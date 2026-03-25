import type { Env } from '../index';
import { json } from '../router';
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
    if (payload.role === 'client' && payload.sub !== clientName) {
      return json({ error: 'Access denied' }, 403);
    }

    if (method === 'GET') {
      return getMappings(env, clientName, payload.sub);
    }

    if (method === 'PUT') {
      return putMappings(request, env, clientName);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }
}

async function getMappings(env: Env, clientName: string, actor: string): Promise<Response> {
  const client = await env.DB.prepare('SELECT id FROM clients WHERE client_name = ? COLLATE NOCASE').bind(clientName).first<{ id: number }>();
  if (!client) {
    return json({ error: 'Client not found' }, 404);
  }

  const rows = await env.DB.prepare(
    'SELECT state_name, plan_name, availity_payer_id, availity_payer_name FROM payer_mappings WHERE client_id = ?'
  ).bind(client.id).all();

  // Audit log
  await env.DB.prepare('INSERT INTO audit_log (actor, action, client_name) VALUES (?, ?, ?)').bind(actor, 'mappings_read', clientName).run();

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

async function putMappings(request: Request, env: Env, clientName: string): Promise<Response> {
  const client = await env.DB.prepare('SELECT id FROM clients WHERE client_name = ? COLLATE NOCASE').bind(clientName).first<{ id: number }>();
  if (!client) {
    return json({ error: 'Client not found' }, 404);
  }

  const body = await request.json() as { mappings: Record<string, { availityPayerId?: string; availityPayerName?: string }> };
  if (!body.mappings || typeof body.mappings !== 'object') {
    return json({ error: 'Invalid mappings object' }, 400);
  }

  const entries = Object.entries(body.mappings);

  // Validate payload size
  if (entries.length > MAX_MAPPING_ENTRIES) {
    return json({ error: `Too many mapping entries (max ${MAX_MAPPING_ENTRIES})` }, 400);
  }

  for (const [key, val] of entries) {
    const pipeIndex = key.indexOf('|');
    if (pipeIndex === -1) continue;
    const stateName = key.slice(0, pipeIndex);
    const planName = key.slice(pipeIndex + 1);
    if (stateName.length > MAX_STATE_PLAN_NAME_LEN) {
      return json({ error: `state_name exceeds ${MAX_STATE_PLAN_NAME_LEN} characters` }, 400);
    }
    if (planName.length > MAX_STATE_PLAN_NAME_LEN) {
      return json({ error: `plan_name exceeds ${MAX_STATE_PLAN_NAME_LEN} characters` }, 400);
    }
    if (val.availityPayerName && val.availityPayerName.length > MAX_PAYER_NAME_LEN) {
      return json({ error: `availity_payer_name exceeds ${MAX_PAYER_NAME_LEN} characters` }, 400);
    }
    if (val.availityPayerId && val.availityPayerId.length > MAX_PAYER_ID_LEN) {
      return json({ error: `availity_payer_id exceeds ${MAX_PAYER_ID_LEN} characters` }, 400);
    }
  }

  // Delete existing mappings for this client
  await env.DB.prepare('DELETE FROM payer_mappings WHERE client_id = ?').bind(client.id).run();

  // Insert new mappings in batches (D1 batch limit is 100 statements)
  const batchSize = 100;
  let insertedCount = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const statements = batch.filter(([key]) => key.includes('|')).map(([key, val]) => {
      const pipeIndex = key.indexOf('|');
      const stateName = key.slice(0, pipeIndex);
      const planName = key.slice(pipeIndex + 1);
      return env.DB.prepare(
        'INSERT INTO payer_mappings (client_id, state_name, plan_name, availity_payer_id, availity_payer_name, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch())'
      ).bind(client.id, stateName, planName, val.availityPayerId || null, val.availityPayerName || null);
    });

    if (statements.length > 0) {
      await env.DB.batch(statements);
      insertedCount += statements.length;
    }
  }

  // Update client last_updated
  await env.DB.prepare('UPDATE clients SET last_updated = unixepoch() WHERE id = ?').bind(client.id).run();

  // Audit log with actual inserted count
  await env.DB.prepare('INSERT INTO audit_log (actor, action, client_name, detail) VALUES (?, ?, ?, ?)').bind(clientName, 'mappings_updated', clientName, JSON.stringify({ count: insertedCount })).run();

  return json({ ok: true, count: insertedCount });
}
