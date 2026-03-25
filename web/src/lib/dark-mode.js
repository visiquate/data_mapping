export function initDarkMode() {
    const toggle = document.getElementById('darkModeToggle');
    if (!toggle) return;

    function updateToggle() {
        const isDark = document.documentElement.classList.contains('dark');
        toggle.textContent = isDark ? '\u2600\uFE0F' : '\uD83C\uDF19';
    }

    updateToggle();

    toggle.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
        const isDark = document.documentElement.classList.contains('dark');
        localStorage.setItem('darkMode', isDark);
        updateToggle();
    });
}
