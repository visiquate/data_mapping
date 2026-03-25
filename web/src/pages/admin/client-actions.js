import { api } from '../../lib/api.js';
import { showToast } from '../../lib/toast.js';
import { loadClients } from './client-table.js';
import { STATE_ABBREV, ALT_PORTAL_VALUES } from '../../lib/state-map.js';
import { XLSX } from '../../lib/xlsx-utils.js';

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} - Escaped HTML
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Sets up all client action handlers with event delegation
 * Binds create, download, and table action listeners
 */
export function setupClientActions() {
    // Create client
    document.getElementById('createClientBtn').addEventListener('click', createClient);

    // Download standalone
    document.getElementById('downloadStandaloneBtn').addEventListener('click', downloadStandalone);

    // Event delegation for client table actions
    document.getElementById('clientListContainer').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const client = btn.dataset.client;

        if (action === 'view') viewMappings(client);
        else if (action === 'excel') exportExcel(client);
        else if (action === 'uipath') exportUiPath(client);
        else if (action === 'edit') editClient(client);
        else if (action === 'delete') deleteClient(client);
        else if (action === 'resetpass') resetPassphrase(client);
    });
}

/**
 * Creates a new client
 * Validates name and passphrase, calls API, refreshes client list
 */
async function createClient() {
    const nameInput = document.getElementById('newClientName');
    const passInput = document.getElementById('newClientPassphrase');
    const name = nameInput.value.trim().toUpperCase();
    nameInput.value = name;
    const passphrase = passInput.value.trim();

    if (!name || name.length < 2) {
        showToast('Client name must be at least 2 characters', 'error');
        return;
    }
    if (!passphrase) {
        showToast('Enter a passphrase for the client', 'error');
        return;
    }

    try {
        await api.post('/admin/clients', { clientName: name, passphrase });
        nameInput.value = '';
        passInput.value = '';
        showToast('Client "' + name + '" created', 'success');
        loadClients();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

/**
 * Displays all mappings for a client in a modal
 * @param {string} name - Client name
 */
async function viewMappings(name) {
    try {
        const mappings = await api.get('/admin/clients/' + encodeURIComponent(name) + '/mappings');

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        const modal = document.createElement('div');
        modal.className = 'modal';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.textContent = '\u00d7';
        closeBtn.addEventListener('click', () => overlay.remove());

        const title = document.createElement('h3');
        title.textContent = name + ' \u2014 ' + mappings.length + ' Mappings';

        modal.appendChild(closeBtn);
        modal.appendChild(title);

        if (mappings.length === 0) {
            const empty = document.createElement('p');
            empty.style.color = 'var(--text-muted)';
            empty.textContent = 'No mappings yet.';
            modal.appendChild(empty);
        } else {
            const table = document.createElement('table');
            table.className = 'mapping-detail-table';

            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            ['State', 'Plan Name', 'Payer ID', 'Payer Name'].forEach(label => {
                const th = document.createElement('th');
                th.textContent = label;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            mappings.forEach(m => {
                const tr = document.createElement('tr');
                [m.state, m.planName, m.availityPayerId, m.availityPayerName].forEach(val => {
                    const td = document.createElement('td');
                    td.textContent = val ?? '';
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            modal.appendChild(table);
        }

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

/**
 * Exports client mappings as Excel file
 * @param {string} name - Client name
 */
async function exportExcel(name) {
    try {
        const mappings = await api.get('/admin/clients/' + encodeURIComponent(name) + '/mappings');
        const rows = [['State', 'Plan Name', 'Payer ID', 'Payer Name']];
        mappings.forEach(m => {
            rows.push([m.state, m.planName, m.availityPayerId || '', m.availityPayerName || '']);
        });
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 20 }, { wch: 40 }, { wch: 15 }, { wch: 40 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Mappings');
        const timestamp = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, name + '_mapping_v6.0_' + timestamp + '.xlsx');
        showToast('Exported Excel for ' + name, 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

/**
 * Exports client mappings as UiPath JSON format
 * Filters out alternative portal values and groups by state/payer
 * @param {string} name - Client name
 */
async function exportUiPath(name) {
    try {
        const mappings = await api.get('/admin/clients/' + encodeURIComponent(name) + '/mappings');
        const outputByPayerState = {};

        mappings.forEach(m => {
            const payerId = m.availityPayerId;
            if (!payerId || ALT_PORTAL_VALUES.includes(payerId)) return;
            const stateAbbrev = STATE_ABBREV[m.state] || m.state;
            const pKey = stateAbbrev + '|' + payerId;
            if (!outputByPayerState[pKey]) {
                outputByPayerState[pKey] = {
                    LocationCode: stateAbbrev,
                    AvailityPayerID: payerId,
                    ClaimDataPageLayoutType: 1,
                    Queues: []
                };
            }
            const queueName = m.planName.trim() + ', ' + stateAbbrev;
            if (!outputByPayerState[pKey].Queues.includes(queueName)) {
                outputByPayerState[pKey].Queues.push(queueName);
            }
        });

        const output = Object.values(outputByPayerState).sort((a, b) => {
            if (a.LocationCode !== b.LocationCode) {
                return a.LocationCode.localeCompare(b.LocationCode);
            }
            return a.AvailityPayerID.localeCompare(b.AvailityPayerID);
        });

        const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = name + '_uipath_v6.0_' + timestamp + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Exported UiPath JSON for ' + name, 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

/**
 * Opens the main mapping tool for a client
 * @param {string} name - Client name
 */
function editClient(name) {
    window.open('index.html?client=' + encodeURIComponent(name), '_blank');
}

/**
 * Deletes a client and all their mappings
 * Requires two confirmation dialogs
 * @param {string} name - Client name
 */
async function deleteClient(name) {
    if (!confirm('Delete client "' + name + '" and ALL their mappings? This cannot be undone.')) return;
    if (!confirm('Are you really sure?')) return;
    try {
        await api.delete('/admin/clients/' + encodeURIComponent(name));
        showToast('Client "' + name + '" deleted', 'success');
        loadClients();
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

/**
 * Resets a client's passphrase
 * Prompts for new passphrase and updates via API
 * @param {string} name - Client name
 */
async function resetPassphrase(name) {
    const newPass = prompt('Enter new passphrase for "' + name + '":');
    if (!newPass) return;
    try {
        await api.patch('/admin/clients/' + encodeURIComponent(name) + '/passphrase', { newPassphrase: newPass });
        showToast('Passphrase reset for ' + name, 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

/**
 * Downloads standalone HTML version of the mapping tool
 * Feature not yet available in Vite build
 */
async function downloadStandalone() {
    const status = document.getElementById('standaloneStatus');
    status.textContent = 'This feature is not yet available in the new version.';
    setTimeout(() => {
        status.textContent = '';
    }, 3000);
    // TODO: Implement standalone HTML generation for Vite-built version
}
