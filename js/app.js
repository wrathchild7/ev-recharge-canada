// ============================================================
// Prix Recharge VE Canada — Main Application
// ============================================================

// Leaflet 1.9.4 known bug: Tooltip mouseover handler crashes with
// "Cannot set properties of null (setting '_source')" when SVG path
// elements receive mouse events after their parent layer is removed.
// This is an internal DOM-level event that cannot be patched cleanly.
// Suppress this specific harmless error to keep the console clean.
window.addEventListener('error', function(e) {
  if (e.message && e.message.includes("Cannot set properties of null (setting '_source')")) {
    e.preventDefault();
    return true;
  }
});

// --- EV DATA (embedded for offline use) ---
const evData = {
  lastUpdated: "2026-03-15",
  nationalAverage: { level1: 0.15, level2: 0.25, dcFast: 0.42 },
  provinces: [
    { code:"AB", level1:0.18, level2:0.32, dcFast:0.65, totalPorts:1690, level2Ports:1350, dcFastPorts:340, stations:520, pricingModel:"fixed", trend:"stable" },
    { code:"BC", level1:0.12, level2:0.21, dcFast:0.40, totalPorts:6753, level2Ports:5400, dcFastPorts:1353, stations:2200, pricingModel:"fixed", trend:"decreasing" },
    { code:"MB", level1:0.14, level2:0.23, dcFast:0.45, totalPorts:420, level2Ports:350, dcFastPorts:70, stations:145, pricingModel:"fixed", trend:"stable" },
    { code:"NB", level1:0.16, level2:0.27, dcFast:0.52, totalPorts:380, level2Ports:310, dcFastPorts:70, stations:130, pricingModel:"time", trend:"stable" },
    { code:"NL", level1:0.15, level2:0.26, dcFast:0.50, totalPorts:195, level2Ports:160, dcFastPorts:35, stations:68, pricingModel:"fixed", trend:"stable" },
    { code:"NS", level1:0.17, level2:0.29, dcFast:0.60, totalPorts:450, level2Ports:370, dcFastPorts:80, stations:155, pricingModel:"fixed", trend:"increasing" },
    { code:"NT", level1:0.20, level2:0.35, dcFast:0.55, totalPorts:18, level2Ports:15, dcFastPorts:3, stations:8, pricingModel:"fixed", trend:"stable" },
    { code:"NU", level1:null, level2:null, dcFast:null, totalPorts:2, level2Ports:2, dcFastPorts:0, stations:1, pricingModel:"n/a", trend:"n/a" },
    { code:"ON", level1:0.16, level2:0.28, dcFast:0.58, totalPorts:11500, level2Ports:9500, dcFastPorts:2000, stations:4100, pricingModel:"mixed", trend:"decreasing" },
    { code:"PE", level1:0.15, level2:0.25, dcFast:0.48, totalPorts:95, level2Ports:78, dcFastPorts:17, stations:35, pricingModel:"fixed", trend:"stable" },
    { code:"QC", level1:0.10, level2:0.18, dcFast:0.38, totalPorts:11200, level2Ports:9200, dcFastPorts:2000, stations:4000, pricingModel:"power", trend:"stable" },
    { code:"SK", level1:0.17, level2:0.30, dcFast:0.65, totalPorts:285, level2Ports:235, dcFastPorts:50, stations:98, pricingModel:"fixed", trend:"stable" },
    { code:"YT", level1:0.11, level2:0.20, dcFast:0.37, totalPorts:45, level2Ports:38, dcFastPorts:7, stations:18, pricingModel:"fixed", trend:"stable" }
  ]
};

// --- STATE ---
let currentLevel = 'level2';
let map = null;
let geoLayer = null;
let cachedGeoJSON = null;
let sortColumn = 'dcFast';
let sortAsc = true;
let comparisonChart = null;
let highlightedLayer = null; // track currently highlighted province to fix sticky hover

// GeoJSON URLs for Canadian provinces
const GEOJSON_URL = 'https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/canada.geojson';
const GEOJSON_FALLBACK = 'https://cdn.jsdelivr.net/gh/codeforamerica/click_that_hood@master/public/data/canada.geojson';

// --- COLOR SCALE ---
function getColor(price) {
  if (price === null || price === undefined) return '#bdbdbd';
  if (price <= 0.20) return '#1b5e20';
  if (price <= 0.25) return '#2e7d32';
  if (price <= 0.30) return '#388e3c';
  if (price <= 0.35) return '#43a047';
  if (price <= 0.40) return '#66bb6a';
  if (price <= 0.45) return '#a5d6a7';
  if (price <= 0.50) return '#ffb74d';
  if (price <= 0.55) return '#ff9800';
  if (price <= 0.60) return '#f57c00';
  return '#e65100';
}

const legendData = [
  { label: '< $0.20', color: '#1b5e20' },
  { label: '$0.20-0.25', color: '#2e7d32' },
  { label: '$0.25-0.30', color: '#388e3c' },
  { label: '$0.30-0.35', color: '#43a047' },
  { label: '$0.35-0.40', color: '#66bb6a' },
  { label: '$0.40-0.45', color: '#a5d6a7' },
  { label: '$0.45-0.50', color: '#ffb74d' },
  { label: '$0.50-0.55', color: '#ff9800' },
  { label: '$0.55-0.60', color: '#f57c00' },
  { label: '> $0.60', color: '#e65100' }
];

// --- PROVINCE CODE MATCHING ---
const nameToCode = {
  'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
  'new brunswick': 'NB', 'newfoundland and labrador': 'NL',
  'nova scotia': 'NS', 'northwest territories': 'NT', 'nunavut': 'NU',
  'ontario': 'ON', 'prince edward island': 'PE', 'quebec': 'QC',
  'québec': 'QC', 'saskatchewan': 'SK', 'yukon': 'YT', 'yukon territory': 'YT'
};

function getProvinceData(feature) {
  const name = (feature.properties.name || feature.properties.NAME || feature.properties.PRENAME || '').toLowerCase().trim();
  const code = nameToCode[name];
  if (!code) return null;
  return evData.provinces.find(p => p.code === code) || null;
}

// --- INIT MAP ---
let labelsLayer = null; // city/road labels overlay, shown during drill-down
let baseTileLight = null;   // CartoDB light_nolabels — clean for choropleth (zoom ≤7)
let baseTileVoyager = null; // CartoDB Voyager — road-focused for station drill-down (zoom 8+)

function initMap() {
  map = L.map('map', {
    center: [56, -96], zoom: 4, minZoom: 3, maxZoom: 18, scrollWheelZoom: true
  });

  // Custom pane for region outlines — above province choropleth so tooltips work
  map.createPane('regionsPane');
  map.getPane('regionsPane').style.zIndex = 450;

  // Custom pane for labels — z-index above everything so text stays readable
  map.createPane('labelsPane');
  map.getPane('labelsPane').style.zIndex = 650;
  map.getPane('labelsPane').style.pointerEvents = 'none';

  // Base tiles — light (no labels) for clean choropleth at province level
  baseTileLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);

  // Road-focused tiles — Voyager for drill-down (shows highways, routes, road network)
  baseTileVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd', maxZoom: 19
  });

  // Labels-only overlay — added/removed during drill-down, rendered above polygons
  labelsLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd', maxZoom: 19, pane: 'labelsPane'
  });

  loadGeoJSON();
}

async function loadGeoJSON() {
  let data = null;
  try {
    const resp = await fetch(GEOJSON_URL);
    if (resp.ok) data = await resp.json();
  } catch(e) { console.log('Primary GeoJSON failed, trying fallback...'); }

  if (!data) {
    try {
      const resp = await fetch(GEOJSON_FALLBACK);
      if (resp.ok) data = await resp.json();
    } catch(e) { console.log('Fallback GeoJSON also failed.'); }
  }

  if (data) {
    cachedGeoJSON = data;
    renderGeoLayer(data);
    // Phase 2: init drill-down after geo layer is ready
    if (typeof initDrillDown === 'function') {
      setTimeout(initDrillDown, 100);
    }
  } else {
    renderMarkers();
  }
}

function renderGeoLayer(geojsonData) {
  if (geoLayer) {
    geoLayer.eachLayer(function(layer) {
      if (layer.getTooltip()) { layer.closeTooltip(); layer.unbindTooltip(); }
      layer.off();
    });
    map.removeLayer(geoLayer);
  }

  geoLayer = L.geoJSON(geojsonData, {
    style: function(feature) {
      const prov = getProvinceData(feature);
      const price = prov ? prov[currentLevel] : null;
      return {
        fillColor: getColor(price), weight: 2, opacity: 1,
        color: '#ffffff', fillOpacity: 0.75
      };
    },
    onEachFeature: function(feature, layer) {
      const prov = getProvinceData(feature);
      if (prov) {
        // Use tooltip on hover instead of popup (popup conflicts with drill-down click)
        layer.bindTooltip(createPopupContent(prov), {
          sticky: true, direction: 'top', className: 'province-tooltip', maxWidth: 300
        });
        layer.on({
          mouseover: function(e) {
            // Skip highlight when drilled into a province
            if (typeof currentDrillProvince !== 'undefined' && currentDrillProvince) return;
            // Reset previous highlight first (fixes sticky hover from bringToFront)
            if (highlightedLayer && highlightedLayer !== e.target) {
              geoLayer.resetStyle(highlightedLayer);
              highlightedLayer = null;
            }
            highlightedLayer = e.target;
            e.target.setStyle({ weight: 3, color: '#d32f2f', fillOpacity: 0.9 });
            // Note: bringToFront() removed — it causes Leaflet Tooltip._source null errors
            // when reordering SVG elements triggers spurious mouseout/mouseover events
          },
          mouseout: function(e) {
            if (typeof currentDrillProvince !== 'undefined' && currentDrillProvince) return;
            geoLayer.resetStyle(e.target);
            if (highlightedLayer === e.target) highlightedLayer = null;
          }
        });
      }
    }
  }).addTo(map);
}

function renderMarkers() {
  const centroids = {
    AB:[53.9,-116.6], BC:[53.7,-127.6], MB:[53.8,-98.8],
    NB:[46.5,-66.2], NL:[53.1,-57.7], NS:[44.7,-63.0],
    NT:[64.3,-119.0], NU:[65.2,-86.0], ON:[49.3,-84.5],
    PE:[46.2,-63.0], QC:[52.0,-72.0], SK:[52.9,-106.5], YT:[63.0,-135.0]
  };
  evData.provinces.forEach(prov => {
    const coords = centroids[prov.code];
    if (!coords) return;
    const price = prov[currentLevel];
    const circle = L.circleMarker(coords, {
      radius: Math.max(8, Math.sqrt(prov.totalPorts) / 2),
      fillColor: getColor(price), color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.8
    }).addTo(map);
    circle.bindPopup(createPopupContent(prov), { maxWidth: 300 });
  });
}

function createPopupContent(prov) {
  const fmt = v => v !== null ? `$${v.toFixed(2)}` : t('popupNA');
  const num = v => v.toLocaleString(currentLang === 'fr' ? 'fr-CA' : 'en-CA');
  const name = getProvinceName(prov.code);
  return `
    <div class="province-popup">
      <h3>${name}</h3>
      <div class="popup-row"><span>${t('popupLevel1')}</span><span class="popup-value">${fmt(prov.level1)}${t('perKwh')}</span></div>
      <div class="popup-row"><span>${t('popupLevel2')}</span><span class="popup-value">${fmt(prov.level2)}${t('perKwh')}</span></div>
      <div class="popup-row"><span>${t('popupDCFast')}</span><span class="popup-value">${fmt(prov.dcFast)}${t('perKwh')}</span></div>
      <hr style="margin:0.4rem 0;border:none;border-top:1px solid #e0e0e0">
      <div class="popup-row"><span>${t('popupTotalPorts')}</span><span class="popup-value">${num(prov.totalPorts)}</span></div>
      <div class="popup-row"><span>${t('popupStations')}</span><span class="popup-value">${num(prov.stations)}</span></div>
      <div class="popup-row"><span>${t('popupDCFastPorts')}</span><span class="popup-value">${num(prov.dcFastPorts)}</span></div>
    </div>
  `;
}

// --- LEGEND ---
function buildLegend() {
  const container = document.getElementById('legend-items');
  container.innerHTML = '';
  legendData.forEach(item => {
    const el = document.createElement('div');
    el.className = 'legend-item';
    el.innerHTML = `<span class="legend-color" style="background:${item.color}"></span><span>${item.label}</span>`;
    container.appendChild(el);
  });
}

// --- TABLE ---
function buildTable() {
  const tbody = document.getElementById('ev-table-body');
  const sorted = [...evData.provinces].sort((a, b) => {
    let aVal = a[sortColumn];
    let bVal = b[sortColumn];
    if (sortColumn === 'name') {
      aVal = getProvinceName(a.code);
      bVal = getProvinceName(b.code);
    }
    if (sortColumn === 'pricingModel') { aVal = a.pricingModel; bVal = b.pricingModel; }
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    if (typeof aVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal, currentLang === 'fr' ? 'fr' : 'en') : bVal.localeCompare(aVal, currentLang === 'fr' ? 'fr' : 'en');
    }
    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  const prices = evData.provinces.filter(p => p.dcFast !== null).map(p => p.dcFast);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const locale = currentLang === 'fr' ? 'fr-CA' : 'en-CA';

  const modelKeys = { fixed:'modelFixed', time:'modelTime', power:'modelPower', mixed:'modelMixed', 'n/a':'modelNA' };

  tbody.innerHTML = sorted.map(prov => {
    const fmtPrice = (val) => {
      if (val === null) return `<span class="price-cell na">${t('popupNA')}</span>`;
      let cls = 'price-cell';
      if (val <= minPrice + 0.05) cls += ' highlight-low';
      else if (val >= maxPrice - 0.05) cls += ' highlight-high';
      return `<span class="${cls}">${val.toFixed(3)}</span>`;
    };

    const modelClass = `model-${prov.pricingModel === 'n/a' ? 'na' : prov.pricingModel}`;
    const modelLabel = t(modelKeys[prov.pricingModel] || 'modelNA');

    return `
      <tr>
        <td><strong>${getProvinceName(prov.code)}</strong></td>
        <td>${fmtPrice(prov.level1)}</td>
        <td>${fmtPrice(prov.level2)}</td>
        <td>${fmtPrice(prov.dcFast)}</td>
        <td>${prov.totalPorts.toLocaleString(locale)}</td>
        <td>${prov.stations.toLocaleString(locale)}</td>
        <td><span class="model-badge ${modelClass}">${modelLabel}</span></td>
      </tr>
    `;
  }).join('');
}

function initTableSort() {
  document.querySelectorAll('#ev-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortColumn === col) { sortAsc = !sortAsc; }
      else { sortColumn = col; sortAsc = true; }
      document.querySelectorAll('#ev-table th').forEach(h => h.classList.remove('active-sort'));
      th.classList.add('active-sort');
      buildTable();
    });
  });
}

// --- COMPARISON CHART ---
function buildComparisonChart() {
  const ctx = document.getElementById('comparison-chart').getContext('2d');
  const provinces = evData.provinces.filter(p => p.dcFast !== null);
  const labels = provinces.map(p => p.code);

  if (comparisonChart) comparisonChart.destroy();

  comparisonChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: t('chartLevel1'),
          data: provinces.map(p => p.level1),
          backgroundColor: 'rgba(76, 175, 80, 0.7)',
          borderColor: '#388e3c', borderWidth: 1
        },
        {
          label: t('chartLevel2'),
          data: provinces.map(p => p.level2),
          backgroundColor: 'rgba(255, 152, 0, 0.7)',
          borderColor: '#f57c00', borderWidth: 1
        },
        {
          label: t('chartDCFast'),
          data: provinces.map(p => p.dcFast),
          backgroundColor: 'rgba(211, 47, 47, 0.7)',
          borderColor: '#c62828', borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        title: { display: true, text: t('chartTitle'), font: { size: 14, weight: '600' } },
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: $${ctx.raw.toFixed(2)}/kWh`,
            title: items => {
              const code = items[0].label;
              return getProvinceName(code);
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: t('chartYAxis') },
          ticks: { callback: v => `$${v.toFixed(2)}` }
        },
        x: {
          title: { display: true, text: t('chartXAxis') }
        }
      }
    }
  });
}

// --- LEVEL SELECTOR ---
function initLevelSelector() {
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLevel = btn.dataset.level;
      updateMapColors();
    });
  });
}

function updateMapColors() {
  if (geoLayer) {
    geoLayer.eachLayer(layer => {
      if (layer.feature) {
        const prov = getProvinceData(layer.feature);
        const price = prov ? prov[currentLevel] : null;
        layer.setStyle({ fillColor: getColor(price), fillOpacity: 0.75 });
      }
    });
  }
}

// --- NAV HIGHLIGHT ---
function initNavHighlight() {
  const sections = document.querySelectorAll('.section');
  const navLinks = document.querySelectorAll('.nav-link');
  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(sec => {
      const top = sec.offsetTop - 120;
      if (window.scrollY >= top) current = sec.id;
    });
    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) link.classList.add('active');
    });
  });
}

// --- REBUILD ALL (called by i18n on language switch) ---
function rebuildAllContent() {
  // Rebuild dynamic elements that use t()
  buildTable();
  buildComparisonChart();

  // Rebuild map popups with new language
  if (typeof currentDrillProvince !== 'undefined' && currentDrillProvince) {
    // If drilled into a province, re-render region layer
    const prov = currentDrillProvince;
    currentDrillProvince = null; // reset so drillInto re-runs
    drillIntoProvince(prov);
  } else if (cachedGeoJSON) {
    renderGeoLayer(cachedGeoJSON);
    if (typeof initDrillDown === 'function') {
      // Reset the guard flag since geoLayer was recreated with new layer objects
      if (typeof drillDownInitialized !== 'undefined') drillDownInitialized = false;
      setTimeout(initDrillDown, 100);
    }
  }

  // Update page title
  document.title = t('siteTitle') + ' — Canada';

  // Handle avg-label line breaks (they use \n in translations)
  document.querySelectorAll('[data-i18n="avgLabelDC"], [data-i18n="avgLabelL2"]').forEach(el => {
    const key = el.dataset.i18n;
    el.innerHTML = t(key).replace(/\n/g, '<br>');
  });
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('last-updated').textContent = evData.lastUpdated;

  initMap();
  buildLegend();
  buildTable();
  initTableSort();
  buildComparisonChart();
  initLevelSelector();
  initNavHighlight();
  initI18n(); // from i18n.js
});
