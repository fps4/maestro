import Link from 'next/link';
import { fetchAcceptances, fetchStandards } from '@/lib/api';
import {
  Card,
  Chip,
  Empty,
  Eyebrow,
  Mono,
  Notice,
  PageTitle,
  Scroller,
  Td,
  Th,
  Tile,
} from '@/components/atoms';
import type { Acceptance } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The standards this tenant complies with.
 *
 * **The standards are not ours — the acceptances are.** A standard lives in the catalogue, shared
 * across tenants and read-only. What this workspace holds is who accepted it, when, and against
 * which pack version.
 *
 * **A lapse is a state, not a notification.** A material pack change lapses the acceptance and the
 * artifacts resting on it read as unsupported. It survives being ignored, which is the difference
 * between a control and a message.
 */
export default async function StandardsPage() {
  const [acceptances, standards] = await Promise.all([fetchAcceptances(), fetchStandards().catch(() => [])]);

  const byStandard = new Map(standards.map((s) => [s.standard_id, s]));
  const active = acceptances.filter((a) => a.status === 'active');
  const lapsed = acceptances.filter((a) => a.status === 'lapsed');
  const overridden = acceptances.filter((a) => a.status === 'overridden');

  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>pack binding · a governed artifact like any other</Eyebrow>
        <PageTitle>Standards this workspace complies with</PageTitle>
        <p className="text-sm text-muted">
          Who accepted each standard, when, and against which pack version. It hands over at exit as your own
          record of what you accepted and why.
        </p>
      </div>

      {lapsed.length > 0 ? (
        <Notice tone="hard" title={`${lapsed.length} acceptance${lapsed.length === 1 ? '' : 's'} lapsed.`}>
          {lapsed.map((a) => `${a.standard} was accepted at pack ${a.pack_version}`).join('; ')}. A material
          change was published since, so what was accepted is not what is now in force. Anything resting on
          these reads as unsupported until the advisor re-accepts.
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Tile value={acceptances.length} label="Standards accepted" />
        <Tile value={active.length} label="Active" />
        <Tile value={lapsed.length} label="Lapsed" alert={lapsed.length > 0} />
        <Tile value={overridden.length} label="Overridden" alert={overridden.length > 0} />
      </div>

      {acceptances.length === 0 ? (
        <Empty title="No acceptance has been recorded in this workspace.">
          An acceptance names a party, a person and a date, because a standard is interpreted rather than
          merely quoted. Until one exists, a gate that requires them will say so rather than quietly passing.
        </Empty>
      ) : (
        <Card className="gap-3">
          <h2 className="text-sm font-semibold">
            Acceptances{' '}
            <span className="font-normal text-faint">— per standard, by a named party, dated</span>
          </h2>
          <Scroller>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Standard</Th>
                  <Th>Scope</Th>
                  <Th>Accepted by</Th>
                  <Th right>Pack</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {acceptances.map((acceptance) => (
                  <Row
                    key={`${acceptance.standard}-${acceptance.scope}-${acceptance.project ?? ''}`}
                    acceptance={acceptance}
                    title={byStandard.get(acceptance.standard)?.title}
                    artifact={byStandard.get(acceptance.standard)?.artifact}
                  />
                ))}
              </tbody>
            </table>
          </Scroller>
        </Card>
      )}

      {overridden.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <h2 className="text-sm font-semibold">
            Overrides{' '}
            <span className="font-normal text-faint">
              — product tier only; a regulatory standard cannot be overridden
            </span>
          </h2>
          {overridden.map((a) => (
            <Card key={a.standard} className="border-l-[3px] border-l-critical">
              <div className="flex flex-wrap items-center gap-2">
                <Mono className="text-sm font-semibold">{a.standard}</Mono>
                <Chip state="overridden">override</Chip>
                {a.override?.expires ? (
                  <span className="text-2xs text-warning">expires {a.override.expires}</span>
                ) : null}
              </div>
              {a.override ? (
                <>
                  <p className="m-0 text-sm text-muted">&ldquo;{a.override.justification}&rdquo;</p>
                  <span className="text-2xs text-faint">
                    accepted by <Mono>{a.override.accepted_by}</Mono> · every override is a recorded exception
                    with an expiry, never a setting
                  </span>
                </>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      <Notice title="Platform standards are not on this page.">
        The Tier 1 invariants and the build standards are the platform&rsquo;s own, claimed by inheritance and
        evidenced through the conformance record. This page is <i>this workspace&rsquo;s</i> obligations only.
      </Notice>
    </>
  );
}

function Row({ acceptance, title, artifact }: { acceptance: Acceptance; title?: string; artifact?: string }) {
  return (
    <tr className="hover:bg-surface-2">
      <Td>
        {artifact ? (
          <Link
            href={`/catalogue/${artifact}`}
            className="font-mono text-xs font-semibold underline-offset-2 hover:underline"
          >
            {acceptance.standard}
          </Link>
        ) : (
          <Mono className="text-xs font-semibold">{acceptance.standard}</Mono>
        )}
        {title ? <span className="block text-2xs text-faint">{title}</span> : null}
      </Td>
      <Td className="text-sm">
        {acceptance.scope}
        {acceptance.project ? (
          <span className="block font-mono text-2xs text-faint">{acceptance.project}</span>
        ) : null}
      </Td>
      <Td className="text-sm">
        {acceptance.accepted_by}
        <span className="block text-2xs text-faint">{acceptance.at}</span>
      </Td>
      <Td right>
        <Mono className={acceptance.status === 'lapsed' ? 'text-faint' : ''}>{acceptance.pack_version}</Mono>
      </Td>
      <Td>
        <Chip
          state={
            acceptance.status === 'active'
              ? 'accepted'
              : acceptance.status === 'lapsed'
                ? 'expired'
                : 'overridden'
          }
        >
          {acceptance.status}
        </Chip>
      </Td>
    </tr>
  );
}
