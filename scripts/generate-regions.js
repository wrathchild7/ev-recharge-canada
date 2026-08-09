#!/usr/bin/env node
// ============================================================
// generate-regions.js
// Fetches StatCan economic region boundaries (2021 census) and
// writes them as static files served by GitHub Pages.
//
// These boundaries essentially never change, so this only needs
// to be re-run if StatCan publishes a new census geography.
//
// Run: node scripts/generate-regions.js
// Output: data/regions/{PROV}.json  (13 files)
// ============================================================

const https = require('https');
const fs = require('fs');
const path = require('path');

const STATCAN_ER_URL = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/2/query';

// Province code -> StatCan PRUID
const PROVINCE_UID = {
  NL:'10', PE:'11', NS:'12', NB:'13', QC:'24', ON:'35',
  MB:'46', SK:'47', AB:'48', BC:'59', YT:'60', NT:'61', NU:'62'
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Reponse JSON invalide : ' + e.message)); }
      });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Round every coordinate to 4 decimals (~11 m) — plenty for region outlines
function trimCoords(node) {
  if (Array.isArray(node)) {
    if (typeof node[0] === 'number') {
      return node.map(n => Math.round(n * 10000) / 10000);
    }
    return node.map(trimCoords);
  }
  return node;
}

async function fetchProvince(prov) {
  const params = new URLSearchParams({
    where: `PRUID = '${PROVINCE_UID[prov]}'`,
    outFields: 'ERUID,ERNAME,PRUID,LANDAREA',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.01',
    f: 'geojson'
  });

  const data = await fetch(`${STATCAN_ER_URL}?${params}`);
  if (data.error) throw new Error(JSON.stringify(data.error));
  if (!data.features || data.features.length === 0) throw new Error('aucune region retournee');

  data.features.forEach(f => {
    if (f.geometry && f.geometry.coordinates) {
      f.geometry.coordinates = trimCoords(f.geometry.coordinates);
    }
  });

  return data;
}

async function main() {
  const outDir = path.join(__dirname, '..', 'data', 'regions');
  fs.mkdirSync(outDir, { recursive: true });

  let totalKB = 0;
  let failed = [];

  console.log('Regions economiques StatCan (recensement 2021)\n');

  for (const prov of Object.keys(PROVINCE_UID)) {
    try {
      const geojson = await fetchProvince(prov);
      const json = JSON.stringify(geojson);
      fs.writeFileSync(path.join(outDir, `${prov}.json`), json, 'utf8');
      const kb = Buffer.byteLength(json) / 1024;
      totalKB += kb;
      console.log(`  ${prov}  ${String(geojson.features.length).padStart(2)} regions  ${kb.toFixed(0).padStart(5)} KB`);
    } catch (e) {
      console.error(`  ${prov}  ECHEC : ${e.message}`);
      failed.push(prov);
    }
    await sleep(500); // be polite with the StatCan service
  }

  console.log(`\nTotal : ${(totalKB / 1024).toFixed(2)} MB`);

  if (failed.length) {
    console.error(`\nProvinces en echec : ${failed.join(', ')} — relancer le script.`);
    process.exit(1);
  }

  console.log('Termine. git add data/regions/ && git commit && git push');
}

main().catch(err => { console.error('\nErreur :', err.message); process.exit(1); });
