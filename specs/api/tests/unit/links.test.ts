import { describe, expect, it } from 'vitest';
import {
  PinRefused,
  assertLinksDeclared,
  assertPinsUnchanged,
  freezePins,
  resolveLinks,
} from '../../src/domain/links.js';
import type { TypeDeclaration } from '../../src/domain/workspace-definition.js';
import type { Link } from '../../src/domain/types.js';

const specification: TypeDeclaration = {
  id: 'specification',
  facet_schema: './schemas/specification.json',
  body_format: 'markdown/v1',
  effective_dating: false,
  classification_required: true,
  catalogue_refs: true,
  body_blocks: [],
  links: [
    { id: 'justified_by', to: 'business_case', pinned: true },
    { id: 'addresses', to: 'opportunity', pinned: false },
  ],
};

const links: Link[] = [
  { type: 'justified_by', target: 'art-4417' },
  { type: 'addresses', target: 'art-2201' },
];

describe('freezePins', () => {
  it('freezes the pinned link to the target’s accepted ordinal', () => {
    const frozen = freezePins(links, specification, (a) => (a === 'art-4417' ? 7 : undefined));
    expect(frozen.find((l) => l.type === 'justified_by')!.pinned_to).toBe(7);
  });

  it('leaves an unpinned link following its lineage', () => {
    const frozen = freezePins(links, specification, () => 7);
    expect(frozen.find((l) => l.type === 'addresses')!.pinned_to).toBeUndefined();
  });

  it('refuses acceptance when the pin target has no accepted version', () => {
    expect(() => freezePins(links, specification, () => undefined)).toThrow(PinRefused);
    expect(() => freezePins(links, specification, () => undefined)).toThrow(/nothing to freeze to/);
  });

  it('never re-freezes an already frozen pin', () => {
    const already: Link[] = [{ type: 'justified_by', target: 'art-4417', pinned_to: 4 }];
    expect(freezePins(already, specification, () => 9)[0]!.pinned_to).toBe(4);
  });

  it('is a no-op for a type that declares no pin', () => {
    const opportunity: TypeDeclaration = { ...specification, id: 'opportunity', links: [] };
    expect(freezePins([], opportunity, () => 1)).toEqual([]);
  });
});

describe('assertPinsUnchanged', () => {
  const frozen: Link[] = [{ type: 'justified_by', target: 'art-4417', pinned_to: 7 }];

  it('permits an unchanged pin', () => {
    expect(() => assertPinsUnchanged(frozen, [...frozen])).not.toThrow();
  });

  it('refuses a repointed pin', () => {
    expect(() =>
      assertPinsUnchanged(frozen, [{ type: 'justified_by', target: 'art-4417', pinned_to: 9 }]),
    ).toThrow(/cannot be repointed/);
  });

  it('refuses a removed pin', () => {
    expect(() => assertPinsUnchanged(frozen, [])).toThrow(/cannot be removed/);
  });

  it('ignores links that were never pinned', () => {
    expect(() => assertPinsUnchanged([{ type: 'addresses', target: 'art-2201' }], [])).not.toThrow();
  });
});

describe('assertLinksDeclared', () => {
  it('accepts declared link types', () => {
    expect(() => assertLinksDeclared(links, specification)).not.toThrow();
  });

  it('refuses an undeclared link type and lists what is declared', () => {
    expect(() => assertLinksDeclared([{ type: 'mentions', target: 'art-1' }], specification)).toThrow(
      /declares no link `mentions`.*justified_by, addresses/s,
    );
  });

  it('refuses two instances of the pinned link type', () => {
    expect(() =>
      assertLinksDeclared(
        [
          { type: 'justified_by', target: 'art-1' },
          { type: 'justified_by', target: 'art-2' },
        ],
        specification,
      ),
    ).toThrow(/at most one/);
  });
});

describe('resolveLinks', () => {
  it('reports a frozen pin at its frozen ordinal, whatever the lineage says now', () => {
    const resolved = resolveLinks(
      [{ type: 'justified_by', target: 'art-4417', pinned_to: 7 }],
      specification,
      () => 11,
    );
    expect(resolved[0]).toEqual({
      type: 'justified_by',
      target: 'art-4417',
      pinned: true,
      ordinal: 7,
      resolution: 'frozen',
    });
  });

  it('reports an unpinned link at the latest accepted ordinal', () => {
    const resolved = resolveLinks([{ type: 'addresses', target: 'art-2201' }], specification, () => 3);
    expect(resolved[0]).toMatchObject({ ordinal: 3, resolution: 'follows_lineage', pinned: false });
  });

  it('reports a link whose target has nothing accepted as unresolved rather than guessing', () => {
    const resolved = resolveLinks(
      [{ type: 'addresses', target: 'art-2201' }],
      specification,
      () => undefined,
    );
    expect(resolved[0]).toMatchObject({ resolution: 'unresolved' });
    expect(resolved[0]!.ordinal).toBeUndefined();
  });
});
