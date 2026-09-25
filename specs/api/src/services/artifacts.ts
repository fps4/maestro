/**
 * Drafts and versions — the editing loop and the record it produces.
 *
 *   open draft ──▶ edit (human or agent) ──▶ save (revision++) ──▶ propose ──▶ decide
 *        ▲                                                            │
 *        └──────────────── request_changes reopens a draft ───────────┘
 *
 * Domain rules meet persistence here, and nothing above this layer knows about DynamoDB. The rules
 * themselves live in `domain/` as pure functions; this file is what makes them true of stored data.
 */

import { digestOf } from '../domain/digest.js';
import type { Actor, Recorder } from '../db/outbox.js';
import { Conflict, withoutBody, type Transaction, type WorkspaceHandle } from '../db/handle.js';
import {
  versionPayloadKey,
  writePayload,
  type PayloadRef,
  type PayloadStore,
} from '../record/payload-store.js';
import { mintArtifactId, mintDraftId } from '../domain/ids.js';
import { confirmFacet, invalidateConfirmations } from '../domain/facets.js';
import { assertLinksDeclared, assertPinsUnchanged } from '../domain/links.js';
import { parseDuration, typeIn, initialPhase } from '../domain/workspace-definition.js';
import { composeDocument, parseDocument } from '../domain/document.js';
import { labelsFor } from '../domain/labels.js';
import { draftReadiness, type Readiness } from '../domain/readiness.js';
import { excerpt } from './render.js';
import { phaseAfterPropose } from '../domain/lifecycle.js';
import { assertRevision, nextState, proposeVersion, recordContribution } from '../domain/versioning.js';
import type {
  Artifact,
  Body,
  CatalogueRef,
  Classification,
  Draft,
  EffectiveWindow,
  Facets,
  Link,
  ProvenanceMap,
  Version,
} from '../domain/types.js';
import { isPrincipal } from '../domain/types.js';
import type { LoadedWorkspace } from './workspaces.js';

export class NotFound extends Error {
  constructor(what: string) {
    super(`${what} does not exist in this workspace.`);
    this.name = 'NotFound';
  }
}

export class Refused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Refused';
  }
}

export type { Actor } from '../db/outbox.js';

export interface CreateDraftInput {
  type: string;
  title: string;
  /** Absent for a new lineage; present when revising an existing artifact. */
  artifact?: string;
  facets?: Facets;
  provenance?: ProvenanceMap;
  body?: Body;
  links?: Link[];
  catalogue_refs?: CatalogueRef[];
  classification?: Classification;
  effective?: EffectiveWindow;
}

export interface SaveDraftInput {
  revision: number;
  title?: string;
  facets?: Facets;
  provenance?: ProvenanceMap;
  body?: Body;
  links?: Link[];
  catalogue_refs?: CatalogueRef[];
  classification?: Classification;
  effective?: EffectiveWindow;
}

/**
 * What `VersionProposed` carries as its payload (ADR-0020 §2): everything immutable about the
 * version. The mutable and derived fields — `state`, `decided_at`, `materiality`, `redacted_at`,
 * the pin a later acceptance freezes — are what the later events say; `workspace` is where the
 * rebuild puts it.
 */
export type VersionPayload = Omit<
  Version,
  'workspace' | 'state' | 'decided_at' | 'materiality' | 'redacted_at'
>;

export function versionPayloadOf(version: Version): VersionPayload {
  const {
    workspace: _workspace,
    state: _state,
    decided_at: _decided,
    materiality: _m,
    redacted_at: _r,
    ...rest
  } = version;
  return rest;
}

export class ArtifactService {
  /** `recorder` and `payloads` are per request; a read-only caller (a packet, a lineage) may omit them. */
  constructor(
    private readonly handle: WorkspaceHandle,
    private readonly workspace: LoadedWorkspace,
    private readonly recorder?: Recorder,
    private readonly payloads?: PayloadStore,
  ) {}

  private record(): Recorder {
    if (!this.recorder) throw new Error('This service was built without a recorder and cannot write.');
    return this.recorder;
  }

  /** Written before the transaction that names it; an orphan from a failed transaction is harmless. */
  private async payload(subject: { artifact: string; ordinal: number }, what: string, value: unknown) {
    if (!this.payloads) throw new Error('This service was built without a payload store and cannot write.');
    return writePayload(this.payloads, versionPayloadKey(this.handle.workspace, subject, what), value);
  }

  /** The one place a stale write becomes the caller's sentence. */
  private refuseConflict(error: unknown): never {
    if (error instanceof Conflict) throw new Refused(error.message);
    throw error;
  }

  private typeOrThrow(id: string) {
    const type = typeIn(this.workspace.definition, id);
    if (!type) {
      throw new Refused(
        `\`${id}\` is not a type in this workspace. Declared: ${this.workspace.definition.types.map((t) => t.id).join(', ')}.`,
      );
    }
    return type;
  }

  // --- drafts ---

  async createDraft(input: CreateDraftInput, actor: Actor): Promise<Draft> {
    const type = this.typeOrThrow(input.type);
    const now = new Date().toISOString();
    const links = input.links ?? [];
    assertLinksDeclared(links, type);

    let basedOn: number | undefined;
    if (input.artifact) {
      const artifact = await this.handle.artifacts.get(input.artifact);
      if (!artifact) throw new NotFound(`Artifact \`${input.artifact}\``);
      if (artifact.type !== input.type) {
        throw new Refused(
          `\`${input.artifact}\` is a \`${artifact.type}\`. A lineage does not change type — a different type is a different artifact.`,
        );
      }
      basedOn = artifact.latest_ordinal || undefined;
    }

    const draft: Draft = {
      id: mintDraftId(),
      workspace: this.handle.workspace,
      ...(input.artifact ? { artifact: input.artifact } : {}),
      type: input.type,
      title: input.title,
      revision: 1,
      facets: input.facets ?? {},
      provenance: input.provenance ?? {},
      body: input.body ?? { format: type.body_format, content: '' },
      attachments: [],
      links,
      ...(input.catalogue_refs ? { catalogue_refs: input.catalogue_refs } : {}),
      ...(input.classification ? { classification: input.classification } : {}),
      ...(input.effective ? { effective: input.effective } : {}),
      contributors: recordContribution([], actor.principal, actor.kind, now),
      ...(basedOn ? { based_on: basedOn } : {}),
      created_at: now,
      updated_at: now,
      ...(type.draft_expiry ? { expires_at: expiryFrom(type.draft_expiry) } : {}),
    };

    await this.handle.drafts.insert(draft);
    return draft;
  }

  async getDraft(id: string): Promise<Draft> {
    const draft = await this.handle.drafts.get(id);
    if (!draft) throw new NotFound(`Draft \`${id}\``);
    return draft;
  }

  /**
   * Save a draft.
   *
   * Saves are ordinary writes — autosave, partial facets, an empty body. A draft has no integrity
   * obligations because it is not a record. Two things are still enforced: the revision must be
   * current, and a confirmation cannot survive a change to the value it confirmed.
   */
  async saveDraft(id: string, input: SaveDraftInput, actor: Actor): Promise<Draft> {
    const draft = await this.getDraft(id);
    assertRevision(input.revision, draft.revision);

    const type = this.typeOrThrow(draft.type);
    const now = new Date().toISOString();

    const facets = input.facets ?? draft.facets;
    let provenance = input.provenance ?? draft.provenance;
    if (input.facets) provenance = invalidateConfirmations(draft.facets, facets, provenance);

    const links = input.links ?? draft.links;
    if (input.links) {
      assertLinksDeclared(links, type);
      // A pin frozen on the artifact's accepted version cannot be undone by editing a draft.
      assertPinsUnchanged(draft.links, links);
    }

    const update: Partial<Draft> = {
      revision: draft.revision + 1,
      facets,
      provenance,
      links,
      updated_at: now,
      contributors: recordContribution(draft.contributors, actor.principal, actor.kind, now),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body ? { body: input.body } : {}),
      ...(input.catalogue_refs ? { catalogue_refs: input.catalogue_refs } : {}),
      ...(input.classification ? { classification: input.classification } : {}),
      ...(input.effective ? { effective: input.effective } : {}),
      ...(type.draft_expiry ? { expires_at: expiryFrom(type.draft_expiry) } : {}),
    };

    // Conditioned on the revision, so two concurrent saves cannot both win: the loser's condition
    // no longer matches and it is refused with the current state rather than overwriting silently.
    const result = await this.handle.drafts.save(id, draft.revision, update);
    if (!result)
      throw new Refused('This draft changed while you were saving. Reload and apply your edit again.');
    return result;
  }

  /**
   * Save a draft as one document (ADR-0017).
   *
   * Front-matter and declared blocks become the facets; the rest is the body. Every facet the
   * document carries is re-marked with this actor's provenance — `declared` for a person,
   * `extracted` for an agent — and a facet the document no longer carries is dropped. A human's
   * earlier confirmation survives only where the value did, which `saveDraft` already enforces.
   */
  async saveDocument(
    id: string,
    input: { revision: number; document: string },
    actor: Actor,
  ): Promise<Draft> {
    const draft = await this.getDraft(id);
    const type = this.typeOrThrow(draft.type);
    const parsed = parseDocument(input.document, type);

    const at = new Date().toISOString();
    const provenance: ProvenanceMap = {};
    for (const field of Object.keys(parsed.facets)) {
      const previous = draft.provenance[field];
      const unchanged =
        previous && JSON.stringify(draft.facets[field]) === JSON.stringify(parsed.facets[field]);
      // An unchanged facet keeps its provenance, confirmation included; a changed one is this
      // actor's, and invalidateConfirmations in saveDraft would clear a stale confirmation anyway.
      provenance[field] = unchanged
        ? previous
        : { source: actor.kind === 'agent' ? 'extracted' : 'declared', by: actor.principal, at };
    }

    return this.saveDraft(
      id,
      {
        revision: input.revision,
        ...(parsed.envelope.title ? { title: parsed.envelope.title } : {}),
        facets: parsed.facets,
        provenance,
        body: parsed.body,
        ...(parsed.envelope.links ? { links: parsed.envelope.links } : {}),
        ...(parsed.envelope.classification ? { classification: parsed.envelope.classification } : {}),
        ...(parsed.envelope.catalogue_refs ? { catalogue_refs: parsed.envelope.catalogue_refs } : {}),
        ...(parsed.envelope.effective ? { effective: parsed.envelope.effective } : {}),
      },
      actor,
    );
  }

  /** A draft or version as one document: the envelope and facets as front-matter, then the body. */
  documentOf(
    record: Pick<
      Draft,
      'type' | 'title' | 'facets' | 'body' | 'classification' | 'links' | 'catalogue_refs' | 'effective'
    >,
  ): string {
    const type = this.typeOrThrow(record.type);
    return composeDocument(
      {
        title: record.title,
        facets: record.facets,
        body: record.body,
        ...(record.classification ? { classification: record.classification } : {}),
        ...(record.links ? { links: record.links } : {}),
        ...(record.catalogue_refs ? { catalogue_refs: record.catalogue_refs } : {}),
        ...(record.effective ? { effective: record.effective } : {}),
      },
      type,
    );
  }

  /** Confirm an agent's extraction. The one act that lets a facet reach a gate. */
  async confirmFacets(id: string, fields: string[], actor: Actor): Promise<Draft> {
    if (actor.kind !== 'human') {
      throw new Refused(
        'Only a human confirms a facet. An agent confirming its own extraction would make confirmation decorative.',
      );
    }
    const draft = await this.getDraft(id);
    const now = new Date().toISOString();
    let provenance = draft.provenance;
    for (const field of fields) provenance = confirmFacet(provenance, field, actor.principal, now);

    const result = await this.handle.drafts.save(id, draft.revision, {
      provenance,
      revision: draft.revision + 1,
      updated_at: now,
      contributors: recordContribution(draft.contributors, actor.principal, actor.kind, now),
    });
    if (!result) throw new Refused('This draft changed while you were confirming. Reload and try again.');
    return result;
  }

  /** What this draft still needs before it can be proposed, and what its gate will then ask. */
  async readiness(id: string): Promise<Readiness> {
    const draft = await this.getDraft(id);
    const type = this.typeOrThrow(draft.type);
    return draftReadiness({
      draft,
      type,
      schema: (this.workspace.facet_schemas[draft.type] ?? {}) as Parameters<
        typeof draftReadiness
      >[0]['schema'],
      issues: this.workspace.validator.check(draft.type, draft.facets),
      def: this.workspace.definition,
      labels: labelsFor(this.workspace.definition),
    });
  }

  async discardDraft(id: string): Promise<void> {
    await this.handle.drafts.delete(id);
  }

  async listDrafts(): Promise<Array<ReturnType<typeof withoutBody<Draft>>>> {
    return this.handle.drafts.list();
  }

  // --- propose ---

  /**
   * Snapshot a draft into an immutable version.
   *
   * Everything here happens in one transaction with the outbox emission, so the stored state and
   * the emitted stream cannot disagree. A divergence between them is the alertable condition that
   * compensates for the store having no check constraints.
   */
  async propose(draftId: string, actor: Actor, bodyCeilingBytes: number): Promise<Version> {
    const draft = await this.getDraft(draftId);
    const type = this.typeOrThrow(draft.type);

    // Facets must satisfy the schema to become a record. A draft may be invalid; a proposal may not.
    this.workspace.validator.assert(draft.type, draft.facets);
    assertLinksDeclared(draft.links, type);

    const artifactId = draft.artifact ?? mintArtifactId();
    const now = new Date().toISOString();

    // The ordinal is read before the transaction so the payload can be written before it
    // (ADR-0020 §1); the version's key is (artifact, ordinal) and the artifact's update is
    // conditioned on the ordinal read, so a race is a refusal rather than a second @n.
    const seen = draft.artifact ? await this.handle.artifacts.get(artifactId) : null;
    if (draft.artifact && !seen) throw new NotFound(`Artifact \`${artifactId}\``);

    const ordinal = (seen?.latest_ordinal ?? 0) + 1;
    const version = proposeVersion({
      draft: { ...draft, artifact: artifactId },
      ordinal,
      ...(seen?.accepted_ordinal ? { supersedes: seen.accepted_ordinal } : {}),
      definition_version: this.workspace.definition.definition_version,
      proposed_by: actor.principal,
      at: now,
      body_ceiling_bytes: bodyCeilingBytes,
      classification_required: type.classification_required,
    });
    const payload = await this.payload(version, 'version.json', versionPayloadOf(version));

    const moved = `\`${artifactId}\` moved on while this draft was being proposed. Propose it again.`;
    return this.handle
      .transaction(async (tx) => {
        const artifact = draft.artifact ? await this.handle.artifacts.get(artifactId) : null;
        if (draft.artifact && !artifact) throw new NotFound(`Artifact \`${artifactId}\``);
        if ((artifact?.latest_ordinal ?? 0) + 1 !== ordinal) throw new Refused(moved);

        await this.handle.versions.insert(version, tx);

        const phase = artifact
          ? (phaseAfterPropose(this.workspace.definition, artifact.phase) ?? artifact.phase)
          : initialPhase(this.workspace.definition);

        if (artifact) {
          await this.handle.artifacts.update(
            artifactId,
            { latest_ordinal: ordinal, phase, title: version.title, updated_at: now },
            tx,
            { expectLatest: artifact.latest_ordinal, onConflict: moved },
          );
        } else {
          await this.handle.artifacts.insert(
            {
              id: artifactId,
              workspace: this.handle.workspace,
              type: draft.type,
              title: version.title,
              phase,
              latest_ordinal: ordinal,
              created_at: now,
              updated_at: now,
            },
            tx,
          );
        }

        // The draft is consumed by the proposal. Keeping it would leave two live representations
        // of the same intent, and the whole point of the split is that only one of them is a record.
        await this.handle.drafts.delete(draftId, tx);

        await this.emitVersionProposed(tx, version, payload);
        return version;
      })
      .catch((error) => this.refuseConflict(error));
  }

  /**
   * Withdraw a proposed version — the proposer's act, before any decision.
   *
   * The git-native path re-proposes on every push, and a lineage with three versions all awaiting
   * the same decision is three decisions nobody wants to take. Withdrawing the earlier one keeps
   * one live proposal per lineage. The withdrawn version stays in the record: it was proposed, and
   * that it was taken back is a fact too.
   */
  async withdraw(artifactId: string, ordinal: number, actor: Actor, reason?: string): Promise<Version> {
    const version = await this.getVersion(artifactId, ordinal);
    if (!isPrincipal({ id: actor.principal, supersedes: actor.supersedes }, version.proposed_by)) {
      throw new Refused(
        `Only the proposer withdraws a version. \`${artifactId}@${ordinal}\` was proposed by \`${version.proposed_by}\`.`,
      );
    }
    const state = nextState(version.state, { kind: 'withdraw', by: actor.principal });
    const now = new Date().toISOString();
    // The reason is prose: the record carries its digest (ADR-0019 §4) and the payload store the
    // text (ADR-0020 §2). A withdrawal without a reason has no payload.
    const payload = reason
      ? await this.payload({ artifact: artifactId, ordinal }, 'withdrawal.json', { reason })
      : undefined;
    return this.handle
      .transaction(async (tx) => {
        await this.handle.versions.update(artifactId, ordinal, { state, decided_at: now }, tx, {
          expectState: 'proposed',
        });
        await this.record().emit(tx, [
          {
            type: 'VersionWithdrawn',
            subject: { artifact: artifactId, ordinal },
            artifact_type: version.type,
            seat: 'author',
            body: reason ? { reason_digest: digestOf(reason) } : {},
            occurred_at: now,
            ...(payload ? { payload } : {}),
          },
        ]);
        return { ...version, state, decided_at: now };
      })
      .catch((error) => this.refuseConflict(error));
  }

  /** The versions of a lineage still awaiting a decision. */
  async proposedVersions(artifactId: string): Promise<Array<ReturnType<typeof withoutBody<Version>>>> {
    return this.handle.versions.ofArtifactInState(artifactId, 'proposed');
  }

  private async emitVersionProposed(tx: Transaction, version: Version, payload: PayloadRef) {
    await this.record().emit(tx, [
      {
        type: 'VersionProposed',
        subject: { artifact: version.artifact, ordinal: version.ordinal },
        artifact_type: version.type,
        seat: 'author',
        // `digest` stays the subject digest a decision cites; the payload holds more than the
        // subject, so its own digest differs (ADR-0020 §2).
        body: {
          type: version.type,
          digest: version.digest,
          definition_version: version.definition_version,
          contributors: version.contributors.map((c) => c.principal),
        },
        occurred_at: version.proposed_at,
        payload,
      },
    ]);
  }

  // --- reads ---

  async getArtifact(id: string): Promise<Artifact> {
    const artifact = await this.handle.artifacts.get(id);
    if (!artifact) throw new NotFound(`Artifact \`${id}\``);
    return artifact;
  }

  async getVersion(artifact: string, ordinal: number): Promise<Version> {
    const version = await this.handle.versions.get(artifact, ordinal);
    if (!version) throw new NotFound(`Version \`${artifact}@${ordinal}\``);
    return version;
  }

  async listVersions(artifact: string): Promise<Array<ReturnType<typeof withoutBody<Version>>>> {
    return this.handle.versions.ofArtifact(artifact);
  }

  async acceptedVersion(artifact: string): Promise<Version | null> {
    return this.handle.versions.accepted(artifact);
  }

  /** Accepted ordinals for a set of artifacts, for resolving links in one round trip. */
  async acceptedOrdinals(artifacts: string[]): Promise<Map<string, number>> {
    return this.handle.artifacts.acceptedOrdinals(artifacts);
  }

  /**
   * The register: everything in flight, with the lifecycle phase it sits in.
   *
   * A superseded version never appears — the register lists lineages, and version history belongs
   * to the artifact. Bodies are projected out, because inline bodies make the wrong query expensive.
   */
  async register(): Promise<
    Array<Artifact & { latest_state?: Version['state']; latest_digest?: string; open_draft?: string }>
  > {
    const artifacts = await this.handle.artifacts.list();
    if (artifacts.length === 0) return [];

    // The artifact names its latest ordinal, so the latest versions are one batched read by key.
    const latest = await this.handle.versions.getMany(
      artifacts.map((a) => ({ artifact: a.id, ordinal: a.latest_ordinal })),
    );
    const latestByArtifact = new Map(latest.map((v) => [v.artifact, v]));

    const openDrafts = await this.handle.drafts.openOn(artifacts.map((a) => a.id));
    const draftByArtifact = new Map(openDrafts.map((d) => [d.artifact, d.id]));

    return artifacts.map((artifact) => {
      const version = latestByArtifact.get(artifact.id);
      const draft = draftByArtifact.get(artifact.id);
      return {
        ...artifact,
        ...(version ? { latest_state: version.state, latest_digest: version.digest } : {}),
        ...(draft ? { open_draft: draft } : {}),
      };
    });
  }

  /**
   * Search titles and bodies, within this workspace only (ADR-0021 §5).
   *
   * A filtered read over the workspace's versions: every term must appear in the title or the
   * body, case-insensitively, and a hit in the title outweighs one in the body. Bounded by the
   * workspace by construction — the read is the workspace's own partition — rather than by a
   * filter someone might forget. Adequate for the MVP; a search service is a later decision.
   */
  async search(
    query: string,
    limit = 25,
  ): Promise<Array<ReturnType<typeof withoutBody<Version>> & { score: number; excerpt: string }>> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (terms.length === 0) return [];
    const hits: Array<ReturnType<typeof withoutBody<Version>> & { score: number; excerpt: string }> = [];
    for (const version of await this.handle.versions.all()) {
      const title = version.title.toLowerCase();
      const body = version.body.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        const inTitle = title.includes(term);
        const inBody = body.includes(term);
        if (!inTitle && !inBody) {
          score = 0;
          break;
        }
        score += (inTitle ? 10 : 0) + (inBody ? 1 : 0);
      }
      if (score > 0) hits.push({ ...withoutBody(version), score, excerpt: excerpt(version.body) });
    }
    return hits
      .sort((a, b) => b.score - a.score || b.proposed_at.localeCompare(a.proposed_at))
      .slice(0, limit);
  }
}

/** A draft's expiry, to the second: the table's TTL keeps seconds, and a round trip must be lossless. */
function expiryFrom(duration: string): string {
  const at = Date.now() + parseDuration(duration);
  return new Date(Math.floor(at / 1000) * 1000).toISOString();
}
