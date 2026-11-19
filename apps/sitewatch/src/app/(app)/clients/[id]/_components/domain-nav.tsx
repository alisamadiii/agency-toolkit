'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, FileText, Gauge, History, Radio, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

const ICONS = {
  gauge: Gauge,
  problems: TriangleAlert,
  pages: FileText,
  history: History,
  endpoints: Radio,
} as const;

export function DomainNav({ id, name }: { id: string; name: string }) {
  const pathname = usePathname();
  const base = `/clients/${id}`;

  const items = [
    { href: base, label: 'Dashboard', icon: 'gauge' as const },
    { href: `${base}/problems`, label: 'Problems', icon: 'problems' as const },
    { href: `${base}/endpoints`, label: 'Endpoints', icon: 'endpoints' as const },
    { href: `${base}/pages`, label: 'Pages', icon: 'pages' as const },
    { href: `${base}/history`, label: 'History', icon: 'history' as const },
  ];

  const isActive = (href: string) =>
    href === base ? pathname === base : pathname.startsWith(href);

  return (
    <aside className="md:w-48 md:shrink-0">
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" />
        Websites
      </Link>
      <p className="mb-2 truncate px-2 text-sm font-medium" title={name}>
        {name}
      </p>
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors',
                active
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
