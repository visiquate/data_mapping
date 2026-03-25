import { api } from '../../lib/api.js';
import { showToast } from '../../lib/toast.js';
import { ALT_PORTAL_VALUES } from '../../lib/state-map.js';

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
 * Loads and renders the client list table
 * Fetches clients from API and displays status counts and actions
 */
export async function loadClients() {
    const container = document.getElementById('clientListContainer');
    try {
        const clients = await api.get('/admin/clients');

        if (!clients.length) {
            container.innerHTML = '<p style="color: var(--text-muted);">No clients yet. Create one above.</p>';
            return;
        }

        let html = '<table class="client-table"><thead><tr>' +
            '<th>Client</th><th>Total</th><th>Mapped</th><th>Not In Availity</th><th>Unmapped</th><th>Last Updated</th><th>Actions</th>' +
            '</tr></thead><tbody>';

        clients.forEach(c => {
            const lastUpdated = c.lastUpdated ? new Date(c.lastUpdated).toLocaleDateString() : 'Never';
            html += '<tr>' +
                '<td><strong>' + escapeHtml(c.clientName) + '</strong></td>' +
                '<td><span class="badge badge-gray">' + c.total + '</span></td>' +
                '<td>' + (c.mapped > 0 ? '<span class="badge badge-green">' + c.mapped + '</span>' : '<span class="badge badge-gray">0</span>') + '</td>' +
                '<td>' + (c.altPortal > 0 ? '<span class="badge" style="background:var(--color-warning);color:white;">' + c.altPortal + '</span>' : '<span class="badge badge-gray">0</span>') + '</td>' +
                '<td>' + (c.unmapped > 0 ? '<span class="badge" style="background:var(--color-error);color:white;">' + c.unmapped + '</span>' : '<span class="badge badge-gray">0</span>') + '</td>' +
                '<td>' + lastUpdated + '</td>' +
                '<td class="actions">' +
                    '<button class="btn btn-primary btn-sm" data-action="view" data-client="' + escapeHtml(c.clientName) + '">View</button>' +
                    '<button class="btn btn-success btn-sm" data-action="excel" data-client="' + escapeHtml(c.clientName) + '">Excel</button>' +
                    '<button class="btn btn-secondary btn-sm" data-action="uipath" data-client="' + escapeHtml(c.clientName) + '">UiPath</button>' +
                    '<button class="btn btn-sm" style="background:var(--color-warning);color:white;" data-action="edit" data-client="' + escapeHtml(c.clientName) + '">Edit</button>' +
                    '<button class="btn btn-danger btn-sm" data-action="delete" data-client="' + escapeHtml(c.clientName) + '">Delete</button>' +
                    '<button class="btn btn-sm" style="background:#8e44ad;color:white;" data-action="resetpass" data-client="' + escapeHtml(c.clientName) + '">Reset Pass</button>' +
                '</td></tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<p style="color: var(--color-error);">Error loading clients: ' + e.message + '</p>';
    }
}
