import { fetchDefinition } from '@/lib/api';
import { Card, Chip, Eyebrow, KeyValue, Mono, Notice, PageTitle, Scroller, Td, Th } from '@/components/atoms';

export const dynamic = 'force-dynamic';

/**
 * The workspace definition, read-only.
 *
 * **Configuration is a screen, not a file.** The types, gates and lifecycle *are* the domain model,
 * and they are data — showing them is what makes that claim checkable rather than a sentence in an
 * ADR.
 *
 * **A declared omission is rendered.** A gate with no separation of duties says so, because the
 * whole reason it is declared per gate is that the exemption should be visible rather than assumed.
 */
export default async function DefinitionPage() {
  const { definition, record } = await fetchDefinition();

  return (
    <>
      <div className="flex flex-col gap-1">
        <Eyebrow>read-only · the service ships none of this</Eyebrow>
        <PageTitle>Workspace definition</PageTitle>
        <p className="text-sm text-muted">
          <Mono>definition_version {definition.definition_version}</Mono> · {record.kind} workspace ·{' '}
          {definition.types.length} types, {definition.gates.length} gates
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold">Artifact types</h2>
          <Scroller>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Body</Th>
                  <Th>Links</Th>
                </tr>
              </thead>
              <tbody>
                {definition.types.map((type) => (
                  <tr key={type.id}>
                    <Td>
                      <Mono className="font-semibold">{type.id}</Mono>
                      <span className="block text-2xs text-faint">
                        {[
                          type.classification_required ? 'classified at propose' : null,
                          type.effective_dating ? 'effective-dated' : null,
                          type.catalogue_refs ? 'may reference standards' : null,
                          type.draft_expiry ? `drafts expire ${type.draft_expiry}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                    </Td>
                    <Td className="text-sm text-muted">
                      <Mono>{type.body_format}</Mono>
                    </Td>
                    <Td className="text-2xs">
                      {type.links.length === 0 ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {type.links.map((link) => (
                            <span key={link.id} className="flex items-center gap-1.5">
                              <Mono>
                                {link.id} → {link.to}
                              </Mono>
                              {link.pinned ? <Chip state="pin">pinned</Chip> : null}
                            </span>
                          ))}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>

          <h2 className="text-sm font-semibold">Lifecycle</h2>
          <Card flat className="gap-1">
            {definition.lifecycle.transitions.map((t, i) => (
              <span key={i} className="font-mono text-xs">
                {t.from} → {t.to}{' '}
                <span className="text-faint">
                  {t.via_gate ? `via_gate: ${t.via_gate}${t.on ? ` on ${t.on}` : ''}` : `via: ${t.via}`}
                </span>
              </span>
            ))}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold">Gates</h2>
          {definition.gates.map((gate) => (
            <Card key={gate.id} className="gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Mono className="text-sm font-semibold">{gate.id}</Mono>
                <span className="text-2xs text-faint">
                  decides on <Mono>{gate.decides_on}</Mono>
                </span>
              </div>
              <KeyValue
                rows={[
                  ['owner', <Mono key="o">{Object.values(gate.owner).join(': ')}</Mono>],
                  ['outcomes', <Mono key="out">{gate.outcomes.join(' · ')}</Mono>],
                  [
                    'requires',
                    <Mono key="r">
                      {[
                        gate.requires.confirmed_facets ? 'confirmed_facets' : null,
                        ...gate.requires.evaluations,
                        gate.requires.catalogue_acceptances ? 'catalogue_acceptances' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'nothing'}
                    </Mono>,
                  ],
                  [
                    'sod',
                    gate.separation_of_duties ? (
                      <Mono key="s">{gate.separation_of_duties}</Mono>
                    ) : (
                      <span key="s" className="text-faint">
                        not declared — the exemption is visible, not assumed
                      </span>
                    ),
                  ],
                  ...(gate.records_materiality
                    ? ([['materiality', <span key="m">classified on every decision</span>]] as Array<
                        [React.ReactNode, React.ReactNode]
                      >)
                    : []),
                ]}
              />
            </Card>
          ))}

          <Notice tone="ok" title="Every type above cost a definition, not a release.">
            Nothing in the service knows what a business case, a sponsor or a Wkb acceptance is. Adding a
            sixth artifact class is a change to this data.
          </Notice>

          <Notice title="Changes are additive against accepted versions.">
            A version written under an earlier definition stays readable under it. A breaking facet change
            creates a new type rather than a new version of one, and removing a type is refused because the
            versions written under it cannot be migrated.
          </Notice>
        </div>
      </div>
    </>
  );
}
