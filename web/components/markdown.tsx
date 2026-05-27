'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Render repo markdown in-app, one-way (ADR-0018 §5). GFM for tables/task-lists; Mermaid and ADR
// cross-link resolution are deferred (contract "Known limitations"). Styled via Tailwind `prose`.
export function Markdown({ children }: { children: string }) {
  return (
    <article className="prose prose-sm prose-neutral max-w-none dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </article>
  );
}
