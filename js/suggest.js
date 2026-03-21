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
          <label for="suggest-price">${t('suggestNewPrice')}</label>
          <div class="suggest-price-input">
            <span class="suggest-currency">$</span>
            <input type="number" id="suggest-price" name="suggestedPrice"
                   step="0.01" min="0" max="10" required
                   placeholder="0.35">
            <span class="suggest-unit">/kWh</span>
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

  // Gather form data
  const payload = {
    stationId: form.stationId.value,
    stationName: form.stationName.value,
    network: form.network.value,
    level: form.level.value,
    currentPrice: '',
    suggestedPrice: parseFloat(form.suggestedPrice.value),
    unit: '$/kWh',
    comment: form.comment.value.trim()
  };

  // Validate
  if (isNaN(payload.suggestedPrice) || payload.suggestedPrice <= 0) {
    status.style.display = 'block';
    status.className = 'suggest-status suggest-error';
    status.textContent = t('suggestErrorPrice');
    return;
  }

  // Disable submit button
  submitBtn.disabled = true;
  submitBtn.textContent = t('suggestSending');

  try {
    const response = await fetch(SUGGEST_API_URL, {
      method: 'POST',
      mode: 'no-cors', // Apps Script requires no-cors for cross-origin
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });

    // With no-cors, we can't read the response, but if no error thrown, it was sent
    status.style.display = 'block';
    status.className = 'suggest-status suggest-success';
    status.textContent = t('suggestSuccess');

    // Hide form, show success
    form.style.display = 'none';

    // Auto-close after 3 seconds
    setTimeout(closeSuggestModal, 3000);

  } catch (error) {
    status.style.display = 'block';
    status.className = 'suggest-status suggest-error';
    status.textContent = t('suggestError');
    submitBtn.disabled = false;
    submitBtn.textContent = t('suggestSubmit');
    console.error('Suggestion submit error:', error);
  }
}
