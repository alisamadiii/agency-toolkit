import { eq } from 'drizzle-orm';

import { PageHeader } from '@/components/page-header';
import { db } from '@/db';
import { notificationChannels } from '@/db/schema';
import { getSettings } from '@/lib/jobs/settings';

import { ChannelCard } from './channel-card';
import { SettingsForm } from './settings-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [s, [discord]] = await Promise.all([
    getSettings(),
    db.select().from(notificationChannels).where(eq(notificationChannels.type, 'discord')),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        description="Saved to the database. The scheduler on Coolify reads these every minute."
      />
      <div className="space-y-6">
        <SettingsForm settings={s} />
        <ChannelCard
          saved={
            discord
              ? { enabled: discord.enabled, config: discord.config as Record<string, unknown> }
              : null
          }
        />
      </div>
    </div>
  );
}
