import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const payersPath = resolve(rootDir, 'worker', 'payers.json');
const payers = JSON.parse(readFileSync(payersPath, 'utf-8'));

// Output SQL for piping to wrangler d1 execute
console.log('-- Seed Availity payer data');
console.log('DELETE FROM availity_payers;');
console.log('BEGIN TRANSACTION;');

Object.entries(payers).forEach(([state, payerList]) => {
    payerList.forEach(p => {
        const stateSafe = state.replace(/'/g, "''");
        const nameSafe = p.payerName.replace(/'/g, "''");
        const idSafe = p.payerId.replace(/'/g, "''");
        console.log(`INSERT INTO availity_payers (state_name, payer_name, payer_id) VALUES ('${stateSafe}', '${nameSafe}', '${idSafe}');`);
    });
});

console.log('COMMIT;');

const totalPayers = Object.values(payers).reduce((sum, arr) => sum + arr.length, 0);
console.error(`Generated ${totalPayers} INSERT statements`);
