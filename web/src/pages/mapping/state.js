/**
 * Shared mutable state for the mapping page
 * This is the central source of truth for all mapping data
 */

const state = {
    AVAILITY_PAYERS: {},
    placementData: [],
    plansByState: {},
    currentMappings: {},
    currentFilter: 'all',
    clientName: '',
    PAGE_SCHEMAS: null,
    clientAuthenticated: false,
};

/**
 * Get the global state object
 * @returns {Object} The shared state
 */
export function getState() {
    return state;
}
