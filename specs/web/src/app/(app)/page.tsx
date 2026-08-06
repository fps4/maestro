import Link from 'next/link';
import { fetchAcceptances, fetchRegister } from '@/lib/api';
import {
  Button,
  Chip,
  Empty,
  Mono,
  PageTitle,
  Scroller,
  Td,
  Th,
  Tile,
  relativeDate,
} from '@/components/atoms';
import type { Acceptance, RegisterRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The register: everything in flight, with the lifecycle phase it sits in.
 *
 * The summary reads before the list. Expiry and a lapsed acceptance are the two things a stale
 * register hides, so they are tiles rather than rows you have to find — §6 of the conceptual design
 * calls a stale register a defect, and a defect you have to scan for is one nobody finds.
 *
 * A superseded version never appears here: the register lists lineages, and version history belongs
 * to the artifact.
 */
export default async function RegisterPage() {
  const [register, acceptances] = await Promise.all([
    fetchRegister(),
    fetchAcceptances().catch((): Acceptance[] => []),
  ]);

  const inFlight = register.filter((r) => !['closed', 'retired'].includes(r.phase));
  const awaiting = register.filter((r) => r.latest_state === 'proposed');
  const expired = register.filter((r) => r.latest_state === 'expired');
  const lapsed = acceptances.filter((a) => a.status === 'lapsed');

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <PageTitle>Register</PageTitle>
          <p className="text-sm text-muted">
            Everything in flight in this workspace, with the lifecycle phase it sits in.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href="/search" size="sm">
            Search
          </Button>
          <Button href="/drafts/new" variant="primary" size="sm">
            New draft
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Tile value={inFlight.length} label="In flight" />
        <Tile value={awaiting.length} label="Awaiting a decision" />
        <Tile value={expired.length} label="Expired" alert={expired.length > 0} />
        <Tile value={lapsed.length} label="Standards acceptance lapsed" alert={lapsed.length > 0} />
      </div>

      {register.length === 0 ? (
        <Empty title="Nothing has been raised yet.">
          A register with nothing in it is either a new workspace or a defect. Start a draft, and the lineage
          appears here the moment a version is proposed.
        </Empty>
      ) : (
        <Scroller>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <Th>Artifact</Th>
                <Th>Type</Th>
                <Th>Phase</Th>
                <Th>State</Th>
                <Th right>Latest</Th>
                <Th right>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {register.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </Scroller>
      )}

      <p className="text-2xs text-faint">
        {register.length} {register.length === 1 ? 'lineage' : 'lineages'} · a superseded version never
        appears here, only its lineage
      </p>
    </>
  );
}

function Row({ row }: { row: RegisterRow }) {
  return (
    <tr className="hover:bg-surface-2">
      <Td>
        <Link href={`/artifacts/${row.id}`} className="font-medium underline-offset-2 hover:underline">
          {row.title}
        </Link>
        <span className="block font-mono text-2xs text-faint">{row.id}</span>
      </Td>
      <Td className="text-sm text-muted">{row.type.replace(/_/g, ' ')}</Td>
      <Td className="text-sm">{row.phase.replace(/_/g, ' ')}</Td>
      <Td>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.latest_state ? <Chip state={row.latest_state}>{row.latest_state}</Chip> : null}
          {row.open_draft ? (
            <Link href={`/drafts/${row.open_draft}`}>
              <Chip state="draft">draft open</Chip>
            </Link>
          ) : null}
        </div>
      </Td>
      <Td right>
        <Mono>@{row.latest_ordinal}</Mono>
      </Td>
      <Td right className="text-sm text-muted">
        {relativeDate(row.updated_at)}
      </Td>
    </tr>
  );
}
