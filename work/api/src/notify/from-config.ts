import type { Config } from '../config.js';
import { LogNotifier, SlackWebhookNotifier, type Notifier } from './notifier.js';

/** The notifier the configuration names. */
export function notifierFor(config: Pick<Config, 'NOTIFIER' | 'SLACK_WEBHOOK_URL'>): Notifier {
  return config.NOTIFIER === 'slack'
    ? new SlackWebhookNotifier(config.SLACK_WEBHOOK_URL!)
    : new LogNotifier();
}

/** The sweep's principal: identity-service's workload id in a deployment, a stand-in on a laptop. */
export function sweepPrincipal(config: Pick<Config, 'SWEEP_PRINCIPAL' | 'isProduction'>): string {
  if (config.SWEEP_PRINCIPAL) return config.SWEEP_PRINCIPAL;
  if (config.isProduction) {
    throw new Error(
      'SWEEP_PRINCIPAL names the workload the sweep acts as — identity-service’s prn-w-… for this service.',
    );
  }
  return 'prn-w-work-sweep-local';
}
