import type { Env } from '../index';
import { json, safeJson } from '../router';
import { requireAuth, AuthError } from '../auth';

const MAX_MAPPING_ENTRIES = 5000;
const MAX_STATE_PLAN_NAME_LEN = 256;
const MAX_PAYER_NAME_LEN = 256;
const MAX_PAYER_ID_LEN = 64;

export function validateClientName(name: string): boolean {
  return /^[A-Z0-9 \-_.]{2,64}$/i.test(name);
}

export async function handleClientRoutes(request: Request, env: Env, path: string, method: string): Promise<Response> {
  try {
    // Extract client name from path: /api/v1/clients/:name/mappings
    const match = path.match(/^\/api\/v1\/clients\/([^/]+)\/mappings$/);
    if (!match) {
      return json({ error: 'Not found' }, 404);
    }

    const clientName = decodeURIComponent(match[1]).toUpperCase();

    if (!validateClientName(clientName)) {
      return json({ error: 'Invalid client name' }, 400);
    }

    const payload = await requireAuth(request, env, 'client');

    // Clients can only access their own data (admins can access any)
    // Case-insensitive comparison: payload.sub preserves DB casing, clientName is uppercased
    if (payload.role === 'client' && payload.sub.toUpperCase() !== clientName) {
      return json({ error: 'Access denied' }, 403);
    }

    if (method === 'GET') {
      return getMappings(request, env, clientName, payload.sub);
    }

    if (method === 'PUT') {
      // Finding 9: pass payload.sub as actor
      return putMappings(request, env, clientName, payload.sub);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }
}

async function getMappings(request: Request, env: Env, clientName: string, actor: string): Promise<Response> {
  const client = await env.DB.prepare('SELECT id FROM clients WHERE client_name = ? COLLATE NOCASE').bind(clientName).first<{ id: number }>();
  if (!client) {
    return json({ error: 'Client not found' }, 404);
  }

  const rows = await env.DB.prepare(
    'SELECT state_name, plan_name, availity_payer_id, availity_payer_name FROM payer_mappings WHERE client_id = ?'
  ).bind(client.id).all();

  // Fix 6: include IP in audit log detail
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  await env.DB.prepare('INSERT INTO audit_log (actor, action, client_name, detail) VALUES (?, ?, ?, ?)').bind(actor, 'mappings_read', clientName, JSON.stringify({ ip })).run();

  // Return as { "State|PlanName": { availityPayerId, availityPayerName } }
  const mappings: Record<string, { availityPayerId: string; availityPayerName: string }> = {};
  for (const row of rows.results) {
    const r = row as any;
    const key = r.state_name + '|' + r.plan_name;
    mappings[key] = {
      availityPayerId: r.availity_payer_id || '',
      availityPayerName: r.availity_payer_name || '',
    };
  }

  return json({ mappings });
}

// Finding 9: accept actor parameter so the audit log records the authenticated subject
async function putMappings(request: Request, env: Env, clientName: string, actor: string): Promise<Response> {
  const client = await env.DB.prepare('SELECT id FROM clients WHERE client_name = ? COLLATE NOCASE').bind(clientName).first<{ id: number }>();
  if (!client) {
    return json({ error: 'Client not found' }, 404);
  }

  // Finding 8: safe JSON parse
  const body = await safeJson<{ mappings: Record<string, { availityPayerId?: string; availityPayerName?: string }> }>(request);
  if (body === null) {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.mappings || typeof body.mappings !== 'object') {
    return json({ error: 'Invalid mappings object' }, 400);
  }

  const entries = Object.entries(body.mappings);

  // Validate payload size
  if (entries.length > MAX_MAPPING_ENTRIES) {
    return json({ error: `Too many mapping entries (max ${MAX_MAPPING_ENTRIES})` }, 400);
  }

  // Finding 6: validate all keys upfront — each key must contain '|' with a non-empty part before it
  // Also normalize whitespace: trim state_name, plan_name, and availity_payer_name on every insert
  // so the DB never accumulates dirty data from upstream sources.
  const normalized: { stateName: string; planName: string; payerId: string | null; payerName: string | null }[] = [];
  const seenKeys = new Set<string>();

  for (const [key, val] of entries) {
    const pipeIndex = key.indexOf('|');
    if (pipeIndex === -1 || pipeIndex === 0) {
      return json({ error: `Invalid mapping key "${key}": must be in "StateName|PlanName" format with a non-empty state name before the pipe` }, 400);
    }
    const stateName = key.slice(0, pipeIndex).trim();
    const planName = key.slice(pipeIndex + 1).trim();
    if (stateName.length === 0) {
      return json({ error: `Invalid mapping key "${key}": state_name cannot be empty after trim` }, 400);
    }
    if (planName.length === 0) {
      return json({ error: `Invalid mapping key: plan_name cannot be empty` }, 400);
    }
    if (stateName.length > MAX_STATE_PLAN_NAME_LEN) {
      return json({ error: `state_name exceeds ${MAX_STATE_PLAN_NAME_LEN} characters` }, 400);
    }
    if (planName.length > MAX_STATE_PLAN_NAME_LEN) {
      return json({ error: `plan_name exceeds ${MAX_STATE_PLAN_NAME_LEN} characters` }, 400);
    }
    const payerName = val.availityPayerName ? val.availityPayerName.trim() : null;
    const payerId = val.availityPayerId ? val.availityPayerId.trim() : null;
    if (payerName && payerName.length > MAX_PAYER_NAME_LEN) {
      return json({ error: `availity_payer_name exceeds ${MAX_PAYER_NAME_LEN} characters` }, 400);
    }
    if (payerId && payerId.length > MAX_PAYER_ID_LEN) {
      return json({ error: `availity_payer_id exceeds ${MAX_PAYER_ID_LEN} characters` }, 400);
    }

    // De-dupe: if trimming caused a collision within this payload, last write wins
    const normKey = stateName + '|' + planName;
    if (seenKeys.has(normKey)) {
      // Replace prior occurrence
      const idx = normalized.findIndex(n => n.stateName + '|' + n.planName === normKey);
      if (idx >= 0) normalized[idx] = { stateName, planName, payerId, payerName };
    } else {
      seenKeys.add(normKey);
      normalized.push({ stateName, planName, payerId, payerName });
    }
  }

  // Delete existing mappings for this client
  await env.DB.prepare('DELETE FROM payer_mappings WHERE client_id = ?').bind(client.id).run();

  // Insert new mappings in batches (D1 batch limit is 100 statements)
  const batchSize = 100;
  let insertedCount = 0;

  for (let i = 0; i < normalized.length; i += batchSize) {
    const batch = normalized.slice(i, i + batchSize);
    const statements = batch.map(n => {
      return env.DB.prepare(
        'INSERT INTO payer_mappings (client_id, state_name, plan_name, availity_payer_id, availity_payer_name, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch())'
      ).bind(client.id, n.stateName, n.planName, n.payerId, n.payerName);
    });

    if (statements.length > 0) {
      await env.DB.batch(statements);
      insertedCount += statements.length;
    }
  }

  // Update client last_updated
  await env.DB.prepare('UPDATE clients SET last_updated = unixepoch() WHERE id = ?').bind(client.id).run();

  // Finding 9: use actor (payload.sub) instead of clientName in audit log; Fix 6: include IP
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  await env.DB.prepare('INSERT INTO audit_log (actor, action, client_name, detail) VALUES (?, ?, ?, ?)').bind(actor, 'mappings_updated', clientName, JSON.stringify({ count: insertedCount, ip })).run();

  return json({ ok: true, count: insertedCount });
}
