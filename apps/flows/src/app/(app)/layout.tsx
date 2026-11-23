import { Workflow } from 'lucide-react';
import Link from 'next/link';

import { SignOutButton } from '@/components/sign-out-button';
import { requireSession } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Workflow className="size-5" /> Flows
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <a href="/api/v1/openapi.json" target="_blank" className="px-2 text-muted-foreground hover:text-foreground">
              API spec
            </a>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
