/**
 * Client authentication and connection handling
 * Manages login, session restoration, and data loading
 */

import { api, getStoredClientName, setStoredClientName } from '../../lib/api.js';
import { loginClient } from '../../lib/auth.js';
import { showToast } from '../../lib/toast.js';
import { getState } from './state.js';
import { renderMappingInterface, updateStats, buildPlansFromMappings, applyMappingsToInterface } from './mapping-ui.js';
import { autoSave, cancelPendingAutoSave } from './auto-save.js';

/**
 * Setup client authentication handlers
 */
export function setupClientHandler() {
    const clientInput = document.getElementById('clientName');
    const passphraseInput = document.getElementById('clientPassphrase');
    const connectBtn = document.getElementById('connectBtn');
    const clientStatus = document.getElementById('clientStatus');
    const clearBtn = document.getElementById('clearDataBtn');
    const state = getState();

    // Restore session
    const savedClient = sessionStorage.getItem('currentClient');
    const savedToken = sessionStorage.getItem('authToken');
    if (savedClient && savedToken) {
        clientInput.value = savedClient;
        // Try to load mappings with existing token
        restoreSession(savedClient);
    }

    let connecting = false;

    connectBtn.addEventListener('click', handleConnect);
    passphraseInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleConnect(); });

    /**
     * Restore a saved client session
     * @param {string} name - Client name
     */
    async function restoreSession(name) {
        try {
            const data = await api.get('/clients/' + encodeURIComponent(name) + '/mappings');
            state.clientName = name;
            state.clientAuthenticated = true;
            state.currentMappings = data.mappings || {};
            const count = Object.keys(state.currentMappings).length;
            clientStatus.textContent = 'Loaded ' + count + ' mappings from cloud';
            clientStatus.className = 'client-status loaded';
            clientStatus.classList.remove('hidden');
            clearBtn.classList.remove('hidden');
            updateConnectionStatus('connected');
            if (count > 0 && Object.keys(state.plansByState).length === 0) {
                buildPlansFromMappings();
            }
            renderMappingInterface();
            updateStats();
        } catch (e) {
            // Token expired, need to re-login
            updateConnectionStatus('none');
        }
    }

    /**
     * Handle the Connect button click
     */
    async function handleConnect() {
        if (connecting) return;

        const name = clientInput.value.trim().toUpperCase();
        clientInput.value = name;
        const passphrase = passphraseInput.value.trim();

        if (name.length < 2) { showToast('Please enter a client name (at least 2 characters)', 'error'); return; }
        if (!passphrase) { showToast('Please enter a passphrase', 'error'); return; }

        connecting = true;
        cancelPendingAutoSave();
        state.currentMappings = {};
        state.plansByState = {};
        state.placementData = [];
        connectBtn.textContent = 'Connecting...';
        connectBtn.disabled = true;

        try {
            const loginResult = await loginClient(name, passphrase);
            state.clientName = loginResult.clientName;
            state.clientAuthenticated = true;
            clientInput.value = state.clientName;

            // Load mappings
            const data = await api.get('/clients/' + encodeURIComponent(state.clientName) + '/mappings');
            state.currentMappings = data.mappings || {};
            const count = Object.keys(state.currentMappings).length;

            clientStatus.textContent = 'Loaded ' + count + ' mappings from cloud';
            clientStatus.className = 'client-status loaded';
            clearBtn.classList.remove('hidden');
            updateConnectionStatus('connected');

            if (count > 0 && Object.keys(state.plansByState).length === 0) {
                buildPlansFromMappings();
            } else {
                applyMappingsToInterface();
            }
            showToast('Connected to ' + state.clientName + ' — loaded ' + count + ' mappings', 'success');
        } catch (e) {
            state.clientAuthenticated = false;
            if (e.message.includes('Invalid credentials')) {
                clientStatus.textContent = 'Invalid credentials';
                clientStatus.className = 'client-status new';
                updateConnectionStatus('none');
                showToast('Invalid credentials for ' + name + '. Check client name and passphrase.', 'error');
            } else {
                // Offline fallback
                state.clientName = name;
                clientStatus.textContent = 'Working offline';
                clientStatus.className = 'client-status new';
                updateConnectionStatus('offline');
                loadClientDataLocal(name);
                showToast('Cannot reach server. Working offline with local data.', 'error');
            }
        } finally {
            connecting = false;
            connectBtn.textContent = 'Connect';
            connectBtn.disabled = false;
            clientStatus.classList.remove('hidden');
        }
    }

    clearBtn.addEventListener('click', async () => {
        if (confirm('WARNING: This will permanently delete ALL saved mappings for "' + state.clientName + '". This cannot be undone.\n\nAre you absolutely sure?')) {
            localStorage.removeItem('payerMapping_' + state.clientName);
            state.currentMappings = {};
            if (state.clientAuthenticated) {
                try {
                    await api.put('/clients/' + encodeURIComponent(state.clientName) + '/mappings', { mappings: {} });
                } catch (e) { console.error('Failed to clear cloud data:', e); }
            }
            state.plansByState = {};
            renderMappingInterface();
            updateStats();
            clientStatus.textContent = 'Data cleared - starting fresh';
            clientStatus.className = 'client-status new';
            showToast('All data permanently cleared for ' + state.clientName, 'success');
        }
    });
}

/**
 * Load client data from localStorage if available
 * @param {string} name - Client name
 */
function loadClientDataLocal(name) {
    const state = getState();
    const clientStatus = document.getElementById('clientStatus');
    const clearBtn = document.getElementById('clearDataBtn');
    const savedData = localStorage.getItem('payerMapping_' + name);
    if (savedData) {
        try {
            const data = JSON.parse(savedData);
            state.currentMappings = data.mappings || {};
            const count = Object.keys(state.currentMappings).length;
            clientStatus.textContent = 'Loaded ' + count + ' mappings (local)';
            clientStatus.className = 'client-status loaded';
            clearBtn.classList.remove('hidden');
            renderMappingInterface();
            updateStats();
        } catch (e) {
            clientStatus.textContent = 'New client - no saved data';
            clientStatus.className = 'client-status new';
        }
    } else {
        clientStatus.textContent = 'New client - no saved data';
        clientStatus.className = 'client-status new';
        clearBtn.classList.add('hidden');
    }
}

/**
 * Update the connection status indicator
 * @param {string} status - 'connected', 'offline', or 'none'
 */
export function updateConnectionStatus(status) {
    const el = document.getElementById('connectionStatus');
    if (status === 'connected') {
        el.innerHTML = '&#9729;&#65039; Connected';
        el.style.color = 'var(--color-success)';
    } else if (status === 'offline') {
        el.innerHTML = '&#128190; Local only';
        el.style.color = 'var(--color-warning)';
    } else if (status === 'none') {
        el.innerHTML = '';
    }
}
