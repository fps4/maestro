import { describe, expect, it } from 'vitest';
import {
  acceptanceStatus,
  checkEffectiveWindow,
  forceStatusAt,
  lapseOutcome,
  type AcceptanceRecord,
} from '../../src/domain/effective.js';

describe('forceStatusAt', () => {
  const at = (iso: string) => new Date(iso);

  it('reports undated when the type does not use effective dating', () => {
    expect(forceStatusAt(undefined, at('2026-08-06'))).toBe('undated');
    expect(forceStatusAt({}, at('2026-08-06'))).toBe('undated');
  });

  it('reports pending before the effective date', () => {
    expect(forceStatusAt({ effective_from: '2026-09-01' }, at('2026-08-06'))).toBe('pending');
  });

  it('reports in force between the dates', () => {
    expect(
      forceStatusAt({ effective_from: '2024-01-01', effective_to: '2027-01-01' }, at('2026-08-06')),
    ).toBe('in_force');
  });

  it('reports lapsed on and after the end date', () => {
    expect(
      forceStatusAt({ effective_from: '2024-01-01', effective_to: '2026-08-06' }, at('2026-08-06')),
    ).toBe('lapsed');
  });

  it('treats an open end date as in force', () => {
    expect(forceStatusAt({ effective_from: '2024-01-01', effective_to: null }, at('2026-08-06'))).toBe(
      'in_force',
    );
  });
});

describe('lapseOutcome', () => {
  it('fails a dependent claim by default, because that is the safe reading', () => {
    expect(lapseOutcome(undefined).claim).toBe('fails');
    expect(lapseOutcome('fail').claim).toBe('fails');
  });

  it('treats an unregulated gap as the obligation not applying', () => {
    expect(lapseOutcome('unregulated').claim).toBe('unregulated');
  });

  it('freezes at the last reading where the pack says so', () => {
    expect(lapseOutcome('freeze_at_last').claim).toBe('frozen');
  });
});

describe('acceptanceStatus', () => {
  const acceptance: AcceptanceRecord = {
    standard: 'NL-WKA-VERKLARING-001',
    standard_ordinal: 4,
    pack_version: '3.1.0',
    accepted_by: 'Boekhoudkantoor Y',
    at: '2026-03-03',
    scope: 'tenant',
  };

  it('stands when nothing has been published since', () => {
    expect(acceptanceStatus(acceptance, [{ ordinal: 4 }])).toEqual({ status: 'active' });
  });

  it('stands through an immaterial change — a typo does not need re-acceptance', () => {
    expect(acceptanceStatus(acceptance, [{ ordinal: 5, materiality: 'immaterial' }])).toEqual({
      status: 'active',
    });
  });

  it('lapses on a material change, and names the version that lapsed it', () => {
    expect(acceptanceStatus(acceptance, [{ ordinal: 5, materiality: 'material' }])).toEqual({
      status: 'lapsed',
      lapsed_at_ordinal: 5,
    });
  });

  it('reports the earliest material version, not the latest', () => {
    const status = acceptanceStatus(acceptance, [
      { ordinal: 7, materiality: 'material' },
      { ordinal: 5, materiality: 'material' },
      { ordinal: 6, materiality: 'immaterial' },
    ]);
    expect(status.lapsed_at_ordinal).toBe(5);
  });

  it('ignores versions at or before the one that was accepted', () => {
    expect(acceptanceStatus(acceptance, [{ ordinal: 3, materiality: 'material' }])).toEqual({
      status: 'active',
    });
  });
});

describe('checkEffectiveWindow', () => {
  it('accepts a well-formed window', () => {
    expect(checkEffectiveWindow({ effective_from: '2024-01-01', effective_to: '2027-01-01' })).toEqual([]);
  });

  it('refuses a window nothing could ever be in force during', () => {
    expect(checkEffectiveWindow({ effective_from: '2027-01-01', effective_to: '2024-01-01' })).toContain(
      'effective_to is not after effective_from, so nothing could ever be in force',
    );
  });

  it('refuses an unparseable date', () => {
    expect(checkEffectiveWindow({ effective_from: 'soon' })).toContain('effective_from is not a date');
  });
});
