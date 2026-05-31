import Link from 'next/link';
import { ApiErrorNotice } from '@/components/api-error-notice';
import { ArtefactsPanel } from '@/components/artefacts-panel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CommentForm } from '@/components/comment-form';
import { CommentList } from '@/components/comment-list';
import { GateDecisionPanel } from '@/components/gate-decision-panel';
import { Markdown } from '@/components/markdown';
import { MarkLastSeen } from '@/components/since-last-review-separator';
import { RefinementCycleSummary } from '@/components/refinement-cycle-summary';
import { getSpec, getTask, listProducts } from '@/lib/api';
import { specsPath } from '@/lib/links';
import type { ArtefactPublished, SpecDetail, SpecKind, SpecRef, TaskDetail } from '@/lib/types';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<string, string> = {
  intake: 'Intake',
  functional_gate: 'Functional gate',
  design: 'Design',
  technical_gate: 'Technical (design) gate',
  build: 'Build',
  merge_gate: 'Merge gate',
  done: 'Done',
  blocked: 'Blocked',
};

const GATE_LABEL: Record<string, string> = {
  functional: 'functional',
  technical_design: 'technical_design',
  technical_merge: 'merge',
};

const KIND_FROM_GATE: Record<string, SpecKind> = {
  functional: 'functional_spec',
  technical_design: 'technical_design',
};

export default async function TaskPage({
  params,
}: {
  params: Promise<{ productId: string; taskId: string }>;
}) {
  const { productId, taskId } = await params;

  let task: TaskDetail;
  try {
    task = await getTask(productId, taskId);
  } catch (error) {
    return (
      <Shell productId={productId} taskId={taskId}>
        <ApiErrorNotice error={error} />
      </Shell>
    );
  }

  // Roles + product visibility: drive the gate-decision panel's hint, never the gate itself —
  // server-side enforcement is the contract (workspace-write-api.md §POST-decisions ⇒ 403
  // forbidden_role). The UI is just nicer when it tells the architect what role applied.
  let productRole: string | null = null;
  try {
    const products = await listProducts();
    productRole = products.find((p) => p.id === productId)?.role ?? null;
  } catch {
    /* read-API hiccup on the product list shouldn't crash the task page */
  }

  // The artefact currently under review. Resolved by: the most recent agent_response.posted (a
  // re-draft after request_changes) wins over the spec/design tags; otherwise the response that
  // matches the open gate; otherwise the gate's expected kind from the gate type.
  const activeGate = task.open_gates[0] ?? null;
  const artefactKind: SpecKind | null = activeGate
    ? KIND_FROM_GATE[activeGate.type] ?? null
    : task.agent_responses.length > 0
      ? task.agent_responses[task.agent_responses.length - 1].kind
      : null;

  // Try to fetch the artefact content from the read API (one-way render). The detail endpoint
  // returns the file as-committed on the branch; for the M1 dogfood that's the right thing since
  // a re-draft replaces the file in place on the same branch.
  let artefact: SpecDetail | null = null;
  if (artefactKind && task.branch) {
    try {
      const feature = await guessFeature(task);
      if (feature) artefact = await getSpec(productId, feature, artefactKind, task.branch);
    } catch {
      /* artefact may not yet be in the index; surface this in the artefact card */
    }
  }

  // The seq the catch-up marker advances to on view (ADR-0023). The largest of any event the
  // task carries — comments, open gates, responses — so any future event resets "new" correctly.
  const maxSeq = computeMaxSeq(task);
  const artefactRef: SpecRef | null = artefact
    ? artefact.ref
    : task.agent_responses.length > 0
      ? task.agent_responses[task.agent_responses.length - 1].ref
      : null;
  const defaultLocator = task.comments.find((c) => c.anchor?.locator?.criterion_id)?.anchor?.locator
    ?.criterion_id;

  return (
    <Shell productId={productId} taskId={taskId}>
      <MarkLastSeen productId={productId} taskId={taskId} maxSeq={maxSeq} />
      <Header task={task} />

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Artefact</CardTitle>
            <CardDescription>
              {artefact ? (
                <span className="font-mono text-xs">{artefact.ref.path}</span>
              ) : (
                <>Rendered one-way from the product repo. None drafted yet.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {artefact ? (
              <Markdown>{artefact.content}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">
                The spec / design agent has not drafted an artefact yet. Once it does, the file
                renders here from the repo (read-only, ADR-0008/0018).
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {activeGate ? (
            <Card>
              <CardHeader>
                <CardTitle>Decision</CardTitle>
                <CardDescription>
                  Role-authorized + attributed (ADR-0011/0009).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GateDecisionPanel
                  productId={productId}
                  taskId={taskId}
                  gateId={activeGate.type}
                  gateType={GATE_LABEL[activeGate.type] ?? activeGate.type}
                  seq={activeGate.seq}
                  resolvedRole={productRole}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>No pending gate</CardTitle>
                <CardDescription>
                  Nothing to decide right now. Stage is{' '}
                  <span className="font-mono">{task.stage}</span>.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {task.agent_responses.length > 0 && (
            <div className="space-y-3">
              {await Promise.all(
                task.agent_responses.map(async (r) => (
                  <RefinementCycleSummary
                    key={r.seq}
                    response={r}
                    diff={await fetchDiff(productId, r, task.artefacts)}
                  />
                )),
              )}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Artefacts</CardTitle>
              <CardDescription>
                The PR diff, test report and SBOM this task produced — resolved through the artefact
                store on demand, never a long-lived link (ADR-0012).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ArtefactsPanel
                productId={productId}
                taskId={taskId}
                artefacts={task.stored_artefacts}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Discussion</CardTitle>
            <CardDescription>
              Comments anchor to the artefact above. On <em>request changes</em>, the orchestrator
              bundles the open anchored comments and hands them to the agent (ADR-0020).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <CommentList
              productId={productId}
              taskId={taskId}
              comments={task.comments}
              responses={task.agent_responses}
            />
            <div className="border-t pt-4">
              <CommentForm
                productId={productId}
                taskId={taskId}
                artefactKind={artefactKind}
                artefactRef={artefactRef}
                defaultLocator={defaultLocator}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function Header({ task }: { task: TaskDetail }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Task {task.task_id}</h1>
      <Badge variant="secondary">{STAGE_LABEL[task.stage] ?? task.stage}</Badge>
      {task.status !== 'active' && <Badge variant="muted">{task.status}</Badge>}
      {task.merged && <Badge variant="success">merged</Badge>}
    </div>
  );
}

function Shell({
  productId,
  taskId,
  children,
}: {
  productId: string;
  taskId: string;
  children: React.ReactNode;
}) {
  return (
    <main className="container mx-auto max-w-5xl px-6 py-10">
      <p className="text-sm text-muted-foreground">
        <Link href="/" className="hover:underline">
          maestro
        </Link>{' '}
        /{' '}
        <Link href={specsPath(productId)} className="hover:underline">
          {productId}
        </Link>{' '}
        / tasks / <span className="font-mono">{taskId}</span>
      </p>
      <div className="mt-4">{children}</div>
    </main>
  );
}

// For a given refinement-cycle closure, find the IMMEDIATELY PRECEDING artefact for the same
// (kind, path) in the task's chronological artefacts list, then fetch both refs through the read
// API (the current via the response's commit, the previous via ?commit=). Returns the diff data
// the RefinementCycleSummary card renders, or undefined if there is no preceding artefact.
async function fetchDiff(
  productId: string,
  response: { ref: SpecRef; kind: SpecKind; seq: number },
  artefacts: ArtefactPublished[],
): Promise<
  | { previousLabel: string; currentLabel: string; previousContent: string; currentContent: string }
  | undefined
> {
  const previous = [...artefacts]
    .filter((a) => a.kind === response.kind && a.ref.path === response.ref.path && a.seq < response.seq)
    .sort((a, b) => b.seq - a.seq)[0];
  if (!previous) return undefined;
  const { feature } = pathToFeature(response.ref.path, response.kind);
  if (!feature) return undefined;
  try {
    const [prev, curr] = await Promise.all([
      getSpec(productId, feature, response.kind, previous.ref.branch, previous.ref.commit),
      getSpec(productId, feature, response.kind, response.ref.branch, response.ref.commit),
    ]);
    return {
      previousLabel: `before · commit ${previous.ref.commit?.slice(0, 7) ?? '(unknown)'}`,
      currentLabel: `after · commit ${response.ref.commit?.slice(0, 7) ?? '(unknown)'}`,
      previousContent: prev.content,
      currentContent: curr.content,
    };
  } catch {
    // A degraded content fetch on either ref is not the page's failure — the summary still
    // renders, just without the diff. The reviewer reads `summary_of_changes` + the per-anchor
    // notes inline with the comment list as the fallback.
    return undefined;
  }
}

function pathToFeature(path: string, kind: SpecKind): { feature: string | null } {
  // Mirror of guessFeature below for a single ref — kind-aware: a technical_design path ends in
  // `<feature>-design.md`, a functional_spec ends in `<feature>.md`.
  const suffix = kind === 'technical_design' ? /\/([^/]+?)-design\.md$/ : /\/([^/]+?)\.md$/;
  const match = suffix.exec(path);
  return { feature: match ? match[1] : null };
}

// Compute the largest seq across everything the task carries — used by the catch-up marker
// (ADR-0023) so a view bumps the last-seen counter to the current state.
function computeMaxSeq(task: TaskDetail): number {
  let max = 0;
  for (const g of task.open_gates) if (g.seq > max) max = g.seq;
  for (const g of task.gates) if (g.seq > max) max = g.seq;
  for (const c of task.comments) if (c.seq > max) max = c.seq;
  for (const r of task.agent_responses) if (r.seq > max) max = r.seq;
  return max;
}

// Best-effort: derive the feature slug from the latest agent_response.posted's ref path (it
// committed at docs/.../<feature>.md or <feature>-design.md), or from a gate's path. M1 doesn't
// expose feature on the task-detail response yet; this guess works for the dogfood layout and
// will be replaced when the spec.drafted projection surfaces ref.feature directly.
async function guessFeature(task: TaskDetail): Promise<string | null> {
  const candidates = [
    ...task.agent_responses.map((r) => r.ref.path),
    // Future: an `artefacts:` field on TaskDetail would replace this guess.
  ];
  for (const path of candidates) {
    const match = /\/([^/]+?)(?:-design)?\.md$/.exec(path);
    if (match) return match[1];
  }
  return null;
}
