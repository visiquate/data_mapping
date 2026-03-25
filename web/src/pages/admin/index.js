import { initDarkMode } from '../../lib/dark-mode.js';
import { setupAdminAuth } from './admin-auth.js';
import { setupClientActions } from './client-actions.js';

document.addEventListener('DOMContentLoaded', () => {
    initDarkMode();
    setupAdminAuth();
    setupClientActions();
});
