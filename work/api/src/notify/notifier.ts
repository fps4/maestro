/**
 * The notifier port (component page, "Ports"): how a chase-ladder step reaches a person. The local
 * default is a log line; on AWS, a Slack incoming webhook. SES waits for a principal's address,
 * which is identity-service's to give, not this service's to hold.
 *
 * A delivery's outcome is part of the record: the sweep records `delivered` or `failed` on the
 * `WorkItemChased` event, so a step whose message never arrived is visible as such.
 */

export interface Notice {
  workspace: string;
  item_id: string;
  title: string;
  step: string;
  /** The principal the step reaches — an identity-service id. */
  to: string;
  accountable: string;
  due?: string;
}

export interface Notifier {
  deliver(notice: Notice): Promise<'delivered' | 'failed'>;
}

/** The laptop's notifier: one JSON line per step, always delivered. */
export class LogNotifier implements Notifier {
  constructor(
    private readonly log: (line: Record<string, unknown>) => void = (l) => console.log(JSON.stringify(l)),
  ) {}

  async deliver(notice: Notice): Promise<'delivered'> {
    this.log({ msg: 'chase', ...notice });
    return 'delivered';
  }
}

const STEP_WORDS: Record<string, string> = {
  reminder: 'Reminder',
  chase: 'Chasing',
  escalate_accountable: 'Escalated to the accountable human',
  escalate_steward: 'Escalated to the steward',
};

/**
 * A Slack incoming webhook: one message per step, naming the principal by id. A non-2xx answer or a
 * network error is `failed`, and recorded as such; the sweep does not retry a step.
 */
export class SlackWebhookNotifier implements Notifier {
  constructor(
    private readonly url: string,
    private readonly send: typeof fetch = fetch,
  ) {}

  async deliver(n: Notice): Promise<'delivered' | 'failed'> {
    const text =
      `*${STEP_WORDS[n.step] ?? n.step}* · \`${n.item_id}\` in \`${n.workspace}\`: ${n.title}\n` +
      `For \`${n.to}\`; accountable \`${n.accountable}\`${n.due ? `; due ${n.due}` : ''}.`;
    try {
      const res = await this.send(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok ? 'delivered' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
