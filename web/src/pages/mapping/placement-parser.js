/**
 * Handle file uploads and parsing for placement data and mappings
 */

import { showToast } from '../../lib/toast.js';
import { readSpreadsheet } from '../../lib/xlsx-utils.js';
import { detectPHIColumns } from '../../lib/phi-detector.js';
import { STATE_MAP, STATE_ABBREV, ALT_PORTAL_VALUES, PAGE_SCHEMA_DATA } from '../../lib/state-map.js';
import { getState } from './state.js';
import { renderMappingInterface, updateStats, buildPlansFromMappings, applyMappingsToInterface } from './mapping-ui.js';
import { XLSX } from '../../lib/xlsx-utils.js';
import { autoSave } from './auto-save.js';

/**
 * Setup all file input handlers and drag-drop zones
 */
export function setupFileHandlers() {
    document.getElementById('placementFile').addEventListener('change', handlePlacementFile);
    setupDragDrop('placementDropZone', 'placementFile');
    document.getElementById('mappingFile').addEventListener('change', handleMappingFile);
    setupDragDrop('mappingDropZone', 'mappingFile');
    document.getElementById('saveMappingBtn').addEventListener('click', saveMappingProgress);
    document.getElementById('exportJsonBtn').addEventListener('click', exportForUiPath);
    document.getElementById('schemaFile').addEventListener('change', handleSchemaFile);
    setupDragDrop('schemaDropZone', 'schemaFile');
}

/**
 * Setup drag-and-drop for a file input zone
 * @param {string} zoneId - ID of the drop zone element
 * @param {string} inputId - ID of the file input element
 */
function setupDragDrop(zoneId, inputId) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', (e) => {
        e.preventDefault(); zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; input.dispatchEvent(new Event('change')); }
    });
}

/**
 * Handle placement file upload
 * @param {Event} e - The change event
 */
async function handlePlacementFile(e) {
    const state = getState();
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('placementFileName').textContent = file.name;
    document.getElementById('placementDropZone').classList.add('has-file');
    try {
        const data = await readFileAsArray(file);
        state.placementData = readSpreadsheet(data, file.name);
        const phiCols = detectPHIColumns(state.placementData);
        if (phiCols.length > 0) {
            state.placementData = [];
            document.getElementById('placementDropZone').classList.remove('has-file');
            document.getElementById('placementFileName').textContent = '';
            e.target.value = '';
            showToast('File rejected — contains PHI columns: ' + phiCols.join(', ') + '. Please use the PHI Stripper tool first.', 'error');
            return;
        }
        processPlacementData();
        showToast('Placement file loaded: ' + state.placementData.length + ' rows', 'success');
    } catch (error) {
        showToast('Error: ' + error.message, 'error');
        console.error(error);
    }
}

/**
 * Read a file as a Uint8Array
 * @param {File} file - The file to read
 * @returns {Promise<Uint8Array>} Array buffer of the file
 */
function readFileAsArray(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(new Uint8Array(e.target.result));
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Handle mapping file upload (previous mappings or UiPath output)
 * @param {Event} e - The change event
 */
async function handleMappingFile(e) {
    const state = getState();
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('mappingFileName').textContent = file.name;
    document.getElementById('mappingDropZone').classList.add('has-file');
    try {
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data);
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws);
            const mappings = {};
            rows.forEach(row => {
                const s = row['State'];
                const p = row['Plan Name'];
                if (s && p) {
                    mappings[s + '|' + p] = { availityPayerId: row['Payer ID'] || '', availityPayerName: row['Payer Name'] || '' };
                }
            });
            state.currentMappings = mappings;
            showToast('Loaded ' + Object.keys(state.currentMappings).length + ' mappings from Excel file', 'success');
        } else {
            const text = await file.text();
            const mappingData = JSON.parse(text);
            if (Array.isArray(mappingData)) {
                state.currentMappings = convertUiPathToMappings(mappingData);
                showToast('Loaded ' + Object.keys(state.currentMappings).length + ' mappings from UiPath file', 'success');
            } else {
                state.currentMappings = mappingData.mappings || {};
                showToast('Loaded ' + Object.keys(state.currentMappings).length + ' mappings', 'success');
            }
        }
        if (Object.keys(state.plansByState).length === 0) {
            buildPlansFromMappings();
        } else {
            applyMappingsToInterface();
        }
    } catch (error) { showToast('Error: ' + error.message, 'error'); }
}

/**
 * Convert UiPath format to our internal mappings format
 * @param {Array} uipathData - Array of UiPath entries
 * @returns {Object} Mappings object
 */
function convertUiPathToMappings(uipathData) {
    const state = getState();
    const mappings = {};
    uipathData.forEach(entry => {
        const stateAbbrev = entry.LocationCode;
        const fullState = STATE_MAP[stateAbbrev] || stateAbbrev;
        const payerId = entry.AvailityPayerID;
        (entry.Queues || []).forEach(queue => {
            const planName = queue.replace(/\s*,\s*[A-Z]{2}\s*$/, '').trim();
            const mappingKey = fullState + '|' + planName;
            const statePayers = state.AVAILITY_PAYERS[fullState] || [];
            const matchedPayer = statePayers.find(p => p.payerId === payerId);
            mappings[mappingKey] = {
                availityPayerId: payerId,
                availityPayerName: matchedPayer ? matchedPayer.payerName : payerId
            };
        });
    });
    return mappings;
}

/**
 * Handle schema file upload
 * @param {Event} e - The change event
 */
function handleSchemaFile(e) {
    const state = getState();
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('schemaFileName').textContent = file.name;
    document.getElementById('schemaDropZone').classList.add('has-file');
    file.text().then(text => {
        state.PAGE_SCHEMAS = JSON.parse(text);
        showToast('Loaded ' + Object.keys(state.PAGE_SCHEMAS).length + ' page schemas', 'success');
    }).catch(error => showToast('Error: ' + error.message, 'error'));
}

/**
 * Process the placement data to build plansByState
 * Extracts unique State|Payer combinations and their volumes
 */
export function processPlacementData() {
    const state = getState();
    state.plansByState = {};
    const sampleRow = state.placementData[0] || {};
    const columns = Object.keys(sampleRow);
    const stateCol = columns.find(c => c.toLowerCase() === 'state');
    const payerCol = columns.find(c => c.toLowerCase() === 'payer1' || c.toLowerCase() === 'payer');
    const volumeCol = columns.find(c => c.toLowerCase() === 'volume');

    if (!stateCol || !payerCol) {
        showToast('Could not find State or Payer1 columns', 'error');
        return;
    }

    const planCounts = {};
    state.placementData.forEach(row => {
        let s = row[stateCol];
        const payer = String(row[payerCol] || '').trim();
        if (!s || !payer) return;
        s = String(s).trim();
        const stateUpper = s.toUpperCase();
        const fullState = STATE_MAP[stateUpper] || STATE_MAP[s] || Object.keys(STATE_MAP).reduce((found, abbr) => found || (STATE_MAP[abbr].toUpperCase() === stateUpper ? STATE_MAP[abbr] : null), null) || s;
        const stateAbbrev = STATE_ABBREV[fullState] || s;
        const key = fullState + '|' + payer;
        const parsed = volumeCol ? parseInt(row[volumeCol]) : NaN;
        const vol = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
        if (!planCounts[key]) planCounts[key] = { state: fullState, stateAbbrev, payer, count: 0 };
        planCounts[key].count += vol;
    });

    Object.values(planCounts).forEach(item => {
        if (!state.plansByState[item.state]) state.plansByState[item.state] = [];
        state.plansByState[item.state].push({ planName: item.payer, stateAbbrev: item.stateAbbrev, volume: item.count });
    });

    Object.keys(state.plansByState).forEach(st => {
        state.plansByState[st].sort((a, b) => b.volume - a.volume);
    });

    document.getElementById('statsSection').classList.remove('hidden');
    document.getElementById('mappingSection').classList.remove('hidden');
    document.getElementById('actionsSection').classList.remove('hidden');
    renderMappingInterface();
    updateStats();
}

/**
 * Save mapping progress to Excel file
 */
function saveMappingProgress() {
    const state = getState();
    const name = state.clientName || 'Client';
    const rows = [['State', 'Plan Name', 'Payer ID', 'Payer Name']];
    Object.entries(state.currentMappings).forEach(([key, mapping]) => {
        const sep = key.indexOf('|');
        const s = sep === -1 ? key : key.slice(0, sep);
        const planName = sep === -1 ? '' : key.slice(sep + 1);
        rows.push([s, planName, mapping.availityPayerId || '', mapping.availityPayerName || '']);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:20},{wch:40},{wch:20},{wch:40}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Mappings');
    const meta = XLSX.utils.aoa_to_sheet([['Client Name', 'Last Updated'], [name, new Date().toISOString().split('T')[0]]]);
    XLSX.utils.book_append_sheet(wb, meta, 'Info');
    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, name + '_mapping_v6.0_' + timestamp + '.xlsx');
    showToast('Mapping progress saved to Excel file', 'success');
}

/**
 * Export mapping data for UiPath automation
 */
function exportForUiPath() {
    const state = getState();
    const schemas = state.PAGE_SCHEMAS || PAGE_SCHEMA_DATA;
    const outputByPayerState = {};
    Object.entries(state.plansByState).forEach(([st, plans]) => {
        plans.forEach(plan => {
            const mappingKey = st + '|' + plan.planName;
            const mapping = state.currentMappings[mappingKey];
            if (!mapping) return;
            const payerId = mapping.availityPayerId;
            if (ALT_PORTAL_VALUES.includes(payerId)) return;
            const stateAbbrev = plan.stateAbbrev;
            const key = stateAbbrev + '|' + payerId;
            if (!outputByPayerState[key]) {
                outputByPayerState[key] = { LocationCode: stateAbbrev, AvailityPayerID: payerId, ClaimDataPageLayoutType: schemas[payerId] !== undefined ? schemas[payerId] : 1, Queues: [] };
            }
            const queueName = plan.planName + ', ' + stateAbbrev;
            if (!outputByPayerState[key].Queues.includes(queueName)) outputByPayerState[key].Queues.push(queueName);
        });
    });
    const output = Object.values(outputByPayerState).sort((a, b) => {
        if (a.LocationCode !== b.LocationCode) return a.LocationCode.localeCompare(b.LocationCode);
        return a.AvailityPayerID.localeCompare(b.AvailityPayerID);
    });
    const name = state.clientName || 'Client';
    const timestamp = new Date().toISOString().split('T')[0];
    const blob = new Blob([JSON.stringify(output, null, 4)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name + '_uipath_v6.0_' + timestamp + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('UiPath JSON exported', 'success');
}
