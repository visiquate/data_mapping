import { describe, it, expect } from 'vitest';
import { detectPHIColumns } from '../lib/phi-detector.js';

describe('detectPHIColumns', () => {
  it('returns empty array for clean files with expected columns', () => {
    const data = [{ State: 'Texas', Payer1: 'Aetna', Volume: 42 }];
    expect(detectPHIColumns(data)).toEqual([]);
  });

  it('detects common PHI column names', () => {
    const data = [{ State: 'TX', Payer1: 'Aetna', FirstName: 'John', LastName: 'Doe', DOB: '1990-01-01' }];
    const result = detectPHIColumns(data);
    expect(result).toContain('FirstName');
    expect(result).toContain('LastName');
    expect(result).toContain('DOB');
  });

  it('detects SSN and MemberID columns', () => {
    const data = [{ State: 'TX', Payer1: 'Aetna', SSN: '123-45-6789', MemberID: 'M001' }];
    const result = detectPHIColumns(data);
    expect(result).toContain('SSN');
    expect(result).toContain('MemberID');
  });

  it('is case-insensitive for column detection', () => {
    const data = [{ State: 'TX', Payer1: 'Aetna', firstname: 'Jane' }];
    const result = detectPHIColumns(data);
    expect(result).toContain('firstname');
  });

  it('handles columns with underscores and dashes', () => {
    const data = [{ State: 'TX', Payer1: 'Aetna', 'first_name': 'Jane', 'date-of-birth': '1990' }];
    const result = detectPHIColumns(data);
    expect(result.length).toBeGreaterThan(0);
  });

  it('flags files with too many columns even without PHI names', () => {
    const data = [{ State: 'TX', Payer1: 'Aetna', Col3: 'x', Col4: 'y', Col5: 'z', Col6: 'w' }];
    const result = detectPHIColumns(data);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain('columns detected');
  });

  it('returns empty for empty data', () => {
    expect(detectPHIColumns([])).toEqual([]);
  });

  it('allows State, Payer, Payer1, Volume columns', () => {
    const data = [{ State: 'TX', Payer: 'Aetna', Volume: 10 }];
    expect(detectPHIColumns(data)).toEqual([]);
  });
});
