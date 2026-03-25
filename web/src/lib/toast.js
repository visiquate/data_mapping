let toastTimer;

export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 3000);
}
