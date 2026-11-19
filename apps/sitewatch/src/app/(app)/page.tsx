import { requireSession } from '@/lib/session';
import { summarizeSites } from '@/lib/site-summary';

import { ClientsDashboard } from './clients-dashboard';

export default async function HomePage() {
  const { user } = await requireSession();
  const cards = await summarizeSites(user.id);
  return <ClientsDashboard cards={cards} />;
}
