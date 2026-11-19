import { assertSafeOutboundUrl } from '../ssrf';
import {
  discordConfigSchema,
  type ChannelSender,
  type NotificationPayload,
  type SendResult,
} from '../types';

// Discord caps each field value at 1024 chars.
function clamp(value: string, max = 1024): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function buildEmbed(payload: NotificationPayload) {
  const embed = payload.embed!;
  return {
    author: { name: 'Lead Finder' },
    title: clamp(payload.title, 256),
    url: embed.url,
    color: embed.color,
    description: embed.url ? `**[→ Open dashboard](${embed.url})**` : undefined,
    fields: embed.fields?.map((f) => ({
      name: clamp(f.name, 256),
      value: clamp(f.value),
    })),
    footer: embed.footer ? { text: clamp(embed.footer, 2048) } : undefined,
    timestamp: embed.timestamp,
  };
}

export const discordSender: ChannelSender = {
  async send(config, payload): Promise<SendResult> {
    const parsed = discordConfigSchema.safeParse(config);
    if (!parsed.success) return { ok: false, error: 'Invalid Discord config' };
    const c = parsed.data;

    try {
      const url = assertSafeOutboundUrl(c.webhookUrl);
      const body: Record<string, unknown> = payload.embed
        ? { embeds: [buildEmbed(payload)] }
        : { content: [payload.title, ...payload.lines].join('\n') };
      if (c.botUsername) body.username = c.botUsername;
      if (c.botAvatarUrl) body.avatar_url = c.botAvatarUrl;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { ok: false, error: `Discord responded ${res.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: toMessage(error) };
    }
  },
};

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Send failed';
}
