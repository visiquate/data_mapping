import type { Env } from './index';

interface TokenPayload {
  sub: string;
  role: 'admin' | 'client';
  exp: number;
  iat: number;
}

function base64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64url(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(secret, data);
  return expected === signature;
}

export async function createToken(env: Env, sub: string, role: 'admin' | 'client'): Promise<string> {
  const expirySeconds = role === 'admin'
    ? parseInt(env.ADMIN_TOKEN_EXPIRY_SECONDS || '900')
    : parseInt(env.TOKEN_EXPIRY_SECONDS || '14400');

  const payload: TokenPayload = {
    sub,
    role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expirySeconds,
  };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = await hmacSign(env.SESSION_SECRET, header + '.' + body);

  return header + '.' + body + '.' + signature;
}

export async function verifyToken(env: Env, token: string): Promise<TokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const valid = await hmacVerify(env.SESSION_SECRET, header + '.' + body, signature);
  if (!valid) return null;

  try {
    const payload: TokenPayload = JSON.parse(base64urlDecode(body));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function requireAuth(request: Request, env: Env, requiredRole?: 'admin' | 'client'): Promise<TokenPayload> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing authorization token');
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(env, token);
  if (!payload) {
    throw new AuthError('Invalid or expired token');
  }

  if (requiredRole && payload.role !== requiredRole && payload.role !== 'admin') {
    throw new AuthError('Insufficient permissions');
  }

  return payload;
}

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function hashPassphrase(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
