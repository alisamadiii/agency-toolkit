import { and, count, desc, eq, lt, sql as dsql } from 'drizzle-orm';
import type { z } from 'zod';

import { db } from '@/db';
import { apiKey, notificationChannel, run, runStep, schedule, secret, workflow, workspace, type RunStatus } from '@/db/schema';
import { CHANNELS, SECRET_MASK, type ChannelType } from '@/lib/channels/registry';
import { sendToChannel } from '@/lib/channels/senders';
import { decrypt, encrypt, randomToken, sha256 } from '@/lib/crypto';
import { cronError, nextRun } from '@/lib/cron';
import { allowedHostError } from '@/lib/net';
import type {
  channelCreateSchema,
  channelUpdateSchema,
  Graph,
  scheduleCreateSchema,
  scheduleUpdateSchema,
  workflowCreateSchema,
  workflowUpdateSchema,
  workspaceCreateSchema,
  workspaceUpdateSchema,
} from '@/lib/schemas';

// Business logic shared by the REST API and the dashboard. Every workspace-scoped
// function takes workspaceId and filters by it, so one client can't touch another's data.

export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

const notFound = (what: string) => new ServiceError(404, `${what} not found`);

// ---------- Workspaces (admin) ----------

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'workspace'
  );
}

function checkHosts(hosts: string[]) {
  const errors = hosts.map(allowedHostError).filter(Boolean);
  if (errors.length) throw new ServiceError(400, 'Invalid allowed hosts', errors);
}

export async function listWorkspaces() {
  return db.select().from(workspace).orderBy(workspace.name);
}

export async function getWorkspace(id: string) {
  const [row] = await db.select().from(workspace).where(eq(workspace.id, id));
  if (!row) throw notFound('Workspace');
  return row;
}

export async function createWorkspace(input: z.output<typeof workspaceCreateSchema>) {
  checkHosts(input.allowedHosts);
  if (input.id) {
    const [exists] = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, input.id));
    if (exists) throw new ServiceError(409, 'A workspace with this id already exists');
  }
  let slug = input.slug ?? slugify(input.name);
  const [taken] = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.slug, slug));
  if (taken) {
    if (input.slug) throw new ServiceError(409, 'Slug already in use');
    slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }
  const [row] = await db
    .insert(workspace)
    // A given id (e.g. a hub project id) also becomes the external link.
    .values({ ...input, slug, externalId: input.id ?? null, signingSecret: encrypt(randomToken(32)) })
    .returning();
  return row;
}

export async function updateWorkspace(id: string, input: z.output<typeof workspaceUpdateSchema>) {
  if (input.allowedHosts) checkHosts(input.allowedHosts);
  const [row] = await db.update(workspace).set(input).where(eq(workspace.id, id)).returning();
  if (!row) throw notFound('Workspace');
  return row;
}

export async function deleteWorkspace(id: string) {
  const [row] = await db.delete(workspace).where(eq(workspace.id, id)).returning({ id: workspace.id });
  if (!row) throw notFound('Workspace');
}

export function publicWorkspace(ws: typeof workspace.$inferSelect) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signingSecret, ...rest } = ws;
  return rest;
}

// ---------- API keys ----------

export async function createApiKey(workspaceId: string | null, name: string) {
  if (workspaceId) await getWorkspace(workspaceId);
  const kind = workspaceId ? 'live' : 'admin';
  const full = `fl_${kind}_${randomToken(24)}`;
  const [row] = await db
    .insert(apiKey)
    .values({ workspaceId, name, prefix: full.slice(0, 14), hash: sha256(full) })
    .returning();
  // `key` is returned once and never stored.
  return { ...publicKey(row), key: full };
}

export async function listApiKeys(workspaceId: string | null) {
  const rows = await db
    .select()
    .from(apiKey)
    .where(workspaceId ? eq(apiKey.workspaceId, workspaceId) : dsql`${apiKey.workspaceId} IS NULL`)
    .orderBy(desc(apiKey.createdAt));
  return rows.map(publicKey);
}

export async function revokeApiKey(id: string, workspaceId?: string | null) {
  const where = workspaceId === undefined ? eq(apiKey.id, id) : and(eq(apiKey.id, id), eq(apiKey.workspaceId, workspaceId ?? ''));
  const [row] = await db.update(apiKey).set({ revokedAt: new Date() }).where(where).returning();
  if (!row) throw notFound('API key');
  return publicKey(row);
}

function publicKey(row: typeof apiKey.$inferSelect) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hash, ...rest } = row;
  return rest;
}

// ---------- Secrets ----------

export async function listSecrets(workspaceId: string) {
  return db
    .select({ name: secret.name, updatedAt: secret.updatedAt })
    .from(secret)
    .where(eq(secret.workspaceId, workspaceId))
    .orderBy(secret.name);
}

export async function putSecret(workspaceId: string, name: string, value: string) {
  await db
    .insert(secret)
    .values({ workspaceId, name, value: encrypt(value) })
    .onConflictDoUpdate({
      target: [secret.workspaceId, secret.name],
      set: { value: encrypt(value), updatedAt: new Date() },
    });
  return { name };
}

export async function deleteSecret(workspaceId: string, name: string) {
  const [row] = await db
    .delete(secret)
    .where(and(eq(secret.workspaceId, workspaceId), eq(secret.name, name)))
    .returning({ name: secret.name });
  if (!row) throw notFound('Secret');
}

// ---------- Workflows ----------

export async function listWorkflows(workspaceId: string) {
  return db.select().from(workflow).where(eq(workflow.workspaceId, workspaceId)).orderBy(desc(workflow.createdAt));
}

export async function getWorkflow(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.id, id), eq(workflow.workspaceId, workspaceId)));
  if (!row) throw notFound('Workflow');
  return row;
}

export async function createWorkflow(workspaceId: string, input: z.output<typeof workflowCreateSchema>) {
  const ws = await getWorkspace(workspaceId);
  const [{ value }] = await db.select({ value: count() }).from(workflow).where(eq(workflow.workspaceId, workspaceId));
  if (value >= ws.maxWorkflows) throw new ServiceError(403, `Workspace limit of ${ws.maxWorkflows} workflows reached`);
  await checkChannelRefs(workspaceId, input.graph, input.alertChannelIds);
  const [row] = await db
    .insert(workflow)
    .values({ ...input, workspaceId, triggerToken: randomToken(24) })
    .returning();
  return row;
}

// Notify nodes and alerts may only use this workspace's own channels.
async function checkChannelRefs(workspaceId: string, graph?: Graph, alertChannelIds?: string[]) {
  const ids = new Set(alertChannelIds ?? []);
  for (const n of graph?.nodes ?? []) if (n.type === 'notify') ids.add(n.config.channelId);
  if (!ids.size) return;
  const own = new Set(
    (await db.select({ id: notificationChannel.id }).from(notificationChannel).where(eq(notificationChannel.workspaceId, workspaceId))).map(
      (c) => c.id
    )
  );
  const missing = [...ids].filter((id) => !own.has(id));
  if (missing.length) throw new ServiceError(400, 'Unknown notification channel for this workspace', missing);
}

export async function updateWorkflow(workspaceId: string, id: string, input: z.output<typeof workflowUpdateSchema>) {
  await checkChannelRefs(workspaceId, input.graph, input.alertChannelIds);
  const [row] = await db
    .update(workflow)
    .set({ ...input, version: dsql`${workflow.version} + 1`, updatedAt: new Date() })
    .where(and(eq(workflow.id, id), eq(workflow.workspaceId, workspaceId)))
    .returning();
  if (!row) throw notFound('Workflow');
  return row;
}

export async function deleteWorkflow(workspaceId: string, id: string) {
  const [row] = await db
    .delete(workflow)
    .where(and(eq(workflow.id, id), eq(workflow.workspaceId, workspaceId)))
    .returning({ id: workflow.id });
  if (!row) throw notFound('Workflow');
}

export async function rotateTriggerToken(workspaceId: string, id: string) {
  const [row] = await db
    .update(workflow)
    .set({ triggerToken: randomToken(24) })
    .where(and(eq(workflow.id, id), eq(workflow.workspaceId, workspaceId)))
    .returning();
  if (!row) throw notFound('Workflow');
  return row;
}

// ---------- Schedules ----------

export async function listSchedules(workspaceId: string, workflowId?: string) {
  return db
    .select()
    .from(schedule)
    .where(
      workflowId
        ? and(eq(schedule.workspaceId, workspaceId), eq(schedule.workflowId, workflowId))
        : eq(schedule.workspaceId, workspaceId)
    )
    .orderBy(schedule.createdAt);
}

function checkCron(cron: string, timezone: string) {
  const error = cronError(cron, timezone);
  if (error) throw new ServiceError(400, `Invalid schedule: ${error}`);
}

export async function createSchedule(workspaceId: string, workflowId: string, input: z.output<typeof scheduleCreateSchema>) {
  await getWorkflow(workspaceId, workflowId);
  checkCron(input.cron, input.timezone);
  const [row] = await db
    .insert(schedule)
    .values({ ...input, workflowId, workspaceId, nextRunAt: nextRun(input.cron, input.timezone) })
    .returning();
  return row;
}

export async function updateSchedule(workspaceId: string, id: string, input: z.output<typeof scheduleUpdateSchema>) {
  const [current] = await db
    .select()
    .from(schedule)
    .where(and(eq(schedule.id, id), eq(schedule.workspaceId, workspaceId)));
  if (!current) throw notFound('Schedule');
  const cron = input.cron ?? current.cron;
  const timezone = input.timezone ?? current.timezone;
  checkCron(cron, timezone);
  const [row] = await db
    .update(schedule)
    .set({ ...input, nextRunAt: nextRun(cron, timezone) })
    .where(eq(schedule.id, id))
    .returning();
  return row;
}

export async function deleteSchedule(workspaceId: string, id: string) {
  const [row] = await db
    .delete(schedule)
    .where(and(eq(schedule.id, id), eq(schedule.workspaceId, workspaceId)))
    .returning({ id: schedule.id });
  if (!row) throw notFound('Schedule');
}

// ---------- Runs ----------

export async function listRuns(
  workspaceId: string,
  opts: { workflowId?: string; status?: RunStatus; before?: Date; limit?: number }
) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const conditions = [eq(run.workspaceId, workspaceId)];
  if (opts.workflowId) conditions.push(eq(run.workflowId, opts.workflowId));
  if (opts.status) conditions.push(eq(run.status, opts.status));
  if (opts.before) conditions.push(lt(run.queuedAt, opts.before));
  const rows = await db
    .select({
      id: run.id,
      workflowId: run.workflowId,
      trigger: run.trigger,
      status: run.status,
      attempt: run.attempt,
      error: run.error,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    })
    .from(run)
    .where(and(...conditions))
    .orderBy(desc(run.queuedAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    data: page,
    nextCursor: rows.length > limit ? page[page.length - 1].queuedAt.toISOString() : null,
  };
}

export async function getRun(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(run)
    .where(and(eq(run.id, id), eq(run.workspaceId, workspaceId)));
  if (!row) throw notFound('Run');
  const steps = await db.select().from(runStep).where(eq(runStep.runId, id)).orderBy(runStep.position);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { lockedBy, leaseUntil, ...rest } = row;
  return { ...rest, steps };
}

// ---------- Notification channels (per workspace) ----------

type ChannelRow = typeof notificationChannel.$inferSelect;

function readConfig(row: ChannelRow): Record<string, unknown> {
  try {
    return JSON.parse(decrypt(row.config));
  } catch {
    return {};
  }
}

// Secret fields are replaced by a mask; everything else is returned as-is.
export function publicChannel(row: ChannelRow) {
  const config = readConfig(row);
  for (const f of CHANNELS[row.type].fields) {
    if (f.secret && config[f.key]) config[f.key] = SECRET_MASK;
  }
  return { id: row.id, name: row.name, type: row.type, enabled: row.enabled, config, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function validConfig(type: ChannelType, config: Record<string, unknown>) {
  const parsed = CHANNELS[type].schema.safeParse(config);
  if (!parsed.success) {
    throw new ServiceError(
      400,
      'Invalid channel settings',
      parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`)
    );
  }
  return parsed.data as Record<string, unknown>;
}

export async function listChannels(workspaceId: string) {
  const rows = await db
    .select()
    .from(notificationChannel)
    .where(eq(notificationChannel.workspaceId, workspaceId))
    .orderBy(notificationChannel.createdAt);
  return rows.map(publicChannel);
}

async function channelRow(workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(notificationChannel)
    .where(and(eq(notificationChannel.id, id), eq(notificationChannel.workspaceId, workspaceId)));
  if (!row) throw notFound('Channel');
  return row;
}

export async function getChannel(workspaceId: string, id: string) {
  return publicChannel(await channelRow(workspaceId, id));
}

// Decrypted config for sending (server only).
export async function channelForSend(workspaceId: string, id: string) {
  const row = await channelRow(workspaceId, id);
  return { row, config: readConfig(row) };
}

export async function createChannel(workspaceId: string, input: z.output<typeof channelCreateSchema>) {
  await getWorkspace(workspaceId);
  const config = validConfig(input.type, input.config);
  const [row] = await db
    .insert(notificationChannel)
    .values({ workspaceId, name: input.name, type: input.type, enabled: input.enabled, config: encrypt(JSON.stringify(config)) })
    .returning();
  return publicChannel(row);
}

export async function updateChannel(workspaceId: string, id: string, input: z.output<typeof channelUpdateSchema>) {
  const row = await channelRow(workspaceId, id);
  const patch: Partial<typeof notificationChannel.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.config) {
    const current = readConfig(row);
    const next: Record<string, unknown> = { ...current, ...input.config };
    // Masked or omitted secrets keep the stored value.
    for (const f of CHANNELS[row.type].fields) {
      if (f.secret && (next[f.key] === SECRET_MASK || next[f.key] === undefined)) next[f.key] = current[f.key];
    }
    patch.config = encrypt(JSON.stringify(validConfig(row.type, next)));
  }
  const [updated] = await db.update(notificationChannel).set(patch).where(eq(notificationChannel.id, id)).returning();
  return publicChannel(updated);
}

export async function deleteChannel(workspaceId: string, id: string) {
  await channelRow(workspaceId, id);
  // Drop it from alert lists so workflows stay valid.
  await db
    .update(workflow)
    .set({ alertChannelIds: dsql`array_remove(${workflow.alertChannelIds}, ${id}::uuid)` })
    .where(eq(workflow.workspaceId, workspaceId));
  await db.delete(notificationChannel).where(eq(notificationChannel.id, id));
}

export async function testChannel(workspaceId: string, id: string, to?: string) {
  const { row, config } = await channelForSend(workspaceId, id);
  const result = await sendToChannel(row.type, config, {
    title: 'Test from Flows',
    message: `This is a test notification for the "${row.name}" channel. If you can read this, it works.`,
    to,
    level: 'info',
  });
  return result;
}
