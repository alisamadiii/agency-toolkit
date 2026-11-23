import { redirect } from 'next/navigation';

import { readEmbed } from '@/lib/embed';
import { getWorkspace } from '@/lib/service';

// Every /iframe page starts here: the workspace comes only from the signed session cookie.
export async function embedPage() {
  const session = await readEmbed();
  if (!session) redirect('/iframe/expired');
  const ws = await getWorkspace(session.workspaceId).catch(() => null);
  if (!ws) redirect('/iframe/expired');
  return { session, ws };
}
