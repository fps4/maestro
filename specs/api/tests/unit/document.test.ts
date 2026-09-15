import { describe, expect, it } from 'vitest';
import { composeDocument, parseDocument, splitFrontMatter, tableUnder } from '../../src/domain/document.js';

const type = {
  body_format: 'markdown/v1' as const,
  body_blocks: [{ facet: 'acceptance_criteria', heading: 'Acceptance criteria', shape: 'table' as const }],
};

const DOC = `---
title: Materiaalstaat generator
classification: { lawful_basis: contract, retention: 7y, personal_data: false }
links: [{ type: justified_by, target: art-case }]
facets:
  class: generative
consequence_class: c2
---
## Scope

When a project is selected, the system shall generate the materiaalstaat.

## Acceptance criteria

| ID   | Text                                                   | Priority | Verify |
|------|--------------------------------------------------------|----------|--------|
| AC-1 | When a project is selected, the system shall generate | must     | test   |
| AC-2 | The staat shall list every item with a quantity        | should   | inspection |

## Out of scope

Pricing.
`;

describe('tableUnder', () => {
  it('reads the first table under the named heading, keyed by snake-cased headers, and stops at the next heading', () => {
    const rows = tableUnder(DOC.split('---\n')[2]!, 'acceptance criteria');
    expect(rows).toEqual([
      {
        id: 'AC-1',
        text: 'When a project is selected, the system shall generate',
        priority: 'must',
        verify: 'test',
      },
      {
        id: 'AC-2',
        text: 'The staat shall list every item with a quantity',
        priority: 'should',
        verify: 'inspection',
      },
    ]);
    expect(tableUnder(DOC, 'Out of scope')).toBeUndefined();
    expect(tableUnder(DOC, 'No such heading')).toBeUndefined();
  });

  it('coerces booleans and numbers and leaves everything else a string', () => {
    const rows = tableUnder('## T\n\n| a | b | c |\n|---|---|---|\n| true | 3.5 | 007x |\n', 'T');
    expect(rows).toEqual([{ a: true, b: 3.5, c: '007x' }]);
  });
});

describe('parseDocument', () => {
  it('derives facets from front-matter and from declared blocks, blocks winning', () => {
    const parsed = parseDocument(DOC, type);
    expect(parsed.envelope.title).toBe('Materiaalstaat generator');
    expect(parsed.envelope.links).toEqual([{ type: 'justified_by', target: 'art-case' }]);
    expect(parsed.envelope.classification?.lawful_basis).toBe('contract');
    expect(Object.keys(parsed.facets).sort()).toEqual(['acceptance_criteria', 'class', 'consequence_class']);
    expect(parsed.from_blocks).toEqual(['acceptance_criteria']);
    expect((parsed.facets.acceptance_criteria as unknown[]).length).toBe(2);
    expect(parsed.body.content).toMatch(/^## Scope/);
    expect(parsed.body.format).toBe('markdown/v1');
  });

  it('lets front-matter carry a block facet when the body has no such table', () => {
    const parsed = parseDocument('---\nacceptance_criteria: [{ id: AC-1 }]\n---\nNo table here.\n', type);
    expect(parsed.facets.acceptance_criteria).toEqual([{ id: 'AC-1' }]);
    expect(parsed.from_blocks).toEqual([]);
  });

  it('refuses front-matter that is not a mapping, in words', () => {
    expect(() => parseDocument('---\n- a list\n---\nbody', type)).toThrow(/must be a mapping/);
    expect(() => parseDocument('---\n: : :\n---\nbody', type)).toThrow(/not valid YAML/);
  });
});

describe('composeDocument', () => {
  it('round-trips: a composed document parses back to the same facets, envelope and body', () => {
    const parsed = parseDocument(DOC, type);
    const composed = composeDocument(
      {
        title: parsed.envelope.title!,
        facets: parsed.facets,
        body: parsed.body,
        classification: parsed.envelope.classification!,
        links: parsed.envelope.links!,
      },
      type,
    );
    // Block facets are not repeated in the front-matter — they are in the body already.
    expect(splitFrontMatter(composed).meta).toEqual({
      title: 'Materiaalstaat generator',
      classification: { lawful_basis: 'contract', retention: '7y', personal_data: false },
      links: [{ type: 'justified_by', target: 'art-case' }],
      facets: { class: 'generative', consequence_class: 'c2' },
    });
    const again = parseDocument(composed, type);
    expect(again.facets).toEqual(parsed.facets);
    expect(again.envelope).toEqual(parsed.envelope);
    expect(again.body).toEqual(parsed.body);
  });
});
