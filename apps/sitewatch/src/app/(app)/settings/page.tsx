import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { notificationChannels } from '@/db/schema';
import { requireSession } from '@/lib/session';

import { SettingsClient, type ChannelView } from './settings-client';

export default async function SettingsPage() {
  const { user } = await requireSession();

  const channels = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.userId, user.id));

  const views: ChannelView[] = channels.map((c) => ({
    type: c.type,
    enabled: c.enabled,
    config: c.config as Record<string, unknown>,
  }));

  return <SettingsClient channels={views} />;
}
