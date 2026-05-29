'use client';

// Side-by-side line diff between two artefact revisions for the same (kind, path) on a task —
// the literal diff-of-artefact view (workspace-ux-design.md §refinement-loop step 4). Used after
// a request_changes cycle: the architect sees what changed from the last review to the redrafted
// artefact, alongside the agent's per-anchor reply notes.
//
// Each ref's content is fetched through the read API (no GitHub token in the browser; the
// ADR-0015 invariant is preserved). The previous ref's content comes via ?commit= (#44 extends
// the read API).

import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

export function DiffArtefactView({
  previousLabel,
  currentLabel,
  previousContent,
  currentContent,
}: {
  previousLabel: string;
  currentLabel: string;
  previousContent: string;
  currentContent: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border text-xs">
      <ReactDiffViewer
        oldValue={previousContent}
        newValue={currentContent}
        splitView
        useDarkTheme={false}
        compareMethod={DiffMethod.LINES}
        leftTitle={previousLabel}
        rightTitle={currentLabel}
        styles={{
          variables: {
            light: {
              codeFoldGutterBackground: 'hsl(var(--muted))',
              codeFoldBackground: 'hsl(var(--muted))',
            },
          },
          contentText: { fontFamily: 'var(--font-mono, ui-monospace)' },
        }}
      />
    </div>
  );
}
