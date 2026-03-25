import type { Env } from './index';
import { handleAuthRoutes } from './routes/auth';
import { handleClientRoutes } from './routes/clients';
import { handleAdminRoutes } from './routes/admin';
import { handlePayerRoutes } from './routes/payers';

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Health check
  if (path === '/api/v1/health') {
    return json({ status: 'ok' });
  }

  // Auth routes
  if (path.startsWith('/api/v1/auth/')) {
    return handleAuthRoutes(request, env, path, method);
  }

  // Admin routes
  if (path.startsWith('/api/v1/admin/')) {
    return handleAdminRoutes(request, env, path, method);
  }

  // Client routes
  if (path.startsWith('/api/v1/clients/')) {
    return handleClientRoutes(request, env, path, method);
  }

  // Payer reference data
  if (path.startsWith('/api/v1/payers')) {
    return handlePayerRoutes(request, env, path, method);
  }

  return json({ error: 'Not found' }, 404);
}

export function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
