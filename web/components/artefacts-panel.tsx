// The per-task **artefacts index** (US-0033, S4): the artefacts the loop produced whose bytes live
// in the ArtifactStore — PR diff, test report, SBOM, etc. Pure render: the task page passes
// `task.stored_artefacts`; each "View" link points at the workspace's artefact route
// (`/products/{p}/artifacts/{key}`), which forwards the caller's identity server-side and 302s to a
// freshly-minted, short-TTL presigned URL. The browser never holds the API URL or a long-lived link
// (ADR-0015 / US-0033 AC #2). Rendering of a clicked artefact (diff / test report / SBOM) is a
// follow-up slice; this is the index + the view affordance.

import { Badge } from '@/components/ui/badge';
import type { StoredArtefact } from '@/lib/types';

const KIND_LABEL: Record<string, string> = {
  pr_diff: 'PR diff',
  test_report: 'Test report',
  sbom: 'SBOM',
  diff_snapshot: 'Diff snapshot',
  functional_spec: 'Functional spec',
  technical_design: 'Technical design',
};

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function sourceLabel(source: StoredArtefact['source']): string | null {
  if (!source) return null;
  const event = typeof source.event === 'string' ? source.event : undefined;
  const agent = typeof source.agent === 'string' ? source.agent : undefined;
  return event ?? agent ?? null;
}

function artefactHref(productId: string, key: string): string {
  // The workspace route (not the raw API): it forwards identity and 302s to the presigned URL.
  const segments = key.split('/').map(encodeURIComponent).join('/');
  return `/products/${encodeURIComponent(productId)}/artifacts/${segments}`;
}

export function ArtefactsPanel({
  productId,
  artefacts,
}: {
  productId: string;
  artefacts: StoredArtefact[];
}) {
  if (artefacts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No artefacts yet. The PR diff, test report and SBOM appear here once the build stage produces
        them — resolved through the artefact store on demand (ADR-0012).
      </p>
    );
  }

  return (
    <ul className="space-y-3" aria-label="Task artefacts">
      {artefacts.map((a) => {
        const source = sourceLabel(a.source);
        return (
          <li
            key={`${a.seq}-${a.key}`}
            className="flex items-start justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                <span className="truncate font-medium" title={a.name}>
                  {a.name}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatBytes(a.size)}
                {source ? <> · from {source}</> : null}
              </p>
            </div>
            <a
              href={artefactHref(productId, a.key)}
              className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
              rel="noopener"
            >
              View
            </a>
          </li>
        );
      })}
    </ul>
  );
}
