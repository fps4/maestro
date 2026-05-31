// PR-diff renderer (US-0033 AC #3): each file rendered with the SHARED react-diff-viewer-continued
// component (via DiffArtefactView) — the same side-by-side view as the spec/design re-draft diff
// (M2 Q6). Shape: docs/architecture/contracts/artifact-content-schemas.md (kind: pr_diff).

import { DiffArtefactView } from '@/components/diff-artefact-view';
import { Badge } from '@/components/ui/badge';

export interface PrDiffFile {
  path: string;
  status?: 'added' | 'modified' | 'deleted';
  old?: string;
  new?: string;
}

export interface PrDiff {
  base?: string;
  head?: string;
  files: PrDiffFile[];
}

export function PrDiffView({ diff }: { diff: PrDiff }) {
  const files = diff.files ?? [];
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">This diff has no files.</p>;
  }
  return (
    <div className="space-y-4">
      {diff.base || diff.head ? (
        <p className="font-mono text-xs text-muted-foreground">
          {diff.base ?? '?'} ← {diff.head ?? '?'}
        </p>
      ) : null}
      {files.map((f) => (
        <div key={f.path} className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{f.status ?? 'modified'}</Badge>
            <span className="font-mono text-xs">{f.path}</span>
          </div>
          <DiffArtefactView
            previousLabel={`old · ${f.path}`}
            currentLabel={`new · ${f.path}`}
            previousContent={f.old ?? ''}
            currentContent={f.new ?? ''}
          />
        </div>
      ))}
    </div>
  );
}
