const API_BASE = (window.location.hostname === 'localhost')
    ? '/api/v1'
    : 'https://payer-mapping-api.visiquate-inc.workers.dev/api/v1';

function getToken() {
    return sessionStorage.getItem('authToken');
}

export function setToken(token) {
    sessionStorage.setItem('authToken', token);
}

export function clearToken() {
    sessionStorage.removeItem('authToken');
}

export function getStoredClientName() {
    return sessionStorage.getItem('currentClient');
}

export function setStoredClientName(name) {
    sessionStorage.setItem('currentClient', name);
}

async function request(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const response = await fetch(API_BASE + path, { ...options, headers });

    if (response.status === 401) {
        // Don't clear token for auth endpoints — these are login failures, not expired sessions
        if (!path.startsWith('/auth/')) {
            clearToken();
            throw new Error('Session expired. Please log in again.');
        }
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Invalid credentials');
    }

    if (response.status === 403) {
        // Access denied — token may be for a different client, or session is invalid
        if (!path.startsWith('/auth/')) {
            clearToken();
            throw new Error('Session expired. Please log in again.');
        }
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Access denied');
    }

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Request failed: ' + response.status);
    }

    if (response.status === 204) return null;
    return response.json();
}

export const api = {
    get: (path) => request(path, { method: 'GET' }),
    post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
    put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (path) => request(path, { method: 'DELETE' }),
    // For binary downloads (Excel exports)
    getBlob: async (path) => {
        const token = getToken();
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const response = await fetch(API_BASE + path, { headers });
        if (!response.ok) throw new Error('Download failed: ' + response.status);
        return response.blob();
    },
};
