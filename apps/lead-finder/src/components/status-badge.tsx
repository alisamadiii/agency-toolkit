import { Badge } from '@/components/ui/badge';
import type { LeadStatus, Run } from '@/db/schema';
import { cn } from '@/lib/utils';

const LEAD_TONE: Record<LeadStatus, string> = {
  new: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  designing: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  design_ready: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  contacted: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  won: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  lost: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  skipped: 'bg-muted text-muted-foreground',
  hidden: 'bg-muted text-muted-foreground/70',
};

export const statusLabel = (s: string) => s.replace('_', ' ');

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge variant="outline" className={cn('border-transparent capitalize', LEAD_TONE[status])}>
      {statusLabel(status)}
    </Badge>
  );
}

const RUN_TONE: Record<Run['status'], string> = {
  running: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

export function RunStatusBadge({ status }: { status: Run['status'] }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 border-transparent capitalize', RUN_TONE[status])}>
      <span
        className={cn(
          'size-1.5 rounded-full bg-current',
          status === 'running' && 'animate-pulse'
        )}
      />
      {status}
    </Badge>
  );
}
