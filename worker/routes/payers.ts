import type { Env } from '../index';
import { json } from '../router';
import payersData from '../payers.json';

export async function handlePayerRoutes(_request: Request, _env: Env, path: string, method: string): Promise<Response> {
  if (method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // GET /api/v1/payers — return all payer data grouped by state
  if (path === '/api/v1/payers') {
    return json(payersData);
  }

  // GET /api/v1/payers/:state
  const stateMatch = path.match(/^\/api\/v1\/payers\/(.+)$/);
  if (stateMatch) {
    const state = decodeURIComponent(stateMatch[1]);
    const payers = (payersData as Record<string, any[]>)[state];
    if (!payers) {
      return json({ error: 'State not found' }, 404);
    }
    return json(payers);
  }

  return json({ error: 'Not found' }, 404);
}
