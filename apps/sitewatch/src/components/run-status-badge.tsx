import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

export function RunStatusBadge({ status }: { status: string }) {
  if (status === 'running')
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" /> running
      </Badge>
    );
  if (status === 'ok')
    return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">ok</Badge>;
  if (status === 'degraded') return <Badge variant="secondary">degraded</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
}
