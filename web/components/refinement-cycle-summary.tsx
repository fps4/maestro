// One refinement cycle's closure (ADR-0022) — summary_of_changes + addresses[] inline + the
// literal **diff-of-artefact** between the previous artefact ref and the redrafted one (the
// `previousContent` / `currentContent` props come from two `getSpec` calls in the task page).
// Server component composing the diff client component lazily.

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentResponse } from '@/lib/types';
import { DiffArtefactView } from './diff-artefact-view';

export function RefinementCycleSummary({
  response,
  diff,
}: {
  response: AgentResponse;
  diff?: {
    previousLabel: string;
    currentLabel: string;
    previousContent: string;
    currentContent: string;
  };
}) {
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
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap text-sm">{response.summary_of_changes}</p>
        {diff && (
          <DiffArtefactView
            previousLabel={diff.previousLabel}
            currentLabel={diff.currentLabel}
            previousContent={diff.previousContent}
            currentContent={diff.currentContent}
          />
        )}
      </CardContent>
    </Card>
  );
}
