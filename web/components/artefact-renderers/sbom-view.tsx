'use client';

// SBOM renderer (US-0033 AC #4): a searchable per-package table of name / version / license / type
// from a CycloneDX document. Shape: docs/architecture/contracts/artifact-content-schemas.md
// (kind: sbom, content_type application/vnd.cyclonedx+json).

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';

interface CycloneLicense {
  license?: { id?: string; name?: string };
  expression?: string;
}

export interface SbomComponent {
  type?: string;
  name?: string;
  version?: string;
  purl?: string;
  licenses?: CycloneLicense[];
}

export function licenseLabel(licenses: CycloneLicense[] | undefined): string {
  if (!licenses || licenses.length === 0) return '—';
  const parts = licenses
    .map((l) => l.license?.id ?? l.license?.name ?? l.expression)
    .filter((x): x is string => !!x);
  return parts.length ? Array.from(new Set(parts)).join(', ') : '—';
}

export function SbomView({ components }: { components: SbomComponent[] }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const enriched = components.map((c) => ({ c, license: licenseLabel(c.licenses) }));
    if (!needle) return enriched;
    return enriched.filter(({ c, license }) =>
      [c.name, c.version, c.purl, license, c.type]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle)),
    );
  }, [components, q]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Input
          type="search"
          placeholder="Filter packages…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter packages"
          className="max-w-xs"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {rows.length} of {components.length} package{components.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Package</th>
              <th className="px-3 py-2 font-medium">Version</th>
              <th className="px-3 py-2 font-medium">License</th>
              <th className="px-3 py-2 font-medium">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                  No packages match “{q}”.
                </td>
              </tr>
            ) : (
              rows.map(({ c, license }, i) => (
                <tr key={c.purl ?? `${c.name}@${c.version}#${i}`}>
                  <td className="px-3 py-2 font-medium">
                    {c.name ?? '—'}
                    {c.purl ? (
                      <span className="block font-mono text-xs text-muted-foreground">{c.purl}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{c.version ?? '—'}</td>
                  <td className="px-3 py-2">{license}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c.type ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
