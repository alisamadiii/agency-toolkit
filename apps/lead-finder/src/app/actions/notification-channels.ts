'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { notificationChannels } from '@/db/schema';
import { DASHBOARD_URL, senders } from '@/lib/notifications/dispatch';
import { assertSafeOutboundUrl } from '@/lib/notifications/ssrf';
import { CHANNEL_TYPES, channelConfigSchemas, type ChannelType } from '@/lib/notifications/types';

function isChannelType(type: string): type is ChannelType {
  return (CHANNEL_TYPES as readonly string[]).includes(type);
}

function validateConfig(type: ChannelType, raw: unknown) {
  const parsed = channelConfigSchemas[type].safeParse(raw);
  if (!parsed.success) {
    return { config: null, error: parsed.error.issues[0]?.message ?? 'Invalid config' };
  }
  try {
    assertSafeOutboundUrl((parsed.data as { webhookUrl: string }).webhookUrl);
  } catch (error) {
    return { config: null, error: error instanceof Error ? error.message : 'Unsafe URL' };
  }
  return { config: parsed.data as Record<string, unknown>, error: null };
}

async function findChannel(type: ChannelType) {
  const [row] = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.type, type));
  return row;
}

export async function saveChannel(type: string, rawConfig: unknown) {
  if (!isChannelType(type)) return { error: 'Unknown channel' };

  const { config, error } = validateConfig(type, rawConfig);
  if (error || !config) return { error };

  await db
    .insert(notificationChannels)
    .values({ type, config, enabled: true })
    .onConflictDoUpdate({
      target: notificationChannels.type,
      set: { config, enabled: true, updatedAt: new Date() },
    });

  revalidatePath('/settings');
  return { error: null };
}

export async function toggleChannel(type: string) {
  if (!isChannelType(type)) return { error: 'Unknown channel' };
  const existing = await findChannel(type);
  if (!existing) return { error: 'Configure the channel first' };

  await db
    .update(notificationChannels)
    .set({ enabled: !existing.enabled, updatedAt: new Date() })
    .where(eq(notificationChannels.id, existing.id));

  revalidatePath('/settings');
  return { error: null };
}

// Sends a real test message through the saved channel config.
export async function testChannel(type: string) {
  if (!isChannelType(type)) return { error: 'Unknown channel' };
  const existing = await findChannel(type);
  if (!existing) return { error: 'Configure the channel first' };

  const result = await senders[type].send(existing.config, {
    title: 'Lead Finder test notification',
    lines: ['If you can read this, the channel works.'],
    embed: {
      color: 0x5865f2,
      url: DASHBOARD_URL,
      fields: [{ name: '✅ Channel connected', value: 'Daily lead summaries will land here.' }],
      footer: 'Lead Finder',
      timestamp: new Date().toISOString(),
    },
  });
  if (!result.ok) return { error: result.error ?? 'Send failed' };
  return { error: null };
}
