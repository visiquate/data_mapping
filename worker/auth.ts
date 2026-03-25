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

function base64urlToBytes(str: string): Uint8Array {
  const binary = base64urlDecode(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importHmacKey(secret: string, usages: string[]): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await importHmacKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return base64url(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await importHmacKey(secret, ['verify']);
  const sigBytes = base64urlToBytes(signature);
  return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
}

export async function createToken(env: Env, sub: string, role: 'admin' | 'client'): Promise<string> {
  const expirySeconds = role === 'admin'
    ? parseInt(env.ADMIN_TOKEN_EXPIRY_SECONDS || '900')
    : parseInt(env.TOKEN_EXPIRY_SECONDS || '14400');

  // Finding 7: validate expiry is a finite positive number
  if (!Number.isFinite(expirySeconds) || expirySeconds <= 0) {
    throw new Error(`Invalid token expiry configuration: ${expirySeconds}`);
  }

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
    // Finding 7: guard against NaN/non-finite exp before comparison
    if (!Number.isFinite(payload.exp)) return null;
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

// Finding 1: legacy SHA-256 hash (kept for transparent migration)
export async function hashPassphraseLegacy(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Finding 1: PBKDF2-based hash — returns "pbkdf2.210000.base64salt.base64hash"
export async function hashPassphraseSecure(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(text),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 210000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  const saltB64 = btoa(String.fromCharCode(...saltBytes));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derivedBits)));
  return `pbkdf2.210000.${saltB64}.${hashB64}`;
}

// Finding 1: auto-detect format and compare; returns true if text matches stored hash
export async function verifyPassphrase(text: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2.')) {
    // Format: pbkdf2.<iterations>.<base64salt>.<base64hash>
    const parts = stored.split('.');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;

    let saltBytes: Uint8Array;
    let expectedHashBytes: Uint8Array;
    try {
      saltBytes = Uint8Array.from(atob(parts[2]), c => c.charCodeAt(0));
      expectedHashBytes = Uint8Array.from(atob(parts[3]), c => c.charCodeAt(0));
    } catch {
      return false;
    }

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(text),
      'PBKDF2',
      false,
      ['deriveBits'],
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    );

    const derivedBytes = new Uint8Array(derivedBits);

    // Constant-time comparison
    if (derivedBytes.length !== expectedHashBytes.length) return false;
    let diff = 0;
    for (let i = 0; i < derivedBytes.length; i++) {
      diff |= derivedBytes[i] ^ expectedHashBytes[i];
    }
    return diff === 0;
  }

  // Legacy: plain SHA-256 hex
  const legacyHash = await hashPassphraseLegacy(text);
  return legacyHash === stored;
}

// Keep the original export name as an alias so any remaining callers don't break at compile time.
// New code should prefer hashPassphraseSecure.
export const hashPassphrase = hashPassphraseLegacy;
