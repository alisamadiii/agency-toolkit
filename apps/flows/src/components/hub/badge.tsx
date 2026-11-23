import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type BadgeTone = 'success' | 'neutral' | 'coral' | 'info' | 'warning' | 'danger';

const tones: Record<BadgeTone, string> = {
  success: 'bg-success-soft text-success-text',
  neutral: 'bg-badge-neutral text-ink-3',
  coral: 'bg-coral-soft text-coral-deep',
  info: 'bg-info-soft text-info-text',
  warning: 'bg-warning-soft text-ink-3',
  danger: 'bg-danger-soft text-danger',
};

// Client Hub badge: 22px tall, 4px radius, 12px/500.
export function HubBadge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1.5 rounded px-2 text-xs font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

const statusTone: Record<string, { text: string; dot: string; label: string }> = {
  success: { text: 'text-success-text', dot: 'bg-success', label: 'Success' },
  failed: { text: 'text-danger', dot: 'bg-danger', label: 'Failed' },
  timeout: { text: 'text-danger', dot: 'bg-warning', label: 'Timed out' },
  running: { text: 'text-info-text', dot: 'bg-info animate-pulse', label: 'Running' },
  queued: { text: 'text-dim', dot: 'bg-faint', label: 'Queued' },
  cancelled: { text: 'text-dim', dot: 'bg-faint', label: 'Cancelled' },
  skipped: { text: 'text-dim', dot: 'bg-faint', label: 'Skipped' },
};

// "● Success" style inline status, as in the hub tables.
export function RunStatus({ status }: { status: string }) {
  const t = statusTone[status] ?? statusTone.queued;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium', t.text)}>
      <span className={cn('size-[7px] rounded-full', t.dot)} />
      {t.label}
    </span>
  );
}
