import { readEmbed } from '@/lib/embed';

import { EmbedProvider } from './embed-provider';

export const dynamic = 'force-dynamic';

// The client hub embed. Framing is limited to the hub by src/proxy.ts.
export default async function IframeLayout({ children }: { children: React.ReactNode }) {
  const session = await readEmbed();
  return (
    <div className="min-h-svh bg-canvas text-ink">
      <EmbedProvider role={session?.role ?? 'view-only'}>{children}</EmbedProvider>
    </div>
  );
}
