import { describe, it, expect } from 'vitest';
import { STATE_MAP, STATE_ABBREV, ALT_PORTAL_VALUES, PAGE_SCHEMA_DATA } from '../lib/state-map.js';

describe('STATE_MAP', () => {
  it('maps abbreviations to full state names', () => {
    expect(STATE_MAP['TX']).toBe('Texas');
    expect(STATE_MAP['CA']).toBe('California');
    expect(STATE_MAP['NY']).toBe('New York');
  });

  it('includes all 50 states plus territories', () => {
    expect(Object.keys(STATE_MAP).length).toBeGreaterThanOrEqual(50);
  });

  it('includes DC', () => {
    expect(STATE_MAP['DC']).toBe('District of Columbia');
  });
});

describe('STATE_ABBREV', () => {
  it('is the inverse of STATE_MAP', () => {
    expect(STATE_ABBREV['Texas']).toBe('TX');
    expect(STATE_ABBREV['California']).toBe('CA');
  });

  it('has same number of entries as STATE_MAP', () => {
    expect(Object.keys(STATE_ABBREV).length).toBe(Object.keys(STATE_MAP).length);
  });
});

describe('ALT_PORTAL_VALUES', () => {
  it('contains expected portal identifiers', () => {
    expect(ALT_PORTAL_VALUES).toContain('UHC');
    expect(ALT_PORTAL_VALUES).toContain('not available');
    expect(ALT_PORTAL_VALUES).toContain('Cigna');
    expect(ALT_PORTAL_VALUES).toContain('Superior');
  });

  it('does not contain standard Availity payer IDs', () => {
    expect(ALT_PORTAL_VALUES).not.toContain('AETNA');
    expect(ALT_PORTAL_VALUES).not.toContain('BCBSTX');
  });
});

describe('PAGE_SCHEMA_DATA', () => {
  it('maps payer IDs to page layout integers', () => {
    expect(PAGE_SCHEMA_DATA['AETNA']).toBe(2);
    expect(PAGE_SCHEMA_DATA['BCBSTX']).toBe(6);
    expect(PAGE_SCHEMA_DATA['HUMANA']).toBe(9);
  });

  it('has numeric values', () => {
    Object.values(PAGE_SCHEMA_DATA).forEach(v => {
      expect(typeof v).toBe('number');
    });
  });
});
