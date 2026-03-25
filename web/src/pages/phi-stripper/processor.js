import { STATE_MAP } from '../../lib/state-map.js';
import { showToast } from '../../lib/toast.js';
import { readSpreadsheet, XLSX } from '../../lib/xlsx-utils.js';

let cleanedData = [];
let clientFileName = '';

/**
 * Process uploaded file and extract State and Payer1 columns
 * @param {File} file - The uploaded file
 */
export function processFile(file) {
    clientFileName = file.name.replace(/\.[^.]+$/, '');
    const nameEl = document.getElementById('fileName');
    nameEl.textContent = file.name;
    nameEl.classList.remove('hidden');
    document.getElementById('dropZone').classList.add('has-file');

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const rows = readSpreadsheet(new Uint8Array(e.target.result), file.name);
            processData(rows, file.name);
        } catch (err) {
            showToast('Error reading file: ' + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

/**
 * Aggregate rows by unique (State, Payer1) combinations
 * @param {Array} rows - Parsed spreadsheet rows
 * @param {string} filename - Original filename for context
 */
export function processData(rows, filename) {
    if (!rows.length) {
        showToast('File is empty');
        return;
    }

    const columns = Object.keys(rows[0]);
    const stateCol = columns.find((c) => c.toLowerCase() === 'state');
    const payerCol = columns.find(
        (c) => c.toLowerCase() === 'payer1' || c.toLowerCase() === 'payer'
    );

    if (!stateCol || !payerCol) {
        showToast('Could not find State or Payer1 columns. Found: ' + columns.join(', '));
        return;
    }

    // Aggregate rows into unique (State, Payer) combinations with volume counts
    const counts = {};
    let skipped = 0;
    rows.forEach((row) => {
        let state = row[stateCol];
        const payer = row[payerCol];
        if (!state || !payer) {
            skipped++;
            return;
        }
        state = String(state).trim().toUpperCase();
        const fullState = STATE_MAP[state] || state;
        const key = fullState + '|' + payer;
        if (!counts[key]) {
            counts[key] = { State: fullState, Payer1: String(payer).trim(), Volume: 0 };
        }
        counts[key].Volume++;
    });

    // Sort by State, then by Volume (descending)
    cleanedData = Object.values(counts).sort((a, b) => {
        if (a.State !== b.State) return a.State.localeCompare(b.State);
        return b.Volume - a.Volume;
    });

    const removedCols = columns.filter((c) => c !== stateCol && c !== payerCol);
    const states = [...new Set(cleanedData.map((r) => r.State))];

    // Update results section
    document.getElementById('originalRows').textContent = rows.length.toLocaleString();
    document.getElementById('originalCols').textContent = columns.length;
    document.getElementById('removedCols').textContent =
        removedCols.length +
        ' (' +
        removedCols.slice(0, 5).join(', ') +
        (removedCols.length > 5 ? '...' : '') +
        ')';
    document.getElementById('outputRows').textContent = cleanedData.length.toLocaleString();
    document.getElementById('statesFound').textContent = states.length;

    // Show warning if rows were skipped
    const warn = document.getElementById('warningSection');
    if (skipped > 0) {
        warn.textContent = skipped + ' rows skipped (missing State or Payer1 value).';
        warn.style.display = 'block';
    } else {
        warn.style.display = 'none';
    }

    // Preview table (first 10 rows)
    const tbody = document.getElementById('previewBody');
    tbody.innerHTML = '';
    cleanedData.slice(0, 10).forEach((row) => {
        tbody.innerHTML +=
            '<tr><td>' +
            row.State +
            '</td><td>' +
            row.Payer1 +
            '</td><td>' +
            row.Volume.toLocaleString() +
            '</td></tr>';
    });
    if (cleanedData.length > 10) {
        tbody.innerHTML +=
            '<tr><td colspan="3" style="color:var(--text-muted);text-align:center;">... and ' +
            (cleanedData.length - 10) +
            ' more rows</td></tr>';
    }

    document.getElementById('resultsSection').classList.remove('hidden');
}

/**
 * Download cleaned data as Excel file
 */
export function downloadCleanFile() {
    if (!cleanedData.length) return;
    const ws = XLSX.utils.json_to_sheet(cleanedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plans');
    ws['!cols'] = [{ wch: 20 }, { wch: 40 }, { wch: 10 }];
    XLSX.writeFile(wb, clientFileName + '_clean.xlsx');
}
