import type { Env } from '../index';
import { json, safeJson } from '../router';
import { createToken, verifyPassphrase, hashPassphraseSecure } from '../auth';

// Finding 2: max failed login attempts per IP in the rate-limit window
const RATE_LIMIT_MAX_FAILURES = 10;
const RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutes

export async function handleAuthRoutes(request: Request, env: Env, path: string, method: string): Promise<Response> {
  if (method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  if (path === '/api/v1/auth/admin/login') {
    return adminLogin(request, env);
  }

  if (path === '/api/v1/auth/client/login') {
    return clientLogin(request, env);
  }

  return json({ error: 'Not found' }, 404);
}

// Fix 2: escape LIKE special characters to prevent wildcard injection
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

// Finding 2: check rate limit for an IP; returns true when the caller is blocked
async function isRateLimited(env: Env, ip: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM audit_log
     WHERE actor = 'anonymous' AND action = 'login_failed'
       AND detail LIKE ? ESCAPE '\\' AND event_time > unixepoch() - ${RATE_LIMIT_WINDOW_SECONDS}`
  ).bind(`%"ip":"${escapeLike(ip)}"%`).first<{ cnt: number }>();
  return (row?.cnt ?? 0) >= RATE_LIMIT_MAX_FAILURES;
}

// Finding 2: record a failed login attempt with the originating IP
async function logFailedLogin(env: Env, ip: string, context: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)'
  ).bind('anonymous', 'login_failed', JSON.stringify({ ip, context })).run();
}

async function adminLogin(request: Request, env: Env): Promise<Response> {
  // Finding 2: rate limiting
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (await isRateLimited(env, ip)) {
    return json({ error: 'Too many failed attempts. Please try again later.' }, 429);
  }

  // Finding 8: safe JSON parse
  const body = await safeJson<{ passphrase?: string }>(request);
  if (body === null) {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.passphrase) {
    return json({ error: 'Passphrase required' }, 400);
  }

  const row = await env.DB.prepare('SELECT passphrase_hash FROM admin_config WHERE id = 1').first<{ passphrase_hash: string }>();

  // Fix 3: always run verifyPassphrase to avoid timing oracle when row is null
  const DUMMY_HASH = 'pbkdf2.210000.AAAAAAAAAAAAAAAAAAAAAA==.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const valid = await verifyPassphrase(body.passphrase, row?.passphrase_hash ?? DUMMY_HASH);

  if (!row || !valid) {
    // Finding 2: audit failed login; Fix 9: swallow DB errors so a write failure can't convert 401 to 500
    await logFailedLogin(env, ip, 'admin').catch(() => {});
    return json({ error: 'Invalid credentials' }, 401);
  }

  // Finding 1b: transparently migrate legacy SHA-256 hashes to PBKDF2 on successful login
  if (!row.passphrase_hash.startsWith('pbkdf2.')) {
    const newHash = await hashPassphraseSecure(body.passphrase);
    await env.DB.prepare('UPDATE admin_config SET passphrase_hash = ? WHERE id = 1').bind(newHash).run();
  }

  // Audit log
  await env.DB.prepare('INSERT INTO audit_log (actor, action) VALUES (?, ?)').bind('admin', 'admin_login').run();

  const token = await createToken(env, 'admin', 'admin');
  return json({ token });
}

async function clientLogin(request: Request, env: Env): Promise<Response> {
  // Finding 2: rate limiting
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (await isRateLimited(env, ip)) {
    return json({ error: 'Too many failed attempts. Please try again later.' }, 429);
  }

  // Finding 8: safe JSON parse
  const body = await safeJson<{ clientName?: string; passphrase?: string }>(request);
  if (body === null) {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.clientName || !body.passphrase) {
    return json({ error: 'Client name and passphrase required' }, 400);
  }

  const clientName = body.clientName.trim().toUpperCase();

  const row = await env.DB.prepare(
    'SELECT id, client_name, passphrase_hash FROM clients WHERE client_name = ? COLLATE NOCASE'
  ).bind(clientName).first<{ id: number; client_name: string; passphrase_hash: string }>();

  // Fix 3: always run verifyPassphrase against a dummy hash when row is null to keep timing constant
  const DUMMY_HASH = 'pbkdf2.210000.AAAAAAAAAAAAAAAAAAAAAA==.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const valid = await verifyPassphrase(body.passphrase, row?.passphrase_hash ?? DUMMY_HASH);

  if (!row || !valid) {
    // Finding 2: audit failed login; Fix 9: swallow DB errors so a write failure can't convert 401 to 500
    await logFailedLogin(env, ip, `client:${clientName}`).catch(() => {});
    return json({ error: 'Invalid credentials' }, 401);
  }

  // Finding 1b: transparently migrate legacy SHA-256 hashes to PBKDF2 on successful login
  if (!row.passphrase_hash.startsWith('pbkdf2.')) {
    const newHash = await hashPassphraseSecure(body.passphrase);
    await env.DB.prepare('UPDATE clients SET passphrase_hash = ? WHERE client_name = ?').bind(newHash, row.client_name).run();
  }

  // Audit log
  await env.DB.prepare('INSERT INTO audit_log (actor, action, client_name) VALUES (?, ?, ?)').bind(row.client_name, 'client_login', row.client_name).run();

  const token = await createToken(env, row.client_name, 'client');
  return json({ token, clientName: row.client_name });
}
