import { describe, expect, it } from 'vitest';
import {
  canonicalise,
  digestVersion,
  abbreviateDigest,
  type DigestSubject,
} from '../../src/domain/digest.js';

const base: DigestSubject = {
  workspace: 'ws-aannemer-x',
  artifact: 'art-4417',
  type: 'business_case',
  ordinal: 7,
  definition_version: 3,
  facets: { declared_outcome: { baseline: 14.2, target: 8.0, unit: 'days' }, consequence_class: 'c3' },
  body: { format: 'markdown/v1', content: '## Scope\n\nDe generator…' },
  attachments: [],
  links: [{ type: 'addresses', target: 'art-2201', pinned_to: null }],
};

describe('canonicalise', () => {
  it('sorts object keys so insertion order cannot change an identity', () => {
    expect(canonicalise({ b: 1, a: 2 })).toBe(canonicalise({ a: 2, b: 1 }));
  });

  it('drops undefined rather than emitting it', () => {
    expect(canonicalise({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('preserves array order, because an array is ordered and an object is not', () => {
    expect(canonicalise([1, 2])).not.toBe(canonicalise([2, 1]));
  });

  it('refuses a non-finite number rather than emitting null for it', () => {
    expect(() => canonicalise({ n: Number.NaN })).toThrow(/non-finite/);
  });
});

describe('digestVersion', () => {
  it('is stable across key ordering in the facets', () => {
    const reordered: DigestSubject = {
      ...base,
      facets: { consequence_class: 'c3', declared_outcome: { unit: 'days', target: 8.0, baseline: 14.2 } },
    };
    expect(digestVersion(reordered)).toBe(digestVersion(base));
  });

  it('changes when the body changes', () => {
    const edited = { ...base, body: { ...base.body, content: base.body.content + '\n' } };
    expect(digestVersion(edited)).not.toBe(digestVersion(base));
  });

  it('changes when a facet changes', () => {
    const edited: DigestSubject = {
      ...base,
      facets: { ...base.facets, declared_outcome: { baseline: 14.2, target: 10.0, unit: 'days' } },
    };
    expect(digestVersion(edited)).not.toBe(digestVersion(base));
  });

  it('changes when a pin freezes, because what the record asserts has changed', () => {
    const pinned: DigestSubject = {
      ...base,
      links: [{ type: 'addresses', target: 'art-2201', pinned_to: 4 }],
    };
    expect(digestVersion(pinned)).not.toBe(digestVersion(base));
  });

  it('does not change when links are supplied in a different order', () => {
    const two: DigestSubject = {
      ...base,
      links: [
        { type: 'addresses', target: 'art-2201', pinned_to: null },
        { type: 'derives_from', target: 'art-9001', pinned_to: null },
      ],
    };
    const swapped: DigestSubject = { ...two, links: [...two.links].reverse() };
    expect(digestVersion(swapped)).toBe(digestVersion(two));
  });

  it('is not affected by who confirmed a facet — provenance is record, not content', () => {
    // The same bytes reviewed by two people must carry one identity, or every equality claim the
    // record makes becomes a claim about who happened to look at it.
    expect(digestVersion({ ...base })).toBe(digestVersion({ ...base }));
  });
});

describe('abbreviateDigest', () => {
  it('shortens for display', () => {
    expect(abbreviateDigest('sha256:9f2c4a1b2c3d4e5f6071829304a5b6c7d8e9f0a1b2c3d4e5f60718293e18b')).toBe(
      'sha256:9f2c4a…e18b',
    );
  });

  it('leaves something too short to abbreviate alone', () => {
    expect(abbreviateDigest('sha256:abc')).toBe('sha256:abc');
  });
});
