import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STYLES: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-400',
  timeout: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  running: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  queued: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  skipped: 'bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge className={cn('capitalize', STYLES[status])}>{status}</Badge>;
}
