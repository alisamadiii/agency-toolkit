import { startReaper } from './reaper';
import { startScheduler } from './scheduler';
import { startWorker } from './worker';

declare global {
  var __flowsEngine: boolean | undefined;
}

// ROLE=all (default) runs everything; ROLE=web serves only the API/dashboard.
// Add capacity by running more containers with ROLE=worker (same image).
export async function startEngine() {
  if (globalThis.__flowsEngine) return;
  globalThis.__flowsEngine = true;
  const role = process.env.ROLE ?? 'all';
  if (role === 'web') return;
  startScheduler();
  startReaper();
  await startWorker();
}
