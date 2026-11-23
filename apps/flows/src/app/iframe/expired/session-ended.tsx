'use client';

import { useEffect } from 'react';

// Tells the hub to fetch a fresh link; the hub only listens to the Flows origin.
export function SessionEnded({ origins }: { origins: string[] }) {
  useEffect(() => {
    if (window.parent === window) return;
    for (const origin of origins) {
      try {
        window.parent.postMessage({ source: 'flows', type: 'session-expired' }, origin);
      } catch {
        // not this origin
      }
    }
  }, [origins]);
  return (
    <div className="grid min-h-svh place-items-center px-6">
      <div className="max-w-sm text-center">
        <p className="text-base font-semibold">Your session ended</p>
        <p className="mt-1 text-sm text-dim">Reload the page to open Automations again.</p>
      </div>
    </div>
  );
}
