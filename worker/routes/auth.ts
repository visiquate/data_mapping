import type { Env } from '../index';
import { json } from '../router';
import { createToken, hashPassphrase } from '../auth';

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

async function adminLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { passphrase?: string };
  if (!body.passphrase) {
    return json({ error: 'Passphrase required' }, 400);
  }

  const hash = await hashPassphrase(body.passphrase);
  const row = await env.DB.prepare('SELECT passphrase_hash FROM admin_config WHERE id = 1').first<{ passphrase_hash: string }>();

  if (!row || hash !== row.passphrase_hash) {
    return json({ error: 'Invalid credentials' }, 401);
  }

  // Audit log
  await env.DB.prepare('INSERT INTO audit_log (actor, action) VALUES (?, ?)').bind('admin', 'admin_login').run();

  const token = await createToken(env, 'admin', 'admin');
  return json({ token });
}

async function clientLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { clientName?: string; passphrase?: string };
  if (!body.clientName || !body.passphrase) {
    return json({ error: 'Client name and passphrase required' }, 400);
  }

  const clientName = body.clientName.trim().toUpperCase();

  const row = await env.DB.prepare(
    'SELECT id, client_name, passphrase_hash FROM clients WHERE client_name = ? COLLATE NOCASE'
  ).bind(clientName).first<{ id: number; client_name: string; passphrase_hash: string }>();

  // Always hash to prevent timing-based enumeration, even when client is not found
  const hash = await hashPassphrase(body.passphrase);

  if (!row || hash !== row.passphrase_hash) {
    return json({ error: 'Invalid credentials' }, 401);
  }

  // Audit log
  await env.DB.prepare('INSERT INTO audit_log (actor, action, client_name) VALUES (?, ?, ?)').bind(row.client_name, 'client_login', row.client_name).run();

  const token = await createToken(env, row.client_name, 'client');
  return json({ token, clientName: row.client_name });
}
