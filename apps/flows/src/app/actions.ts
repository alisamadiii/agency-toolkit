'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { run } from '@/db/schema';
import { enqueueRun, cancelRun as cancelQueuedRun } from '@/lib/engine/queue';
import {
  channelCreateSchema,
  channelUpdateSchema,
  type Graph,
  scheduleCreateSchema,
  secretNameSchema,
  workflowCreateSchema,
  workspaceCreateSchema,
  workspaceUpdateSchema,
} from '@/lib/schemas';
import * as service from '@/lib/service';
import { requireSession } from '@/lib/session';

// Dashboard mutations. Every action checks the owner session first.

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function act<T>(fn: () => Promise<T>, path?: string): Promise<ActionResult<T>> {
  await requireSession();
  try {
    const data = await fn();
    if (path) revalidatePath(path);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof service.ServiceError) {
      const details = Array.isArray(error.details) ? `: ${error.details.join(', ')}` : '';
      return { ok: false, error: error.message + details };
    }
    if (error instanceof z.ZodError) return { ok: false, error: z.prettifyError(error) };
    return { ok: false, error: error instanceof Error ? error.message : 'Something went wrong' };
  }
}

const hostsFrom = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);

export async function createWorkspaceAction(input: { name: string; allowedHosts: string }) {
  return act(async () => {
    const ws = await service.createWorkspace(
      workspaceCreateSchema.parse({ name: input.name, allowedHosts: hostsFrom(input.allowedHosts) })
    );
    return { id: ws.id };
  }, '/');
}

export async function updateWorkspaceAction(
  id: string,
  input: { name: string; allowedHosts: string; maxWorkflows: number; maxConcurrentRuns: number }
) {
  return act(async () => {
    await service.updateWorkspace(
      id,
      workspaceUpdateSchema.parse({ ...input, allowedHosts: hostsFrom(input.allowedHosts) })
    );
  }, `/w/${id}`);
}

export async function deleteWorkspaceAction(id: string) {
  return act(() => service.deleteWorkspace(id), '/');
}

export async function createApiKeyAction(workspaceId: string | null, name: string) {
  return act(async () => (await service.createApiKey(workspaceId, name || 'API key')).key, workspaceId ? `/w/${workspaceId}` : '/');
}

export async function revokeApiKeyAction(id: string, path: string) {
  return act(async () => {
    await service.revokeApiKey(id);
  }, path);
}

export async function putSecretAction(workspaceId: string, name: string, value: string) {
  return act(async () => {
    await service.putSecret(workspaceId, secretNameSchema.parse(name), value);
  }, `/w/${workspaceId}`);
}

export async function deleteSecretAction(workspaceId: string, name: string) {
  return act(() => service.deleteSecret(workspaceId, name), `/w/${workspaceId}`);
}

const BLANK: Graph = {
  nodes: [{ id: 'trigger', type: 'trigger', name: 'Trigger', position: { x: 0, y: 120 }, config: {} }],
  edges: [],
};

// Call an API, branch on the status code, and shape the result on each branch.
const EXAMPLE: Graph = {
  nodes: [
    { id: 'trigger', type: 'trigger', name: 'Trigger', position: { x: 0, y: 120 }, config: {} },
    {
      id: 'fetch',
      type: 'http',
      name: 'Fetch data',
      position: { x: 300, y: 120 },
      config: {
        method: 'GET',
        url: 'https://httpbin.org/json',
        headers: {},
        timeoutSec: 30,
        retries: 0,
        continueOnError: true,
      },
    },
    {
      id: 'ok',
      type: 'if',
      name: 'Status is 200?',
      position: { x: 600, y: 120 },
      config: { conditions: [{ left: '{{nodes.fetch.output.status}}', op: 'equals', right: '200' }], combine: 'and' },
    },
    {
      id: 'summarize',
      type: 'code',
      name: 'Summarize',
      position: { x: 920, y: 30 },
      config: {
        code: 'export default async ({ nodes }) => {\n  const slides = nodes.fetch.output.body.slideshow.slides;\n  console.log(`found ${slides.length} slides`);\n  return { title: nodes.fetch.output.body.slideshow.title, slides: slides.length };\n};\n',
        timeoutSec: 30,
        retries: 0,
        continueOnError: false,
      },
    },
    {
      id: 'report_error',
      type: 'code',
      name: 'Report error',
      position: { x: 920, y: 220 },
      config: {
        code: 'export default async ({ nodes }) => ({ failed: true, detail: nodes.fetch.output });\n',
        timeoutSec: 30,
        retries: 0,
        continueOnError: false,
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'fetch', sourceHandle: null },
    { id: 'e2', source: 'fetch', target: 'ok', sourceHandle: null },
    { id: 'e3', source: 'ok', target: 'summarize', sourceHandle: 'true' },
    { id: 'e4', source: 'ok', target: 'report_error', sourceHandle: 'false' },
  ],
};

export async function createWorkflowAction(workspaceId: string, name: string, template: 'blank' | 'example') {
  return act(async () => {
    const wf = await service.createWorkflow(
      workspaceId,
      workflowCreateSchema.parse({ name: name || 'Untitled workflow', graph: template === 'example' ? EXAMPLE : BLANK })
    );
    return { id: wf.id };
  }, `/w/${workspaceId}`);
}

// Saves the canvas and settings.
export async function saveGraphAction(
  workspaceId: string,
  workflowId: string,
  input: {
    name: string;
    enabled: boolean;
    description: string | null;
    timeoutSec: number;
    maxAttempts: number;
    onFinishUrl: string | null;
    alertOn: 'failure' | 'always' | 'never';
    alertChannelIds: string[];
    graph: Graph;
  }
) {
  return act(async () => {
    const wf = await service.updateWorkflow(
      workspaceId,
      workflowId,
      workflowCreateSchema.parse({ ...input, onFinishUrl: input.onFinishUrl || null })
    );
    return { version: wf.version };
  }, `/w/${workspaceId}/workflows/${workflowId}`);
}

// Live run state for the canvas.
export async function getRunAction(runId: string) {
  return act(async () => {
    const [ref] = await db.select({ workspaceId: run.workspaceId }).from(run).where(eq(run.id, runId));
    if (!ref) throw new Error('Run not found');
    return service.getRun(ref.workspaceId, runId);
  });
}

// `definition` is the workflow JSON from the "Edit JSON" dialog (name, graph, timeoutSec...).
export async function saveWorkflowAction(workspaceId: string, workflowId: string | null, definition: string) {
  return act(async () => {
    let raw: unknown;
    try {
      raw = JSON.parse(definition);
    } catch {
      throw new Error('Workflow must be valid JSON');
    }
    const input = workflowCreateSchema.parse(raw);
    const wf = workflowId
      ? await service.updateWorkflow(workspaceId, workflowId, input)
      : await service.createWorkflow(workspaceId, input);
    return { id: wf.id };
  }, `/w/${workspaceId}`);
}

export async function deleteWorkflowAction(workspaceId: string, workflowId: string) {
  return act(() => service.deleteWorkflow(workspaceId, workflowId), `/w/${workspaceId}`);
}

export async function runWorkflowAction(workspaceId: string, workflowId: string, input: string) {
  return act(async () => {
    let parsed: Record<string, unknown> = {};
    if (input.trim()) {
      try {
        parsed = JSON.parse(input);
      } catch {
        throw new Error('Input must be valid JSON');
      }
    }
    const run = await enqueueRun({ workflowId, workspaceId, trigger: 'manual', input: parsed });
    return { runId: run.id };
  }, `/w/${workspaceId}/workflows/${workflowId}`);
}

export async function cancelRunAction(workspaceId: string, runId: string) {
  return act(async () => {
    const result = await cancelQueuedRun(runId, workspaceId);
    if (!result) throw new Error('Run is not queued or running');
  }, `/runs/${runId}`);
}

export async function createScheduleAction(
  workspaceId: string,
  workflowId: string,
  input: { cron: string; timezone: string }
) {
  return act(async () => {
    await service.createSchedule(workspaceId, workflowId, scheduleCreateSchema.parse(input));
  }, `/w/${workspaceId}/workflows/${workflowId}`);
}

export async function toggleScheduleAction(workspaceId: string, workflowId: string, id: string, enabled: boolean) {
  return act(async () => {
    await service.updateSchedule(workspaceId, id, { enabled });
  }, `/w/${workspaceId}/workflows/${workflowId}`);
}

export async function deleteScheduleAction(workspaceId: string, workflowId: string, id: string) {
  return act(() => service.deleteSchedule(workspaceId, id), `/w/${workspaceId}/workflows/${workflowId}`);
}

export async function rotateTriggerAction(workspaceId: string, workflowId: string) {
  return act(async () => {
    await service.rotateTriggerToken(workspaceId, workflowId);
  }, `/w/${workspaceId}/workflows/${workflowId}`);
}

// ---------- Notification channels (per workspace) ----------

export async function createChannelAction(workspaceId: string, input: { name: string; type: string; config: Record<string, unknown> }) {
  return act(async () => {
    const ch = await service.createChannel(workspaceId, channelCreateSchema.parse(input));
    return { id: ch.id };
  }, `/w/${workspaceId}`);
}

export async function updateChannelAction(
  workspaceId: string,
  id: string,
  input: { name?: string; enabled?: boolean; config?: Record<string, unknown> }
) {
  return act(async () => {
    await service.updateChannel(workspaceId, id, channelUpdateSchema.parse(input));
  }, `/w/${workspaceId}`);
}

export async function deleteChannelAction(workspaceId: string, id: string) {
  return act(() => service.deleteChannel(workspaceId, id), `/w/${workspaceId}`);
}

export async function testChannelAction(workspaceId: string, id: string, to?: string) {
  return act(async () => {
    const result = await service.testChannel(workspaceId, id, to || undefined);
    if (!result.ok) throw new Error(result.error ?? 'Send failed');
    return { to: result.to ?? null };
  });
}
