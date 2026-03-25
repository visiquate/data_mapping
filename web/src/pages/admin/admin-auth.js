import { loginAdmin } from '../../lib/auth.js';
import { showToast } from '../../lib/toast.js';
import { loadClients } from './client-table.js';

/**
 * Sets up admin authentication flow
 * Attaches login button and passphrase input listeners
 */
export function setupAdminAuth() {
    const loginBtn = document.getElementById('loginBtn');
    const passphraseInput = document.getElementById('adminPassphrase');

    loginBtn.addEventListener('click', handleLogin);
    passphraseInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
}

/**
 * Handles admin login attempt
 * Validates passphrase and transitions to dashboard
 */
async function handleLogin() {
    const passphrase = document.getElementById('adminPassphrase').value.trim();
    if (!passphrase) {
        showToast('Enter passphrase', 'error');
        return;
    }

    try {
        await loginAdmin(passphrase);
        document.getElementById('loginSection').classList.add('hidden');
        document.getElementById('dashboardSection').classList.remove('hidden');
        loadClients();
        showToast('Logged in as admin', 'success');
    } catch (e) {
        showToast(e.message || 'Login failed', 'error');
    }
}
