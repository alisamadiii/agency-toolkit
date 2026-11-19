import { z } from 'zod';

export const CHANNEL_TYPES = ['discord', 'slack', 'telegram', 'email', 'webhook'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

// Rich-card hints for the Discord channel. Other channels ignore it and fall
// back to title + lines.
export type AlertEmbed = {
  color?: number; // 0xRRGGBB
  url?: string; // deep link that makes the title clickable (the dashboard page)
  fields?: { name: string; value: string }[];
  footer?: string;
  timestamp?: string; // ISO
};

export type NotificationPayload = {
  title: string;
  lines: string[];
  recipientEmail?: string;
  // Structured version of the alert for machine consumers (webhook channel).
  // Text channels ignore it.
  data?: Record<string, unknown>;
  // Rich-card hints for Discord. Text channels ignore it.
  embed?: AlertEmbed;
};

export type SendResult = { ok: boolean; error?: string };

export interface ChannelSender {
  send(config: unknown, payload: NotificationPayload): Promise<SendResult>;
}

export const discordConfigSchema = z.object({
  webhookUrl: z.string().url(),
  botUsername: z.string().default(''),
  botAvatarUrl: z.string().default(''),
});

export const slackConfigSchema = z.object({
  webhookUrl: z.string().url(),
});

export const telegramConfigSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
});

export const emailConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  username: z.string().default(''),
  password: z.string().default(''),
  fromEmail: z.string().email(),
  encryption: z.enum(['tls', 'ssl', 'none']).default('tls'),
  extraEmails: z.string().default(''),
});

export const webhookConfigSchema = z.object({
  url: z.string().url(),
  headers: z.string().default('{}'),
  secret: z.string().default(''),
});

export const channelConfigSchemas: Record<ChannelType, z.ZodTypeAny> = {
  discord: discordConfigSchema,
  slack: slackConfigSchema,
  telegram: telegramConfigSchema,
  email: emailConfigSchema,
  webhook: webhookConfigSchema,
};

export type DiscordConfig = z.infer<typeof discordConfigSchema>;
export type SlackConfig = z.infer<typeof slackConfigSchema>;
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;
export type EmailConfig = z.infer<typeof emailConfigSchema>;
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
