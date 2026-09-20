/**
 * The workspace definition — the whole domain model, as data (ADR-0001).
 *
 * Declarations describe STRUCTURE and CONSTRAINTS, never behaviour. There are no expressions, no
 * conditionals and no hooks: where judgement is needed a definition declares a required evaluation,
 * an evaluator answers through the port, and the service records the verdict.
 *
 * This file is the only place that knows what a definition may say. It knows nothing about what any
 * particular definition does say — no `business_case`, no `sponsor`, no `explore`.
 */

import { z } from 'zod';

/** Durations as `90d`, `12h`, `30m`. Parsed once, here, so no caller invents a second syntax. */
const durationPattern = /^(\d+)(m|h|d|w)$/;

export function parseDuration(value: string): number {
  const m = durationPattern.exec(value);
  if (!m) throw new Error(`Not a duration: ${value} (expected e.g. 90d, 12h, 30m)`);
  const n = Number(m[1]);
  switch (m[2]) {
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    case 'w':
      return n * 604_800_000;
    default:
      throw new Error(`Not a duration: ${value}`);
  }
}

const sizePattern = /^(\d+)(B|KB|MB|GB)$/i;

export function parseSize(value: string): number {
  const m = sizePattern.exec(value);
  if (!m) throw new Error(`Not a size: ${value} (expected e.g. 25MB)`);
  const n = Number(m[1]);
  const unit = (m[2] ?? 'B').toUpperCase();
  const factor = unit === 'GB' ? 1 << 30 : unit === 'MB' ? 1 << 20 : unit === 'KB' ? 1 << 10 : 1;
  return n * factor;
}

const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'must be lower snake_case');

/** How much a thing matters if wrong. Carried on every event; read by the regulated branch. */
const consequenceClass = z.string().regex(/^c[0-9]$/, 'must be c0–c9');

const linkDeclaration = z.object({
  id: identifier,
  to: identifier,
  /**
   * At most one link per type may be pinned (§2.6). A pinned link resolves to a specific version at
   * acceptance and freezes; everything else points at a lineage and follows it.
   */
  pinned: z.boolean().default(false),
  /** What a reader sees for this edge — "Justified by", not `justified_by`. */
  label: z.string().optional(),
  description: z.string().optional(),
});

const attachmentPolicy = z.object({
  max_size: z.string().default('25MB'),
  media_types: z.array(z.string()).default(['image/png', 'image/jpeg', 'application/pdf']),
});

const typeDeclaration = z.object({
  id: identifier,
  title: z.string().optional(),
  /** One plain-language line: what an artifact of this type is *for*. Shown wherever the type is named. */
  description: z.string().optional(),
  facet_schema: z.string(),
  body_format: z.enum(['markdown/v1', 'text/v1']).default('markdown/v1'),
  attachments: attachmentPolicy.optional(),
  draft_expiry: z.string().optional(),
  /**
   * Effective dating is opt-in per type, and it is the one thing a catalogue type needs that a
   * tenant artifact does not. A business case is accepted or it is not; a standard is accepted AND
   * in force between two dates, and can lapse with no successor (ADR-0010).
   */
  effective_dating: z.boolean().default(false),
  /**
   * A version carrying personal data must be classified at propose, with the vocabulary read from
   * configuration. An unclassified write is not merely unclassified — it is unclassifiable, and
   * cannot be given a retention rule or a lawful basis afterwards.
   */
  classification_required: z.boolean().default(false),
  /** Whether artifacts of this type may reference standards in the catalogue workspace. */
  catalogue_refs: z.boolean().default(false),
  /** Overrides the workspace's consequence class for artifacts of this type. */
  consequence_class: consequenceClass.optional(),
  links: z.array(linkDeclaration).default([]),
  /**
   * Typed blocks: a part of the body that is also a facet (ADR-0017). "The table under the
   * heading *Acceptance criteria* is the facet `acceptance_criteria`." The block stays prose to a
   * reader and becomes structure to a gate; the same bytes are both, so they cannot drift.
   */
  body_blocks: z
    .array(
      z.object({
        facet: identifier,
        heading: z.string().min(1),
        shape: z.enum(['table']).default('table'),
      }),
    )
    .default([]),
});

export type TypeDeclaration = z.infer<typeof typeDeclaration>;

const ownerResolver = z.discriminatedUnion('resolver', [
  z.object({ resolver: z.literal('role'), role: z.string() }),
  z.object({ resolver: z.literal('routing_table'), table: z.string(), key: z.string() }),
  z.object({ resolver: z.literal('assignment') }),
]);

export type OwnerResolver = z.infer<typeof ownerResolver>;

const gateDeclaration = z.object({
  id: identifier,
  title: z.string().optional(),
  /** One plain-language line: what a decider at this gate is being asked. */
  description: z.string().optional(),
  decides_on: identifier,
  owner: ownerResolver,
  outcomes: z.array(identifier).min(1),
  /**
   * What each outcome is called on the button a person presses. The outcome id is what the record
   * carries; the label is what the person read. `request_changes` and "Ask for changes" are the same
   * outcome, and only one of them belongs on a screen.
   */
  outcome_labels: z.record(z.string()).default({}),
  /**
   * Which outcome accepts the version. Resolved by `acceptingOutcome()`: declared here, or
   * `approve` / `accept` when the gate lists one of those. A gate whose outcomes are `publish`,
   * `request_changes`, `withdraw` must say `accepts_on: publish`, because the alternative is the
   * service knowing what "publish" means — the vocabulary leak ADR-0001 exists to prevent.
   */
  accepts_on: identifier.optional(),
  /** Which outcome, if any, reopens a draft carrying the reviewer's reasoning. */
  reopens_on: identifier.optional(),
  blocking: z.boolean().default(true),
  requires: z
    .object({
      confirmed_facets: z.boolean().default(false),
      evaluations: z.array(identifier).default([]),
      /**
       * Refuse to open while a referenced standard's acceptance has lapsed. Declared per gate
       * because a lapse that blocks release legitimately does not block an early gate.
       */
      catalogue_acceptances: z.boolean().default(false),
      /**
       * Hold the gate shut while a question on the version is unanswered. Declared per gate: a
       * release gate may reasonably refuse to open over an open question; an early exploration gate
       * may reasonably not. Undeclared, open questions are shown and never block.
       */
      questions_resolved: z.boolean().default(false),
    })
    .default({}),
  /**
   * Declared per gate because a small organisation legitimately cannot honour it — in which case
   * the exemption is visible rather than assumed.
   */
  separation_of_duties: z.enum(['exclude_creator', 'exclude_proposer']).optional(),
  attribution_profile: identifier.default('default'),
  /**
   * A publication gate classifies its own change as material or not, and a material one lapses
   * every acceptance resting on the previous version (ADR-0010).
   */
  records_materiality: z.boolean().default(false),
});

export type GateDeclaration = z.infer<typeof gateDeclaration>;

const transition = z
  .object({
    from: identifier,
    to: identifier,
    via: z.enum(['propose', 'system']).optional(),
    via_gate: identifier.optional(),
    on: identifier.optional(),
  })
  .refine((t) => Boolean(t.via) !== Boolean(t.via_gate), {
    message: 'a transition is authorised by exactly one of `via` or `via_gate`',
  });

export type Transition = z.infer<typeof transition>;

const lifecycle = z.object({
  phases: z.array(identifier).min(1),
  /** What each phase is called to a reader — "Exploring", not `explore`. */
  phase_labels: z.record(z.string()).default({}),
  initial: identifier.optional(),
  transitions: z.array(transition),
});

/**
 * A seat is the role an act is authorised under, and its oversight level is what the record
 * carries for that act (ADR-0019). `decider` is O0: a human only, always (ADR-0005). The defaults
 * are the four roles the service knows; a definition may lower a level, never admit an agent to
 * `decider`.
 */
export const OVERSIGHT_LEVELS = ['O0', 'O1', 'O2', 'O3', 'O4'] as const;
export const SEATS = ['author', 'reviewer', 'decider', 'workspace_admin', 'auditor'] as const;
export type Seat = (typeof SEATS)[number];

const seatDeclaration = z.object({ oversight_level: z.enum(OVERSIGHT_LEVELS) });

const DEFAULT_SEATS: Record<Seat, z.infer<typeof seatDeclaration>> = {
  author: { oversight_level: 'O1' },
  reviewer: { oversight_level: 'O1' },
  decider: { oversight_level: 'O0' },
  workspace_admin: { oversight_level: 'O0' },
  auditor: { oversight_level: 'O0' },
};

const seats = z
  .object({
    author: seatDeclaration.default(DEFAULT_SEATS.author),
    reviewer: seatDeclaration.default(DEFAULT_SEATS.reviewer),
    decider: seatDeclaration.default(DEFAULT_SEATS.decider),
    workspace_admin: seatDeclaration.default(DEFAULT_SEATS.workspace_admin),
    auditor: seatDeclaration.default(DEFAULT_SEATS.auditor),
  })
  .default(DEFAULT_SEATS);

const attributionRule = z.object({
  must_resolve_to: z.literal('principal'),
  kind: z.enum(['human', 'agent', 'service']).optional(),
});

const attributionProfile = z.object({
  id: identifier,
  required: z.array(identifier).min(1),
  rules: z.record(attributionRule).default({}),
  optional: z.array(identifier).default([]),
  /** What each attribution field is called on a form — "Oversight level", not `oversight_level`. */
  field_labels: z.record(z.string()).default({}),
});

export type AttributionProfile = z.infer<typeof attributionProfile>;

/**
 * An evaluator is an endpoint the service calls with a version's facets, or one of the built-ins
 * the service carries as the port's local default (ADR-0015). `facet_schema` reports each required
 * facet of the type's schema as a finding — the floor of sufficiency, and the reason a gate can
 * open on a deployment with no standards engine behind it.
 */
const evaluatorDeclaration = z
  .object({
    id: identifier,
    /** `${VAR}` segments resolve from the environment at call time; unresolved means unavailable. */
    endpoint: z.string().optional(),
    builtin: z.enum(['facet_schema']).optional(),
    reads: z.literal('facets').default('facets'),
    timeout_ms: z.number().int().positive().default(10_000),
  })
  .refine((e) => Boolean(e.endpoint) !== Boolean(e.builtin), {
    message: 'an evaluator is either an `endpoint` or a `builtin`, not both and not neither',
  });

export type EvaluatorDeclaration = z.infer<typeof evaluatorDeclaration>;

export const workspaceDefinitionSchema = z
  .object({
    workspace: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/, 'must be lower kebab-case'),
    definition_version: z.number().int().positive(),
    title: z.string().optional(),
    /**
     * A catalogue workspace holds standards, packs and constructs and is readable — never writable
     * — from a tenant session. A tenant workspace holds a tenant's own chain of record and is
     * reachable from nowhere else at all (ADR-0008).
     */
    kind: z.enum(['tenant', 'catalogue']).default('tenant'),
    /** Every event about a version carries its type's class, or this one (ADR-0019). */
    consequence_class: consequenceClass,
    seats,
    types: z.array(typeDeclaration).min(1),
    attribution_profiles: z.array(attributionProfile).min(1),
    gates: z.array(gateDeclaration).default([]),
    lifecycle,
    evaluators: z.array(evaluatorDeclaration).default([]),
  })
  .superRefine((def, ctx) => {
    const typeIds = new Set(def.types.map((t) => t.id));
    const phaseIds = new Set(def.lifecycle.phases);
    const gateIds = new Set(def.gates.map((g) => g.id));
    const profileIds = new Set(def.attribution_profiles.map((p) => p.id));
    const evaluatorIds = new Set(def.evaluators.map((e) => e.id));

    const fail = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    // The decider seat is a human's, always. A definition that says otherwise is refused here so
    // the rule is a property of the configuration rather than a check somebody could skip.
    if (def.seats.decider.oversight_level !== 'O0') {
      fail(
        ['seats', 'decider', 'oversight_level'],
        'the decider seat is O0: only a named human decides (ADR-0005)',
      );
    }

    def.types.forEach((type, i) => {
      // At most one pinned link per type. Two frozen references would make "the version that
      // justified this" ambiguous, which is the whole property the pin exists to provide.
      const pinned = type.links.filter((l) => l.pinned);
      if (pinned.length > 1) {
        fail(
          ['types', i, 'links'],
          `type \`${type.id}\` declares ${pinned.length} pinned links; at most one is allowed`,
        );
      }
      const seen = new Set<string>();
      type.links.forEach((link, j) => {
        if (seen.has(link.id)) fail(['types', i, 'links', j], `duplicate link id \`${link.id}\``);
        seen.add(link.id);
        if (!typeIds.has(link.to)) {
          fail(['types', i, 'links', j, 'to'], `link \`${link.id}\` targets undeclared type \`${link.to}\``);
        }
      });
      const blockFacets = new Set<string>();
      type.body_blocks.forEach((block, j) => {
        if (blockFacets.has(block.facet)) {
          fail(['types', i, 'body_blocks', j, 'facet'], `facet \`${block.facet}\` is declared by two blocks`);
        }
        blockFacets.add(block.facet);
      });
      if (type.draft_expiry) {
        try {
          parseDuration(type.draft_expiry);
        } catch (e) {
          fail(['types', i, 'draft_expiry'], (e as Error).message);
        }
      }
      if (type.attachments) {
        try {
          parseSize(type.attachments.max_size);
        } catch (e) {
          fail(['types', i, 'attachments', 'max_size'], (e as Error).message);
        }
      }
    });

    def.gates.forEach((gate, i) => {
      if (!typeIds.has(gate.decides_on)) {
        fail(
          ['gates', i, 'decides_on'],
          `gate \`${gate.id}\` decides on undeclared type \`${gate.decides_on}\``,
        );
      }
      if (!profileIds.has(gate.attribution_profile)) {
        fail(
          ['gates', i, 'attribution_profile'],
          `undeclared attribution profile \`${gate.attribution_profile}\``,
        );
      }
      if (gate.reopens_on && !gate.outcomes.includes(gate.reopens_on)) {
        fail(['gates', i, 'reopens_on'], `\`${gate.reopens_on}\` is not one of this gate's outcomes`);
      }
      if (gate.accepts_on && !gate.outcomes.includes(gate.accepts_on)) {
        fail(['gates', i, 'accepts_on'], `\`${gate.accepts_on}\` is not one of this gate's outcomes`);
      }
      // A gate that can never accept is a gate nothing gets through. Refused at apply rather than
      // discovered when a publication decision leaves the standard `rejected`.
      if (!acceptingOutcome(gate)) {
        fail(
          ['gates', i, 'accepts_on'],
          `gate \`${gate.id}\` has no accepting outcome: none of ${gate.outcomes.join(', ')} is \`approve\` or \`accept\`, and \`accepts_on\` is not declared`,
        );
      }
      if (gate.accepts_on && gate.reopens_on && gate.accepts_on === gate.reopens_on) {
        fail(['gates', i, 'accepts_on'], `\`${gate.accepts_on}\` cannot both accept and reopen`);
      }
      gate.requires.evaluations.forEach((ev, j) => {
        if (!evaluatorIds.has(ev)) {
          fail(['gates', i, 'requires', 'evaluations', j], `undeclared evaluator \`${ev}\``);
        }
      });
      // A label for an outcome the gate cannot produce is a typo, and a typo here means a button
      // that says "Approve" over an outcome called `aprove` — caught at apply, not at the gate.
      for (const outcome of Object.keys(gate.outcome_labels)) {
        if (!gate.outcomes.includes(outcome)) {
          fail(['gates', i, 'outcome_labels', outcome], `\`${outcome}\` is not one of this gate's outcomes`);
        }
      }
    });

    for (const phase of Object.keys(def.lifecycle.phase_labels)) {
      if (!phaseIds.has(phase)) fail(['lifecycle', 'phase_labels', phase], `undeclared phase \`${phase}\``);
    }

    def.lifecycle.transitions.forEach((t, i) => {
      if (!phaseIds.has(t.from))
        fail(['lifecycle', 'transitions', i, 'from'], `undeclared phase \`${t.from}\``);
      if (!phaseIds.has(t.to)) fail(['lifecycle', 'transitions', i, 'to'], `undeclared phase \`${t.to}\``);
      if (t.via_gate && !gateIds.has(t.via_gate)) {
        fail(['lifecycle', 'transitions', i, 'via_gate'], `undeclared gate \`${t.via_gate}\``);
      }
      if (t.via_gate && t.on) {
        const gate = def.gates.find((g) => g.id === t.via_gate);
        if (gate && !gate.outcomes.includes(t.on)) {
          fail(
            ['lifecycle', 'transitions', i, 'on'],
            `\`${t.on}\` is not an outcome of gate \`${t.via_gate}\``,
          );
        }
      }
    });

    if (def.lifecycle.initial && !phaseIds.has(def.lifecycle.initial)) {
      fail(['lifecycle', 'initial'], `undeclared phase \`${def.lifecycle.initial}\``);
    }

    // Every attribution profile must name a human somewhere. A profile where an agent could occupy
    // every required field is a profile under which nobody is answerable (ADR-0005).
    def.attribution_profiles.forEach((profile, i) => {
      const fields = new Set([...profile.required, ...profile.optional]);
      for (const field of Object.keys(profile.field_labels)) {
        if (!fields.has(field)) {
          fail(
            ['attribution_profiles', i, 'field_labels', field],
            `\`${field}\` is not a field of this profile`,
          );
        }
      }
      const namesAHuman = profile.required.some((field) => profile.rules[field]?.kind === 'human');
      if (!namesAHuman) {
        fail(
          ['attribution_profiles', i, 'rules'],
          `profile \`${profile.id}\` requires no field that must resolve to a human; a decision under it would leave nobody answerable`,
        );
      }
    });
  });

export type WorkspaceDefinition = z.infer<typeof workspaceDefinitionSchema>;

export class DefinitionError extends Error {
  constructor(
    message: string,
    readonly issues: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'DefinitionError';
  }
}

/**
 * Parse a definition, naming the failing path.
 *
 * "Invalid definition" sends someone reading a 400-line YAML file top to bottom.
 * "types[2].links[1].to: link `implements` targets undeclared type `funcional_spec`" does not.
 */
export function parseWorkspaceDefinition(input: unknown): WorkspaceDefinition {
  const result = workspaceDefinitionSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({
    path: i.path.join('.') || '(root)',
    message: i.message,
  }));
  throw new DefinitionError(
    `Workspace definition is invalid:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`,
    issues,
  );
}

// --- lookups, so no caller re-scans the arrays ---

export function typeIn(def: WorkspaceDefinition, id: string): TypeDeclaration | undefined {
  return def.types.find((t) => t.id === id);
}

export function gateIn(def: WorkspaceDefinition, id: string): GateDeclaration | undefined {
  return def.gates.find((g) => g.id === id);
}

/** The consequence class an event about an artifact of this type carries. */
export function consequenceClassFor(def: WorkspaceDefinition, typeId: string | undefined): string {
  const type = typeId ? def.types.find((t) => t.id === typeId) : undefined;
  return type?.consequence_class ?? def.consequence_class;
}

export function profileIn(def: WorkspaceDefinition, id: string): AttributionProfile | undefined {
  return def.attribution_profiles.find((p) => p.id === id);
}

/**
 * The outcome that accepts a version at this gate.
 *
 * Declared as `accepts_on`, or the conventional `approve` / `accept` when the gate lists one. This is
 * the only place that convention is spelled out; the validator guarantees it resolves for every
 * committed gate, so callers may treat the result as present.
 */
export function acceptingOutcome(gate: Pick<GateDeclaration, 'outcomes' | 'accepts_on'>): string | undefined {
  if (gate.accepts_on) return gate.accepts_on;
  return gate.outcomes.find((o) => o === 'approve' || o === 'accept');
}

export function evaluatorIn(def: WorkspaceDefinition, id: string): EvaluatorDeclaration | undefined {
  return def.evaluators.find((e) => e.id === id);
}

export function gatesDecidingOn(def: WorkspaceDefinition, type: string): GateDeclaration[] {
  return def.gates.filter((g) => g.decides_on === type);
}

export function pinnedLinkFor(type: TypeDeclaration): TypeDeclaration['links'][number] | undefined {
  return type.links.find((l) => l.pinned);
}

export function initialPhase(def: WorkspaceDefinition): string {
  return def.lifecycle.initial ?? def.lifecycle.phases[0]!;
}
