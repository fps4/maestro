/**
 * The payload store (ADR-0020 §1): bytes go in under a key, a locator and a digest come out, the
 * same bytes come back for the locator, and nothing outside the store is ever read through it.
 */

import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalize, sha256, typeKey } from '@fps4/maestro-spine';
import { describe, expect, it } from 'vitest';
import {
  FsPayloadStore,
  PayloadMismatch,
  PayloadRefused,
  encodePayload,
  payloadKey,
  readPayload,
  versionPayloadKey,
  writePayload,
} from '../../src/record/payload-store.js';
import { RECORD_TYPES } from '../../src/db/record-types.js';

const fresh = () => new FsPayloadStore(mkdtempSync(join(tmpdir(), 'specs-payloads-unit-')));

describe('the key layout', () => {
  it('is <workspace>/<subject_type>/<subject_id>/<what>, the workspace in the spine’s form', () => {
    expect(payloadKey('aannemer-x', 'version', 'art-abc@3', 'version.json')).toBe(
      'ws-aannemer-x/version/art-abc@3/version.json',
    );
    expect(payloadKey('ws-minted', 'version', 'art-abc@3', 'decision/dec-1.json')).toBe(
      'ws-minted/version/art-abc@3/decision/dec-1.json',
    );
    expect(versionPayloadKey('aannemer-x', { artifact: 'art-abc', ordinal: 3 }, 'withdrawal.json')).toBe(
      'ws-aannemer-x/version/art-abc@3/withdrawal.json',
    );
  });
});

describe('encoding', () => {
  it('is the canonical JSON of the value, and the digest is the spine’s over those bytes', () => {
    const { bytes, digest } = encodePayload({ b: 1, a: 'x', c: undefined });
    expect(Buffer.from(bytes).toString('utf8')).toBe('{"a":"x","b":1}');
    expect(digest).toBe(sha256(canonicalize({ a: 'x', b: 1 })));
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('the filesystem store', () => {
  it('puts under the root and answers a file:/// ref with the digest of the bytes', async () => {
    const store = fresh();
    const ref = await writePayload(store, 'ws-x/version/art-a@1/version.json', { title: 'T', n: 1 });
    expect(ref.ref).toBe(`file://${store.root}/ws-x/version/art-a@1/version.json`);
    expect(ref.ref).toMatch(/^file:\/\/\/.+/);
    expect(ref.digest).toBe(encodePayload({ n: 1, title: 'T' }).digest);
    expect(existsSync(join(store.root, 'ws-x/version/art-a@1/version.json'))).toBe(true);
    // No temp file left behind: the write is a rename into place.
    expect(readdirSync(join(store.root, 'ws-x/version/art-a@1'))).toEqual(['version.json']);
  });

  it('round-trips through get, and readPayload checks the digest before parsing', async () => {
    const store = fresh();
    const value = { text: 'Which unit is the target expressed in?' };
    const ref = await writePayload(store, 'ws-x/version/art-a@1/question/qst-1.json', value);
    expect(Buffer.from(await store.get(ref.ref)).toString('utf8')).toBe(canonicalize(value));
    expect(await readPayload(store, ref)).toEqual(value);
    await expect(
      readPayload(store, { ref: ref.ref, digest: `sha256:${'0'.repeat(64)}` }),
    ).rejects.toBeInstanceOf(PayloadMismatch);
  });

  it('overwrites the same key with the same bytes — a retried transaction’s orphan is harmless', async () => {
    const store = fresh();
    const first = await writePayload(store, 'ws-x/version/art-a@1/version.json', { a: 1 });
    const again = await writePayload(store, 'ws-x/version/art-a@1/version.json', { a: 1 });
    expect(again).toEqual(first);
  });

  it('erases, and erasing twice is not an error', async () => {
    const store = fresh();
    const ref = await writePayload(store, 'ws-x/version/art-a@1/version.json', { a: 1 });
    await store.erase(ref.ref);
    await expect(store.get(ref.ref)).rejects.toThrow();
    await store.erase(ref.ref);
  });

  it('refuses a ref outside its root: a locator is not a licence to read', async () => {
    const store = fresh();
    await expect(store.get('file:///etc/hosts')).rejects.toBeInstanceOf(PayloadRefused);
    await expect(store.get(`file://${store.root}/../elsewhere.json`)).rejects.toBeInstanceOf(PayloadRefused);
    await expect(store.get('s3://bucket/key')).rejects.toBeInstanceOf(PayloadRefused);
    await expect(store.put('../escape.json', new Uint8Array())).rejects.toBeInstanceOf(PayloadRefused);
  });
});

describe('EvaluationRecorded', () => {
  const schema = RECORD_TYPES.get(typeKey('EvaluationRecorded', 1))!;
  const digest = `sha256:${'a'.repeat(64)}`;

  it('is declared, strict, and carries the evaluator, the verdict, the subject digest and a count', () => {
    expect(schema).toBeDefined();
    expect(
      schema.safeParse({ evaluator: 'sufficiency', verdict: 'pass', subject_digest: digest, findings: 5 })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ evaluator: 'sufficiency', verdict: 'maybe', subject_digest: digest, findings: 0 })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ evaluator: 'sufficiency', verdict: 'pass', subject_digest: digest }).success,
    ).toBe(false);
    // The findings themselves are the payload; a sentence in the body is refused by shape.
    expect(
      schema.safeParse({
        evaluator: 'sufficiency',
        verdict: 'pass',
        subject_digest: digest,
        findings: [{ outcome: 'met', detail: 'Declared outcome is present.' }],
      }).success,
    ).toBe(false);
  });
});
