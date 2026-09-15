/**
 * The document — one text that is the artifact, from which the facets are derived.
 *
 * ADR-0004 split every version into facets a machine reads and a body a person reads, and the
 * editor grew into a JSON form beside a textarea. ADR-0017 keeps the split in the *record* — gates
 * still read only facets — and removes it from *authoring*: a person or an agent writes one
 * markdown document, and the facets are a projection of it, taken at save.
 *
 * Two places a facet can live in the document, both declared rather than coded:
 *
 * - **Front-matter.** Every top-level key the service does not reserve, and everything under
 *   `facets:`, is a facet. `title`, `classification`, `links`, `catalogue_refs` and `effective`
 *   are the envelope.
 * - **Typed blocks.** A type may declare `body_blocks`: *the table under the heading "Acceptance
 *   criteria" is the facet `acceptance_criteria`*. The block stays prose to the reader and becomes
 *   an array of objects to the gate, and the same bytes are both. Blocks win over front-matter for
 *   the facet they name.
 *
 * Pure. Storage, provenance and the digest are untouched by this module: a version's document is
 * composed from what is stored, and a draft's facets are replaced by what is parsed.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Body, CatalogueRef, Classification, EffectiveWindow, Facets, Link } from './types.js';
import type { TypeDeclaration } from './workspace-definition.js';

export const RESERVED_KEYS = [
  'type',
  'title',
  'artifact',
  'classification',
  'links',
  'catalogue_refs',
  'effective',
  'facets',
] as const;

const RESERVED = new Set<string>(RESERVED_KEYS);

export interface Envelope {
  title?: string;
  type?: string;
  artifact?: string;
  classification?: Classification;
  links?: Link[];
  catalogue_refs?: CatalogueRef[];
  effective?: EffectiveWindow;
}

export interface ParsedDocument {
  envelope: Envelope;
  facets: Facets;
  body: Body;
  /** Which facets came from a typed block rather than front-matter. */
  from_blocks: string[];
}

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

/** Split `---\n…\n---\n` front-matter from the body. No front-matter is fine: everything is body. */
export function splitFrontMatter(source: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!m) return { meta: {}, body: source };
  let meta: unknown;
  try {
    meta = parseYaml(m[1]!) ?? {};
  } catch (error) {
    throw new DocumentError(`The front-matter is not valid YAML: ${(error as Error).message}`);
  }
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    throw new DocumentError('The front-matter must be a mapping of keys to values.');
  }
  return { meta: meta as Record<string, unknown>, body: m[2] ?? '' };
}

/** Facets are the `facets:` block plus every top-level key the service does not reserve. */
export function facetsFrom(meta: Record<string, unknown>): Facets {
  const facets: Facets = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!RESERVED.has(key)) facets[key] = value;
  }
  if (meta.facets && typeof meta.facets === 'object' && !Array.isArray(meta.facets)) {
    Object.assign(facets, meta.facets as object);
  }
  return facets;
}

/**
 * The table under a heading, as rows keyed by the header cells.
 *
 * `## Acceptance criteria` … `| id | text | priority | verify |` … The first table after the
 * heading and before the next heading of the same or a higher level. Header cells become keys
 * (`Verify by` → `verify_by`); `true`/`false` and bare numbers become what they look like, and
 * everything else stays a string — a schema that wants a number gets one when the author typed one.
 */
export function tableUnder(markdown: string, heading: string): Array<Record<string, unknown>> | undefined {
  const lines = markdown.split(/\r?\n/);
  const wanted = heading.trim().toLowerCase();
  let level = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]!);
    if (h && h[2]!.trim().toLowerCase() === wanted) {
      level = h[1]!.length;
      start = i + 1;
      break;
    }
  }
  if (start < 0) return undefined;

  const section: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const h = /^(#{1,6})\s+/.exec(lines[i]!);
    if (h && h[1]!.length <= level) break;
    section.push(lines[i]!);
  }

  const rows = section.map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (rows.length < 2) return undefined;
  const cells = (row: string) =>
    row
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const header = cells(rows[0]!).map((h) =>
    h
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
  );
  if (!/^\|?\s*:?-+/.test(rows[1]!)) return undefined; // not a table: no separator row
  return rows.slice(2).map((row) => {
    const values = cells(row);
    const record: Record<string, unknown> = {};
    header.forEach((key, i) => {
      if (!key) return;
      record[key] = coerce(values[i] ?? '');
    });
    return record;
  });
}

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Parse a whole document against a type: front-matter, then the type's declared blocks. */
export function parseDocument(
  source: string,
  type: Pick<TypeDeclaration, 'body_blocks' | 'body_format'>,
): ParsedDocument {
  const { meta, body } = splitFrontMatter(source);
  const facets = facetsFrom(meta);
  const fromBlocks: string[] = [];
  for (const block of type.body_blocks) {
    const rows = tableUnder(body, block.heading);
    if (rows) {
      facets[block.facet] = rows;
      fromBlocks.push(block.facet);
    }
  }
  const envelope: Envelope = {};
  if (typeof meta.title === 'string') envelope.title = meta.title;
  if (typeof meta.type === 'string') envelope.type = meta.type;
  if (typeof meta.artifact === 'string') envelope.artifact = meta.artifact;
  if (meta.classification && typeof meta.classification === 'object')
    envelope.classification = meta.classification as Classification;
  if (Array.isArray(meta.links)) envelope.links = meta.links as Link[];
  if (Array.isArray(meta.catalogue_refs)) envelope.catalogue_refs = meta.catalogue_refs as CatalogueRef[];
  if (meta.effective && typeof meta.effective === 'object')
    envelope.effective = meta.effective as EffectiveWindow;
  return { envelope, facets, body: { format: type.body_format, content: body }, from_blocks: fromBlocks };
}

/**
 * The document of a stored draft or version: front-matter composed from the envelope and the
 * facets, then the body. Facets a declared block carries are left out of the front-matter — they
 * are in the body already, and writing them twice is how the two drift.
 */
export function composeDocument(
  input: {
    title: string;
    facets: Facets;
    body: Body;
    classification?: Classification;
    links?: Link[];
    catalogue_refs?: CatalogueRef[];
    effective?: EffectiveWindow;
  },
  type: Pick<TypeDeclaration, 'body_blocks'>,
): string {
  const blockFacets = new Set(type.body_blocks.map((b) => b.facet));
  const facets = Object.fromEntries(Object.entries(input.facets).filter(([k]) => !blockFacets.has(k)));
  const meta: Record<string, unknown> = { title: input.title };
  if (input.classification) meta.classification = input.classification;
  // A link that follows the lineage carries `pinned_to: null` in storage; in the document that is
  // noise. A frozen pin is a fact about the version and stays.
  if (input.links && input.links.length > 0) {
    meta.links = input.links.map(({ pinned_to, ...link }) =>
      pinned_to != null ? { ...link, pinned_to } : link,
    );
  }
  if (input.catalogue_refs && input.catalogue_refs.length > 0) meta.catalogue_refs = input.catalogue_refs;
  if (input.effective) meta.effective = input.effective;
  if (Object.keys(facets).length > 0) meta.facets = facets;
  const front = stringifyYaml(meta, { lineWidth: 0 }).trimEnd();
  return `---\n${front}\n---\n${input.body.content}`;
}
