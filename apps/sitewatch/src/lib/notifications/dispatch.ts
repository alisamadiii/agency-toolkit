import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { notificationChannels, user } from '@/db/schema';

import { discordSender } from './channels/discord';
import { emailSender } from './channels/email';
import { slackSender } from './channels/slack';
import { telegramSender } from './channels/telegram';
import { webhookSender } from './channels/webhook';
import type {
  ChannelSender,
  ChannelType,
  NotificationPayload,
  SendResult,
} from './types';

export const senders: Record<ChannelType, ChannelSender> = {
  discord: discordSender,
  slack: slackSender,
  telegram: telegramSender,
  email: emailSender,
  webhook: webhookSender,
};

// Sends one alert to every enabled channel of the instance owner.
export async function sendAlert(
  payload: Omit<NotificationPayload, 'recipientEmail'>
): Promise<Record<string, SendResult>> {
  const [owner] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .limit(1);
  if (!owner) return {};

  const channels = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.userId, owner.id),
        eq(notificationChannels.enabled, true)
      )
    );

  const results: Record<string, SendResult> = {};
  for (const channel of channels) {
    results[channel.type] = await senders[channel.type].send(channel.config, {
      ...payload,
      recipientEmail: channel.type === 'email' ? owner.email : undefined,
    });
  }
  return results;
}
