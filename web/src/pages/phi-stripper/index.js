import { initDarkMode } from '../../lib/dark-mode.js';
import { processFile, downloadCleanFile } from './processor.js';

// Expose downloadCleanFile to window for onclick handler
window.downloadCleanFile = downloadCleanFile;

document.addEventListener('DOMContentLoaded', () => {
    // Initialize dark mode toggle
    initDarkMode();

    // Set up drag and drop
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            processFile(e.dataTransfer.files[0]);
        }
    });

    dropZone.addEventListener('click', (e) => {
        // Allow clicking the button without triggering file input
        if (e.target.tagName !== 'BUTTON') {
            fileInput.click();
        }
    });

    // Set up file input change handler
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            processFile(e.target.files[0]);
        }
    });
});
