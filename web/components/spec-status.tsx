import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { GateDecision, SpecStatus } from '@/lib/types';

const STAGE_LABEL: Record<string, string> = {
  intake: 'Intake',
  functional_gate: 'Functional gate',
  design: 'Design',
  technical_gate: 'Technical gate',
  build: 'Build',
  merge_gate: 'Merge gate',
  done: 'Done',
  blocked: 'Blocked',
};

const DECISION: Record<GateDecision, { label: string; variant: BadgeProps['variant'] }> = {
  approve: { label: 'approved', variant: 'success' },
  request_changes: { label: 'changes requested', variant: 'destructive' },
  reject: { label: 'rejected', variant: 'destructive' },
  pending: { label: 'pending', variant: 'muted' },
};

// Render a spec's live status as badges: the delivery-task stage, the relevant gate's verdict, and
// merged. `null` means no delivery task owns this doc yet (e.g. a spec sitting on the default branch).
export function SpecStatusBadges({ status }: { status: SpecStatus | null }) {
  if (!status) {
    return <Badge variant="outline">no active task</Badge>;
  }
  const decision = DECISION[status.gate.decision] ?? DECISION.pending;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary">{STAGE_LABEL[status.stage] ?? status.stage}</Badge>
      <Badge variant={decision.variant}>
        {status.gate.type} · {decision.label}
      </Badge>
      {status.merged && <Badge variant="success">merged</Badge>}
    </div>
  );
}
