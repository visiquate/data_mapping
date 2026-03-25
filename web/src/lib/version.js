export function initVersion() {
    const el = document.getElementById('appVersion');
    if (el) el.textContent = 'v6 (' + __COMMIT_HASH__ + ')';
}
