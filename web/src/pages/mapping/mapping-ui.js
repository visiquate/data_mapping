/**
 * Mapping UI rendering and interaction
 * Handles the display of plans, payer selection, filters, and stats
 */

import { STATE_ABBREV, ALT_PORTAL_VALUES } from '../../lib/state-map.js';
import { getState } from './state.js';
import { autoSave } from './auto-save.js';

/**
 * Escape HTML special characters for safe display
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Setup filter button event listeners
 */
export function setupFilterButtons() {
    const state = getState();
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentFilter = btn.dataset.filter;
            renderMappingInterface();
        });
    });
}

/**
 * Setup search box event listener
 */
export function setupSearch() {
    document.getElementById('searchBox').addEventListener('input', (e) => {
        renderMappingInterface(e.target.value.toLowerCase());
    });
}

/**
 * Build the plansByState structure from existing mappings
 * Used when loading mappings from a file without placement data
 */
export function buildPlansFromMappings() {
    const state = getState();
    state.plansByState = {};
    Object.entries(state.currentMappings).forEach(([key, mapping]) => {
        const sep = key.indexOf('|');
        if (sep === -1) return;
        const st = key.slice(0, sep);
        const planName = key.slice(sep + 1);
        if (!st || !planName) return;
        const stateAbbrev = STATE_ABBREV[st] || st;
        if (!state.plansByState[st]) state.plansByState[st] = [];
        state.plansByState[st].push({ planName, stateAbbrev, volume: null });
    });
    Object.keys(state.plansByState).forEach(st => {
        state.plansByState[st].sort((a, b) => a.planName.localeCompare(b.planName));
    });
    document.getElementById('statsSection').classList.remove('hidden');
    document.getElementById('mappingSection').classList.remove('hidden');
    document.getElementById('actionsSection').classList.remove('hidden');
    renderMappingInterface();
    updateStats();
}

/**
 * Apply existing mappings to the current interface
 */
export function applyMappingsToInterface() {
    renderMappingInterface();
    updateStats();
}

/**
 * Render the entire mapping interface with states and plans
 * @param {string} searchTerm - Optional search term to filter plans
 */
export function renderMappingInterface(searchTerm = '') {
    const state = getState();
    const container = document.getElementById('mappingContent');
    container.innerHTML = '';
    const sortedStates = Object.keys(state.plansByState).sort();

    sortedStates.forEach(st => {
        let plans = state.plansByState[st];
        if (searchTerm) plans = plans.filter(p => p.planName.toLowerCase().includes(searchTerm));
        if (state.currentFilter === 'mapped') plans = plans.filter(p => { const pid = state.currentMappings[st + '|' + p.planName]?.availityPayerId; return pid && !ALT_PORTAL_VALUES.includes(pid); });
        else if (state.currentFilter === 'altportal') plans = plans.filter(p => ALT_PORTAL_VALUES.includes(state.currentMappings[st + '|' + p.planName]?.availityPayerId));
        else if (state.currentFilter === 'unmapped') plans = plans.filter(p => !state.currentMappings[st + '|' + p.planName]?.availityPayerId);
        if (plans.length === 0) return;

        const stateSection = document.createElement('div');
        stateSection.className = 'state-section';
        const stateAbbrev = plans[0]?.stateAbbrev || STATE_ABBREV[st] || '';

        const stateHeader = document.createElement('div');
        stateHeader.className = 'state-header';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = st + ' (' + stateAbbrev + ')';

        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'state-badge';
        badgeSpan.textContent = plans.length + ' plans';

        stateHeader.appendChild(titleSpan);
        stateHeader.appendChild(badgeSpan);

        const table = document.createElement('table');
        table.className = 'mapping-table';
        table.innerHTML = '<thead><tr><th style="width:40%">Plan Name</th><th style="width:15%">Volume</th><th style="width:45%">Payer Mapping</th></tr></thead><tbody>' +
            plans.map(plan => renderPlanRow(plan, st)).join('') + '</tbody>';

        stateSection.appendChild(stateHeader);
        stateSection.appendChild(table);
        container.appendChild(stateSection);
    });

    container.querySelectorAll('.payer-select').forEach(select => {
        select.addEventListener('change', handlePayerSelection);
    });
}

/**
 * Render a single plan row in the mapping table
 * @param {Object} plan - Plan object with planName, stateAbbrev, and volume
 * @param {string} st - State name
 * @returns {string} HTML for the table row
 */
function renderPlanRow(plan, st) {
    const state = getState();
    const mappingKey = st + '|' + plan.planName;
    const mapping = state.currentMappings[mappingKey];
    const isMapped = mapping?.availityPayerId;
    const isAltPortal = ALT_PORTAL_VALUES.includes(mapping?.availityPayerId);
    const rowClass = isAltPortal ? 'alt-portal' : (isMapped ? 'mapped' : '');
    const selectClass = isAltPortal ? 'not-available' : (isMapped ? 'mapped' : '');
    const availityPayers = state.AVAILITY_PAYERS[st] || [];

    return '<tr class="' + rowClass + '">' +
        '<td class="plan-name">' + escapeHtml(plan.planName) + '</td>' +
        '<td class="volume">' + (plan.volume !== null ? plan.volume.toLocaleString() : '\u2014') + '</td>' +
        '<td><select class="payer-select ' + selectClass + '" data-plan="' + escapeHtml(plan.planName) + '" data-state="' + escapeHtml(st) + '">' +
        '<option value="">-- Select Payer --</option>' +
        '<option value="not available"' + (mapping?.availityPayerId === 'not available' ? ' selected' : '') + '>Not In Availity</option>' +
        '<option value="Cigna"' + (mapping?.availityPayerId === 'Cigna' ? ' selected' : '') + '>Cigna Portal</option>' +
        '<option value="HPN"' + (mapping?.availityPayerId === 'HPN' ? ' selected' : '') + '>HPN Portal</option>' +
        '<option value="OptumCare"' + (mapping?.availityPayerId === 'OptumCare' ? ' selected' : '') + '>OptumCare Portal</option>' +
        '<option value="Superior"' + (mapping?.availityPayerId === 'Superior' ? ' selected' : '') + '>Superior Portal</option>' +
        '<option value="UHC"' + (mapping?.availityPayerId === 'UHC' ? ' selected' : '') + '>UHC Portal</option>' +
        '<option value="UMR"' + (mapping?.availityPayerId === 'UMR' ? ' selected' : '') + '>UMR Portal</option>' +
        availityPayers.map(p => '<option value="' + escapeHtml(p.payerId) + '" data-payer-name="' + escapeHtml(p.payerName) + '"' +
            (mapping?.availityPayerId === p.payerId ? ' selected' : '') + '>' + escapeHtml(p.payerName) + ' (' + escapeHtml(p.payerId) + ')</option>').join('') +
        '</select></td></tr>';
}

/**
 * Handle payer selection change in dropdown
 * @param {Event} e - The change event
 */
function handlePayerSelection(e) {
    const state = getState();
    const select = e.target;
    const planName = select.dataset.plan;
    const st = select.dataset.state;
    const mappingKey = st + '|' + planName;
    const payerId = select.value;
    const selectedOption = select.options[select.selectedIndex];
    const payerName = selectedOption.dataset?.payerName || payerId;

    if (payerId) state.currentMappings[mappingKey] = { availityPayerId: payerId, availityPayerName: payerName };
    else delete state.currentMappings[mappingKey];

    const row = select.closest('tr');
    row.classList.remove('mapped', 'unmapped', 'alt-portal');
    select.classList.remove('mapped', 'not-available');

    if (ALT_PORTAL_VALUES.includes(payerId)) { row.classList.add('alt-portal'); select.classList.add('not-available'); }
    else if (payerId) { row.classList.add('mapped'); select.classList.add('mapped'); }
    updateStats();
    autoSave();
}

/**
 * Update statistics display
 * Counts total, mapped, alt portal, unmapped plans and states
 * Updates progress bar and percentage display
 */
export function updateStats() {
    const state = getState();
    let total = 0, mapped = 0, altPortal = 0;
    Object.entries(state.plansByState).forEach(([st, plans]) => {
        plans.forEach(plan => {
            total++;
            const pid = state.currentMappings[st + '|' + plan.planName]?.availityPayerId;
            if (pid) {
                if (ALT_PORTAL_VALUES.includes(pid)) altPortal++;
                else mapped++;
            }
        });
    });
    const unmapped = total - mapped - altPortal;
    document.getElementById('totalPlans').textContent = total;
    document.getElementById('mappedPlans').textContent = mapped;
    document.getElementById('altPortalPlans').textContent = altPortal;
    document.getElementById('unmappedPlans').textContent = unmapped;
    document.getElementById('totalStates').textContent = Object.keys(state.plansByState).length;
    const mappedPct = total > 0 ? Math.round((mapped / total) * 100) : 0;
    const altPct = total > 0 ? Math.round((altPortal / total) * 100) : 0;
    document.getElementById('progressFill').style.width = (mappedPct + altPct) + '%';
    document.getElementById('altProgressFill').style.width = altPct + '%';
    document.getElementById('altProgressFill').style.left = mappedPct + '%';
    document.getElementById('progressText').textContent = mappedPct + '% Mapped to Availity \u00b7 ' + altPct + '% Not In Availity \u00b7 ' + (100 - mappedPct - altPct) + '% Unmapped';
}
