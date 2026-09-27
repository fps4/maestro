import Link from 'next/link';
import {
  Chip,
  Mono,
  Notice,
  PageTitle,
  Scroller,
  SectionTitle,
  Td,
  Th,
  Tile,
  shortDigest,
} from '@/components/atoms';
import { WorkUnavailable, Who } from '@/components/work';
import { fetchArtifact, fetchEstate } from '@/lib/runtime';
import type { Artifact, Instance } from '@/lib/runtime-types';
import { fetchFrontier, fetchMe, fetchRates } from '@/lib/work';
import { utc } from '@/lib/work-labels';
import type { FrontierRow, Rates } from '@/lib/work-types';

export const dynamic = 'force-dynamic';

/**
 * The estate (ux.md): every application × environment — what runs there, at which level and tier,
 * the last deploy and by whom, its open items, and the rollback target. runtime-service's register,
 * with work-service's open items beside each row.
 *
 * A digest the ledger holds no build record for is a hard stop, not a detail: its row reads first and
 * says so in words, and it stays until a built digest is deployed over it (ADR-0027 §2).
 */
export default async function EstatePage() {
  let estate: Instance[];
  try {
    estate = await fetchEstate();
  } catch (error) {
    return (
      <>
        <PageTitle>Estate</PageTitle>
        <WorkUnavailable error={error} title="The estate is not available" />
      </>
    );
  }

  // work-service's half is beside the register, not part of it: without it the estate still reads.
  const [frontier, me] = await Promise.all([
    fetchFrontier().catch((): FrontierRow[] | null => null),
    fetchMe()
      .then((m) => m.principal)
      .catch(() => ''),
  ]);
  const artifacts = new Map(
    await Promise.all(
      estate.map(async (i) => [i.instance_id, await fetchArtifact(i.application, i.digest)] as const),
    ),
  );
  const applications = [...new Set(estate.map((i) => i.application))].sort();
  const rates = (await Promise.all(applications.map((a) => fetchRates(a).catch(() => null)))).filter(
    (r): r is Rates => r !== null,
  );

  const rows = [...estate].sort(
    (a, b) =>
      Number(b.state === 'mismatched') - Number(a.state === 'mismatched') ||
      a.application.localeCompare(b.application) ||
      a.environment.localeCompare(b.environment),
  );
  const mismatched = estate.filter((i) => i.state === 'mismatched').length;
  const open = (i: Instance) =>
    frontier?.filter((r) => r.about.application === i.application && r.about.environment === i.environment)
      .length;

  return (
    <>
      <div className="flex flex-col gap-1">
        <PageTitle>Estate</PageTitle>
        <p className="text-sm text-muted">
          What runs where: every application and environment the pipelines have deployed.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        <Tile value={estate.length} label="Instances" />
        <Tile value={applications.length} label="Applications" />
        <Tile value={mismatched} label="Running an unbuilt digest" alert={mismatched > 0} />
      </div>

      {frontier === null ? (
        <Notice tone="warn" title="Open items are not shown">
          work-service could not be read.
        </Notice>
      ) : null}

      {estate.length === 0 ? (
        <Notice title="Nothing deployed yet">
          An instance appears with the first deploy event a pipeline puts for a declared application.
        </Notice>
      ) : (
        <Scroller>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <Th>Instance</Th>
                <Th>Running</Th>
                <Th>Level · tier</Th>
                <Th>Last deploy</Th>
                <Th>Rollback target</Th>
                <Th right>Open items</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <Row
                  key={i.instance_id}
                  instance={i}
                  artifact={artifacts.get(i.instance_id) ?? null}
                  open={open(i)}
                  me={me}
                />
              ))}
            </tbody>
          </table>
        </Scroller>
      )}

      {rates.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <SectionTitle>The argument for the next level</SectionTitle>
            <p className="text-xs text-muted">
              Per application, what maestro handed back because its onboarding level does not let it act.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {rates.map((r) => (
              <div key={r.application} className="rounded border border-rule bg-surface-2 px-3 py-2 text-xs">
                <Mono>{r.application}</Mono>{' '}
                <span className="text-muted">
                  escalated out{' '}
                  <b className="tabular text-ink">
                    {r.escalated_out_rate === null ? '—' : `${Math.round(r.escalated_out_rate * 100)}%`}
                  </b>{' '}
                  of {Object.values(r.closed).reduce((a, b) => a + b, 0)} closed
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function Row({
  instance: i,
  artifact,
  open,
  me,
}: {
  instance: Instance;
  artifact: Artifact | null;
  open: number | undefined;
  me: string;
}) {
  const hard = i.state === 'mismatched';
  return (
    <tr className={hard ? 'bg-critical-soft' : 'hover:bg-surface-2'}>
      <Td>
        <Link
          href={`/estate/${encodeURIComponent(i.application)}/${encodeURIComponent(i.environment)}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {i.application}
        </Link>
        <span className="block font-mono text-2xs text-faint">{i.environment}</span>
      </Td>
      <Td>
        <span className="flex flex-col gap-0.5">
          <Mono className="text-xs">{shortDigest(i.digest)}</Mono>
          {hard ? (
            <Chip state="rejected" className="w-fit normal-case">
              no build record — a hard stop
            </Chip>
          ) : (
            <span className="text-2xs text-faint">
              {artifact?.version ? `v${artifact.version} · ` : ''}
              <Mono>{i.commit.slice(0, 7)}</Mono>
            </span>
          )}
        </span>
      </Td>
      <Td className="text-xs">
        {i.onboarding_level || i.tier ? (
          <Mono>{[i.onboarding_level?.toUpperCase(), i.tier].filter(Boolean).join(' · ')}</Mono>
        ) : (
          <span className="text-faint">not set here; work-service’s definition applies</span>
        )}
      </Td>
      <Td className="text-xs">
        <span className="flex flex-col">
          <Mono className="text-xs">{utc(i.deployed_at)}</Mono>
          <span className="text-2xs text-faint">
            by <Who id={i.deployed_by} me={me} />
          </span>
        </span>
      </Td>
      <Td>
        {i.rollback_target ? (
          <Mono className="text-xs">{shortDigest(i.rollback_target)}</Mono>
        ) : (
          <span className="text-2xs text-faint">none yet</span>
        )}
      </Td>
      <Td right className="tabular">
        {open === undefined ? '—' : open}
      </Td>
    </tr>
  );
}
