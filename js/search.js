// ============================================================
// Search Module — Station search bar with dropdown
// Combo approach: local station index + Nominatim geocoding
// ============================================================

let stationIndex = [];    // Lightweight pan-Canadian station index
let searchInput = null;
let searchDropdown = null;
let searchDebounce = null;
let searchNavigating = false; // Guard: prevent double-click during drill-down

// --- Load station index on page load ---
async function loadStationIndex() {
  try {
    const resp = await fetch('data/station-index.json');
    if (resp.ok) {
      const data = await resp.json();
      stationIndex = data.stations || [];
      console.log(`Search index loaded: ${stationIndex.length} stations`);
    }
  } catch (e) {
    console.log('Station index not available (optional):', e.message);
  }
}

// --- Normalize string for search (remove accents, lowercase) ---
function normalizeSearch(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// --- Search local station index ---
function searchStations(query, maxResults = 5) {
  if (!query || query.length < 2 || stationIndex.length === 0) return [];

  const q = normalizeSearch(query);
  const terms = q.split(/\s+/);
  const scored = [];

  for (const s of stationIndex) {
    const name = normalizeSearch(s.n);
    const network = normalizeSearch(s.w);
    const city = normalizeSearch(s.c);
    const combined = name + ' ' + network + ' ' + city + ' ' + s.p.toLowerCase();

    // All terms must match somewhere
    const allMatch = terms.every(t => combined.includes(t));
    if (!allMatch) continue;

    // Score: prefer name starts-with, then exact network, then city match
    let score = 0;
    if (name.startsWith(q)) score += 100;
    else if (name.includes(q)) score += 50;
    if (terms.some(t => network.startsWith(t))) score += 30;
    if (terms.some(t => city.startsWith(t))) score += 20;
    terms.forEach(t => { if (combined.includes(t)) score += 5; });

    scored.push({ ...s, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}

// --- Search Nominatim for places (Canadian places only) ---
async function searchNominatim(query, maxResults = 3) {
  if (!query || query.length < 3) return [];
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=ca&limit=${maxResults}&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'Accept-Language': currentLang || 'en' }
    });
    if (!resp.ok) return [];
    const results = await resp.json();
    return results.map(r => ({
      type: 'place',
      name: r.display_name.split(',').slice(0, 2).join(','),
      fullName: r.display_name,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      province: extractProvinceFromNominatim(r)
    }));
  } catch (e) {
    console.log('Nominatim search error:', e.message);
    return [];
  }
}

// --- Extract province code from Nominatim result ---
function extractProvinceFromNominatim(result) {
  const addr = result.address || {};
  const prov = addr.state || addr.province || '';
  const map = {
    'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
    'new brunswick': 'NB', 'newfoundland and labrador': 'NL',
    'northwest territories': 'NT', 'nova scotia': 'NS', 'nunavut': 'NU',
    'ontario': 'ON', 'prince edward island': 'PE', 'quebec': 'QC',
    'québec': 'QC', 'saskatchewan': 'SK', 'yukon': 'YT'
  };
  return map[prov.toLowerCase()] || '';
}

// --- Province code from lat/lng (approximate bounding boxes) ---
const PROVINCE_BOUNDS = {
  'BC': { latMin: 48.3, latMax: 60, lngMin: -139.1, lngMax: -114.0 },
  'AB': { latMin: 49.0, latMax: 60, lngMin: -120.0, lngMax: -110.0 },
  'SK': { latMin: 49.0, latMax: 60, lngMin: -110.0, lngMax: -101.4 },
  'MB': { latMin: 49.0, latMax: 60, lngMin: -101.4, lngMax: -88.9 },
  'ON': { latMin: 41.7, latMax: 56.9, lngMin: -95.2, lngMax: -74.3 },
  'QC': { latMin: 45.0, latMax: 62.6, lngMin: -79.8, lngMax: -57.1 },
  'NB': { latMin: 44.6, latMax: 48.1, lngMin: -69.1, lngMax: -63.8 },
  'NS': { latMin: 43.4, latMax: 47.0, lngMin: -66.4, lngMax: -59.7 },
  'PE': { latMin: 45.9, latMax: 47.1, lngMin: -64.5, lngMax: -62.0 },
  'NL': { latMin: 46.6, latMax: 60.4, lngMin: -67.8, lngMax: -52.6 },
  'YT': { latMin: 60.0, latMax: 69.6, lngMin: -141.0, lngMax: -124.0 },
  'NT': { latMin: 60.0, latMax: 78.8, lngMin: -136.5, lngMax: -102.0 },
  'NU': { latMin: 51.7, latMax: 83.1, lngMin: -120.7, lngMax: -61.2 }
};

function guessProvinceFromCoords(lat, lng) {
  for (const [code, b] of Object.entries(PROVINCE_BOUNDS)) {
    if (lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax) {
      return code;
    }
  }
  return '';
}

// --- Render dropdown results ---
function renderDropdown(stationResults, placeResults) {
  if (!searchDropdown) return;

  if (stationResults.length === 0 && placeResults.length === 0) {
    const noResultLabel = (typeof currentLang !== 'undefined' && currentLang === 'fr')
      ? 'Aucun résultat' : 'No results';
    searchDropdown.innerHTML = `<div class="search-no-results">${noResultLabel}</div>`;
    searchDropdown.classList.add('active');
    return;
  }

  let html = '';

  // Station results
  if (stationResults.length > 0) {
    const stationLabel = (typeof currentLang !== 'undefined' && currentLang === 'fr')
      ? 'Bornes' : 'Stations';
    html += `<div class="search-group-label">${stationLabel}</div>`;
    stationResults.forEach(s => {
      const networkBadge = s.w ? `<span class="search-network">${s.w}</span>` : '';
      html += `
        <div class="search-item search-station" data-type="station" data-id="${s.i}" data-lat="${s.a[0]}" data-lng="${s.a[1]}" data-province="${s.p}">
          <span class="search-icon">⚡</span>
          <div class="search-item-text">
            <span class="search-item-name">${s.n}</span>
            <span class="search-item-detail">${s.c}, ${s.p} ${networkBadge}</span>
          </div>
        </div>`;
    });
  }

  // Place results
  if (placeResults.length > 0) {
    const placeLabel = (typeof currentLang !== 'undefined' && currentLang === 'fr')
      ? 'Lieux' : 'Places';
    html += `<div class="search-group-label">${placeLabel}</div>`;
    placeResults.forEach(p => {
      html += `
        <div class="search-item search-place" data-type="place" data-lat="${p.lat}" data-lng="${p.lng}" data-province="${p.province}">
          <span class="search-icon">📍</span>
          <div class="search-item-text">
            <span class="search-item-name">${p.name}</span>
          </div>
        </div>`;
    });
  }

  searchDropdown.innerHTML = html;
  searchDropdown.classList.add('active');

  // Attach click handlers
  searchDropdown.querySelectorAll('.search-item').forEach(item => {
    item.addEventListener('click', () => onSearchResultClick(item));
  });
}

// --- Show/hide loading spinner in search bar ---
function showSearchLoading(show) {
  const wrapper = document.querySelector('.search-input-wrapper');
  if (!wrapper) return;
  let spinner = wrapper.querySelector('.search-spinner');
  if (show) {
    if (!spinner) {
      spinner = document.createElement('span');
      spinner.className = 'search-spinner';
      wrapper.insertBefore(spinner, wrapper.querySelector('.search-clear-btn'));
    }
    spinner.style.display = 'inline-block';
    if (searchInput) searchInput.disabled = true;
  } else {
    if (spinner) spinner.style.display = 'none';
    if (searchInput) searchInput.disabled = false;
  }
}

// --- Handle search result click: auto-drill + zoom ---
async function onSearchResultClick(item) {
  // Guard: prevent double-click while navigating
  if (searchNavigating) return;

  const type = item.dataset.type;
  const lat = parseFloat(item.dataset.lat);
  const lng = parseFloat(item.dataset.lng);
  let province = item.dataset.province;

  // Guess province from coords if not available
  if (!province) province = guessProvinceFromCoords(lat, lng);

  // Close dropdown, update input
  closeSearchDropdown();
  searchInput.value = item.querySelector('.search-item-name').textContent;

  if (!province) {
    // No province detected — just fly to the coordinates
    if (typeof map !== 'undefined') {
      map.flyTo([lat, lng], 14, { duration: 1.5 });
    }
    return;
  }

  // Check if we need to drill into a different province
  const needsDrill = (typeof currentDrillProvince === 'undefined' || currentDrillProvince === null || currentDrillProvince !== province);

  if (needsDrill && typeof drillIntoProvince === 'function') {
    // Show spinner — drill-down fetches data and can take a few seconds
    searchNavigating = true;
    showSearchLoading(true);
    try {
      await drillIntoProvince(province);
    } finally {
      showSearchLoading(false);
      searchNavigating = false;
    }
  }

  // Fly to the result
  if (typeof map !== 'undefined') {
    const zoomLevel = type === 'station' ? 16 : 13;
    map.flyTo([lat, lng], zoomLevel, { duration: 1.5 });

    // If it's a station, try to open its popup after zoom completes
    if (type === 'station') {
      const stationId = item.dataset.id;
      setTimeout(() => openStationPopup(stationId, lat, lng), 2000);
    }
  }
}

// --- Try to open a station's popup by finding its marker ---
function openStationPopup(stationId, lat, lng) {
  if (typeof stationClusterGroup === 'undefined' || !stationClusterGroup) return;

  let closest = null;
  let closestDist = Infinity;

  stationClusterGroup.eachLayer(layer => {
    if (!layer.getLatLng) return;
    const ll = layer.getLatLng();
    const dist = Math.abs(ll.lat - lat) + Math.abs(ll.lng - lng);
    if (dist < closestDist) {
      closestDist = dist;
      closest = layer;
    }
  });

  if (closest && closestDist < 0.001) {
    // Zoom to visible cluster child if needed
    stationClusterGroup.zoomToShowLayer(closest, () => {
      closest.openPopup();
    });
  }
}

// --- Close dropdown ---
function closeSearchDropdown() {
  if (searchDropdown) searchDropdown.classList.remove('active');
}

// --- Main search handler (debounced) ---
function onSearchInput() {
  const query = searchInput.value.trim();

  if (query.length < 2) {
    closeSearchDropdown();
    return;
  }

  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    // Run both searches in parallel
    const stationResults = searchStations(query, 5);
    const placeResults = query.length >= 3 ? await searchNominatim(query, 3) : [];
    renderDropdown(stationResults, placeResults);
  }, 300);
}

// --- Clear search ---
function clearSearch() {
  if (searchInput) searchInput.value = '';
  closeSearchDropdown();
}

// --- Initialize search bar ---
function initSearch() {
  searchInput = document.getElementById('search-input');
  searchDropdown = document.getElementById('search-dropdown');
  if (!searchInput || !searchDropdown) return;

  searchInput.addEventListener('input', onSearchInput);
  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length >= 2) onSearchInput();
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const searchBar = document.getElementById('search-bar');
    if (searchBar && !searchBar.contains(e.target)) {
      closeSearchDropdown();
    }
  });

  // Keyboard navigation
  searchInput.addEventListener('keydown', (e) => {
    if (!searchDropdown.classList.contains('active')) return;
    const items = searchDropdown.querySelectorAll('.search-item');
    const active = searchDropdown.querySelector('.search-item.highlighted');
    let idx = Array.from(items).indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) active.classList.remove('highlighted');
      idx = (idx + 1) % items.length;
      items[idx].classList.add('highlighted');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) active.classList.remove('highlighted');
      idx = idx <= 0 ? items.length - 1 : idx - 1;
      items[idx].classList.add('highlighted');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) active.click();
      else if (items.length > 0) items[0].click();
    } else if (e.key === 'Escape') {
      closeSearchDropdown();
      searchInput.blur();
    }
  });

  // Load index
  loadStationIndex();
  console.log('Search bar initialized');
}

document.addEventListener('DOMContentLoaded', initSearch);
