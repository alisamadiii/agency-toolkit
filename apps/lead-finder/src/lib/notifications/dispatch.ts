import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { notificationChannels } from '@/db/schema';

import { discordSender } from './channels/discord';
import type {
  ChannelSender,
  ChannelType,
  NotificationPayload,
  SendResult,
} from './types';

export const senders: Record<ChannelType, ChannelSender> = {
  discord: discordSender,
};

// Sends to every enabled channel. No enabled channels → no-op.
export async function sendAlert(
  payload: NotificationPayload
): Promise<Record<string, SendResult>> {
  const channels = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.enabled, true));

  const results: Record<string, SendResult> = {};
  for (const channel of channels) {
    results[channel.type] = await senders[channel.type].send(channel.config, payload);
  }
  return results;
}

// The dashboard only runs locally, so links in alerts point at the dev server.
export const DASHBOARD_URL = 'http://localhost:3000';
