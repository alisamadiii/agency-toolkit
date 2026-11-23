'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

// Client Hub underline tabs, as links. Active = ink text + 2px coral underline.
// `prefixes`: other paths that also make the tab active (e.g. detail pages).
export function UnderlineNav({ items }: { items: { href: string; label: string; prefixes?: string[] }[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-6 border-b border-line">
      {items.map((t) => {
        const active = path === t.href || (t.prefixes ?? []).some((p) => path.startsWith(p));
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px flex h-10 items-center border-b-2 text-sm focus-visible:ring-2 focus-visible:ring-coral focus-visible:outline-none',
              active ? 'border-coral font-medium text-ink' : 'border-transparent text-dim hover:text-ink'
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
