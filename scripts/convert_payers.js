import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const xlsxPath = resolve(rootDir, 'availity_payers.xlsx');
const outputPath = resolve(rootDir, 'worker', 'payers.json');

console.log('Reading', xlsxPath);
const data = readFileSync(xlsxPath);
const wb = XLSX.read(data);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

const payers = {};
rows.forEach(row => {
    const state = row['State'];
    if (!state) return;
    if (!payers[state]) payers[state] = [];
    payers[state].push({
        payerName: row['Payer Name'],
        payerId: String(row['Payer ID'])
    });
});

// Sort payers within each state alphabetically
Object.keys(payers).forEach(state => {
    payers[state].sort((a, b) => a.payerName.localeCompare(b.payerName));
});

const stateCount = Object.keys(payers).length;
const totalPayers = Object.values(payers).reduce((sum, arr) => sum + arr.length, 0);

writeFileSync(outputPath, JSON.stringify(payers, null, 2));
console.log(`Written ${totalPayers} payers across ${stateCount} states to ${outputPath}`);
