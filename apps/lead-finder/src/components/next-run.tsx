'use client';

import * as React from 'react';

// Live countdown to the next scheduled run.
export function NextRunCountdown({ at }: { at: string | null }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!at) return <span className="text-muted-foreground">Paused</span>;
  const ms = Math.max(0, new Date(at).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return (
    <span className="font-mono tabular-nums">
      {h}h {String(m).padStart(2, '0')}m {String(s).padStart(2, '0')}s
    </span>
  );
}
