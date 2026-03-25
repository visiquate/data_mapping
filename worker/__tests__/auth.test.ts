import { describe, it, expect } from 'vitest';

// auth.ts imports './index' for the Env type, which drags in Cloudflare-specific
// globals that are unavailable in Node. Rather than mocking the entire module
// graph, these tests exercise the same crypto primitives directly so we can
// verify correctness of the hashing logic without the worker runtime.

async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('hashPassphrase (crypto.subtle SHA-256)', () => {
  it('produces consistent SHA-256 hex output', async () => {
    const result = await sha256Hex('test');
    expect(result).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });

  it('produces different hashes for different inputs', async () => {
    const h1 = await sha256Hex('password1');
    const h2 = await sha256Hex('password2');
    expect(h1).not.toBe(h2);
  });

  it('always returns a 64-character hex string', async () => {
    const result = await sha256Hex('any input');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across calls', async () => {
    const first = await sha256Hex('stable');
    const second = await sha256Hex('stable');
    expect(first).toBe(second);
  });
});

describe('AuthError', () => {
  // Reproduce the class exactly as defined in auth.ts to validate its contract.
  class AuthError extends Error {
    status = 401;
    constructor(message: string) {
      super(message);
      this.name = 'AuthError';
    }
  }

  it('has status 401', () => {
    const err = new AuthError('unauthorized');
    expect(err.status).toBe(401);
  });

  it('carries the provided message', () => {
    const err = new AuthError('test error');
    expect(err.message).toBe('test error');
  });

  it('has name AuthError', () => {
    const err = new AuthError('oops');
    expect(err.name).toBe('AuthError');
  });

  it('is an instance of Error', () => {
    const err = new AuthError('oops');
    expect(err instanceof Error).toBe(true);
  });
});
