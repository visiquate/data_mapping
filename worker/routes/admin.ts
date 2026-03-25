import type { Env } from '../index';
import { json } from '../router';
import { requireAuth, AuthError, hashPassphrase } from '../auth';

export async function handleAdminRoutes(request: Request, env: Env, path: string, method: string): Promise<Response> {
  try {
    const payload = await requireAuth(request, env, 'admin');

    // GET /api/v1/admin/clients — list all clients with stats
    if (path === '/api/v1/admin/clients' && method === 'GET') {
      return listClients(env);
    }

    // POST /api/v1/admin/clients — create client
    if (path === '/api/v1/admin/clients' && method === 'POST') {
      return createClient(request, env);
    }

    // DELETE /api/v1/admin/clients/:name
    const deleteMatch = path.match(/^\/api\/v1\/admin\/clients\/([^/]+)$/);
    if (deleteMatch && method === 'DELETE') {
      return deleteClient(env, decodeURIComponent(deleteMatch[1]));
    }

    // PATCH /api/v1/admin/clients/:name/passphrase
    const patchMatch = path.match(/^\/api\/v1\/admin\/clients\/([^/]+)\/passphrase$/);
    if (patchMatch && method === 'PATCH') {
      return resetPassphrase(request, env, decodeURIComponent(patchMatch[1]));
    }

    // GET /api/v1/admin/clients/:name/export/uipath
    const uipathMatch = path.match(/^\/api\/v1\/admin\/clients\/([^/]+)\/export\/uipath$/);
    if (uipathMatch && method === 'GET') {
      return exportUiPath(env, decodeURIComponent(uipathMatch[1]));
    }

    // GET /api/v1/admin/clients/:name/mappings
    const mappingsMatch = path.match(/^\/api\/v1\/admin\/clients\/([^/]+)\/mappings$/);
    if (mappingsMatch && method === 'GET') {
      return getClientMappings(env, decodeURIComponent(mappingsMatch[1]));
    }

    return json({ error: 'Not found' }, 404);
  } catch (error: any) {
    if (error instanceof AuthError) {
      return json({ error: error.message }, error.status);
    }
    throw error;
  }
}

async function listClients(env: Env): Promise<Response> {
  const clients = await env.DB.prepare(`
    SELECT
      c.client_name,
      c.last_updated,
      COUNT(pm.id) AS total,
      SUM(CASE WHEN pm.availity_payer_id IS NOT NULL AND pm.availity_payer_id NOT IN ('not available','UHC','Superior','Cigna','HPN','UMR','OptumCare') THEN 1 ELSE 0 END) AS mapped,
      SUM(CASE WHEN pm.availity_payer_id IN ('not available','UHC','Superior','Cigna','HPN','UMR','OptumCare') THEN 1 ELSE 0 END) AS alt_portal,
      SUM(CASE WHEN pm.availity_payer_id IS NULL THEN 1 ELSE 0 END) AS unmapped
    FROM clients c
    LEFT JOIN payer_mappings pm ON pm.client_id = c.id
    GROUP BY c.id
    ORDER BY c.client_name
  `).all();

  const result = clients.results.map((row: any) => ({
    clientName: row.client_name,
    total: row.total || 0,
    mapped: row.mapped || 0,
    altPortal: row.alt_portal || 0,
    unmapped: row.unmapped || 0,
    lastUpdated: row.last_updated ? new Date(row.last_updated * 1000).toISOString() : null,
  }));

  return json(result);
}

async function createClient(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { clientName?: string; passphrase?: string };
  if (!body.clientName || body.clientName.trim().length < 2) {
    return json({ error: 'Client name must be at least 2 characters' }, 400);
  }
  if (!body.passphrase) {
    return json({ error: 'Passphrase required' }, 400);
  }

  const clientName = body.clientName.trim().toUpperCase();
  const hash = await hashPassphrase(body.passphrase);

  // Check if exists
  const existing = await env.DB.prepare('SELECT id FROM clients WHERE client_name = ? COLLATE NOCASE').bind(clientName).first();
  if (existing) {
    return json({ error: 'Client "' + clientName + '" already exists' }, 409);
  }

  await env.DB.prepare(
    'INSERT INTO clients (client_name, passphrase_hash) VALUES (?, ?)'
  ).bind(clientName, hash).run();

  // Audit log
  await env.DB.prepare('INSERT INTO audit_log (actor, action, client_name) VALUES (?, ?, ?)').bind('admin', 'client_created', clientName).run();

  return json({ clientName }, 201);
}

async function deleteClient(env: Env, clientName: string): Promise<Response> {
  const result = await env.DB.prepare('DELETE FROM clients WHERE client_name = ? COLLATE NOCASE').bind(clientName).run();

  if (!result.meta.changes) {
    return json({ error: 'Client not found' }, 404);
  }

  // Audit log
  await env.DB.prepare('INSERT INTO audit_log (actor, action, client_name) VALUES (?, ?, ?)').bind('admin', 'client_deleted', clientName).run();

  return new Response(null, { status: 204 });
}

async function resetPassphrase(request: Request, env: Env, clientName: string): Promise<Response> {
  const body = await request.json() as { newPassphrase?: string };
  if (!body.newPassphrase) {
    return json({ error: 'New passphrase required' }, 400);
  }

  const hash = await hashPassphrase(body.newPassphrase);
  const result = await env.DB.prepare(
    'UPDATE clients SET passphrase_hash = ?, last_updated = unixepoch() WHERE client_name = ? COLLATE NOCASE'
  ).bind(hash, clientName).run();

  if (!result.meta.changes) {
    return json({ error: 'Client not found' }, 404);
  }

  // Audit log
  await env.DB.prepare('INSERT INTO audit_log (actor, action, client_name) VALUES (?, ?, ?)').bind('admin', 'passphrase_reset', clientName).run();

  return json({ ok: true });
}

async function getClientMappings(env: Env, clientName: string): Promise<Response> {
  const client = await env.DB.prepare('SELECT id FROM clients WHERE client_name = ? COLLATE NOCASE').bind(clientName).first<{ id: number }>();
  if (!client) {
    return json({ error: 'Client not found' }, 404);
  }

  const rows = await env.DB.prepare(
    'SELECT state_name, plan_name, availity_payer_id, availity_payer_name FROM payer_mappings WHERE client_id = ? ORDER BY state_name, plan_name'
  ).bind(client.id).all();

  return json(rows.results.map((r: any) => ({
    state: r.state_name,
    planName: r.plan_name,
    availityPayerId: r.availity_payer_id || '',
    availityPayerName: r.availity_payer_name || '',
  })));
}

const ALT_PORTAL_VALUES = ['not available', 'UHC', 'Superior', 'Cigna', 'HPN', 'UMR', 'OptumCare'];

async function exportUiPath(env: Env, clientName: string): Promise<Response> {
  const client = await env.DB.prepare('SELECT id FROM clients WHERE client_name = ? COLLATE NOCASE').bind(clientName).first<{ id: number }>();
  if (!client) {
    return json({ error: 'Client not found' }, 404);
  }

  const rows = await env.DB.prepare(
    'SELECT state_name, plan_name, availity_payer_id FROM payer_mappings WHERE client_id = ? AND availity_payer_id IS NOT NULL'
  ).bind(client.id).all();

  // State name to abbreviation map
  const STATE_ABBREV: Record<string, string> = {
    'Alabama': 'AL', 'Alaska': 'AK', 'American Samoa': 'AS', 'Arizona': 'AZ',
    'Arkansas': 'AR', 'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT',
    'Delaware': 'DE', 'District of Columbia': 'DC', 'Florida': 'FL', 'Georgia': 'GA',
    'Guam': 'GU', 'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN',
    'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME',
    'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
    'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE',
    'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
    'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
    'Northern Mariana Islands': 'MP', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR',
    'Pennsylvania': 'PA', 'Puerto Rico': 'PR', 'Rhode Island': 'RI',
    'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX',
    'Utah': 'UT', 'Vermont': 'VT', 'Virgin Islands': 'VI', 'Virginia': 'VA',
    'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
  };

  const outputByPayerState: Record<string, any> = {};

  for (const row of rows.results) {
    const r = row as any;
    const payerId = r.availity_payer_id;
    if (ALT_PORTAL_VALUES.includes(payerId)) continue;

    const stateAbbrev = STATE_ABBREV[r.state_name] || r.state_name;
    const pKey = stateAbbrev + '|' + payerId;

    if (!outputByPayerState[pKey]) {
      outputByPayerState[pKey] = {
        LocationCode: stateAbbrev,
        AvailityPayerID: payerId,
        ClaimDataPageLayoutType: 1,
        Queues: [],
      };
    }

    const queueName = r.plan_name.trim() + ', ' + stateAbbrev;
    if (!outputByPayerState[pKey].Queues.includes(queueName)) {
      outputByPayerState[pKey].Queues.push(queueName);
    }
  }

  const output = Object.values(outputByPayerState).sort((a: any, b: any) => {
    if (a.LocationCode !== b.LocationCode) return a.LocationCode.localeCompare(b.LocationCode);
    return a.AvailityPayerID.localeCompare(b.AvailityPayerID);
  });

  return new Response(JSON.stringify(output, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${clientName}_uipath.json"`,
    },
  });
}
