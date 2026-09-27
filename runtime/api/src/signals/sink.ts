/**
 * Where a digest mismatch goes (maestro ADR-0027 §5): to work-service's signals intake, as a
 * `digest_mismatch` signal this service's workload puts. work-service dedups it by fingerprint,
 * resolves severity and clocks from its policy, and raises the SEV item; this service never writes
 * an item.
 *
 * Delivered after the transaction that recorded the mismatch. A failed delivery is a log line and
 * nothing more: the mismatch is on the record either way, and the instance stays marked until a
 * built digest is deployed over it.
 */

export interface MismatchSignal {
  workspace: string;
  application: string;
  environment: string;
  digest: string;
  /** When the deploy happened. */
  at: string;
  /** The deploy's EventBridge id: work-service's dedup of this delivery. */
  delivery: string;
}

export interface SignalSink {
  mismatch(signal: MismatchSignal): Promise<'delivered' | 'failed'>;
}

/** The envelope work-service's `POST /signals` reads (docs/signals.md, "The envelope"). */
export function signalOf(s: MismatchSignal) {
  return {
    signal_version: 1,
    source: 'maestro-runtime',
    delivery_id: s.delivery,
    application: s.application,
    environment: s.environment,
    kind: 'digest_mismatch',
    state: 'alarm',
    severity_hint: 'P2',
    fingerprint: `${s.application}#${s.environment}#${s.digest}`,
    occurred_at: s.at,
    detail: { digest: s.digest },
  };
}

/** The laptop's, and the tests': a line, and a list of what would have been sent. */
export class LogSignalSink implements SignalSink {
  readonly sent: MismatchSignal[] = [];

  async mismatch(signal: MismatchSignal): Promise<'delivered'> {
    this.sent.push(signal);
    console.log(JSON.stringify({ msg: 'digest mismatch signal', ...signalOf(signal) }));
    return 'delivered';
  }
}

export interface WorkSinkOptions {
  workApiUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}

/** work-service's intake, with a token from identity-service's client-credentials grant. */
export class WorkSignalSink implements SignalSink {
  private token?: { value: string; until: number };

  constructor(private readonly options: WorkSinkOptions) {}

  private async bearer(): Promise<string> {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const f = this.options.fetch ?? fetch;
    const response = await f(this.options.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }),
    });
    if (!response.ok) throw new Error(`the token endpoint answered ${response.status}`);
    const { access_token, expires_in } = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    this.token = { value: access_token, until: Date.now() + ((expires_in ?? 300) - 30) * 1000 };
    return access_token;
  }

  async mismatch(signal: MismatchSignal): Promise<'delivered' | 'failed'> {
    const f = this.options.fetch ?? fetch;
    try {
      const response = await f(
        `${this.options.workApiUrl.replace(/\/+$/, '')}/v1/workspaces/${signal.workspace}/signals`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${await this.bearer()}`, 'content-type': 'application/json' },
          body: JSON.stringify(signalOf(signal)),
        },
      );
      if (!response.ok) throw new Error(`work-service answered ${response.status}: ${await response.text()}`);
      return 'delivered';
    } catch (error) {
      console.error(
        JSON.stringify({
          msg: 'digest mismatch signal failed',
          ...signalOf(signal),
          err: (error as Error).message,
        }),
      );
      return 'failed';
    }
  }
}
