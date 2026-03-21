// ============================================================
// Price Suggestion — Crowdsourced price updates
// ============================================================

const SUGGEST_API_URL = 'https://script.google.com/macros/s/AKfycbx5z2weX8YSKu-N6I7pZeMMZSHRs2dYhUZJYz3K_mvjrg9GLU8zAT0rtZz2RvHVfr3X/exec';

// --- Build the "Suggest a price" button HTML for station popups ---
function buildSuggestButton(stationData) {
  // Encode station data as JSON in a data attribute
  const encoded = encodeURIComponent(JSON.stringify({
    stationId: stationData.id || '',
    stationName: stationData.name || '',
    network: stationData.network || '',
    level2Ports: stationData.ev_level2_evse_num || 0,
    dcFastPorts: stationData.ev_dc_fast_num || 0
  }));

  return `
    <div style="margin-top:0.5rem;text-align:center;">
      <button class="suggest-price-btn" onclick="openSuggestModal(decodeURIComponent('${encoded}'))">
        ${t('suggestPrice')}
      </button>
    </div>
  `;
}

// --- Update the unit display when user changes the unit selector ---
function onUnitChange() {
  const unitSelect = document.getElementById('suggest-unit-select');
  const unitLabel = document.getElementById('suggest-unit-label');
  const priceInput = document.getElementById('suggest-price');
  const unit = unitSelect.value;

  // Update the displayed unit label
  unitLabel.textContent = unit === 'free' ? '' : unit;

  // Adjust input constraints based on unit
  if (unit === 'free') {
    priceInput.value = '0';
    priceInput.disabled = true;
    priceInput.required = false;
  } else {
    priceInput.disabled = false;
    priceInput.required = true;
    if (unit === '$/kWh') {
      priceInput.step = '0.01';
      priceInput.max = '10';
      priceInput.placeholder = '0.35';
    } else if (unit === '$/min') {
      priceInput.step = '0.01';
      priceInput.max = '5';
      priceInput.placeholder = '0.20';
    } else if (unit === '$/hr') {
      priceInput.step = '0.50';
      priceInput.max = '50';
      priceInput.placeholder = '2.50';
    } else if (unit === '$/session') {
      priceInput.step = '0.50';
      priceInput.max = '100';
      priceInput.placeholder = '10.00';
    }
  }
}

// --- Create and show the suggestion modal ---
function openSuggestModal(encodedData) {
  const data = typeof encodedData === 'string' ? JSON.parse(encodedData) : encodedData;

  // Remove existing modal if any
  const existing = document.getElementById('suggest-modal-overlay');
  if (existing) existing.remove();

  // Determine which levels to show based on station ports
  const hasL2 = data.level2Ports > 0;
  const hasDC = data.dcFastPorts > 0;

  // Build level options
  let levelOptions = '';
  if (hasL2 && hasDC) {
    levelOptions = `
      <option value="level2">${t('popupLevel2')}</option>
      <option value="dcFast">${t('popupDCFast')}</option>
    `;
  } else if (hasDC) {
    levelOptions = `<option value="dcFast">${t('popupDCFast')}</option>`;
  } else {
    levelOptions = `<option value="level2">${t('popupLevel2')}</option>`;
  }

  // Build unit options
  const unitOptions = `
    <option value="$/kWh">$/kWh</option>
    <option value="$/min">$/min</option>
    <option value="$/hr">$/hr</option>
    <option value="$/session">$/${t('suggestUnitSession')}</option>
    <option value="free">${t('suggestUnitFree')}</option>
  `;

  const overlay = document.createElement('div');
  overlay.id = 'suggest-modal-overlay';
  overlay.className = 'suggest-overlay';
  overlay.innerHTML = `
    <div class="suggest-modal">
      <button class="suggest-close" onclick="closeSuggestModal()">&times;</button>
      <h3>${t('suggestTitle')}</h3>
      <p class="suggest-station-name">${data.stationName}</p>
      <p class="suggest-network">${data.network}</p>

      <form id="suggest-form" onsubmit="submitSuggestion(event)">
        <input type="hidden" name="stationId" value="${data.stationId}">
        <input type="hidden" name="stationName" value="${data.stationName.replace(/"/g, '&quot;')}">
        <input type="hidden" name="network" value="${data.network.replace(/"/g, '&quot;')}">

        <div class="suggest-field">
          <label for="suggest-level">${t('suggestLevel')}</label>
          <select id="suggest-level" name="level" required>
            ${levelOptions}
          </select>
        </div>

        <div class="suggest-field">
          <label for="suggest-unit-select">${t('suggestUnitLabel')}</label>
          <select id="suggest-unit-select" name="unit" onchange="onUnitChange()">
            ${unitOptions}
          </select>
        </div>

        <div class="suggest-field" id="suggest-price-field">
          <label for="suggest-price">${t('suggestNewPrice')}</label>
          <div class="suggest-price-input">
            <span class="suggest-currency">$</span>
            <input type="number" id="suggest-price" name="suggestedPrice"
                   step="0.01" min="0" max="10" required
                   placeholder="0.35">
            <span class="suggest-unit" id="suggest-unit-label">/kWh</span>
          </div>
        </div>

        <div class="suggest-field">
          <label for="suggest-comment">${t('suggestComment')}</label>
          <textarea id="suggest-comment" name="comment" rows="2"
                    placeholder="${t('suggestCommentPlaceholder')}" maxlength="500"></textarea>
        </div>

        <div class="suggest-actions">
          <button type="button" class="suggest-cancel" onclick="closeSuggestModal()">${t('suggestCancel')}</button>
          <button type="submit" class="suggest-submit">${t('suggestSubmit')}</button>
        </div>
      </form>

      <div id="suggest-status" class="suggest-status" style="display:none;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeSuggestModal();
  });

  // Close on Escape key
  document.addEventListener('keydown', handleSuggestEscape);
}

function handleSuggestEscape(e) {
  if (e.key === 'Escape') closeSuggestModal();
}

function closeSuggestModal() {
  const overlay = document.getElementById('suggest-modal-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', handleSuggestEscape);
}

// --- Submit the suggestion to Google Apps Script ---
async function submitSuggestion(event) {
  event.preventDefault();

  const form = document.getElementById('suggest-form');
  const status = document.getElementById('suggest-status');
  const submitBtn = form.querySelector('.suggest-submit');
  const unit = form.unit.value;

  // Gather form data
  const payload = {
    stationId: form.stationId.value,
    stationName: form.stationName.value,
    network: form.network.value,
    level: form.level.value,
    currentPrice: '',
    suggestedPrice: unit === 'free' ? 0 : parseFloat(form.suggestedPrice.value),
    unit: unit,
    comment: form.comment.value.trim()
  };

  // Validate
  if (unit !== 'free' && (isNaN(payload.suggestedPrice) || payload.suggestedPrice <= 0)) {
    status.style.display = 'block';
    status.className = 'suggest-status suggest-error';
    status.textContent = t('suggestErrorPrice');
    return;
  }

  // Disable submit button
  submitBtn.disabled = true;
  submitBtn.textContent = t('suggestSending');

  // Use no-cors: Google Apps Script redirects to googleusercontent.com,
  // which returns an opaque response. We can't read the status, so we
  // optimistically show success. The data arrives even if fetch "fails".
  try {
    await fetch(SUGGEST_API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    // With no-cors + redirect, browsers may report a TypeError even though
    // the POST was delivered. Log it but don't block the success message.
    console.log('Suggest fetch opaque/redirect (data likely sent):', e.message);
  }

  // Always show success — the data is sent regardless of opaque response
  status.style.display = 'block';
  status.className = 'suggest-status suggest-success';
  status.textContent = t('suggestSuccess');
  form.style.display = 'none';
  setTimeout(closeSuggestModal, 3000);
}
