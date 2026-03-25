/**
 * migrate_firebase.js
 *
 * Reads all data from Firebase Firestore via the REST API and emits SQL
 * suitable for insertion into the Cloudflare D1 payer-mapping-db database.
 *
 * Usage:
 *   node scripts/migrate_firebase.js > /tmp/firebase_migration.sql
 *
 * Requires Node.js 18+ (uses built-in fetch).
 */

const FIREBASE_API_KEY = 'AIzaSyAYg8MItMR6l5Yw3Gt_gPIzZyBE6H0HlAM';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/payer-mapping-tool/databases/(default)/documents';

/**
 * Escape a string value for safe embedding in a SQL single-quoted literal.
 * @param {string} value
 * @returns {string}
 */
function sqlEscape(value) {
    if (value == null) return 'NULL';
    return String(value).replace(/'/g, "''");
}

/**
 * Convert an ISO 8601 timestamp string to a Unix epoch integer (seconds).
 * Returns the current time as a fallback if the value is missing or invalid.
 * @param {string|undefined} isoString
 * @returns {number}
 */
function toUnixEpoch(isoString) {
    if (!isoString) return Math.floor(Date.now() / 1000);
    const ms = Date.parse(isoString);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

/**
 * Fetch a URL with basic error handling; throws on non-OK responses.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status} fetching ${url}: ${text}`);
    }
    return response.json();
}

/**
 * Fetch all client documents, following nextPageToken pagination.
 * @returns {Promise<Array<{id: string, fields: object}>>}
 */
async function fetchAllClients() {
    const docs = [];
    let pageToken = null;

    do {
        const url = new URL(`${FIRESTORE_BASE}/clients`);
        url.searchParams.set('key', FIREBASE_API_KEY);
        url.searchParams.set('pageSize', '100');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const data = await fetchJson(url.toString());

        if (Array.isArray(data.documents)) {
            for (const doc of data.documents) {
                // Extract the document ID from the full resource name
                const id = doc.name.split('/').pop();
                docs.push({ id, fields: doc.fields || {} });
            }
        }

        pageToken = data.nextPageToken || null;
    } while (pageToken);

    return docs;
}

/**
 * Fetch the admin config document.
 * @returns {Promise<object>} fields map
 */
async function fetchAdminConfig() {
    const url = `${FIRESTORE_BASE}/config/admin?key=${FIREBASE_API_KEY}`;
    const data = await fetchJson(url);
    return data.fields || {};
}

/**
 * Extract a string value from a Firestore field value object.
 * @param {object|undefined} fieldValue
 * @returns {string}
 */
function getString(fieldValue) {
    if (!fieldValue) return '';
    return fieldValue.stringValue ?? '';
}

/**
 * Extract a timestamp string from a Firestore field value object.
 * @param {object|undefined} fieldValue
 * @returns {string|undefined}
 */
function getTimestamp(fieldValue) {
    if (!fieldValue) return undefined;
    return fieldValue.timestampValue ?? undefined;
}

/**
 * Main entry point.
 */
async function main() {
    const lines = [];
    let clientCount = 0;
    let totalMappings = 0;

    // --- Admin config ---
    const adminFields = await fetchAdminConfig();
    const adminHash = getString(adminFields.passphraseHash);
    const adminUpdatedAt = Math.floor(Date.now() / 1000);

    lines.push('-- Admin config SKIPPED — set admin passphrase manually to avoid overwriting production credentials');
    lines.push(`-- Firebase admin hash was: ${sqlEscape(adminHash)}`);
    lines.push('');

    // --- Clients and their mappings ---
    const clients = await fetchAllClients();

    lines.push('-- Clients');

    // We need deterministic client IDs for the foreign key in payer_mappings.
    // Because we use INSERT OR REPLACE with AUTOINCREMENT we cannot predict the
    // generated id.  Instead we use a two-pass approach: assign a stable
    // client_id by selecting on client_name via a subquery in the mapping
    // inserts, and let SQLite manage the autoincrement.  We drive the client
    // inserts first so the rows definitely exist when the mappings reference them.

    const mappingLines = [];
    mappingLines.push('-- Payer mappings');

    for (const { id: docId, fields } of clients) {
        clientCount++;

        const clientName = getString(fields.clientName) || docId;
        const passphraseHash = getString(fields.passphraseHash);
        const createdAt = toUnixEpoch(getTimestamp(fields.createdAt));
        const lastUpdated = toUnixEpoch(getTimestamp(fields.lastUpdated));

        lines.push(
            `INSERT OR REPLACE INTO clients (client_name, passphrase_hash, created_at, last_updated) ` +
            `VALUES ('${sqlEscape(clientName)}', '${sqlEscape(passphraseHash)}', ${createdAt}, ${lastUpdated});`
        );

        // Parse mappings map
        const mappingsMap = fields.mappings?.mapValue?.fields ?? {};

        for (const [key, valueObj] of Object.entries(mappingsMap)) {
            // Split on the FIRST '|' only — plan names may themselves contain '|'
            const pipeIndex = key.indexOf('|');
            if (pipeIndex === -1) {
                // Malformed key; skip
                process.stderr.write(`WARNING: skipping malformed mapping key "${key}" for client "${clientName}"\n`);
                continue;
            }

            const stateName = key.slice(0, pipeIndex);
            const planName = key.slice(pipeIndex + 1);

            const mappingFields = valueObj?.mapValue?.fields ?? {};
            const availityPayerId = getString(mappingFields.availityPayerId);
            const availityPayerName = getString(mappingFields.availityPayerName);
            const updatedAt = Math.floor(Date.now() / 1000);

            // Use a subquery to look up the client_id by client_name so we
            // don't need to hard-code autoincrement IDs.
            mappingLines.push(
                `INSERT OR REPLACE INTO payer_mappings (client_id, state_name, plan_name, availity_payer_id, availity_payer_name, updated_at) ` +
                `VALUES (` +
                `(SELECT id FROM clients WHERE client_name = '${sqlEscape(clientName)}' COLLATE NOCASE LIMIT 1), ` +
                `'${sqlEscape(stateName)}', ` +
                `'${sqlEscape(planName)}', ` +
                `'${sqlEscape(availityPayerId)}', ` +
                `'${sqlEscape(availityPayerName)}', ` +
                `${updatedAt}` +
                `);`
            );

            totalMappings++;
        }
    }

    lines.push('');
    lines.push(...mappingLines);

    // Emit all SQL to stdout
    process.stdout.write(lines.join('\n') + '\n');

    // Summary to stderr so it doesn't pollute the SQL file
    process.stderr.write('\n--- Migration summary ---\n');
    process.stderr.write(`Clients:        ${clientCount}\n`);
    process.stderr.write(`Total mappings: ${totalMappings}\n`);
    process.stderr.write('SQL written to stdout.\n');
}

main().catch(err => {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(1);
});
