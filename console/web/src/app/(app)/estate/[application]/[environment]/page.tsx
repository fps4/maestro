import Link from 'next/link';
import {
  Card,
  Chip,
  KeyValue,
  Mono,
  Notice,
  PageTitle,
  Scroller,
  SectionTitle,
  Td,
  Th,
  shortDigest,
} from '@/components/atoms';
import { FrontierTable, NothingOwed, WorkUnavailable, Who } from '@/components/work';
import { fetchArtifact, fetchInstance } from '@/lib/runtime';
import type { Deploy, Instance } from '@/lib/runtime-types';
import { fetchFrontier, fetchMe } from '@/lib/work';
import { utc } from '@/lib/work-labels';
import type { FrontierRow } from '@/lib/work-types';

export const dynamic = 'force-dynamic';

/**
 * One instance: what runs, what ran before (the rollback target, copied, never computed), every
 * deploy newest first with the ones that had no build record marked, and the open items about it.
 * It records; it never deploys — there is no control here to roll back or restart anything.
 */
export default async function InstancePage({
  params,
}: {
  params: Promise<{ application: string; environment: string }>;
}) {
  const { application, environment } = await params;
  const app = decodeURIComponent(application);
  const env = decodeURIComponent(environment);

  let instance: Instance;
  let deploys: Deploy[];
  try {
    ({ instance, deploys } = await fetchInstance(app, env));
  } catch (error) {
    return (
      <>
        <PageTitle>
          {app} · {env}
        </PageTitle>
        <WorkUnavailable error={error} title="The estate is not available" />
      </>
    );
  }
  const [artifact, rows, me] = await Promise.all([
    fetchArtifact(app, instance.digest),
    fetchFrontier({ application: app }).catch((): FrontierRow[] | null => null),
    fetchMe()
      .then((m) => m.principal)
      .catch(() => ''),
  ]);
  const here = rows?.filter((r) => r.about.environment === env) ?? null;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-2 text-xs text-faint">
          <Link href="/estate" className="underline-offset-2 hover:underline">
            Estate
          </Link>
          <span>/</span>
          <Mono>{instance.instance_id}</Mono>
        </p>
        <PageTitle>
          {app} · {env}
        </PageTitle>
      </div>

      {instance.state === 'mismatched' ? (
        <Notice tone="hard" title="Running a digest with no build record">
          The deploy of <Mono>{shortDigest(instance.digest)}</Mono> named an artifact no pipeline recorded
          building. It is recorded, and the instance stays marked until a built digest is deployed over it.
          Nothing is corrected in place.
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Running</SectionTitle>
          <KeyValue
            rows={[
              ['digest', <Mono key="d">{instance.digest}</Mono>],
              ['version', artifact?.version ?? '—'],
              ['built from', <Mono key="c">{instance.commit}</Mono>],
              ['build record', artifact?.built ? `recorded ${utc(artifact.recorded_at)}` : 'none'],
              ['deployed', `${utc(instance.deployed_at)}`],
              ['by', <Who key="w" id={instance.deployed_by} me={me} />],
              [
                'rollback target',
                instance.rollback_target ? <Mono key="r">{instance.rollback_target}</Mono> : 'none yet',
              ],
              [
                'level · tier',
                instance.onboarding_level || instance.tier
                  ? [instance.onboarding_level?.toUpperCase(), instance.tier].filter(Boolean).join(' · ')
                  : 'not set here; work-service’s definition applies',
              ],
            ]}
          />
        </Card>
        <Card>
          <SectionTitle>Open items about it</SectionTitle>
          {here === null ? (
            <p className="text-xs text-muted">work-service could not be read.</p>
          ) : (
            <FrontierTable
              rows={here}
              me={me}
              empty={<NothingOwed title="Nothing open about this instance." />}
            />
          )}
        </Card>
      </div>

      <section className="flex flex-col gap-2">
        <SectionTitle>Deploys, newest first</SectionTitle>
        <Scroller>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Digest</Th>
                <Th>Commit</Th>
                <Th>By</Th>
                <Th>Replaced</Th>
              </tr>
            </thead>
            <tbody>
              {deploys.map((d) => (
                <tr key={d.revision} className={d.mismatch ? 'bg-critical-soft' : undefined}>
                  <Td>
                    <Mono className="text-xs">{utc(d.deployed_at)}</Mono>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Mono className="text-xs">{shortDigest(d.digest)}</Mono>
                      {d.mismatch ? (
                        <Chip state="rejected" className="normal-case">
                          no build record
                        </Chip>
                      ) : null}
                    </span>
                  </Td>
                  <Td>
                    <Mono className="text-xs">{d.commit.slice(0, 12)}</Mono>
                  </Td>
                  <Td>
                    <Who id={d.deployed_by} me={me} />
                  </Td>
                  <Td>{d.previous ? <Mono className="text-xs">{shortDigest(d.previous)}</Mono> : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      </section>
    </>
  );
}
