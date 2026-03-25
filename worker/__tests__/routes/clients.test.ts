import { describe, it, expect } from 'vitest';
import { validateClientName } from '../../routes/clients';

describe('validateClientName', () => {
  it('accepts valid client names', () => {
    expect(validateClientName('UTSW')).toBe(true);
    expect(validateClientName('CRH')).toBe(true);
    expect(validateClientName('St. Luke')).toBe(true);
    expect(validateClientName('UofL')).toBe(true);
    expect(validateClientName('TEST-123')).toBe(true);
    expect(validateClientName('My_Client')).toBe(true);
  });

  it('rejects names that are too short', () => {
    expect(validateClientName('A')).toBe(false);
    expect(validateClientName('')).toBe(false);
  });

  it('rejects names that are too long', () => {
    expect(validateClientName('A'.repeat(65))).toBe(false);
  });

  it('accepts names at boundary lengths', () => {
    expect(validateClientName('AB')).toBe(true);
    expect(validateClientName('A'.repeat(64))).toBe(true);
  });

  it('rejects names with special characters', () => {
    expect(validateClientName('test<script>')).toBe(false);
    expect(validateClientName('test|pipe')).toBe(false);
    expect(validateClientName("test'quote")).toBe(false);
    expect(validateClientName('test;drop')).toBe(false);
  });
});
