/**
 * Payer Mapping Tool - Entry Point
 * Initializes the application and sets up all event handlers
 */

import { initDarkMode } from '../../lib/dark-mode.js';
import { api, getStoredClientName } from '../../lib/api.js';
import { showToast } from '../../lib/toast.js';
import { setupClientHandler } from './client-auth.js';
import { loadAvailityPayers } from './availity-loader.js';
import { setupFileHandlers } from './placement-parser.js';
import { setupFilterButtons, setupSearch, renderMappingInterface } from './mapping-ui.js';
import { getState } from './state.js';

/**
 * Initialize the application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', async () => {
    initDarkMode();

    const state = getState();
    state.AVAILITY_PAYERS = await loadAvailityPayers();
    setupClientHandler();
    setupFileHandlers();
    setupFilterButtons();
    setupSearch();
});
