'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { EmbedRole } from '@/db/schema';
import { EmbedError, requireEmbed } from '@/lib/embed';
import { cancelRun as cancelQueuedRun, enqueueRun } from '@/lib/engine/queue';
import {
  channelCreateSchema,
  channelUpdateSchema,
  type Graph,
  scheduleCreateSchema,
  secretNameSchema,
  workflowCreateSchema,
} from '@/lib/schemas';
import * as service from '@/lib/service';
import { BLANK, BOOK_A_CALL, EXAMPLE } from '@/lib/workflow-templates';

import type { ActionResult } from '../actions';

// Client hub embed actions. Same signatures as the dashboard actions so the shared
// screens can call either, but the workspace always comes from the signed session
// cookie. A workspaceId sent by the browser must match it, or the call is refused.

async function act<T>(
  min: EmbedRole,
  workspaceId: string | null,
  fn: (workspaceId: string) => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const session = await requireEmbed(min);
    if (workspaceId !== null && workspaceId !== session.workspaceId) {
      throw new EmbedError(403, "You don't have access to that workspace.");
    }
    const data = await fn(session.workspaceId);
    revalidatePath('/iframe', 'layout');
    return { ok: true, data };
  } catch (error) {
    if (error instanceof EmbedError) return { ok: false, error: error.message };
    if (error instanceof service.ServiceError) {
      const details = Array.isArray(error.details) ? `: ${error.details.join(', ')}` : '';
      return { ok: false, error: error.message + details };
    }
    if (error instanceof z.ZodError) return { ok: false, error: z.prettifyError(error) };
    return { ok: false, error: error instanceof Error ? error.message : 'Something went wrong' };
  }
}

// ---------- API keys and secrets ----------

export async function createApiKeyAction(workspaceId: string | null, name: string) {
  return act('full-access', workspaceId ?? '', async (ws) => (await service.createApiKey(ws, name || 'API key')).key);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function revokeApiKeyAction(id: string, _path: string) {
  return act('full-access', null, async (ws) => {
    // Scoped revoke: only keys of this workspace.
    await service.revokeApiKey(id, ws);
  });
}

export async function putSecretAction(workspaceId: string, name: string, value: string) {
  return act('content-editor', workspaceId, async (ws) => {
    await service.putSecret(ws, secretNameSchema.parse(name), value);
  });
}

export async function deleteSecretAction(workspaceId: string, name: string) {
  return act('content-editor', workspaceId, (ws) => service.deleteSecret(ws, name));
}

// ---------- Workflows ----------

export async function createWorkflowAction(workspaceId: string, name: string, template: 'blank' | 'example' | 'book_call') {
  return act('content-editor', workspaceId, async (ws) => {
    const wf = await service.createWorkflow(
      ws,
      workflowCreateSchema.parse({ name: name || 'Untitled workflow', graph: template === 'example' ? EXAMPLE : template === 'book_call' ? BOOK_A_CALL : BLANK })
    );
    return { id: wf.id };
  });
}

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
  return act('content-editor', workspaceId, async (ws) => {
    const wf = await service.updateWorkflow(
      ws,
      workflowId,
      workflowCreateSchema.parse({ ...input, onFinishUrl: input.onFinishUrl || null })
    );
    return { version: wf.version };
  });
}

export async function getRunAction(runId: string) {
  return act('view-only', null, (ws) => service.getRun(ws, runId));
}

export async function saveWorkflowAction(workspaceId: string, workflowId: string | null, definition: string) {
  return act('content-editor', workspaceId, async (ws) => {
    let raw: unknown;
    try {
      raw = JSON.parse(definition);
    } catch {
      throw new Error('Workflow must be valid JSON');
    }
    const input = workflowCreateSchema.parse(raw);
    const wf = workflowId ? await service.updateWorkflow(ws, workflowId, input) : await service.createWorkflow(ws, input);
    return { id: wf.id };
  });
}

export async function deleteWorkflowAction(workspaceId: string, workflowId: string) {
  return act('content-editor', workspaceId, (ws) => service.deleteWorkflow(ws, workflowId));
}

export async function runWorkflowAction(workspaceId: string, workflowId: string, input: string) {
  return act('content-editor', workspaceId, async (ws) => {
    let parsed: Record<string, unknown> = {};
    if (input.trim()) {
      try {
        parsed = JSON.parse(input);
      } catch {
        throw new Error('Input must be valid JSON');
      }
    }
    const run = await enqueueRun({ workflowId, workspaceId: ws, trigger: 'manual', input: parsed });
    return { runId: run.id };
  });
}

export async function cancelRunAction(workspaceId: string, runId: string) {
  return act('content-editor', workspaceId, async (ws) => {
    const result = await cancelQueuedRun(runId, ws);
    if (!result) throw new Error('Run is not queued or running');
  });
}

// ---------- Schedules ----------

export async function createScheduleAction(workspaceId: string, workflowId: string, input: { cron: string; timezone: string }) {
  return act('content-editor', workspaceId, async (ws) => {
    await service.createSchedule(ws, workflowId, scheduleCreateSchema.parse(input));
  });
}

export async function toggleScheduleAction(workspaceId: string, _workflowId: string, id: string, enabled: boolean) {
  return act('content-editor', workspaceId, async (ws) => {
    await service.updateSchedule(ws, id, { enabled });
  });
}

export async function deleteScheduleAction(workspaceId: string, _workflowId: string, id: string) {
  return act('content-editor', workspaceId, (ws) => service.deleteSchedule(ws, id));
}

export async function rotateTriggerAction(workspaceId: string, workflowId: string) {
  return act('content-editor', workspaceId, async (ws) => {
    await service.rotateTriggerToken(ws, workflowId);
  });
}

// ---------- Notification channels ----------

export async function createChannelAction(workspaceId: string, input: { name: string; type: string; config: Record<string, unknown> }) {
  return act('content-editor', workspaceId, async (ws) => {
    const ch = await service.createChannel(ws, channelCreateSchema.parse(input));
    return { id: ch.id };
  });
}

export async function updateChannelAction(
  workspaceId: string,
  id: string,
  input: { name?: string; enabled?: boolean; config?: Record<string, unknown> }
) {
  return act('content-editor', workspaceId, async (ws) => {
    await service.updateChannel(ws, id, channelUpdateSchema.parse(input));
  });
}

export async function deleteChannelAction(workspaceId: string, id: string) {
  return act('content-editor', workspaceId, (ws) => service.deleteChannel(ws, id));
}

export async function testChannelAction(workspaceId: string, id: string, to?: string) {
  return act('content-editor', workspaceId, async (ws) => {
    const result = await service.testChannel(ws, id, to || undefined);
    if (!result.ok) throw new Error(result.error ?? 'Send failed');
    return { to: result.to ?? null };
  });
}
