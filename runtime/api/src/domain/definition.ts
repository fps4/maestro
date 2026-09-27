/**
 * The workspace definition: the applications runtime-service registers instances of, their
 * environments and the repositories they are built from (maestro ADR-0027 §7). A tenant supplies it
 * from its configuration repository as `workspaces/<workspace>.runtime.yaml`; `npm run
 * workspace:apply` validates and stores it under a version.
 *
 * It holds no tier and no onboarding level. Those are a person's act, recorded here as events
 * (`set_level`, `set_tier`) and projected by work-service (ADR-0027 §4) — never configuration a
 * pipeline could change.
 */

import { OVERSIGHT_LEVELS } from '@fps4/maestro-spine';
import { z } from 'zod';
import { PRINCIPAL_ID } from './ids.js';

export class DefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitionError';
  }
}

const slug = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/, 'must be a lower-case slug');
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be lower snake_case');
const human = z
  .string()
  .regex(PRINCIPAL_ID)
  .refine((v) => v.startsWith('prn-h-'), 'must be a human (prn-h-…)');

const application = z
  .object({
    id: slug,
    /** The human answerable for what is recorded about this application. */
    accountable: human,
    /** The environments it runs in: declared, not a fixed list (ADR-0027 §6). */
    environments: z.array(slug).min(1),
    /** The repositories it is built from, and the environment each one deploys to. */
    repositories: z
      .array(
        z
          .object({
            repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'is <owner>/<repo>'),
            environment: slug,
            path: z
              .string()
              .regex(/^([A-Za-z0-9_.-]+\/)+$/, 'is a directory relative to the repository root, ending in /')
              .optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const seat = z.object({ oversight_level: z.enum(OVERSIGHT_LEVELS) }).strict();

/**
 * The seats this service's acts are recorded under. `intake`: a pipeline's build and deploy, taken in
 * by the intake workload. `owner`: a person setting an application's level or tier.
 */
const DEFAULT_SEATS = { intake: { oversight_level: 'O2' }, owner: { oversight_level: 'O0' } } as const;

const definitionSchema = z
  .object({
    workspace: slug,
    definition_version: z.number().int().positive(),
    title: z.string().optional(),
    /** How much a thing matters if wrong; carried on every event. */
    consequence_class: z.string().regex(/^c[0-9]$/),
    seats: z.record(identifier, seat).default(DEFAULT_SEATS),
    steward: human.optional(),
    applications: z.array(application).default([]),
  })
  .strict();

export type WorkspaceDefinition = z.infer<typeof definitionSchema>;
export type Application = z.infer<typeof application>;

export function parseWorkspaceDefinition(raw: unknown): WorkspaceDefinition {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new DefinitionError(`The workspace definition is invalid:\n${lines.join('\n')}`);
  }
  const d = parsed.data;
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const app of d.applications) {
    if (ids.has(app.id)) problems.push(`application \`${app.id}\` is declared twice`);
    ids.add(app.id);
    for (const r of app.repositories) {
      if (!app.environments.includes(r.environment)) {
        problems.push(
          `application \`${app.id}\`: repository ${r.repository} names environment \`${r.environment}\`, which it does not have`,
        );
      }
    }
  }
  for (const s of ['intake', 'owner']) {
    if (!d.seats[s]) problems.push(`seat \`${s}\` is not declared; this service records its acts under it`);
  }
  if (problems.length > 0) {
    throw new DefinitionError(
      `The workspace definition is invalid:\n${problems.map((p) => `  ${p}`).join('\n')}`,
    );
  }
  return d;
}

export function applicationOf(definition: WorkspaceDefinition, id: string): Application | undefined {
  return definition.applications.find((a) => a.id === id);
}
