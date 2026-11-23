import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/lib/utils';

// Client Hub card: 1px line border, 10px radius, no shadow. `soft` = sidebar tint.
export function HubCard({ soft, className, ...props }: ComponentPropsWithoutRef<'section'> & { soft?: boolean }) {
  return <section className={cn('rounded-card border border-line', soft ? 'bg-sidebar' : 'bg-surface', className)} {...props} />;
}

export function HubCardHeader({
  title,
  description,
  action,
  divided = true,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  divided?: boolean;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 px-6 py-4', divided && 'border-b border-divider')}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-dim">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-inner bg-tile text-dim">{icon}</div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-[13px] text-dim">{text}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
