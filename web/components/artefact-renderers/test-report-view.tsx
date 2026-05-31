'use client';

// Test-report renderer (US-0033 AC #4): summary + pass/fail per scenario, fail-first, with the
// failing-scenario detail expandable. Shape: docs/architecture/contracts/artifact-content-schemas.md
// (kind: test_report).

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';

export interface TestScenario {
  id: string;
  name?: string;
  criterion?: string | null;
  status: 'passed' | 'failed' | 'skipped';
  duration_ms?: number | null;
  message?: string | null;
  detail?: string | null;
}

export interface TestReport {
  tool?: string;
  summary?: { total?: number; passed?: number; failed?: number; skipped?: number; duration_ms?: number };
  scenarios: TestScenario[];
}

const STATUS_ORDER: Record<TestScenario['status'], number> = { failed: 0, skipped: 1, passed: 2 };
const STATUS_VARIANT: Record<TestScenario['status'], 'default' | 'secondary' | 'destructive'> = {
  failed: 'destructive',
  skipped: 'secondary',
  passed: 'default',
};

export function TestReportView({ report }: { report: TestReport }) {
  const scenarios = [...(report.scenarios ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
  const s = report.summary ?? {};
  const failed = s.failed ?? scenarios.filter((x) => x.status === 'failed').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={failed > 0 ? 'destructive' : 'default'}>
          {failed > 0 ? `${failed} failed` : 'all passed'}
        </Badge>
        <span className="text-muted-foreground">
          {s.passed ?? scenarios.filter((x) => x.status === 'passed').length} passed
          {(s.skipped ?? 0) > 0 ? ` · ${s.skipped} skipped` : null}
          {s.total != null ? ` · ${s.total} total` : null}
          {report.tool ? ` · ${report.tool}` : null}
        </span>
      </div>

      <ul className="divide-y rounded-md border" aria-label="Test scenarios">
        {scenarios.map((sc) => (
          <ScenarioRow key={sc.id} scenario={sc} />
        ))}
      </ul>
    </div>
  );
}

function ScenarioRow({ scenario }: { scenario: TestScenario }) {
  const [open, setOpen] = useState(false);
  const hasDetail = scenario.status === 'failed' && !!scenario.detail;
  return (
    <li className="p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[scenario.status]}>{scenario.status}</Badge>
            {scenario.criterion ? (
              <span className="font-mono text-xs text-muted-foreground">{scenario.criterion}</span>
            ) : null}
          </div>
          <p className="mt-1 break-words font-medium">{scenario.name ?? scenario.id}</p>
          <p className="font-mono text-xs text-muted-foreground">{scenario.id}</p>
          {scenario.message ? (
            <p className="mt-1 break-words text-destructive">{scenario.message}</p>
          ) : null}
        </div>
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline"
            aria-expanded={open}
          >
            {open ? 'Hide detail' : 'Show detail'}
          </button>
        ) : null}
      </div>
      {hasDetail && open ? (
        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{scenario.detail}</pre>
      ) : null}
    </li>
  );
}
