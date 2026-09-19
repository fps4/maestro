import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/domain/canonical.js';

describe('RFC 8785 canonicalisation', () => {
  it('reproduces the RFC test vector (§3.2.3 example)', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\u002f","literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts members by UTF-16 code units, not by locale', () => {
    expect(canonicalize({ b: 1, a: 2, B: 3, é: 4, '€': 5, aa: 6 })).toBe(
      '{"B":3,"a":2,"aa":6,"b":1,"é":4,"€":5}',
    );
  });

  it('omits undefined members and turns undefined array elements into null', () => {
    expect(canonicalize({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
  });

  it('refuses what JSON cannot carry', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(undefined)).toThrow();
    expect(() => canonicalize(10n)).toThrow(/bigint/);
  });

  it('is a fixed point', () => {
    const value = { z: [3, { y: 'x', a: null }], m: 1.5e300, s: 'a\tb' };
    const once = canonicalize(value);
    expect(canonicalize(JSON.parse(once))).toBe(once);
  });
});
