import { assertSafeOutboundUrl } from '../ssrf';
import {
  webhookConfigSchema,
  type ChannelSender,
  type SendResult,
} from '../types';

// Machine-consumer channel: POSTs the alert's structured `data` payload as
// JSON (falls back to {title, lines}) so another system — e.g. the client
// hub — can forward reports to clients.
export const webhookSender: ChannelSender = {
  async send(config, payload): Promise<SendResult> {
    const parsed = webhookConfigSchema.safeParse(config);
    if (!parsed.success) return { ok: false, error: 'Invalid webhook config' };
    const c = parsed.data;

    let headers: Record<string, string>;
    try {
      headers = { 'content-type': 'application/json', ...JSON.parse(c.headers || '{}') };
    } catch {
      return { ok: false, error: 'Headers must be valid JSON' };
    }
    if (c.secret) headers['x-webhook-secret'] = c.secret;

    try {
      const url = assertSafeOutboundUrl(c.url);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          payload.data ?? { title: payload.title, lines: payload.lines }
        ),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { ok: false, error: `Webhook responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Send failed',
      };
    }
  },
};
