/**
 * Server-side rendering of bodies.
 *
 * **Sanitisation is not optional.** Bodies are authored by humans *and agents* and rendered to
 * other people in the same workspace, so unsanitised HTML is stored XSS against exactly the people
 * the record exists to protect. It is rendered here, server-side, against a strict allow-list —
 * never handed to a browser as raw content to interpret.
 *
 * An agent authoring a body makes this sharper than it would otherwise be: the content is
 * model-generated, the model's input may include untrusted text, and the reader is a reviewer about
 * to make a decision.
 */

import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import type { AttachmentRef, Body } from '../domain/types.js';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

/**
 * The allow-list.
 *
 * Deliberately narrow. `<a>` may not carry `target` or arbitrary protocols; images resolve only to
 * attachment references we minted. Anything not named here is dropped, which is the correct default
 * for content whose author may be a language model.
 */
const ALLOWED: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'blockquote',
    'pre',
    'code',
    'em',
    'strong',
    'del',
    'hr',
    'br',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title'],
    code: ['class'],
    th: ['align'],
    td: ['align'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // No protocol-relative URLs: `//evil.example` inherits the page's scheme and reads as a path.
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
  },
};

export type AttachmentUrlResolver = (id: string) => string | undefined;

export interface RenderedBody {
  format: string;
  html: string;
  /** Attachment ids the body referenced but that this version does not carry. */
  unresolved: string[];
}

/**
 * Render a body to sanitised HTML.
 *
 * `attachment:att-91` references are resolved to short-lived signed URLs at render time. The body
 * never contains a raw storage URL — a URL baked into a record outlives the credential that made it
 * work, and a record full of dead links is a record nobody trusts.
 */
export function renderBody(
  body: Body,
  attachments: AttachmentRef[],
  resolveUrl: AttachmentUrlResolver,
): RenderedBody {
  if (body.format === 'text/v1') {
    return { format: body.format, html: `<pre>${escapeHtml(body.content)}</pre>`, unresolved: [] };
  }

  const known = new Set(attachments.map((a) => a.id));
  const unresolved: string[] = [];

  const withUrls = body.content.replace(/attachment:([A-Za-z0-9_-]+)/g, (match, id: string) => {
    if (!known.has(id)) {
      unresolved.push(id);
      return match;
    }
    return resolveUrl(id) ?? match;
  });

  const html = sanitizeHtml(md.render(withUrls), ALLOWED);
  return { format: body.format, html, unresolved: [...new Set(unresolved)] };
}

/** Plain text, for search snippets and for a format we do not know how to render. */
export function excerpt(body: Body, length = 240): string {
  const plain = body.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length <= length ? plain : `${plain.slice(0, length).trimEnd()}…`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
