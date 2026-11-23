import Link from 'next/link';

import { StatusBadge } from '@/components/status-badge';

type Row = {
  id: string;
  status: string;
  trigger: string;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  workflowName?: string;
};

function duration(r: Row) {
  if (!r.startedAt || !r.finishedAt) return '—';
  const ms = r.finishedAt.getTime() - r.startedAt.getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function RunsTable({ runs, showWorkflow = false }: { runs: Row[]; showWorkflow?: boolean }) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">Status</th>
            {showWorkflow && <th className="p-2 font-medium">Workflow</th>}
            <th className="p-2 font-medium">Trigger</th>
            <th className="p-2 font-medium">Queued</th>
            <th className="p-2 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {runs.map((r) => (
            <tr key={r.id} className="hover:bg-muted/30">
              <td className="p-2">
                <Link href={`/runs/${r.id}`} className="block">
                  <StatusBadge status={r.status} />
                </Link>
              </td>
              {showWorkflow && <td className="p-2">{r.workflowName}</td>}
              <td className="p-2 capitalize">{r.trigger}</td>
              <td className="p-2 whitespace-nowrap">
                <Link href={`/runs/${r.id}`} className="hover:underline">
                  {r.queuedAt.toLocaleString()}
                </Link>
              </td>
              <td className="p-2">{duration(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
