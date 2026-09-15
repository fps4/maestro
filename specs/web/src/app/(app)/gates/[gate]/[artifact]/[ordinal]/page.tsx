import { fetchArtifact, fetchGateView, fetchVersion } from '@/lib/api';
import { currentWorkspace } from '@/lib/auth';
import {
  Card,
  Chip,
  Eyebrow,
  KeyValue,
  Mono,
  Notice,
  PageTitle,
  SectionTitle,
  shortDigest,
} from '@/components/atoms';
import { stateLabel } from '@/lib/labels';
import { DecideForm } from './decide-form';

export const dynamic = 'force-dynamic';

/**
 * The decision screen.
 *
 * **Requirements before outcomes.** You cannot reach the outcome controls without passing the
 * gate's declared checks — an unmet requirement is a hard stop with a reason, never a greyed button
 * with no explanation.
 *
 * **Each outcome states its consequence.** Approve says what becomes superseded and what freezes. A
 * decision with invisible effects is one nobody can take responsibly.
 *
 * **Attribution is shown, not collected.** `accountable` is resolved and locked to a human
 * principal, and the rule is visible at the moment it matters rather than in a document.
 */
export default async function DecidePage({
  params,
}: {
  params: Promise<{ gate: string; artifact: string; ordinal: string }>;
}) {
  const { gate, artifact, ordinal } = await params;
  const n = Number(ordinal);

  const workspace = await currentWorkspace();
  const [view, { version }, { artifact: record }] = await Promise.all([
    fetchGateView(gate, artifact, n),
    fetchVersion(artifact, n),
    fetchArtifact(artifact),
  ]);

  const blocking = view.requirements.filter((r) => r.blocking && !r.satisfied);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Eyebrow>
            {view.title} · decides on a {view.type_title.toLowerCase()}
          </Eyebrow>
          <PageTitle>{version.title}</PageTitle>
          <p className="text-sm text-muted">
            {view.description ? <>{view.description} · </> : null}
            <Mono>
              {artifact}@{n}
            </Mono>{' '}
            proposed {new Date(version.proposed_at).toLocaleDateString('en-GB')} by{' '}
            <Mono>{version.proposed_by}</Mono>
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/artifacts/${artifact}/versions/${n}`}
            className="rounded border border-rule-strong bg-surface px-2.5 py-0.5 text-xs hover:bg-surface-2"
          >
            Read @{n}
          </a>
          {n > 1 ? (
            <a
              href={`/artifacts/${artifact}/diff?from=${n - 1}&to=${n}`}
              className="rounded border border-rule-strong bg-surface px-2.5 py-0.5 text-xs hover:bg-surface-2"
            >
              Diff @{n - 1} → @{n}
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.75fr),minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card>
            <SectionTitle>Before this gate opens</SectionTitle>
            <div>
              {view.requirements.map((requirement) => (
                <div
                  key={requirement.id}
                  className="flex items-start gap-2.5 border-b border-rule py-2 text-xs last:border-b-0"
                >
                  <span
                    className={`w-3.5 flex-none font-mono text-xs font-bold ${
                      requirement.satisfied
                        ? 'text-accent'
                        : requirement.blocking
                          ? 'text-critical'
                          : 'text-warning'
                    }`}
                  >
                    {requirement.satisfied ? '✓' : requirement.blocking ? '×' : '!'}
                  </span>
                  <div className="flex flex-col gap-px">
                    <b
                      className={
                        requirement.satisfied ? '' : requirement.blocking ? 'text-critical' : 'text-warning'
                      }
                    >
                      {requirement.title}
                      {!requirement.blocking && !requirement.satisfied ? ' — advisory, not blocking' : ''}
                    </b>
                    <span className="text-2xs text-faint">{requirement.detail}</span>
                  </div>
                </div>
              ))}
              {view.requirements.length === 0 ? (
                <p className="m-0 py-2 text-xs text-muted">
                  This gate declares no requirements. The decision is a judgement, recorded.
                </p>
              ) : null}
            </div>
          </Card>

          {!view.may_decide ? (
            <Notice tone="hard" title="You cannot decide at this gate.">
              {view.may_decide_reason}
            </Notice>
          ) : blocking.length > 0 ? (
            <Notice tone="hard" title="This gate is not open.">
              {blocking.map((r) => `${r.title} — ${r.detail}`).join('; ')}
            </Notice>
          ) : (
            <DecideForm
              workspace={workspace}
              gate={view.gate}
              artifact={artifact}
              ordinal={n}
              outcomes={view.outcomes}
              outcomeLabels={view.outcome_labels}
              required={view.attribution_profile.required}
              optional={view.attribution_profile.optional}
              fieldLabels={view.attribution_profile.field_labels}
              acceptedOrdinal={record.accepted_ordinal}
              hasPin={version.links.some((l) => l.pinned_to === null || l.pinned_to === undefined)}
            />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle>
              What is being decided <span className="font-normal text-faint">— by digest</span>
            </SectionTitle>
            <KeyValue
              rows={[
                ['version', <Mono key="v">{`${artifact}@${n}`}</Mono>],
                [
                  'state',
                  <Chip key="s" state={version.state}>
                    {stateLabel(version.state)}
                  </Chip>,
                ],
                ['digest', <Mono key="d">{shortDigest(version.digest)}</Mono>],
                ['definition', <Mono key="def">v{version.definition_version}</Mono>],
              ]}
            />
            <p className="m-0 text-2xs text-faint">
              The decision records this digest. A verdict or an approval reached against different bytes is
              not about this version.
            </p>
          </Card>

          <Card>
            <SectionTitle>
              Attribution{' '}
              <span className="font-normal text-faint font-mono">{view.attribution_profile.id}</span>
            </SectionTitle>
            <p className="m-0 text-2xs text-faint">
              <b>accountable</b> must resolve to a principal of kind <Mono>human</Mono>. A decision naming an
              agent there is a refused write, and the refusal is itself recorded.
            </p>
          </Card>

          <Notice tone="ok" title="This decision is immutable once recorded.">
            It carries the digest of @{n}, every evaluation in force, and your attribution. There is no edit
            and no delete.
          </Notice>
        </div>
      </div>
    </>
  );
}
