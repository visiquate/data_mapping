import { api, setToken, clearToken, setStoredClientName } from './api.js';

export async function loginAdmin(passphrase) {
    const result = await api.post('/auth/admin/login', { passphrase });
    setToken(result.token);
    return result;
}

export async function loginClient(clientName, passphrase) {
    const result = await api.post('/auth/client/login', { clientName, passphrase });
    setToken(result.token);
    setStoredClientName(result.clientName);
    return result;
}

export function logout() {
    clearToken();
    sessionStorage.removeItem('currentClient');
}
