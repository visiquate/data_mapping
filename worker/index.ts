import { handleRequest } from './router';

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
  TOKEN_EXPIRY_SECONDS: string;
  ADMIN_TOKEN_EXPIRY_SECONDS: string;
}

const ALLOWED_ORIGINS_ALWAYS = [
  'https://payer-mapping.visiquate.com',
  'https://payer-mapping-tool-5ie.pages.dev',
];

const ALLOWED_ORIGINS_DEV = [
  'http://localhost:5173',
];

function getAllowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;

  const allowed = [
    ...ALLOWED_ORIGINS_ALWAYS,
    ...(env.ENVIRONMENT !== 'production' ? ALLOWED_ORIGINS_DEV : []),
  ];

  return allowed.includes(origin) ? origin : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigin = getAllowedOrigin(request, env);

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };

    if (allowedOrigin) {
      corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
    }

    // Fix 7: security headers applied to every response
    const securityHeaders: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    };

    // Fix 8: return 403 for OPTIONS from disallowed origins; otherwise complete the preflight
    if (request.method === 'OPTIONS') {
      if (!allowedOrigin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { ...corsHeaders, ...securityHeaders } });
    }

    try {
      const response = await handleRequest(request, env);
      Object.entries({ ...corsHeaders, ...securityHeaders }).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    } catch (_error: unknown) {
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders, ...securityHeaders },
      });
    }
  },
};
