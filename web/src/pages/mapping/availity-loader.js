/**
 * Load Availity payer data from API
 */

import { api } from '../../lib/api.js';

/**
 * Load all available payers by state from the API
 * @returns {Promise<Object>} Object mapping state names to arrays of payers
 */
export async function loadAvailityPayers() {
    try {
        const payers = await api.get('/payers');
        return payers;
    } catch (error) {
        console.error('Failed to load payer data from API:', error);
        return {};
    }
}
