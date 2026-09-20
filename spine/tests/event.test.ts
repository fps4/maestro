import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppendRefused, assertEvent, checkEvent, typeKey } from '../src/domain/event.js';
import { event, resolve } from './helpers.js';

describe('the append rules', () => {
  it('accepts a well-formed, attributed event', () => {
    expect(checkEvent(event(1), resolve)).toEqual([]);
  });

  it('rule 1: accountable must resolve to a human — an agent is refused', () => {
    const issues = checkEvent(event(1, { accountable: 'prn-a-remed-2' }), resolve);
    expect(issues).toEqual([
      expect.objectContaining({ field: 'accountable', message: expect.stringMatching(/must be a human/) }),
    ]);
  });

  it('rule 1: an unknown principal is refused', () => {
    const issues = checkEvent(event(1, { accountable: 'prn-h-nobody' }), resolve);
    expect(issues[0]).toMatchObject({ field: 'accountable' });
  });

  it('rule 2: all four attribution fields are present; nothing defaults', () => {
    for (const field of ['accountable', 'acting', 'seat', 'oversight_level'] as const) {
      const { [field]: _dropped, ...rest } = event(1);
      const issues = checkEvent(rest, resolve);
      expect(issues.map((i) => i.field)).toContain(field);
    }
  });

  it('rule 5: an identity provider subject is refused wherever a principal goes', () => {
    for (const field of ['accountable', 'acting'] as const) {
      const issues = checkEvent(event(1, { [field]: '4c1e9f2c-0f1a-4b7d-9c3e-1234567890ab' }), resolve);
      expect(issues.map((i) => i.field)).toContain(field);
      expect(issues.find((i) => i.field === field)?.message).toMatch(/maestro principal id/);
    }
  });

  it('rule 4: the body carries no free text', () => {
    const issues = checkEvent(
      event(1, { body: { outcome: 'done', note: 'Jan restarted the pipeline' } }),
      resolve,
    );
    expect(issues).toEqual([
      expect.objectContaining({ field: 'body.note', message: expect.stringMatching(/never free text/) }),
    ]);
  });

  it('rule 4: tokens the body may carry — identifiers, digests, timestamps, references', () => {
    const body = {
      outcome: 'done',
      digest: 'sha256:9f2c0000000000000000000000000000000000000000000000000000000000ab',
      at: '2026-09-18T09:14:22Z',
      version: 'spec://cause_analysis/ca-118@2',
      pr: 'https://github.com/tenant1/app1/pull/412',
      count: 3,
      reversible: true,
      parent: null,
      evidence: ['merged_change', 'deploy_event'],
    };
    expect(checkEvent(event(1, { body }), resolve)).toEqual([]);
  });

  it('rule 4: a type may narrow the body with its own schema, never widen it', () => {
    const types = new Map([
      [
        typeKey('WorkItemRaised', 1),
        z.object({ class: z.enum(['remediation']), severity: z.string() }).strict(),
      ],
    ]);
    expect(checkEvent(event(1), resolve, types)).toEqual([]);
    const issues = checkEvent(event(1, { body: { class: 'support', severity: 'sev2' } }), resolve, types);
    expect(issues[0]).toMatchObject({ field: 'body.class' });
  });

  it('a payload lives on S3 or under a file root, never anywhere else', () => {
    const digest = { payload_digest: `sha256:${'a'.repeat(64)}` };
    expect(
      checkEvent(event(1, { payload_ref: 's3://tenant-archive/version/art-1@1.json', ...digest }), resolve),
    ).toEqual([]);
    expect(
      checkEvent(
        event(1, { payload_ref: 'file:///srv/payloads/ws-x/version/art-1@1.json', ...digest }),
        resolve,
      ),
    ).toEqual([]);
    expect(
      checkEvent(event(1, { payload_ref: 'https://example.invalid/x', ...digest }), resolve).map(
        (i) => i.field,
      ),
    ).toContain('payload_ref');
  });

  it('payload_ref and payload_digest come together', () => {
    const issues = checkEvent(event(1, { payload_ref: 's3://tenant-archive/work-item/wrk-8841@7' }), resolve);
    expect(issues.map((i) => i.field)).toContain('payload_digest');
  });

  it('assertEvent throws AppendRefused naming every issue and the seq', () => {
    expect(() =>
      assertEvent(event(7, { accountable: 'prn-a-remed-2', body: { x: 'a b' } }), resolve),
    ).toThrow(AppendRefused);
    try {
      assertEvent(event(7, { accountable: 'prn-a-remed-2', body: { x: 'a b' } }), resolve);
    } catch (error) {
      const refused = error as AppendRefused;
      expect(refused.seq).toBe(7);
      expect(refused.issues.map((i) => i.field)).toEqual(['accountable', 'body.x']);
    }
  });
});
