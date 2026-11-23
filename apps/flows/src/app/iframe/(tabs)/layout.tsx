import { UnderlineNav } from '@/components/hub/tabs';
import { PageHeader } from '@/components/hub/page-header';

import { embedPage } from '../session';

export default async function TabsLayout({ children }: { children: React.ReactNode }) {
  const { session } = await embedPage();
  const items = [
    { href: '/iframe', label: 'Workflows', prefixes: ['/iframe/workflows'] },
    { href: '/iframe/runs', label: 'Runs', prefixes: ['/iframe/runs/'] },
    { href: '/iframe/notifications', label: 'Notifications' },
    { href: '/iframe/keys', label: session.role === 'full-access' ? 'Keys & secrets' : 'Secrets' },
    { href: '/iframe/settings', label: 'Settings' },
  ];
  return (
    <main className="px-4 pt-6 pb-12 sm:px-10 sm:pt-8">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-5">
        <PageHeader
          title="Automations"
          description="Workflows that run on a schedule or when your apps call them, and the notifications they send."
          tabs={<UnderlineNav items={items} />}
        />
        {children}
      </div>
    </main>
  );
}
