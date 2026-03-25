import { handleRequest } from './router';

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
  TOKEN_EXPIRY_SECONDS: string;
  ADMIN_TOKEN_EXPIRY_SECONDS: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers for development
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const response = await handleRequest(request, env);
      // Add CORS headers to all responses
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
