import { pagesWithProblems } from '@/lib/page-problems';

import { requireOwnedClient } from '../_load';
import { PagesView } from '../_components/pages-view';

export default async function PagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireOwnedClient(id);

  return <PagesView pages={await pagesWithProblems(id)} />;
}
