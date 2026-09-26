/**
 * The MCP surface — the tracker contract (maestro docs/components/work-service.md, "Interfaces").
 *
 * `publish`, `fetch`, `claim`, `resolve`, `frontier` and `blocking` are the contract: a skill written
 * against them runs unchanged against any tracker that keeps it, and M2's sixth gate is a suite that
 * drives this server through them and nothing else. `heartbeat`, `release` and `link` are the
 * holder's, outside the contract.
 *
 * Every tool calls the same `WorkItemService` the HTTP routes do, with the same schemas, so a rule
 * holds here because it holds there. What is not here is deliberate, as on HTTP: no tool accepts
 * anything, and none sets an authority field — a publish that names one is refused with its name.
 * A refused claim is a result, not an error: the check and the sentence are the answer.
 */

import { z } from 'zod';
import type { RequestContext } from '../auth/context.js';
import { ITEM_ID } from '../domain/ids.js';
import { NotFound } from '../http/errors.js';
import { frontierSchema, publishSchema, refuseAuthorityFields, resolveSchema } from '../http/schemas.js';
import type { WorkItemService } from '../services/work-items.js';

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler(ctx: RequestContext, input: unknown): Promise<unknown>;
}

const itemInput = z.object({ item: z.string().regex(ITEM_ID, 'an item is `wrk-<n>`') }).strict();

const resolveInput = itemInput.merge(resolveSchema).strict();

/** `link` as MCP declares it: one of the two, flat, because a tool's input schema is one object. */
const linkShape = itemInput
  .extend({
    pull_request: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/, 'a pull request is <owner>/<repo>#<number>')
      .optional(),
    artifact: z.string().min(1).max(256).optional(),
  })
  .strict();
const linkInput = linkShape.refine((v) => (v.pull_request === undefined) !== (v.artifact === undefined), {
  message: 'Link one thing: a `pull_request` or an `artifact`.',
});

const frontierInput = frontierSchema.extend({ limit: z.number().int().positive().max(1000).optional() });

export function buildTools(items: WorkItemService): McpTool[] {
  return [
    {
      name: 'publish',
      title: 'Raise a work item',
      description:
        'Raise a commitment in this workspace: a `class` (change, objective, remediation, obligation, support, review), a `title`, and what it is about — an `application` and `environment` declared in the workspace, or a `subject_type` and `subject_id`. ' +
        'Optionally a `parent`, a `milestone`, the items it is `blocked_by`, a `remediation_class` (remediation only), a `severity_hint` the policy maps, and an `evidence_plan` from merged_change, deploy_event, signal_ok, rescan_clear, decision_accepted. ' +
        'Pass a `key` of your own so a retry returns the same item instead of raising a second. ' +
        'Severity, clocks, onboarding level, the accountable human and the oversight level are resolved from policy and the application and come back on the item — naming any of them is refused. ' +
        'A change or objective about an application onboarded below N2 is refused: maestro does not commit to correctness there.',
      inputSchema: publishSchema,
      async handler(ctx, input) {
        refuseAuthorityFields(input);
        const { key, ...rest } = publishSchema.parse(input);
        return items.raise(ctx, rest, key);
      },
    },
    {
      name: 'fetch',
      title: 'Read a work item',
      description:
        'One item as it is now: its clocks (`respond_by`, `resolve_by`, `review_by`, a lease), each evidence entry with the fact that satisfied it (`satisfied_by`, `satisfied_at`) or none yet, its edges (`blocks`, `child`, `member`), and `next_human_touchpoint` — the person to reach about it.',
      inputSchema: itemInput,
      async handler(ctx, input) {
        return items.get(ctx, itemInput.parse(input).item);
      },
    },
    {
      name: 'claim',
      title: 'Claim a work item',
      description:
        'Take an item to act on it. Authority is checked here, not later: `result` is `claimed`, with the lease’s expiry (renew it with `heartbeat` while you work), or `refused`, with the `check` that refused, a sentence saying why, and the item as the refusal left it. ' +
        'A refusal is an answer, not an error: do not retry it — the item stays for a principal who may act, or has been escalated to the human who answers for it. First claim wins; a held item is refused.',
      inputSchema: itemInput,
      async handler(ctx, input) {
        const { item, result } = await items.claim(ctx, itemInput.parse(input).item);
        return result.claimed
          ? { result: 'claimed', item, lease_expires_at: item.lease_expires_at }
          : { result: 'refused', check: result.check, sentence: result.sentence, item };
      },
    },
    {
      name: 'resolve',
      title: 'Resolve a work item',
      description:
        '`done` from the holder marks the act performed: the item becomes `resolved`, and closes `done` when its evidence plan is satisfied — at once if it already is, otherwise when the merge, deploy or all-clear arrives. ' +
        'Or close it `refused`, `escalated_out` or `superseded`, with a `reason`. Nothing reopens a closed item.',
      inputSchema: resolveInput,
      async handler(ctx, input) {
        const { item, outcome, reason } = resolveInput.parse(input);
        return { item: await items.resolve(ctx, item, outcome, reason) };
      },
    },
    {
      name: 'frontier',
      title: 'Read what is owed now',
      description:
        'The open items, soonest due first: id, class, title, what it is about, the accountable human, who is acting, state, severity, when it next needs attention (`due`) and the next human touchpoint. ' +
        'Filter `for` a principal (`me` for yourself), by `application` or `milestone`; `limit` the rows. Start here to find work.',
      inputSchema: frontierInput,
      async handler(ctx, input) {
        return { rows: await items.frontier(ctx, frontierInput.parse(input)) };
      },
    },
    {
      name: 'blocking',
      title: 'Read what an item waits on',
      description:
        '`blocked_by`: the open items this one waits on. `blocks`: the open items waiting on it. A blocker that has closed, whatever its outcome, is not listed.',
      inputSchema: itemInput,
      async handler(ctx, input) {
        return items.blocking(ctx, itemInput.parse(input).item);
      },
    },
    {
      name: 'heartbeat',
      title: 'Renew your lease',
      description:
        'For the holder: renew the lease on an item you are working on. A lease that runs out returns the item to `open` with a reason, and the next principal may claim it.',
      inputSchema: itemInput,
      async handler(ctx, input) {
        const item = await items.heartbeat(ctx, itemInput.parse(input).item);
        return { item, lease_expires_at: item.lease_expires_at };
      },
    },
    {
      name: 'release',
      title: 'Release an item',
      description:
        'For the holder: give an item back to `open` without resolving it, for someone else to claim.',
      inputSchema: itemInput,
      async handler(ctx, input) {
        return { item: await items.release(ctx, itemInput.parse(input).item) };
      },
    },
    {
      name: 'link',
      title: 'Link a pull request or an artifact',
      description:
        'Name the `pull_request` (`<owner>/<repo>#<number>`) that should satisfy the item’s `merged_change`, or the specs-service `artifact` whose acceptance satisfies `decision_accepted`. The evidence then closes the item when that merge or decision happens.',
      inputSchema: linkShape,
      async handler(ctx, input) {
        const { item, pull_request, artifact } = linkInput.parse(input);
        const [kind, ref] = pull_request
          ? (['pull_request', pull_request] as const)
          : (['artifact', artifact!] as const);
        return { item: await items.link(ctx, item, kind, ref) };
      },
    },
  ];
}

export async function callTool(
  tools: McpTool[],
  name: string,
  ctx: RequestContext,
  input: unknown,
): Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  if (!tool)
    throw new NotFound(`No tool \`${name}\`. The tools are ${tools.map((t) => `\`${t.name}\``).join(', ')}.`);
  return tool.handler(ctx, input);
}
