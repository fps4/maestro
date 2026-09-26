import Link from 'next/link';
import { fetchStandards } from '@/lib/api';
import { humanise } from '@/lib/labels';
import { Card, Chip, Empty, Eyebrow, Mono, Notice, PageTitle, Scroller, Td, Th } from '@/components/atoms';

export const dynamic = 'force-dynamic';

/**
 * The catalogue: standards, packs and constructs.
 *
 * **A standard is an artifact**, so it gets the artifact machinery — a lineage, immutable versions,
 * a publication gate an accountable human passes, a diff between 3.1.0 and 3.2.0, an export. None
 * of that is new code; it is the same engine the specifications run on with a different workspace
 * definition.
 *
 * **Ours carries full text and the know-how. External carries a citation and our reading.** They
 * are distinct types rather than one type with a flag, because the licence disposition differs and
 * so does what the body means — an auditor must know which they are reading, and a flag is settable.
 */
export default async function CataloguePage() {
  const standards = await fetchStandards();

  const ours = standards.filter((s) => s.authority === 'ours');
  const external = standards.filter((s) => s.authority === 'external');

  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>catalogue workspace · shared across tenants · read-only from here</Eyebrow>
        <PageTitle>Standards, packs and constructs</PageTitle>
        <p className="text-sm text-muted">
          The authoritative texts every tenant is governed against. Versioned, gated and diffed exactly like a
          specification — because they are the same kind of object.
        </p>
      </div>

      <Notice title="You are reading the catalogue through a read-only handle.">
        It holds no tenant data and cannot be written from a tenant session. A tenant artifact carries a{' '}
        <i>reference</i> to a standard at a version — never a link, because a link would cross the boundary
        the isolation model exists to hold.
      </Notice>

      {standards.length === 0 ? (
        <Empty title="The catalogue is empty in this deployment.">
          Standards are authored in the catalogue workspace, through the same drafts, versions and gates as
          anything else. Nothing here is seeded with real content: a fixture presented as a standard would be
          worse than an empty shelf.
        </Empty>
      ) : (
        <>
          <Section
            title="Ours"
            subtitle="the body is the standard, and it carries the know-how"
            rows={ours}
          />
          <Section
            title="External"
            subtitle="the body is our summary and our reading — check the licence before quoting"
            rows={external}
          />
        </>
      )}
    </>
  );
}

function Section({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Awaited<ReturnType<typeof fetchStandards>>;
}) {
  if (rows.length === 0) return null;
  return (
    <Card className="gap-3">
      <h2 className="text-sm font-semibold">
        {title} <span className="font-normal text-faint">— {subtitle}</span>
      </h2>
      <Scroller>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <Th>Standard</Th>
              <Th>Tier</Th>
              <Th>Pack</Th>
              <Th>In force</Th>
              <Th>Body</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((standard) => (
              <tr key={`${standard.artifact}@${standard.ordinal}`} className="hover:bg-surface-2">
                <Td>
                  <Link
                    href={`/catalogue/${standard.artifact}`}
                    className="font-mono text-xs font-semibold underline-offset-2 hover:underline"
                  >
                    {standard.standard_id}
                  </Link>
                  <span className="block text-2xs text-faint">{standard.title}</span>
                </Td>
                <Td className="text-sm text-muted">{standard.tier ?? '—'}</Td>
                <Td>
                  <Mono>
                    {standard.pack} {standard.pack_version}
                  </Mono>
                </Td>
                <Td>
                  <Chip
                    state={
                      standard.force === 'in_force' || standard.force === 'undated'
                        ? 'accepted'
                        : standard.force === 'pending'
                          ? 'proposed'
                          : 'expired'
                    }
                  >
                    {humanise(standard.force)}
                  </Chip>
                </Td>
                <Td className="text-2xs text-faint">
                  {standard.authority === 'ours'
                    ? 'full text'
                    : humanise(standard.licence_disposition ?? 'disposition not recorded')}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroller>
    </Card>
  );
}
