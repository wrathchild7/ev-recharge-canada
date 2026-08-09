#!/usr/bin/env node
// ============================================================
// generate-station-index.js
// Fetches ALL Canadian EV stations from NREL in a SINGLE request
// and produces the static data files served by GitHub Pages.
//
// The browser never calls NREL — it reads these files instead.
// That keeps the API key private and removes the rate limit entirely.
//
// Run:  NREL_API_KEY=xxxx node scripts/generate-station-index.js
//   or: set NREL_API_KEY=xxxx  (PowerShell: $env:NREL_API_KEY="xxxx")
//
// Output:
//   data/station-index.json      lightweight index for the search bar
//   data/stations/{PROV}.json    full station data per province (13 files)
// ============================================================

const https = require('https');
const fs = require('fs');
const path = require('path');

// --- API key comes from the environment, never committed ---
const NREL_API_KEY = process.env.NREL_API_KEY;
if (!NREL_API_KEY) {
  console.error('\nERREUR : variable NREL_API_KEY absente.\n');
  console.error('  PowerShell : $env:NREL_API_KEY="votre_cle"');
  console.error('  CMD        : set NREL_API_KEY=votre_cle');
  console.error('  bash       : export NREL_API_KEY=votre_cle\n');
  console.error('Obtenir une cle : https://developer.nlr.gov/signup/\n');
  process.exit(1);
}

// NOTE — changement de domaine, mai 2026.
// NREL a ete renomme "National Laboratory of the Rockies" (NLR) et le domaine
// developer.nrel.gov a cesse de resoudre le 29 mai 2026 (aucune redirection).
// Les cles API existantes restent valides : seul le domaine change.
// https://developer.nlr.gov/docs/nlr-domain-transition/
const NREL_URL = `https://developer.nlr.gov/api/alt-fuel-stations/v1.json?api_key=${NREL_API_KEY}`
  + '&fuel_type=ELEC&country=CA&status=E&access=public&limit=all';

const PROVINCES = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'];

// Connector code mapping — must stay in sync with NREL_CONNECTOR_MAP in js/regions.js
const CONNECTOR_MAP = {
  'J1772': 'J1772',
  'J1772COMBO': 'CCS1',
  'CCS': 'CCS1',
  'CHADEMO': 'CHAdeMO',
  'TESLA': 'NACS / Tesla',
  'NEMA_14_50': 'NEMA 14-50',
  'NEMA_5_15': 'NEMA 5-15',
  'NEMA_5_20': 'NEMA 5-20'
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) {
          return reject(new Error('HTTP 429 — limite NREL atteinte. Attendre une heure.'));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Reponse JSON invalide : ' + e.message)); }
      });
    }).on('error', reject);
  });
}

// Fix common UTF-8 encoding issues in French station names
function fixEncoding(str) {
  if (!str) return '';
  return str
    .replace(/Ã©/g, 'é').replace(/Ã¨/g, 'è').replace(/Ãª/g, 'ê')
    .replace(/Ã /g, 'à').replace(/Ã¢/g, 'â').replace(/Ã®/g, 'î')
    .replace(/Ã´/g, 'ô').replace(/Ã¹/g, 'ù').replace(/Ã»/g, 'û')
    .replace(/Ã§/g, 'ç').replace(/Ã‰/g, 'É').replace(/Ã€/g, 'À')
    .replace(/Ã"/g, 'Ô')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const round5 = n => Math.round(n * 100000) / 100000;

// Shape MUST match normalizeNREL() in js/regions.js — the map code depends on it
function normalize(s) {
  let connectors = [];
  if (Array.isArray(s.ev_connector_types)) {
    connectors = [...new Set(s.ev_connector_types.map(c => CONNECTOR_MAP[c] || c))];
  }
  return {
    id: 'nrel_' + s.id,
    name: fixEncoding(s.station_name || ''),
    latitude: round5(s.latitude),
    longitude: round5(s.longitude),
    ev_level1_evse_num: s.ev_level1_evse_num || 0,
    ev_level2_evse_num: s.ev_level2_evse_num || 0,
    ev_dc_fast_num: s.ev_dc_fast_num || 0,
    ev_connector_types: connectors,
    network: s.ev_network || '',
    address: fixEncoding(s.street_address || ''),
    city: fixEncoding(s.city || ''),
    province: s.state || '',
    zip: s.zip || '',
    source: 'nrel'
  };
}

async function main() {
  const generated = new Date().toISOString().split('T')[0];

  console.log('Requete NREL (toutes les stations canadiennes, 1 seul appel)...');
  const resp = await fetch(NREL_URL);
  const raw = resp.fuel_stations || [];
  console.log(`Recu : ${raw.length} stations\n`);

  if (raw.length === 0) {
    console.error('ERREUR : aucune station recue, generation annulee.');
    process.exit(1);
  }

  const valid = raw.filter(s => s.latitude && s.longitude && PROVINCES.includes(s.state));
  console.log(`Valides (coords + province connue) : ${valid.length}\n`);

  const dataDir = path.join(__dirname, '..', 'data');
  const stationsDir = path.join(dataDir, 'stations');
  fs.mkdirSync(stationsDir, { recursive: true });

  // --- 1. Per-province station files (what the map reads) ---
  const byProvince = {};
  PROVINCES.forEach(p => { byProvince[p] = []; });
  valid.forEach(s => { byProvince[s.state].push(normalize(s)); });

  let totalKB = 0;
  console.log('Fichiers par province :');
  for (const prov of PROVINCES) {
    const stations = byProvince[prov];
    const json = JSON.stringify({ generated, province: prov, count: stations.length, stations });
    const outPath = path.join(stationsDir, `${prov}.json`);
    fs.writeFileSync(outPath, json, 'utf8');
    const kb = Buffer.byteLength(json) / 1024;
    totalKB += kb;
    console.log(`  ${prov}  ${String(stations.length).padStart(5)} stations  ${kb.toFixed(0).padStart(5)} KB`);
  }
  console.log(`  ${''.padEnd(3)} ${''.padStart(5)} total     ${(totalKB / 1024).toFixed(2)} MB (gzip GitHub Pages ~20%)\n`);

  // --- 2. Lightweight search index (unchanged format) ---
  const index = valid.map(s => ({
    i: 'nrel_' + s.id,
    n: fixEncoding(s.station_name || ''),
    w: s.ev_network || '',
    c: fixEncoding(s.city || ''),
    p: s.state,
    a: [Math.round(s.latitude * 10000) / 10000, Math.round(s.longitude * 10000) / 10000]
  }));

  const indexJson = JSON.stringify({ generated, count: index.length, stations: index });
  fs.writeFileSync(path.join(dataDir, 'station-index.json'), indexJson, 'utf8');
  console.log(`station-index.json : ${index.length} entrees, ${(Buffer.byteLength(indexJson) / 1024).toFixed(0)} KB`);

  console.log(`\nTermine. Genere le ${generated}.`);
  console.log('Ne pas oublier : git add data/ && git commit && git push');
}

main().catch(err => { console.error('\nErreur :', err.message); process.exit(1); });
