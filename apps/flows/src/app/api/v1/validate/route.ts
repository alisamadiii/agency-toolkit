import { body, json, route } from '@/lib/api';
import { cronError, nextRuns } from '@/lib/cron';
import { validateSchema } from '@/lib/schemas';

// Dry run: checks a graph or steps (via the schema) and previews the next 5 cron times.
export const POST = route(async (req) => {
  const input = await body(req, validateSchema);
  const result: Record<string, unknown> = { ok: true };
  if (input.cron) {
    const error = cronError(input.cron, input.timezone);
    result.cron = error
      ? { ok: false, error }
      : { ok: true, next: nextRuns(input.cron, input.timezone, 5).map((d) => d.toISOString()) };
    if (error) result.ok = false;
  }
  if (input.graph) result.graph = { ok: true, nodes: input.graph.nodes.length, edges: input.graph.edges.length };
  if (input.steps) result.steps = { ok: true, count: input.steps.length };
  return json(result);
});
