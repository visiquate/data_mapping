/**
 * Auto-save functionality for mapping progress
 * Saves to localStorage immediately, debounced API save after 2 seconds
 */

import { api } from '../../lib/api.js';
import { getState } from './state.js';

let saveTimer;

/**
 * Cancel any pending auto-save timer (call on client switch)
 */
export function cancelPendingAutoSave() {
    clearTimeout(saveTimer);
}

/**
 * Auto-save the current mappings
 * Immediately saves to localStorage, debounces API save by 2 seconds
 */
export function autoSave() {
    const state = getState();
    if (!state.clientName) return;

    // Save to localStorage immediately
    const data = {
        clientName: state.clientName,
        lastUpdated: new Date().toISOString(),
        mappings: state.currentMappings
    };
    localStorage.setItem('payerMapping_' + state.clientName, JSON.stringify(data));

    // Debounced API save (2s)
    if (state.clientAuthenticated) {
        clearTimeout(saveTimer);
        const saveClient = state.clientName;
        const saveMappings = JSON.parse(JSON.stringify(state.currentMappings));
        saveTimer = setTimeout(async () => {
            try {
                await api.put('/clients/' + encodeURIComponent(saveClient) + '/mappings', { mappings: saveMappings });
                showIndicator('Saved to cloud');
            } catch (e) {
                console.error('Auto-save failed:', e);
                showIndicator('Saved locally');
            }
        }, 2000);
    } else {
        showIndicator('Saved locally');
    }
}

/**
 * Show a temporary save indicator notification
 * @param {string} text - The text to display
 */
function showIndicator(text) {
    const indicator = document.getElementById('autoSaveIndicator');
    if (!indicator) return;
    indicator.textContent = text;
    indicator.classList.add('show');
    setTimeout(() => indicator.classList.remove('show'), 1500);
}
