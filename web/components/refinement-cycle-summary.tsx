// One refinement cycle's closure (ADR-0022) — summary_of_changes + addresses[] inline.
// Server component: pure rendering.
//
// The literal line-by-line diff-of-artefact (workspace-ux-design.md §refinement-loop step 4)
// would render alongside this; for M1 it's deferred — the addresses[] + per-comment `Agent reply`
// in the comment list carry the per-anchor "what changed" signal. A small follow-up extends the
// read API with `?commit=` so the workspace can fetch both refs and render a real diff.

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentResponse } from '@/lib/types';

export function RefinementCycleSummary({ response }: { response: AgentResponse }) {
  const counts = response.addresses.reduce<Record<string, number>>(
    (acc, a) => {
      acc[a.action] = (acc[a.action] ?? 0) + 1;
      return acc;
    },
    { addressed: 0, deferred: 0, rejected: 0 },
  );
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {response.agent === 'spec' ? 'Spec re-draft' : 'Design re-draft'}
          </CardTitle>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge variant="success">{counts.addressed} addressed</Badge>
            {counts.deferred > 0 && <Badge variant="secondary">{counts.deferred} deferred</Badge>}
            {counts.rejected > 0 && <Badge variant="destructive">{counts.rejected} disputed</Badge>}
          </div>
        </div>
        <CardDescription className="font-mono text-xs">
          commit {response.ref.commit?.slice(0, 7) ?? '(unknown)'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm">{response.summary_of_changes}</p>
      </CardContent>
    </Card>
  );
}
