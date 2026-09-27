import { describe, expect, it } from 'vitest';
import {
  aboutLabel,
  derivation,
  dueIn,
  markSentences,
  principalLabel,
  pullRequestUrl,
  utc,
} from './work-labels';

const ME = 'prn-h-me';

describe('marks', () => {
  it('says a step reached the reader, and where it stands on the ladder', () => {
    expect(
      markSentences(
        { chased: { step: 'escalate_accountable', n: 3, of: 5, to: ME }, breached: ['respond_by'] },
        ME,
      ),
    ).toEqual(['escalated to you, step 3 of 5', 'breached respond by']);
    expect(markSentences({ chased: { step: 'reminder', n: 1, of: 5, to: ME } }, ME)).toEqual([
      'reminded you, step 1 of 5',
    ]);
  });

  it('names the role when the step reached someone else', () => {
    expect(
      markSentences({ chased: { step: 'escalate_steward', n: 4, of: 5, to: 'prn-h-other' } }, ME),
    ).toEqual(['escalated to the steward, step 4 of 5']);
    expect(markSentences(undefined, ME)).toEqual([]);
  });
});

describe('derived values', () => {
  it('shows the derivation of an item’s clocks', () => {
    expect(
      derivation({ severity: 'sev2', tier: 'tier1', onboarding_level: 'n1', definition_version: 3 }),
    ).toBe('SEV2 × tier1 × N1 · policy v3');
    expect(derivation({ severity: 'sev4', definition_version: 1 })).toBe('SEV4 · policy v1');
  });

  it('reads due times in UTC, and how far away they are', () => {
    expect(utc('2026-09-27T09:05:00Z')).toBe('27 Sep 09:05 UTC');
    const now = Date.parse('2026-09-27T09:00:00Z');
    expect(dueIn('2026-09-27T12:00:00Z', now)).toEqual({ text: 'in 3 h', overdue: false });
    expect(dueIn('2026-09-25T09:00:00Z', now)).toEqual({ text: '2 d overdue', overdue: true });
    expect(dueIn('2026-09-27T09:10:00Z', now)).toEqual({ text: 'in 10 min', overdue: false });
  });
});

describe('words for identifiers', () => {
  it('calls the reader “you” and marks an agent', () => {
    expect(principalLabel(ME, ME)).toEqual({ text: 'you', agent: false });
    expect(principalLabel('prn-a-bump', ME)).toEqual({ text: 'prn-a-bump', agent: true });
    expect(principalLabel(undefined, ME)).toEqual({ text: 'nobody', agent: false });
  });

  it('says what an item is about, and where its pull request is', () => {
    expect(aboutLabel({ application: 'app1', environment: 'prod' })).toBe('app1 · prod');
    expect(aboutLabel({ subject_type: 'standard', subject_id: 's1' })).toBe('standard s1');
    expect(aboutLabel({})).toBe('—');
    expect(pullRequestUrl('fps4/maestro#12')).toBe('https://github.com/fps4/maestro/pull/12');
    expect(pullRequestUrl('not a ref')).toBeNull();
  });
});
