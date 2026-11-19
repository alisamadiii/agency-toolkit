import { z } from 'zod';

export const CHANNEL_TYPES = ['discord'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

// Rich-card hints for the Discord channel.
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

export const channelConfigSchemas: Record<ChannelType, z.ZodTypeAny> = {
  discord: discordConfigSchema,
};

export type DiscordConfig = z.infer<typeof discordConfigSchema>;
