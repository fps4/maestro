import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchAcceptances, fetchArtifact, fetchDefinition, fetchDrafts } from '@/lib/api';
import {
  Button,
  Card,
  Chip,
  Eyebrow,
  Mono,
  Notice,
  OpenEdit,
  PageTitle,
  Provenance,
  Sealed,
  SectionTitle,
  relativeDate,
  shortDigest,
} from '@/components/atoms';
import type { Acceptance, Version } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * One artifact: the version ledger, the links, the facets, and the standards in force.
 *
 * Versions are a **ledger**, not cards — solid left rule, monospace ordinal, digest visible, and
 * nothing on the row that can be edited because nothing about it can change. The open draft sits
 * below the ledger with a dashed rule and one control: adjacent to the record, and visibly not part
 * of it.
 */
export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let data;
  try {
    data = await fetchArtifact(id);
  } catch {
    notFound();
  }
  const { artifact, versions, decisions } = data;

  const [drafts, acceptances, definition] = await Promise.all([
    fetchDrafts().catch(() => []),
    fetchAcceptances().catch((): Acceptance[] => []),
    fetchDefinition().catch(() => null),
  ]);

  const openDraft = drafts.find((d) => d.artifact === artifact.id);
  const latest = versions[0];
  const accepted = versions.find((v) => v.state === 'accepted');
  const subject = accepted ?? latest;
  const type = definition?.definition.types.find((t) => t.id === artifact.type);
  const gate = definition?.definition.gates.find((g) => g.decides_on === artifact.type);
  const pinnedLinkType = type?.links.find((l) => l.pinned)?.id;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Eyebrow>{artifact.type.replace(/_/g, ' ')} · lineage</Eyebrow>
          <PageTitle>{artifact.title}</PageTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Mono>{artifact.id}</Mono>
            <span className="text-faint">·</span>
            <span>
              phase <b>{artifact.phase.replace(/_/g, ' ')}</b>
            </span>
            {subject ? (
              <>
                <span className="text-faint">·</span>
                <span>
                  written under definition <Mono>v{subject.definition_version}</Mono>
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href={`/artifacts/${artifact.id}/lineage`} size="sm">
            Lineage
          </Button>
          {versions.length > 1 ? (
            <Button
              href={`/artifacts/${artifact.id}/diff?from=${versions[1]!.ordinal}&to=${versions[0]!.ordinal}`}
              size="sm"
            >
              Diff @{versions[1]!.ordinal} → @{versions[0]!.ordinal}
            </Button>
          ) : null}
          {gate && latest?.state === 'proposed' ? (
            <Button href={`/gates/${gate.id}/${artifact.id}/${latest.ordinal}`} variant="primary" size="sm">
              Open the {gate.title ?? gate.id} gate
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.75fr),minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <SectionTitle>Versions</SectionTitle>
          <div className="flex flex-col">
            {versions.map((version) => (
              <VersionRow
                key={version.ordinal}
                version={version}
                artifact={artifact.id}
                current={version.ordinal === subject?.ordinal}
                decision={decisions.find((d) => d.ordinal === version.ordinal)}
              />
            ))}
          </div>

          {openDraft ? (
            <OpenEdit className="rounded-md border border-rule bg-surface p-4 !border-l-accent">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Chip state="draft">draft · rev {openDraft.revision}</Chip>
                    {openDraft.based_on ? (
                      <span className="text-2xs text-faint">based on @{openDraft.based_on}</span>
                    ) : null}
                  </div>
                  <span className="text-2xs text-muted">
                    Open since {relativeDate(openDraft.created_at)}
                    {openDraft.expires_at
                      ? ` · expires ${new Date(openDraft.expires_at).toLocaleDateString('en-GB')} if untouched`
                      : ''}
                  </span>
                </div>
                <Button href={`/drafts/${openDraft.id}`} size="sm">
                  Resume editing
                </Button>
              </div>
            </OpenEdit>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {subject ? <LinksCard version={subject} pinnedLinkType={pinnedLinkType} /> : null}
          {subject ? <FacetsCard version={subject} /> : null}
          {subject ? <StandardsCard version={subject} acceptances={acceptances} /> : null}
          {subject?.classification ? (
            <Card flat>
              <SectionTitle>Classification</SectionTitle>
              <p className="m-0 text-2xs text-muted">
                Validated at propose. Lawful basis <Mono>{subject.classification.lawful_basis}</Mono>,
                retention <Mono>{subject.classification.retention}</Mono>
                {subject.classification.personal_data ? ', personal data in scope' : ', no personal data'}.
                Erasure is redaction in place, recorded.
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function VersionRow({
  version,
  artifact,
  current,
  decision,
}: {
  version: Version;
  artifact: string;
  current: boolean;
  decision?: { outcome: string; reasoning?: string; decided_by: string };
}) {
  return (
    <Sealed
      className={`grid grid-cols-[54px,1fr,auto] items-baseline gap-3 border-b border-rule py-2.5 last:border-b-0 ${
        current ? 'bg-surface-2' : ''
      }`}
    >
      <span className="font-mono text-sm font-semibold tabular">@{version.ordinal}</span>
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip state={version.state}>{version.state}</Chip>
          <span className="font-mono text-2xs text-faint">{shortDigest(version.digest)}</span>
        </div>
        <span className="text-2xs text-muted">
          proposed by <Mono>{version.proposed_by}</Mono>
          {version.contributors.length > 1
            ? ` · contributors ${version.contributors.map((c) => c.principal).join(', ')}`
            : ''}
        </span>
        {decision?.reasoning ? (
          <span className="text-2xs text-faint">
            {decision.outcome} — &ldquo;{decision.reasoning}&rdquo;
          </span>
        ) : null}
        <Link
          href={`/artifacts/${artifact}/versions/${version.ordinal}`}
          className="w-fit text-2xs text-faint underline-offset-2 hover:text-ink hover:underline"
        >
          Read this version
        </Link>
      </div>
      <span className="whitespace-nowrap text-2xs text-faint">{relativeDate(version.proposed_at)}</span>
    </Sealed>
  );
}

function LinksCard({ version, pinnedLinkType }: { version: Version; pinnedLinkType?: string }) {
  if (version.links.length === 0) {
    return (
      <Card>
        <SectionTitle>Links</SectionTitle>
        <p className="m-0 text-2xs text-faint">This type declares no links.</p>
      </Card>
    );
  }
  return (
    <Card>
      <SectionTitle>Links</SectionTitle>
      <div className="flex flex-col gap-2.5">
        {version.links.map((link) => {
          const pinned = link.type === pinnedLinkType;
          return (
            <div key={`${link.type}-${link.target}`} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-2xs uppercase tracking-[0.05em] text-faint">
                  {link.type} →
                </span>
                {pinned ? <Chip state="pin">pinned</Chip> : null}
              </div>
              <Link href={`/artifacts/${link.target}`} className="text-sm underline-offset-2 hover:underline">
                <Mono>
                  {link.target}
                  {link.pinned_to != null ? `@${link.pinned_to}` : ''}
                </Mono>
              </Link>
              <span className="text-2xs text-faint">
                {link.pinned_to != null
                  ? 'Frozen at acceptance. It reads against this version however often the target is superseded.'
                  : 'Follows the lineage — always the latest accepted version.'}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FacetsCard({ version }: { version: Version }) {
  const entries = Object.entries(version.facets);
  if (entries.length === 0) return null;
  return (
    <Card>
      <SectionTitle>Facets at @{version.ordinal}</SectionTitle>
      <div className="flex flex-col gap-2">
        {entries.map(([field, value]) => {
          const provenance = version.provenance[field];
          return (
            <div key={field} className="flex flex-col gap-0.5">
              <span className="font-mono text-2xs uppercase tracking-[0.05em] text-faint">{field}</span>
              <span className="text-xs">{summarise(value)}</span>
              {provenance ? (
                <Provenance
                  source={provenance.source}
                  confirmed={Boolean(provenance.confirmed_by)}
                  by={provenance.confirmed_by ?? provenance.by}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function StandardsCard({ version, acceptances }: { version: Version; acceptances: Acceptance[] }) {
  const refs = version.catalogue_refs ?? [];
  if (refs.length === 0) return null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <SectionTitle>Standards in force at @{version.ordinal}</SectionTitle>
        <span className="font-mono text-2xs text-faint">
          {refs[0]!.pack} {refs[0]!.pack_version}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {refs.map((ref) => {
          const acceptance = acceptances.find((a) => a.standard === ref.standard);
          const status = !acceptance ? 'absent' : acceptance.status;
          return (
            <div key={ref.standard} className="flex items-start gap-2">
              <Chip state={status === 'active' ? 'accepted' : status === 'lapsed' ? 'expired' : 'neutral'}>
                {status === 'active' ? 'accepted' : status === 'lapsed' ? 'unsupported' : 'not accepted'}
              </Chip>
              <div className="flex flex-col">
                <span className="font-mono text-2xs">{ref.standard}</span>
                <span className="text-2xs text-faint">
                  {status === 'lapsed'
                    ? `the tenant's acceptance lapsed after pack ${acceptance?.pack_version}`
                    : status === 'active'
                      ? `accepted by ${acceptance?.accepted_by}`
                      : 'no acceptance recorded in this workspace'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <Notice>
        Verdicts are recorded against this version&rsquo;s digest. This service computes none of them — read{' '}
        <Link href="/standards" className="underline">
          the binding
        </Link>{' '}
        for who accepted each.
      </Notice>
    </Card>
  );
}

function summarise(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? '…' : String(v)}`)
    .join(', ');
}
