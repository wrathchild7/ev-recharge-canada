// ============================================================
// Regions Module — Economic Regions Drill-Down (Phase 2)
// ============================================================

// StatCan ArcGIS REST API — Economic Regions layer
const STATCAN_ER_URL = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/2/query';

// --- Station Data Sources ---
// NREL Alt Fuel Stations API (primary — includes Canadian stations via NRCan partnership)
const NREL_API_URL = 'https://developer.nrel.gov/api/alt-fuel-stations/v1.json';
const NREL_API_KEY = 'dd2z5DSuHRQFP3zWOp1CbdFz1N3zVg2QERFIAiNe';

// Open Charge Map API (fallback — global open registry)
const OCM_API_URL = 'https://api.openchargemap.io/v3/poi/';
const OCM_API_KEY = ''; // Get free key at openchargemap.org → My Profile → My Apps

// Province code to PRUID mapping (StatCan PRUID)
const provinceToUID = {
  NL:'10', PE:'11', NS:'12', NB:'13', QC:'24', ON:'35',
  MB:'46', SK:'47', AB:'48', BC:'59', YT:'60', NT:'61', NU:'62'
};

// --- State ---
let regionLayer = null;
let stationMarkers = null;
let cachedRegionData = {};  // { provinceCode: geojson }
let cachedStations = {};    // { provinceCode: [stations] }
let currentDrillProvince = null;
let drillDownInitialized = false; // guard against multiple initDrillDown() calls
let zoomEndHandler = null; // named reference so we don't stack handlers
let drillAnimating = false; // guard to prevent zoomend during fitBounds animation
let regionZoomHandler = null; // named reference for dynamic opacity on zoom
let stationClusterGroup = null; // Leaflet.markercluster group for station markers


// --- localStorage persistent cache (30-day TTL) ---
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LS_PREFIX = 'evca_';

function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      localStorage.removeItem(LS_PREFIX + key);
      console.log(`Cache expired for ${key}`);
      return null;
    }
    console.log(`Cache hit for ${key} (age: ${((Date.now() - entry.ts) / 86400000).toFixed(1)} days)`);
    return entry.data;
  } catch(e) { return null; }
}

function lsSet(key, data) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch(e) {
    // localStorage full — evict oldest entries and retry
    console.warn('localStorage full, clearing old EV cache entries');
    Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX)).forEach(k => localStorage.removeItem(k));
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch(e2) { /* give up */ }
  }
}

// --- Fetch Economic Regions GeoJSON from StatCan ---
async function fetchRegionsForProvince(provinceCode) {
  // 1. In-memory cache
  if (cachedRegionData[provinceCode]) return cachedRegionData[provinceCode];

  // 2. localStorage cache (30 days)
  const lsData = lsGet('regions_' + provinceCode);
  if (lsData) {
    cachedRegionData[provinceCode] = lsData;
    return lsData;
  }

  // 3. Fetch from StatCan API
  const pruid = provinceToUID[provinceCode];
  if (!pruid) return null;

  const params = new URLSearchParams({
    where: `PRUID = '${pruid}'`,
    outFields: 'ERUID,ERNAME,PRUID,LANDAREA',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.01',
    f: 'geojson'
  });

  try {
    const resp = await fetch(`${STATCAN_ER_URL}?${params}`);
    if (!resp.ok) throw new Error(`StatCan API error: ${resp.status}`);
    const data = await resp.json();
    if (data.error) {
      console.error('StatCan query error:', data.error);
      return null;
    }
    if (!data.features || data.features.length === 0) {
      console.warn('No features returned for', provinceCode);
      return null;
    }
    console.log(`Loaded ${data.features.length} economic regions for ${provinceCode} (from API)`);
    cachedRegionData[provinceCode] = data;
    lsSet('regions_' + provinceCode, data);
    return data;
  } catch(e) {
    console.error('Failed to fetch regions for', provinceCode, e);
    return null;
  }
}

// --- Province bounding boxes (approx lat/lng) for OCM spatial queries ---
const provinceBounds = {
  NL:[46.6,-67.8,60.4,-52.6], PE:[45.9,-64.5,47.1,-61.9], NS:[43.4,-66.5,47.0,-59.7],
  NB:[44.6,-69.1,48.1,-63.8], QC:[45.0,-79.8,62.6,-57.1], ON:[41.7,-95.2,56.9,-74.3],
  MB:[49.0,-102.0,60.0,-88.9], SK:[49.0,-110.0,60.0,-101.4], AB:[49.0,-120.0,60.0,-110.0],
  BC:[48.3,-139.1,60.0,-114.0], YT:[60.0,-141.0,69.6,-124.0], NT:[60.0,-136.5,78.8,-102.0],
  NU:[51.7,-120.4,83.1,-61.0]
};

// --- Fix garbled UTF-8 characters common in NREL French data ---
function fixEncoding(str) {
  if (!str) return '';
  return str
    // Double-encoded UTF-8 via Windows-1252: ‚Äì = — (em-dash), ‚Äî = – (en-dash)
    .replace(/\u201A\u00C4\u00EC/g, ' – ')   // ‚Äì → –
    .replace(/\u201A\u00C4\u00EE/g, ' – ')   // ‚Äî → –
    .replace(/\u00C3\u00A9/g, 'é')
    .replace(/\u00C3\u00A8/g, 'è')
    .replace(/\u00C3\u00A0/g, 'à')
    .replace(/\u00C3\u00A2/g, 'â')
    .replace(/\u00C3\u00AE/g, 'î')
    .replace(/\u00C3\u00B4/g, 'ô')
    .replace(/\u00C3\u00B9/g, 'ù')
    .replace(/\u00C3\u00AB/g, 'ë')
    .replace(/\u00C3\u00AF/g, 'ï')
    .replace(/\u00C3\u00BC/g, 'ü')
    .replace(/\u00C3\u00A7/g, 'ç')
    .replace(/\u00C3\u0089/g, 'É')
    .replace(/\u00C3\u0088/g, 'È')
    .replace(/\u00C3\u0080/g, 'À')
    .replace(/\u00C3\u0087/g, 'Ç')
    .replace(/\u0152/g, 'œ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// --- Normalize: convert NREL station to common format ---
function normalizeNREL(s) {
  return {
    id: 'nrel_' + s.id,
    name: fixEncoding(s.station_name || ''),
    latitude: s.latitude,
    longitude: s.longitude,
    ev_level1_evse_num: s.ev_level1_evse_num || 0,
    ev_level2_evse_num: s.ev_level2_evse_num || 0,
    ev_dc_fast_num: s.ev_dc_fast_num || 0,
    network: s.ev_network || '',
    address: fixEncoding(s.street_address || ''),
    city: fixEncoding(s.city || ''),
    province: s.state || '',
    zip: s.zip || '',
    source: 'nrel'
  };
}

// --- Normalize: convert OCM station to common format ---
function normalizeOCM(s) {
  let l1 = 0, l2 = 0, dc = 0;
  if (s.Connections) {
    s.Connections.forEach(c => {
      const qty = c.Quantity || 1;
      const levelId = c.LevelID || (c.Level ? c.Level.ID : 0);
      // OCM Level IDs: 1=Level 1, 2=Level 2, 3=DC Fast
      if (levelId === 1) l1 += qty;
      else if (levelId === 2) l2 += qty;
      else if (levelId === 3) dc += qty;
      else l2 += qty; // default to L2 if unknown
    });
  }
  const addr = s.AddressInfo || {};
  return {
    id: 'ocm_' + s.ID,
    name: addr.Title || '',
    latitude: addr.Latitude,
    longitude: addr.Longitude,
    ev_level1_evse_num: l1,
    ev_level2_evse_num: l2,
    ev_dc_fast_num: dc,
    network: s.OperatorInfo ? (s.OperatorInfo.Title || '') : '',
    address: addr.AddressLine1 || '',
    city: addr.Town || '',
    province: addr.StateOrProvince || '',
    zip: addr.Postcode || '',
    source: 'ocm'
  };
}

// --- Fetch from NREL (primary source) ---
async function fetchFromNREL(provinceCode) {
  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const params = new URLSearchParams({
        api_key: NREL_API_KEY,
        fuel_type: 'ELEC',
        country: 'CA',
        state: provinceCode,
        status: 'E',
        access: 'public',
        limit: 'all'
      });
      const resp = await fetch(`${NREL_API_URL}?${params}`);
      if (resp.status === 429) {
        console.warn(`NREL 429 (attempt ${attempt+1}/${maxRetries})`);
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        return null; // signal to try fallback
      }
      if (!resp.ok) throw new Error(`NREL ${resp.status}`);
      const data = await resp.json();
      const raw = data.fuel_stations || [];
      if (raw.length === 0) return null;
      console.log(`NREL: ${raw.length} stations for ${provinceCode}`);
      return raw.map(normalizeNREL);
    } catch(e) {
      console.warn('NREL failed:', e.message);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      return null;
    }
  }
  return null;
}

// --- Fetch from OCM (fallback source) ---
async function fetchFromOCM(provinceCode) {
  if (!OCM_API_KEY) {
    console.warn('OCM: no API key configured — skipping fallback');
    return null;
  }
  const bounds = provinceBounds[provinceCode];
  if (!bounds) return null;

  try {
    // OCM supports bounding box via boundingbox param: (sw_lat),(sw_lng),(ne_lat),(ne_lng)
    const params = new URLSearchParams({
      output: 'json',
      countrycode: 'CA',
      boundingbox: `(${bounds[0]}),(${bounds[1]}),(${bounds[2]}),(${bounds[3]})`,
      maxresults: '10000',
      compact: 'true',
      verbose: 'false',
      key: OCM_API_KEY
    });
    const resp = await fetch(`${OCM_API_URL}?${params}`);
    if (!resp.ok) throw new Error(`OCM ${resp.status}`);
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    // Filter to operational stations only (StatusTypeID 50 = Operational)
    const operational = data.filter(s =>
      !s.StatusTypeID || s.StatusTypeID === 50 || s.StatusTypeID === 0
    );
    console.log(`OCM: ${operational.length} stations for ${provinceCode} (${data.length} total)`);
    return operational.map(normalizeOCM);
  } catch(e) {
    console.warn('OCM failed:', e.message);
    return null;
  }
}

// --- Merge & deduplicate stations from two sources (by proximity ~50m) ---
function mergeStations(primary, secondary) {
  if (!primary || primary.length === 0) return secondary || [];
  if (!secondary || secondary.length === 0) return primary;

  // Build a spatial index from primary stations (simple grid)
  const grid = {};
  const cellSize = 0.001; // ~111m at equator, good enough for dedup
  primary.forEach(s => {
    const key = Math.round(s.latitude / cellSize) + ',' + Math.round(s.longitude / cellSize);
    if (!grid[key]) grid[key] = [];
    grid[key].push(s);
  });

  let added = 0;
  const merged = [...primary];

  secondary.forEach(s => {
    if (!s.latitude || !s.longitude) return;
    const key = Math.round(s.latitude / cellSize) + ',' + Math.round(s.longitude / cellSize);
    // Check this cell + neighbors for duplicates
    let isDupe = false;
    for (let dx = -1; dx <= 1 && !isDupe; dx++) {
      for (let dy = -1; dy <= 1 && !isDupe; dy++) {
        const nk = (Math.round(s.latitude / cellSize) + dx) + ',' + (Math.round(s.longitude / cellSize) + dy);
        const cell = grid[nk];
        if (cell) {
          for (const p of cell) {
            const dist = Math.abs(p.latitude - s.latitude) + Math.abs(p.longitude - s.longitude);
            if (dist < 0.0005) { isDupe = true; break; } // ~50m
          }
        }
      }
    }
    if (!isDupe) {
      merged.push(s);
      added++;
      // Add to grid so subsequent OCM entries also dedup against it
      if (!grid[key]) grid[key] = [];
      grid[key].push(s);
    }
  });

  if (added > 0) console.log(`Merge: +${added} unique stations from secondary source`);
  return merged;
}

// --- Main fetch: NREL primary → OCM fallback → merge, cache 30 days ---
async function fetchStationsForProvince(provinceCode) {
  // 1. In-memory cache
  if (cachedStations[provinceCode]) return cachedStations[provinceCode];

  // 2. localStorage cache (30 days)
  const lsData = lsGet('stations_' + provinceCode);
  if (lsData) {
    cachedStations[provinceCode] = lsData;
    return lsData;
  }

  // 3. Fetch from BOTH sources in parallel, merge & deduplicate
  console.log(`Fetching station data for ${provinceCode} (NREL + OCM)...`);

  const [nrelStations, ocmStations] = await Promise.all([
    fetchFromNREL(provinceCode),
    fetchFromOCM(provinceCode)
  ]);

  // Merge: NREL is primary, OCM fills the gaps (dedup by proximity)
  const stations = mergeStations(nrelStations, ocmStations);
  const nrelCount = nrelStations ? nrelStations.length : 0;
  const ocmCount = ocmStations ? ocmStations.length : 0;
  console.log(`Sources: NREL=${nrelCount}, OCM=${ocmCount}, merged=${stations.length}`);

  cachedStations[provinceCode] = stations;
  if (stations.length > 0) {
    lsSet('stations_' + provinceCode, stations);
    const sources = [...new Set(stations.map(s => s.source))].join('+');
    console.log(`Cached ${stations.length} stations for ${provinceCode} (sources: ${sources}, TTL: 30 days)`);
  }
  return stations;
}

// --- Count stations per economic region ---
function countStationsPerRegion(regions, stations) {
  if (!regions || !regions.features || !stations) return {};

  const counts = {};

  // Initialize counts per region
  regions.features.forEach(f => {
    const eruid = f.properties.ERUID;
    counts[eruid] = { total: 0, level2: 0, dcFast: 0, level1: 0, name: f.properties.ERNAME };
  });

  // For each station, find which region it belongs to using point-in-polygon
  stations.forEach(station => {
    if (!station.latitude || !station.longitude) return;
    const pt = [station.longitude, station.latitude];

    for (const feature of regions.features) {
      if (pointInPolygon(pt, feature)) {
        const eruid = feature.properties.ERUID;
        counts[eruid].total += (station.ev_level1_evse_num || 0) +
                               (station.ev_level2_evse_num || 0) +
                               (station.ev_dc_fast_num || 0);
        counts[eruid].level1 += station.ev_level1_evse_num || 0;
        counts[eruid].level2 += station.ev_level2_evse_num || 0;
        counts[eruid].dcFast += station.ev_dc_fast_num || 0;
        break;
      }
    }
  });

  return counts;
}

// --- Simple point-in-polygon (ray casting) ---
function pointInPolygon(point, feature) {
  const geom = feature.geometry;
  if (!geom) return false;

  let polygons = [];
  if (geom.type === 'Polygon') {
    polygons = [geom.coordinates];
  } else if (geom.type === 'MultiPolygon') {
    polygons = geom.coordinates;
  }

  for (const polygon of polygons) {
    const ring = polygon[0]; // outer ring
    if (raycast(point, ring)) return true;
  }
  return false;
}

function raycast(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// --- Dynamic opacity based on zoom level (provinces fade as user zooms in) ---
function getDrillOpacity(zoom) {
  if (zoom <= 7)  return 0.70;
  if (zoom <= 8)  return 0.18;
  if (zoom <= 9)  return 0.12;
  if (zoom <= 10) return 0.08;
  if (zoom <= 11) return 0.05;
  return 0; // zoom 12+: fully transparent
}

function applyDrillOpacity() {
  if (!geoLayer || !currentDrillProvince) return;
  const zoom = map.getZoom();
  const opacity = getDrillOpacity(zoom);
  geoLayer.eachLayer(function(layer) {
    if (layer.feature) {
      if (zoom >= 8) {
        // Voyager tiles active — remove all polygon fill and borders for clear road view
        layer.setStyle({ fillOpacity: 0, weight: 0, opacity: 0 });
      } else {
        layer.setStyle({ fillOpacity: opacity, weight: 2, opacity: 1, color: '#ffffff' });
      }
    }
  });

  // At zoom 8+, switch to Voyager road tiles; below 8, use light tiles for choropleth
  if (typeof baseTileLight !== 'undefined' && typeof baseTileVoyager !== 'undefined') {
    if (zoom >= 8) {
      if (map.hasLayer(baseTileLight)) map.removeLayer(baseTileLight);
      if (!map.hasLayer(baseTileVoyager)) map.addLayer(baseTileVoyager);
      // Voyager includes labels, so remove the separate labels overlay
      if (labelsLayer && map.hasLayer(labelsLayer)) map.removeLayer(labelsLayer);
      // Ensure Voyager is behind everything
      baseTileVoyager.setZIndex(0);
    } else {
      if (map.hasLayer(baseTileVoyager)) map.removeLayer(baseTileVoyager);
      if (!map.hasLayer(baseTileLight)) map.addLayer(baseTileLight);
    }
  }

  // At zoom 8+, hide region borders; below 8, show them
  if (regionLayer) {
    if (zoom >= 8) {
      if (map.hasLayer(regionLayer)) map.removeLayer(regionLayer);
    } else {
      if (!map.hasLayer(regionLayer)) map.addLayer(regionLayer);
    }
  }

  // At zoom 8+, show station markers; below 8, hide them
  if (stationClusterGroup) {
    if (zoom >= 8) {
      if (!map.hasLayer(stationClusterGroup)) {
        map.addLayer(stationClusterGroup);
      }
    } else {
      if (map.hasLayer(stationClusterGroup)) {
        map.removeLayer(stationClusterGroup);
      }
    }
  }

  // At zoom 8+, switch legends: hide price legend, show station legend
  const priceLegend = document.getElementById('map-legend');
  let stationLegend = document.getElementById('station-legend');
  if (zoom >= 8 && currentDrillProvince) {
    if (priceLegend) priceLegend.style.display = 'none';
    if (!stationLegend) {
      stationLegend = document.createElement('div');
      stationLegend.id = 'station-legend';
      stationLegend.className = 'legend station-legend';
      const boltMini = (color) => `<svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:middle;"><circle cx="12" cy="12" r="11" fill="${color}" stroke="#fff" stroke-width="2"/><path d="M13 4L8 13h3.5l-1 7 5.5-9H12.5z" fill="#fff"/></svg>`;
      const l2Label = currentLang === 'fr' ? 'Niveau 1 / Niveau 2' : 'Level 1 / Level 2';
      const dcLabel = currentLang === 'fr' ? 'DC Rapide' : 'DC Fast';
      const clusterLabel = currentLang === 'fr' ? 'Groupe de stations' : 'Station cluster';
      stationLegend.innerHTML = `
        <h4>${currentLang === 'fr' ? 'Bornes de recharge' : 'Charging Stations'}</h4>
        <div class="legend-items" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">
          <span>${boltMini('#2e7d32')} ${l2Label}</span>
          <span>${boltMini('#d32f2f')} ${dcLabel}</span>
          <span><span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:rgba(80,80,80,0.85);border:2px solid #fff;text-align:center;line-height:14px;color:#fff;font-size:10px;font-weight:bold;vertical-align:middle;">n</span> ${clusterLabel}</span>
        </div>
      `;
      if (priceLegend && priceLegend.parentNode) {
        priceLegend.parentNode.insertBefore(stationLegend, priceLegend.nextSibling);
      }
    }
    stationLegend.style.display = '';
  } else {
    if (priceLegend) priceLegend.style.display = '';
    if (stationLegend) stationLegend.style.display = 'none';
  }

  // At zoom 8+, hide region tooltips (station clusters take over)
  if (regionLayer) {
    regionLayer.eachLayer(function(layer) {
      if (zoom >= 8) {
        if (layer.getTooltip()) {
          layer.closeTooltip();
          layer.unbindTooltip();
          // Stash tooltip HTML so we can re-bind when zooming back out
          if (!layer._stashedTooltipHtml && layer.feature) {
            layer._stashedTooltipHtml = layer._tooltipHtmlBackup;
          }
        }
        // Also disable hover highlight at this zoom
        layer.off('mouseover');
        layer.off('mouseout');
      } else {
        // Re-bind tooltip if it was stashed
        if (!layer.getTooltip() && layer._tooltipHtmlBackup) {
          layer.bindTooltip(layer._tooltipHtmlBackup, {
            sticky: true, direction: 'top', className: 'province-tooltip', maxWidth: 300
          });
          // Re-bind hover highlight
          layer.on({
            mouseover: function(e) {
              e.target.setStyle({ weight: 3, color: '#d32f2f', opacity: 1 });
            },
            mouseout: function(e) {
              regionLayer.resetStyle(e.target);
            }
          });
        }
      }
    });
  }
}

// --- Color scale for region station density ---
function getRegionColor(totalPorts) {
  if (totalPorts === 0) return '#e0e0e0';
  if (totalPorts <= 10) return '#c8e6c9';
  if (totalPorts <= 50) return '#a5d6a7';
  if (totalPorts <= 100) return '#81c784';
  if (totalPorts <= 250) return '#66bb6a';
  if (totalPorts <= 500) return '#43a047';
  if (totalPorts <= 1000) return '#2e7d32';
  return '#1b5e20';
}

// --- Render region layer on the map (outline only, no fill) ---
function renderRegionLayer(regionGeoJSON, stationCounts) {
  if (regionLayer) {
    map.removeLayer(regionLayer);
    regionLayer = null;
  }

  regionLayer = L.geoJSON(regionGeoJSON, {
    pane: 'regionsPane',
    style: function(feature) {
      return {
        fillColor: 'transparent',
        fillOpacity: 0,
        weight: 1.5,
        opacity: 0.6,
        color: '#666666',
        dashArray: '5, 5'
      };
    },
    onEachFeature: function(feature, layer) {
      const eruid = feature.properties.ERUID;
      const count = stationCounts[eruid] || { total: 0, level1: 0, level2: 0, dcFast: 0 };
      const locale = currentLang === 'fr' ? 'fr-CA' : 'en-CA';
      const num = v => v.toLocaleString(locale);

      const popupHtml = `
        <div class="province-popup">
          <h3>${feature.properties.ERNAME}</h3>
          <div class="popup-row"><span>${t('popupTotalPorts')}</span><span class="popup-value">${num(count.total)}</span></div>
          <div class="popup-row"><span>${t('popupLevel1')} + ${t('popupLevel2')}</span><span class="popup-value">${num(count.level1 + count.level2)}</span></div>
          <div class="popup-row"><span>${t('popupDCFast')}</span><span class="popup-value">${num(count.dcFast)}</span></div>
        </div>
      `;

      // Backup tooltip HTML so applyDrillOpacity can re-bind after zoom-out
      layer._tooltipHtmlBackup = popupHtml;

      layer.bindTooltip(popupHtml, {
        sticky: true, direction: 'top', className: 'province-tooltip', maxWidth: 300
      });
      layer.on({
        mouseover: function(e) {
          e.target.setStyle({ weight: 3, color: '#d32f2f', opacity: 1 });
        },
        mouseout: function(e) {
          regionLayer.resetStyle(e.target);
        }
      });
    }
  }).addTo(map);
}

// --- Look up provincial pricing for a given province code ---
function getProvincePricing(provinceCode) {
  if (typeof evData === 'undefined' || !evData.provinces) return null;
  return evData.provinces.find(p => p.code === provinceCode) || null;
}

// --- Station Marker Cluster ---

// =====================================================================
// NETWORK-SPECIFIC TARIFF DATA
// Sources: official network websites, public rate schedules (2025-2026)
// =====================================================================

// --- FLO (flo.com) — Level 2 set by owner; DCFC varies by location ---
const FLO_TARIFS = {
  level2: {
    fr: 'Fixé par le propriétaire : ~1,00$–2,50$/h',
    en: 'Set by owner: ~$1.00–$2.50/h'
  },
  dcfast: {
    fr: '~0,33$–0,45$/kWh (varie par emplacement)',
    en: '~$0.33–$0.45/kWh (varies by location)'
  },
  note: { fr: 'Tarif affiché à la borne', en: 'Rate shown at charger' }
};

// --- Electrify Canada (electrify-canada.ca) — DCFC only, per-kWh by province ---
const ELECTRIFY_CANADA_TARIFS = {
  provinces: {
    BC: { rate: 0.70, label: 'C.-B.' },
    AB: { rate: 0.60, label: 'Alb.' },
    SK: { rate: 0.60, label: 'Sask.' },
    ON: { rate: 0.65, label: 'Ont.' },
    QC: { rate: 0.65, label: 'Qc' }
  },
  defaultRate: 0.65,
  passPlus: { discount: 0.20, monthly: 7.00 },
  note: { fr: 'Tarif au kWh — Pass+ : -20%', en: 'Per kWh — Pass+: -20%' }
};

// --- Tesla Supercharger (tesla.com/en_ca/support/charging/supercharging) ---
const TESLA_TARIFS = {
  provinces: {
    BC: { peak: 0.48, offpeak: null },
    AB: { peak: 0.71, offpeak: null },
    SK: { peak: 0.58, offpeak: null },
    MB: { peak: 0.51, offpeak: null },
    ON: { peak: 0.55, offpeak: 0.42 },
    QC: { peak: 0.52, offpeak: 0.40 }
  },
  defaultPeak: 0.55,
  note: {
    fr: 'Tarifs varient par station — heures creuses disponibles dans certaines provinces',
    en: 'Rates vary by station — off-peak hours available in some provinces'
  }
};

// --- IVY Charging Network (ivycharge.com) — Ontario only ---
const IVY_TARIFS = {
  dcfast: { rate: 0.62, taxIncluded: true },
  level2: {
    fr: 'Jusqu\'à 2,50$/h',
    en: 'Up to $2.50/h'
  },
  note: { fr: 'Taxes incluses', en: 'Tax included' }
};

// --- Petro-Canada / Suncor Electric Highway (petro-canada.ca) ---
const PETROCAN_TARIFS = {
  dcfast: {
    fr: '~0,50$/min (varie par emplacement)',
    en: '~$0.50/min (varies by location)'
  },
  note: {
    fr: 'Pas de frais de connexion ni d\'inactivité',
    en: 'No connection or idle fees'
  }
};

// --- SWTCH (swtchenergy.com) — Ontario ---
const SWTCH_TARIFS = {
  dcfast: {
    fr: '~12,00$/h (BRCC) — N2 souvent gratuit',
    en: '~$12.00/h (DCFC) — L2 often free'
  },
  note: { fr: 'Stationnement peut s\'ajouter', en: 'Parking may apply' }
};

// --- BC Hydro (bchydro.com) ---
const BCHYDRO_TARIFS = {
  dcfast: { rate: 0.28 },
  level2: {
    fr: 'Gratuit ou faible coût',
    en: 'Free or low cost'
  },
  note: { fr: 'Réseau provincial C.-B.', en: 'BC provincial network' }
};

// --- Circuit Électrique tariff data (taxes included, source: lecircuitelectrique.com/tarifs) ---
const CIRCUIT_ELECTRIQUE_TARIFS = {
  level2: {
    fr: 'Tarif fixé par le propriétaire : entre 0,25$ et 3$/h',
    en: 'Set by owner: $0.25–$3.00/h'
  },
  dcfast: [
    {
      label: { fr: '24 kW', en: '24 kW' },
      tiers: [
        { range: { fr: '0–10 kW', en: '0–10 kW' }, rate: '8,14 $/h', unit: 'h' },
        { range: { fr: '> 10 kW', en: '> 10 kW' }, rate: '0,38 $/kWh', unit: 'kWh' }
      ]
    },
    {
      label: { fr: '50 kW', en: '50 kW' },
      tiers: [
        { range: { fr: '0–20 kW', en: '0–20 kW' }, rate: '13,80 $/h', unit: 'h' },
        { range: { fr: '20–50 kW', en: '20–50 kW' }, rate: '0,38 $/kWh', unit: 'kWh' }
      ]
    },
    {
      label: { fr: '100 kW', en: '100 kW' },
      tiers: [
        { range: { fr: '0–20 kW', en: '0–20 kW' }, rate: '17,00 $/h', unit: 'h' },
        { range: { fr: '20–50 kW', en: '20–50 kW' }, rate: '0,49 $/kWh', unit: 'kWh' },
        { range: { fr: '50–100 kW', en: '50–100 kW' }, rate: '0,44 $/kWh', unit: 'kWh' }
      ]
    },
    {
      label: { fr: '120 kW+', en: '120 kW+' },
      tiers: [
        { range: { fr: '0–20 kW', en: '0–20 kW' }, rate: '19,22 $/h', unit: 'h' },
        { range: { fr: '20–50 kW', en: '20–50 kW' }, rate: '0,55 $/kWh', unit: 'kWh' },
        { range: { fr: '50–90 kW', en: '50–90 kW' }, rate: '0,44 $/kWh', unit: 'kWh' },
        { range: { fr: '90–180 kW', en: '90–180 kW' }, rate: '0,55 $/kWh', unit: 'kWh' },
        { range: { fr: '180 kW+', en: '180 kW+' }, rate: '0,62 $/kWh', unit: 'kWh' }
      ]
    }
  ]
};

function isCircuitElectrique(networkName) {
  if (!networkName) return false;
  const n = networkName.toLowerCase();
  return n.includes('circuit') || n.includes('lectrique');
}

function buildCircuitElectriquePricingHtml(station) {
  const lang = currentLang || 'fr';
  const hasDC = (station.ev_dc_fast_num || 0) > 0;
  const hasL2 = (station.ev_level2_evse_num || 0) > 0 || (station.ev_level1_evse_num || 0) > 0;

  let html = '<hr style="margin:0.4rem 0;border:none;border-top:1px solid #e0e0e0">';
  html += '<div style="font-size:0.82em;color:#1565c0;font-weight:700;margin-bottom:4px;">⚡ Circuit Électrique</div>';

  if (hasL2 && !hasDC) {
    // Level 2 only
    html += `<div style="font-size:0.8em;color:#555;">${CIRCUIT_ELECTRIQUE_TARIFS.level2[lang]}</div>`;
  }

  if (hasDC) {
    // Show DC Fast tier table — pick the best matching tier based on station's DC port count
    // We show all tiers since we don't know the exact borne power
    const titleDC = lang === 'fr' ? 'Bornes rapides (par palier)' : 'DC Fast (tiered)';
    html += `<div style="font-size:0.78em;color:#555;font-weight:600;margin:3px 0 2px 0;">${titleDC}</div>`;
    html += '<table style="width:100%;font-size:0.75em;border-collapse:collapse;margin-bottom:2px;">';
    html += `<tr style="color:#888;"><td style="padding:1px 4px;font-weight:600;">${lang === 'fr' ? 'Borne' : 'Charger'}</td><td style="padding:1px 4px;font-weight:600;">${lang === 'fr' ? 'Puissance' : 'Power'}</td><td style="padding:1px 4px;text-align:right;font-weight:600;">${lang === 'fr' ? 'Tarif' : 'Rate'}</td></tr>`;

    CIRCUIT_ELECTRIQUE_TARIFS.dcfast.forEach(function(tier) {
      tier.tiers.forEach(function(t, i) {
        const borneLabel = i === 0 ? tier.label[lang] : '';
        const bgColor = i === 0 ? 'rgba(21,101,192,0.04)' : 'transparent';
        html += `<tr style="background:${bgColor};"><td style="padding:1px 4px;font-weight:${i === 0 ? '600' : '400'};color:#333;">${borneLabel}</td><td style="padding:1px 4px;color:#555;">${t.range[lang]}</td><td style="padding:1px 4px;text-align:right;color:#1b5e20;font-weight:600;">${t.rate}</td></tr>`;
      });
    });
    html += '</table>';

    // Also show L2 info if station has both
    if (hasL2) {
      const l2Title = lang === 'fr' ? 'Niveau 2' : 'Level 2';
      html += `<div style="font-size:0.78em;color:#555;margin-top:2px;"><b>${l2Title}:</b> ${CIRCUIT_ELECTRIQUE_TARIFS.level2[lang]}</div>`;
    }
  }

  const noteLabel = lang === 'fr' ? 'Taxes incluses' : 'Tax included';
  html += `<div style="font-size:0.7em;color:#999;margin-top:2px;font-style:italic;">${noteLabel}</div>`;
  return html;
}

// --- Network detection helpers ---
function detectNetwork(networkName) {
  if (!networkName) return null;
  const n = networkName.toLowerCase();
  if (n.includes('circuit') || n.includes('lectrique')) return 'circuit_electrique';
  if (n.includes('flo')) return 'flo';
  if (n.includes('electrify') && n.includes('canada')) return 'electrify_canada';
  if (n.includes('tesla')) return 'tesla';
  if (n.includes('ivy')) return 'ivy';
  if (n.includes('petro') || n.includes('suncor')) return 'petrocan';
  if (n.includes('swtch')) return 'swtch';
  if (n.includes('bc hydro')) return 'bchydro';
  if (n.includes('chargepoint')) return 'chargepoint';
  return null;
}

// --- Generic network pricing HTML builder ---
function buildNetworkPricingHtml(station, provinceCode) {
  const lang = currentLang || 'fr';
  const network = detectNetwork(station.network);
  if (!network || network === 'circuit_electrique') return null; // Circuit Électrique handled separately

  const hasDC = (station.ev_dc_fast_num || 0) > 0;
  const hasL2 = (station.ev_level2_evse_num || 0) > 0 || (station.ev_level1_evse_num || 0) > 0;
  const hr = '<hr style="margin:0.4rem 0;border:none;border-top:1px solid #e0e0e0">';
  const fmtRate = function(v) { return lang === 'fr' ? v.toFixed(2).replace('.', ',') + ' $/kWh' : '$' + v.toFixed(2) + '/kWh'; };

  let html = hr;
  let networkLabel = '';
  let networkColor = '#1565c0';

  if (network === 'flo') {
    networkLabel = 'FLO';
    networkColor = '#00a651';
    html += `<div style="font-size:0.82em;color:${networkColor};font-weight:700;margin-bottom:4px;">⚡ ${networkLabel}</div>`;
    if (hasDC) {
      html += `<div style="font-size:0.8em;color:#555;"><b>BRCC:</b> ${FLO_TARIFS.dcfast[lang]}</div>`;
    }
    if (hasL2) {
      const l2Label = lang === 'fr' ? 'Niveau 2' : 'Level 2';
      html += `<div style="font-size:0.8em;color:#555;"><b>${l2Label}:</b> ${FLO_TARIFS.level2[lang]}</div>`;
    }
    html += `<div style="font-size:0.7em;color:#999;margin-top:2px;font-style:italic;">${FLO_TARIFS.note[lang]}</div>`;

  } else if (network === 'electrify_canada') {
    networkLabel = 'Electrify Canada';
    networkColor = '#003b5c';
    const provData = ELECTRIFY_CANADA_TARIFS.provinces[provinceCode] || null;
    const rate = provData ? provData.rate : ELECTRIFY_CANADA_TARIFS.defaultRate;
    const passRate = rate * (1 - ELECTRIFY_CANADA_TARIFS.passPlus.discount);
    html += `<div style="font-size:0.82em;color:${networkColor};font-weight:700;margin-bottom:4px;">⚡ ${networkLabel}</div>`;
    html += `<div style="font-size:0.8em;color:#555;"><b>BRCC:</b> ${fmtRate(rate)}</div>`;
    html += `<div style="font-size:0.78em;color:#888;">Pass+ : ${fmtRate(passRate)} (${lang === 'fr' ? '7$/mois' : '$7/mo'})</div>`;
    html += `<div style="font-size:0.7em;color:#999;margin-top:2px;font-style:italic;">${ELECTRIFY_CANADA_TARIFS.note[lang]}</div>`;

  } else if (network === 'tesla') {
    networkLabel = 'Tesla Supercharger';
    networkColor = '#cc0000';
    const provData = TESLA_TARIFS.provinces[provinceCode] || null;
    const peak = provData ? provData.peak : TESLA_TARIFS.defaultPeak;
    const offpeak = provData ? provData.offpeak : null;
    html += `<div style="font-size:0.82em;color:${networkColor};font-weight:700;margin-bottom:4px;">⚡ ${networkLabel}</div>`;
    if (hasDC || (!hasDC && !hasL2)) {
      const peakLabel = lang === 'fr' ? 'Pointe' : 'Peak';
      html += `<div style="font-size:0.8em;color:#555;"><b>${peakLabel}:</b> ${fmtRate(peak)}</div>`;
      if (offpeak) {
        const offLabel = lang === 'fr' ? 'Hors-pointe' : 'Off-peak';
        html += `<div style="font-size:0.8em;color:#555;"><b>${offLabel}:</b> ${fmtRate(offpeak)}</div>`;
      }
    }
    if (hasL2) {
      const destLabel = lang === 'fr' ? 'Destination (N2)' : 'Destination (L2)';
      const destRate = lang === 'fr' ? 'Gratuit ou tarif du site' : 'Free or site rate';
      html += `<div style="font-size:0.8em;color:#555;"><b>${destLabel}:</b> ${destRate}</div>`;
    }
    html += `<div style="font-size:0.7em;color:#999;margin-top:2px;font-style:italic;">${TESLA_TARIFS.note[lang]}</div>`;

  } else if (network === 'ivy') {
    networkLabel = 'IVY';
    networkColor = '#00b388';
    html += `<div style="font-size:0.82em;color:${networkColor};font-weight:700;margin-bottom:4px;">⚡ ${networkLabel}</div>`;
    if (hasDC) {
      html += `<div style="font-size:0.8em;color:#555;"><b>BRCC:</b> ${fmtRate(IVY_TARIFS.dcfast.rate)}</div>`;
    }
    if (hasL2) {
      const l2Label = lang === 'fr' ? 'Niveau 2' : 'Level 2';
      html += `<div style="font-size:0.8em;color:#555;"><b>${l2Label}:</b> ${IVY_TARIFS.level2[lang]}</div>`;
    }
    html += `<div style="font-size:0.7em;color:#999;margin-top:2px;font-style:italic;">${IVY_TARIFS.note[lang]}</div>`;

  } else if (network === 'petrocan') {
    networkLabel = 'Petro-Canada';
    networkColor = '#e31837';
    html += `<div style="font-size:0.82em;color:${networkColor};font-weight:700;margin-bottom:4px;">⚡ ${networkLabel}</div>`;
    html += `<div style="font-size:0.8em;color:#555;"><b>BRCC:</b> ${PETROCAN_TARIFS.dcfast[lang]}</div>`;
    html += `<div style="font-size:0.7em;color:#999;margin-top:2px;font-style:italic;">${PETROCAN_TARIFS.note[lang]}</div>`;

  } else if (network === 'swtch') {
    networkLabel = 'SWTCH';
    networkColor = '#ff6b00';
    html += `<div style="font-size:0.82em;color:${networkColor};font-weight:700;margin-bottom:4px;">⚡ ${networkLabel}</div>`;
    html += `<div style="font-size:0.8em;color:#555;">${SWTCH_TARIFS.dcfast[lang]}</div>`;
    html += `<div style="font-size:0.7em;color:#999;margin-top:2px;font-style:italic;">${SWTCH_TARIFS.note[lang]}</div>`;

  } else if (network === 'bchydro') {
    networkLabel = 'BC Hydro';
    networkColor = '#0072bc';
    html += `<div style="font-size:0.82em;color:${networkColor};font-weight:700;margin-bottom:4px;">⚡ ${networkLabel}</div>`;
    if (hasDC) {
      html += `<div style="font-size:0.8em;color:#555;"><b>BRCC:</b> ${fmtRate(BCHYDRO_TARIFS.dcfast.rate)}</div>`;
    }
    if (hasL2) {
      const l2Label = lang === 'fr' ? 'Niveau 2' : 'Level 2';
      html += `<div style="font-size:0.8em;color:#555;"><b>${l2Label}:</b> ${BCHYDRO_TARIFS.level2[lang]}</div>`;
    }
    html += `<div style="font-size:0.7em;color:#999;margin-top:2px;font-style:italic;">${BCHYDRO_TARIFS.note[lang]}</div>`;

  } else {
    return null; // Unknown network — fall back to provincial average
  }

  return html;
}

function buildStationMarkers(stations, provinceCode) {
  // Clean up previous cluster
  if (stationClusterGroup) {
    map.removeLayer(stationClusterGroup);
    stationClusterGroup = null;
  }
  if (!stations || stations.length === 0) return;

  stationClusterGroup = L.markerClusterGroup({
    maxClusterRadius: 50,
    disableClusteringAtZoom: 17,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    chunkedLoading: true,
    chunkInterval: 100,
    chunkDelay: 10,
    // Neutral gray clusters — avoid confusion with price color legend
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      let size = 36, fontSize = 13;
      if (count >= 100) { size = 46; fontSize = 14; }
      else if (count >= 10) { size = 40; fontSize = 13; }
      return L.divIcon({
        html: `<div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:rgba(80,80,80,0.85);border:3px solid #fff;
          box-shadow:0 2px 6px rgba(0,0,0,0.35);
          display:flex;align-items:center;justify-content:center;
          color:#fff;font-weight:bold;font-size:${fontSize}px;
          font-family:Arial,sans-serif;
        ">${count}</div>`,
        className: 'station-cluster-icon',
        iconSize: L.point(size, size)
      });
    }
  });

  const locale = currentLang === 'fr' ? 'fr-CA' : 'en-CA';
  const num = v => v.toLocaleString(locale);
  const fmtPrice = v => v !== null && v !== undefined ? `$${v.toFixed(2)}` : (currentLang === 'fr' ? 'N/D' : 'N/A');

  // Look up provincial average pricing
  const provPricing = provinceCode ? getProvincePricing(provinceCode) : null;

  // SVG bolt icon for markers
  const boltSvg = (color, sz) => `
    <svg viewBox="0 0 24 24" width="${sz}" height="${sz}" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
      <circle cx="12" cy="12" r="11" fill="${color}" stroke="#fff" stroke-width="2"/>
      <path d="M13 4L8 13h3.5l-1 7 5.5-9H12.5z" fill="#fff"/>
    </svg>`;

  stations.forEach(function(s) {
    if (!s.latitude || !s.longitude) return;

    const total = (s.ev_level1_evse_num || 0) + (s.ev_level2_evse_num || 0) + (s.ev_dc_fast_num || 0);

    // Bolt icon: red for DC Fast, green for L1/L2
    const hasDC = (s.ev_dc_fast_num || 0) > 0;
    const iconColor = hasDC ? '#d32f2f' : '#2e7d32';
    const iconSize = hasDC ? 22 : 18;

    const icon = L.divIcon({
      className: 'station-marker',
      html: boltSvg(iconColor, iconSize),
      iconSize: [iconSize, iconSize],
      iconAnchor: [iconSize / 2, iconSize / 2]
    });

    const networkLabel = s.network || (currentLang === 'fr' ? 'Inconnu' : 'Unknown');

    // Build address line
    let addressLine = '';
    if (s.address || s.city) {
      const parts = [s.address, s.city].filter(Boolean);
      addressLine = `<div style="color:#666;font-size:0.85em;margin:-2px 0 6px 0;">${parts.join(', ')}</div>`;
    }

    // Build pricing section — network-specific if available, otherwise provincial average
    let pricingHtml = '';
    if (isCircuitElectrique(s.network)) {
      // Show detailed Circuit Électrique tariffs (tiered table)
      pricingHtml = buildCircuitElectriquePricingHtml(s);
    } else {
      // Try network-specific pricing for other major networks
      const networkHtml = buildNetworkPricingHtml(s, provinceCode);
      if (networkHtml) {
        pricingHtml = networkHtml;
      } else if (provPricing) {
        // Fallback: provincial average for unknown/unsupported networks
        const provName = getProvinceName(provinceCode);
        const avgLabel = currentLang === 'fr' ? `Coût moyen ${provName}` : `Avg. cost ${provName}`;
        pricingHtml = `
          <hr style="margin:0.4rem 0;border:none;border-top:1px solid #e0e0e0">
          <div style="font-size:0.82em;color:#555;font-weight:600;margin-bottom:3px;">${avgLabel}</div>
          <div class="popup-row"><span>${t('popupLevel2')}</span><span class="popup-value">${fmtPrice(provPricing.level2)}${t('perKwh')}</span></div>
          <div class="popup-row"><span>${t('popupDCFast')}</span><span class="popup-value">${fmtPrice(provPricing.dcFast)}${t('perKwh')}</span></div>
        `;
      }
    }

    const popupHtml = `
      <div class="province-popup">
        <h3>${s.name || 'Station'}</h3>
        ${addressLine}
        <div class="popup-row"><span>${t('popupNetwork')}</span><span class="popup-value">${networkLabel}</span></div>
        <div class="popup-row"><span>${t('popupTotalPorts')}</span><span class="popup-value">${num(total)}</span></div>
        <div class="popup-row"><span>${t('popupLevel1')} + ${t('popupLevel2')}</span><span class="popup-value">${num((s.ev_level1_evse_num || 0) + (s.ev_level2_evse_num || 0))}</span></div>
        <div class="popup-row"><span>${t('popupDCFast')}</span><span class="popup-value">${num(s.ev_dc_fast_num || 0)}</span></div>
        ${pricingHtml}
      </div>
    `;

    const marker = L.marker([s.latitude, s.longitude], { icon: icon });
    marker.bindPopup(popupHtml, { maxWidth: 280 });
    stationClusterGroup.addLayer(marker);
  });

  // Don't add to map yet — applyDrillOpacity will handle visibility based on zoom
  console.log(`Built marker cluster with ${stations.length} stations`);
}

// --- Drill down into a province ---
async function drillIntoProvince(provinceCode) {
  if (currentDrillProvince === provinceCode) return;
  currentDrillProvince = provinceCode;

  // Show loading indicator
  showDrillLoading(true);

  // Fetch regions and stations in parallel
  const [regions, stations] = await Promise.all([
    fetchRegionsForProvince(provinceCode),
    fetchStationsForProvince(provinceCode)
  ]);

  showDrillLoading(false);

  // Count stations per region (for tooltips)
  let stationCounts = {};
  if (regions && regions.features && stations && stations.length > 0) {
    stationCounts = countStationsPerRegion(regions, stations);
  }

  // Show warning if no station data was available (API rate-limited)
  if (!stations || stations.length === 0) {
    showRateLimitWarning(true);
  } else {
    showRateLimitWarning(false);
  }

  // Render region outlines (no fill, just borders + tooltips with station counts)
  if (regions && regions.features && regions.features.length > 0) {
    renderRegionLayer(regions, stationCounts);
  }

  // Build station marker cluster (shown at zoom 8+)
  buildStationMarkers(stations, provinceCode);

  // Unbind province tooltips during drill-down (region tooltips take over)
  if (geoLayer) {
    geoLayer.eachLayer(function(layer) {
      if (layer.getTooltip()) {
        layer.closeTooltip();
        layer.unbindTooltip();
      }
      layer.off('mouseover mouseout');
    });
  }

  // Show city/road labels overlay during drill-down
  if (labelsLayer && !map.hasLayer(labelsLayer)) {
    labelsLayer.addTo(map);
  }

  // Zoom to province bounds
  let provinceBoundsObj = null;
  if (geoLayer) {
    geoLayer.eachLayer(function(layer) {
      if (layer.feature) {
        const prov = getProvinceData(layer.feature);
        if (prov && prov.code === provinceCode) {
          provinceBoundsObj = layer.getBounds();
        }
      }
    });
  }
  if (provinceBoundsObj) {
    map.fitBounds(provinceBoundsObj, { padding: [30, 30] });
  }

  // Dynamic opacity: province fills fade as user zooms deeper
  if (regionZoomHandler) map.off('zoomend', regionZoomHandler);
  regionZoomHandler = applyDrillOpacity;
  map.on('zoomend', regionZoomHandler);
  applyDrillOpacity();

  // Update breadcrumb
  updateBreadcrumb(provinceCode);
}

// --- Drill back to province view ---
function drillBackToProvinces() {
  currentDrillProvince = null;
  showRateLimitWarning(false);

  // Remove region outlines (unbind tooltips first to prevent Leaflet _source null errors)
  if (regionLayer) {
    regionLayer.eachLayer(function(layer) {
      if (layer.getTooltip()) { layer.closeTooltip(); layer.unbindTooltip(); }
      layer.off();
    });
    map.removeLayer(regionLayer);
    regionLayer = null;
  }

  // Remove station markers cluster
  if (stationClusterGroup) {
    map.removeLayer(stationClusterGroup);
    stationClusterGroup = null;
  }

  // Restore price legend, remove station legend
  const priceLeg = document.getElementById('map-legend');
  const stationLeg = document.getElementById('station-legend');
  if (priceLeg) priceLeg.style.display = '';
  if (stationLeg) stationLeg.remove();

  // Restore province layer opacity and tooltips
  if (geoLayer) {
    geoLayer.eachLayer(function(layer) {
      if (layer.feature) {
        const prov = getProvinceData(layer.feature);
        const price = prov ? prov[currentLevel] : null;
        layer.setStyle({
          fillColor: getColor(price),
          weight: 2,
          opacity: 1,
          color: '#ffffff',
          fillOpacity: 0.75
        });
        // Re-bind province tooltips (were removed during drill-down)
        if (prov) {
          layer.bindTooltip(createPopupContent(prov), {
            sticky: true, direction: 'top', className: 'province-tooltip', maxWidth: 300
          });
        }
      }
    });
  }

  // Remove city/road labels overlay
  if (labelsLayer && map.hasLayer(labelsLayer)) {
    map.removeLayer(labelsLayer);
  }

  // Restore light tiles, remove Voyager road tiles
  if (typeof baseTileVoyager !== 'undefined' && map.hasLayer(baseTileVoyager)) {
    map.removeLayer(baseTileVoyager);
  }
  if (typeof baseTileLight !== 'undefined' && !map.hasLayer(baseTileLight)) {
    map.addLayer(baseTileLight);
  }

  // Remove dynamic opacity handler
  if (regionZoomHandler) {
    map.off('zoomend', regionZoomHandler);
    regionZoomHandler = null;
  }

  // Reset view
  map.setView([56, -96], 4);
  updateBreadcrumb(null);
}

// --- Breadcrumb UI ---
function updateBreadcrumb(provinceCode) {
  let bc = document.getElementById('map-breadcrumb');
  if (!bc) {
    bc = document.createElement('div');
    bc.id = 'map-breadcrumb';
    bc.className = 'map-breadcrumb';
    const mapContainer = document.getElementById('map');
    mapContainer.parentNode.insertBefore(bc, mapContainer);
  }

  if (!provinceCode) {
    bc.innerHTML = '';
    bc.style.display = 'none';
    return;
  }

  bc.style.display = 'flex';
  const canadaLabel = 'Canada';
  const provName = getProvinceName(provinceCode);

  bc.innerHTML = `
    <button class="bc-link" onclick="drillBackToProvinces()">${canadaLabel}</button>
    <span class="bc-sep">&rsaquo;</span>
    <span class="bc-current">${provName}</span>
  `;
}

// --- Loading indicator ---
function showDrillLoading(show) {
  let loader = document.getElementById('drill-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'drill-loader';
    loader.className = 'drill-loader';
    const mapEl = document.getElementById('map');
    mapEl.parentNode.insertBefore(loader, mapEl.nextSibling);
  }

  if (show) {
    const msg = currentLang === 'fr'
      ? 'Chargement des régions et des bornes...'
      : 'Loading regions and stations...';
    loader.innerHTML = `<div class="loader-spinner"></div><span>${msg}</span>`;
    loader.style.display = 'flex';
  } else {
    loader.style.display = 'none';
  }
}

// --- Rate limit warning ---
function showRateLimitWarning(show) {
  let warn = document.getElementById('rate-limit-warning');
  if (!warn) {
    warn = document.createElement('div');
    warn.id = 'rate-limit-warning';
    warn.style.cssText = 'background:#fff3cd;border:1px solid #ffc107;color:#856404;padding:8px 16px;border-radius:6px;margin:8px auto;max-width:600px;text-align:center;font-size:0.9rem;display:none;';
    const mapEl = document.getElementById('map');
    mapEl.parentNode.insertBefore(warn, mapEl.nextSibling);
  }
  if (show) {
    const msg = currentLang === 'fr'
      ? 'Données de bornes temporairement indisponibles (limite API atteinte). Les régions sont affichées sans données de densité. Réessayez dans quelques minutes.'
      : 'Station data temporarily unavailable (API rate limit reached). Regions shown without density data. Try again in a few minutes.';
    warn.textContent = msg;
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }
}

// --- Region legend ---
function buildRegionLegend() {
  const container = document.getElementById('legend-items');
  const items = [
    { label: '0', color: '#e0e0e0' },
    { label: '1-10', color: '#c8e6c9' },
    { label: '11-50', color: '#a5d6a7' },
    { label: '51-100', color: '#81c784' },
    { label: '101-250', color: '#66bb6a' },
    { label: '251-500', color: '#43a047' },
    { label: '501-1000', color: '#2e7d32' },
    { label: '> 1000', color: '#1b5e20' }
  ];
  const title = currentLang === 'fr' ? 'Bornes par région' : 'Ports per region';
  document.querySelector('#map-legend h4').textContent = title;
  container.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'legend-item';
    el.innerHTML = `<span class="legend-color" style="background:${item.color}"></span><span>${item.label}</span>`;
    container.appendChild(el);
  });
}

// --- Initialize drill-down on province click ---
function initDrillDown() {
  // Guard: only attach handlers once
  if (drillDownInitialized) return;
  drillDownInitialized = true;

  // Attach click handlers to province layers for drill-down
  if (geoLayer) {
    geoLayer.eachLayer(layer => {
      if (layer.feature) {
        const prov = getProvinceData(layer.feature);
        if (prov) {
          layer.on('click', function(e) {
            if (currentDrillProvince === prov.code) return; // already in this province
            if (currentDrillProvince) {
              // Switch directly: clean up current drill, then drill into new province
              if (regionLayer) { map.removeLayer(regionLayer); regionLayer = null; }
              if (stationClusterGroup) { map.removeLayer(stationClusterGroup); stationClusterGroup = null; }
              currentDrillProvince = null;
              showRateLimitWarning(false);
            }
            drillIntoProvince(prov.code);
          });
        }
      }
    });
  }

  // Zoom-out no longer resets drill-down — user controls navigation via breadcrumb only
}
