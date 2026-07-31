import { api } from '../../lib/api.js';
import { showToast } from '../../lib/toast.js';
import { loadClients } from './client-table.js';
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

    // Normalize whitespace across all mappings
    document.getElementById('normalizeMappingsBtn').addEventListener('click', normalizeAllMappings);

    // Event delegation for client table actions
    document.getElementById('clientListContainer').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const client = btn.dataset.client;

        if (action === 'view') viewMappings(client);
        else if (action === 'excel') exportExcel(client);
        else if (action === 'uipath') openUiPathModal(client);
        else if (action === 'configure') openConfigureModal(client);
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
 * Opens a portal-selection modal then downloads the UiPath export from the server.
 * @param {string} name - Client name
 */
function openUiPathModal(name) {
    const overlay = makeOverlay();

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '380px';

    const closeBtn = makeCloseBtn(() => overlay.remove());

    const title = document.createElement('h3');
    title.textContent = name + ' — Export for UiPath';

    const label = document.createElement('label');
    label.textContent = 'Portal';
    label.style.cssText = 'display:block;font-weight:600;margin:16px 0 6px;';

    const select = document.createElement('select');
    select.className = 'portal-select';
    select.style.cssText = 'width:100%;margin-bottom:16px;';
    [['availity', 'Availity'], ['uhc', 'UHC']].forEach(([val, label]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        select.appendChild(opt);
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-success';
    downloadBtn.textContent = 'Download';
    downloadBtn.style.width = '100%';
    downloadBtn.addEventListener('click', async () => {
        const portal = select.value;
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Downloading...';
        try {
            const { blob, filename } = await api.download(
                '/clients/' + encodeURIComponent(name) + '/export/uipath?portal=' + portal
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            overlay.remove();
            showToast('Exported UiPath JSON (' + portal.toUpperCase() + ') for ' + name, 'success');
        } catch (e) {
            showToast('Export failed: ' + e.message, 'error');
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download';
        }
    });

    modal.append(closeBtn, title, label, select, downloadBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

/**
 * Opens a modal to view and update per-portal configurations for a client.
 * @param {string} name - Client name
 */
async function openConfigureModal(name) {
    const overlay = makeOverlay();

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '520px';

    const closeBtn = makeCloseBtn(() => overlay.remove());

    const title = document.createElement('h3');
    title.textContent = name + ' — Portal Configuration';

    // Portal selector
    const portalLabel = document.createElement('label');
    portalLabel.textContent = 'Portal';
    portalLabel.style.cssText = 'display:block;font-weight:600;margin:16px 0 6px;';

    const portalSelect = document.createElement('select');
    portalSelect.className = 'portal-select';
    portalSelect.style.cssText = 'width:100%;margin-bottom:16px;';
    const uhcOpt = document.createElement('option');
    uhcOpt.value = 'UHC';
    uhcOpt.textContent = 'UHC — TaxID to Facility mapping';
    portalSelect.appendChild(uhcOpt);

    const statusLine = document.createElement('p');
    statusLine.style.cssText = 'font-size:0.85em;color:var(--text-muted);margin:0 0 8px;';

    const configLabel = document.createElement('label');
    configLabel.style.cssText = 'display:block;font-weight:600;margin-bottom:6px;';
    configLabel.textContent = 'Configuration JSON (paste and save)';

    const textarea = document.createElement('textarea');
    textarea.style.cssText = 'width:100%;height:180px;font-family:monospace;font-size:0.82em;box-sizing:border-box;padding:8px;border:1px solid var(--border);border-radius:4px;background:var(--input-bg,var(--bg-secondary));color:var(--text);resize:vertical;';
    textarea.placeholder = '{\n  "843178470": "U Of L Health Louisville (007305605)",\n  "611293786": "University Medical Center (003311434)"\n}';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-success';
    saveBtn.textContent = 'Save Configuration';
    saveBtn.style.cssText = 'width:100%;margin-top:12px;';

    async function loadPortalConfig() {
        const portal = portalSelect.value;
        statusLine.textContent = 'Loading...';
        textarea.value = '';
        try {
            const result = await api.get('/admin/clients/' + encodeURIComponent(name) + '/portal-config/' + portal);
            if (result.exists) {
                textarea.value = JSON.stringify(result.config, null, 2);
                statusLine.textContent = 'Last updated: ' + new Date(result.updatedAt).toLocaleString();
            } else {
                statusLine.textContent = 'No configuration saved yet.';
            }
        } catch (e) {
            statusLine.textContent = 'Error loading config: ' + e.message;
        }
    }

    portalSelect.addEventListener('change', loadPortalConfig);

    saveBtn.addEventListener('click', async () => {
        const portal = portalSelect.value;
        let parsed;
        try {
            parsed = JSON.parse(textarea.value);
        } catch {
            showToast('Invalid JSON — check formatting', 'error');
            return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
            const result = await api.put(
                '/admin/clients/' + encodeURIComponent(name) + '/portal-config/' + portal,
                { config: parsed }
            );
            showToast('Saved ' + result.keys + ' entries for ' + portal, 'success');
            statusLine.textContent = 'Saved just now (' + result.keys + ' entries)';
        } catch (e) {
            showToast('Save failed: ' + e.message, 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Configuration';
        }
    });

    modal.append(closeBtn, title, portalLabel, portalSelect, statusLine, configLabel, textarea, saveBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    loadPortalConfig();
}

function makeOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    return overlay;
}

function makeCloseBtn(onClose) {
    const btn = document.createElement('button');
    btn.className = 'modal-close';
    btn.textContent = '×';
    btn.addEventListener('click', onClose);
    return btn;
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
 * Triggers the worker normalize-mappings endpoint to clean up whitespace
 * in plan_name, state_name, and availity_payer_name across all clients.
 * Idempotent — running multiple times is safe.
 */
async function normalizeAllMappings() {
    if (!confirm('Normalize whitespace across ALL client mappings?\n\nThis trims leading/trailing spaces from state names, plan names, and payer names.\nIf trimming causes duplicates within a client/state, the most recently updated row wins.\n\nThis is safe to run multiple times.')) return;
    const status = document.getElementById('normalizeStatus');
    const btn = document.getElementById('normalizeMappingsBtn');
    status.textContent = 'Normalizing...';
    btn.disabled = true;
    try {
        const result = await api.post('/admin/normalize-mappings', {});
        const msg = result.totalRows + ' rows scanned. '
            + result.rowsTrimmed + ' trimmed, '
            + result.rowsDeleted + ' duplicates removed across '
            + result.clientsAffected + ' clients.';
        status.textContent = msg;
        showToast('Normalization complete: ' + msg, 'success');
        loadClients();
    } catch (e) {
        status.textContent = 'Error: ' + e.message;
        showToast('Normalize failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
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
