#!/usr/bin/env node
// ============================================================
// generate-station-index.js
// Fetches all Canadian EV stations from NREL API and produces
// a lightweight JSON index for the search bar.
// Run: node scripts/generate-station-index.js
// Output: data/station-index.json
// ============================================================

const https = require('https');
const fs = require('fs');
const path = require('path');

const NREL_API_KEY = 'dd2z5DSuHRQFP3zWOp1CbdFz1N3zVg2QERFIAiNe';
const NREL_URL = `https://developer.nrel.gov/api/alt-fuel-stations/v1.json?api_key=${NREL_API_KEY}&fuel_type=ELEC&country=CA&status=E&limit=all`;

const PROVINCE_ABBREV = {
  'AB': 'AB', 'BC': 'BC', 'MB': 'MB', 'NB': 'NB',
  'NL': 'NL', 'NS': 'NS', 'NT': 'NT', 'NU': 'NU',
  'ON': 'ON', 'PE': 'PE', 'QC': 'QC', 'SK': 'SK', 'YT': 'YT'
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(JSON.parse(data));
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
    .replace(/Ã"/g, 'Ô');
}

async function main() {
  console.log('Fetching all Canadian EV stations from NREL...');
  const resp = await fetch(NREL_URL);
  const stations = resp.fuel_stations || [];
  console.log(`Received ${stations.length} stations`);

  // Build lightweight index: only fields needed for search
  const index = stations
    .filter(s => s.latitude && s.longitude && PROVINCE_ABBREV[s.state])
    .map(s => ({
      i: 'nrel_' + s.id,                          // id
      n: fixEncoding(s.station_name || ''),         // name
      w: s.ev_network || '',                        // network
      c: fixEncoding(s.city || ''),                 // city
      p: s.state,                                   // province code
      a: [Math.round(s.latitude * 10000) / 10000,   // lat (4 decimals ~ 11m precision)
          Math.round(s.longitude * 10000) / 10000]   // lng
    }));

  console.log(`Index entries: ${index.length}`);

  // Write to data/station-index.json
  const outDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, 'station-index.json');
  const json = JSON.stringify({ generated: new Date().toISOString().split('T')[0], count: index.length, stations: index });
  fs.writeFileSync(outPath, json, 'utf8');

  const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.log(`Written to ${outPath} (${sizeKB} KB)`);
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
