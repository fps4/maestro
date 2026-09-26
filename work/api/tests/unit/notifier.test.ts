/**
 * The Slack adapter: one message per ladder step, and a delivery outcome the sweep records — a
 * non-2xx answer and a network error are both `failed`, never an exception that stops the sweep.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { SlackWebhookNotifier, type Notice } from '../../src/notify/notifier.js';

const notice: Notice = {
  workspace: 'aannemer-x',
  item_id: 'wrk-7',
  title: 'Queue consumer down',
  step: 'escalate_accountable',
  to: 'prn-h-demo-owner',
  accountable: 'prn-h-demo-owner',
  due: '2026-09-25T16:00:00Z',
};

describe('the Slack notifier', () => {
  it('posts one message naming the item, the step and the principal', async () => {
    const sent: Array<{ url: string; body: string }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: String(init.body) });
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await new SlackWebhookNotifier('https://hooks.example/x', fake).deliver(notice)).toBe('delivered');
    expect(sent).toHaveLength(1);
    const text = JSON.parse(sent[0]!.body).text as string;
    expect(text).toContain('Escalated to the accountable human');
    expect(text).toContain('`wrk-7`');
    expect(text).toContain('`prn-h-demo-owner`');
  });

  it('answers failed, not an exception, when Slack refuses or cannot be reached', async () => {
    const refusing = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await new SlackWebhookNotifier('https://hooks.example/x', refusing).deliver(notice)).toBe(
      'failed',
    );
    expect(await new SlackWebhookNotifier('https://hooks.example/x', down).deliver(notice)).toBe('failed');
  });

  it('is configured with its webhook or not at all', () => {
    expect(() => loadConfig({ TABLE_NAME: 't', NOTIFIER: 'slack' })).toThrow(/requires SLACK_WEBHOOK_URL/);
    expect(() =>
      loadConfig({ TABLE_NAME: 't', NOTIFIER: 'slack', SLACK_WEBHOOK_URL: 'https://hooks.example/x' }),
    ).not.toThrow();
  });
});
