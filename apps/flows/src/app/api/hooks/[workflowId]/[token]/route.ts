import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { db } from '@/db';
import { workflow } from '@/db/schema';
import { safeEqual } from '@/lib/crypto';
import { EnqueueError, enqueueRun } from '@/lib/engine/queue';

// Public trigger: POST any JSON body; it becomes the run's input.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/hooks/[workflowId]/[token]'>) {
  const { workflowId, token } = await ctx.params;
  if (!z.uuid().safeParse(workflowId).success) return Response.json({ error: 'Not found' }, { status: 404 });

  const [wf] = await db.select().from(workflow).where(and(eq(workflow.id, workflowId)));
  if (!wf || !safeEqual(wf.triggerToken, token)) return Response.json({ error: 'Not found' }, { status: 404 });

  let input: Record<string, unknown> = {};
  const text = await req.text();
  if (text.length > 256 * 1024) return Response.json({ error: 'Body too large' }, { status: 413 });
  if (text) {
    try {
      const parsed = JSON.parse(text);
      input = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { body: parsed };
    } catch {
      input = { body: text };
    }
  }
  try {
    const run = await enqueueRun({ workflowId, workspaceId: wf.workspaceId, trigger: 'webhook', input });
    return Response.json({ runId: run.id }, { status: 202 });
  } catch (error) {
    if (error instanceof EnqueueError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
