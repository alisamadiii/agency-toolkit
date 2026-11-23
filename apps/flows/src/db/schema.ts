import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { ChannelType } from '@/lib/channels/registry';
import type { Graph } from '@/lib/schemas';

// ---------- Better Auth tables (admin dashboard login) ----------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('user'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------- Tenancy ----------

// One per client. Every workflow, secret, run and key belongs to exactly one.
export const workspace = pgTable('workspace', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // The client hub project this workspace belongs to (one workspace per hub project).
  externalId: text('external_id').unique(),
  // Hosts HTTP and script steps may reach. "*" means any public host (admin only).
  allowedHosts: text('allowed_hosts').array().notNull().default(sql`'{}'::text[]`),
  maxWorkflows: integer('max_workflows').notNull().default(50),
  maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(2),
  // Signs finish webhooks (HMAC-SHA256). Encrypted like secrets.
  signingSecret: text('signing_secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Only the SHA-256 of a key is stored; the full key is shown once at creation.
export const apiKey = pgTable(
  'api_key',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null = admin key (manages workspaces, can act on any workspace).
    workspaceId: uuid('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_key_workspace_idx').on(t.workspaceId)]
);

// Values are AES-256-GCM encrypted with MASTER_KEY and never returned by the API.
export const secret = pgTable(
  'secret',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('secret_workspace_name_idx').on(t.workspaceId, t.name)]
);

// ---------- Client hub embed ----------

export const EMBED_ROLES = ['view-only', 'content-editor', 'full-access'] as const;
export type EmbedRole = (typeof EMBED_ROLES)[number];

// Single-use, short-lived ticket the hub's server trades for an /iframe session.
// Only the SHA-256 of the ticket is stored.
export const embedTicket = pgTable('embed_ticket', {
  id: uuid('id').primaryKey().defaultRandom(),
  hash: text('hash').notNull().unique(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  role: text('role').$type<EmbedRole>().notNull(),
  user: jsonb('user').$type<{ id?: string; email?: string; name?: string }>().notNull().default({}),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Integrations (apps a workspace connects, e.g. Google Calendar) ----------

export const INTEGRATION_PROVIDERS = ['google_calendar'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

// One connected account per provider per workspace. Tokens are AES-GCM encrypted.
export const integration = pgTable(
  'integration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<IntegrationProvider>().notNull(),
    accountEmail: text('account_email').notNull(),
    accountName: text('account_name'),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: text('status').$type<'connected' | 'needs_reconnect'>().notNull().default('connected'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('integration_workspace_provider_idx').on(t.workspaceId, t.provider)]
);

// OAuth "state" for a connect popup: single use, 10 minutes, carries the workspace.
export const oauthState = pgTable('oauth_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  hash: text('hash').notNull().unique(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspace.id, { onDelete: 'cascade' }),
  provider: text('provider').$type<IntegrationProvider>().notNull(),
  // PKCE verifier, encrypted.
  codeVerifier: text('code_verifier').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Notifications ----------

// A workspace's own notification destination (its Slack, its Twilio account…).
// `config` is AES-GCM encrypted JSON; secret fields never leave the server.
export const notificationChannel = pgTable(
  'notification_channel',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').$type<ChannelType>().notNull(),
    config: text('config').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notification_channel_workspace_idx').on(t.workspaceId)]
);

// ---------- Workflows ----------

export const workflow = pgTable(
  'workflow',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    enabled: boolean('enabled').notNull().default(true),
    // Canvas: nodes (trigger, http, code, if) and the connections between them.
    graph: jsonb('graph').$type<Graph>().notNull(),
    // Whole-run limit; each node also has its own timeout.
    timeoutSec: integer('timeout_sec').notNull().default(300),
    // Whole-run retries after a failure (attempts = maxAttempts).
    maxAttempts: integer('max_attempts').notNull().default(1),
    // POSTed a signed run summary when a run finishes.
    onFinishUrl: text('on_finish_url'),
    // Run alerts: which of the workspace's channels hear about finished runs, and when.
    alertChannelIds: uuid('alert_channel_ids').array().notNull().default(sql`'{}'::uuid[]`),
    alertOn: text('alert_on').$type<'failure' | 'always' | 'never'>().notNull().default('failure'),
    // Secret part of the public trigger URL /api/hooks/:id/:token.
    triggerToken: text('trigger_token').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('workflow_workspace_idx').on(t.workspaceId)]
);

export const schedule = pgTable(
  'schedule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    cron: text('cron').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    enabled: boolean('enabled').notNull().default(true),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('schedule_due_idx').on(t.nextRunAt).where(sql`${t.enabled}`)]
);

export const RUN_STATUSES = ['queued', 'running', 'success', 'failed', 'cancelled', 'timeout'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_TRIGGERS = ['schedule', 'api', 'webhook', 'manual'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

// The queue. Workers claim queued rows with FOR UPDATE SKIP LOCKED.
export const run = pgTable(
  'run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflow.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    trigger: text('trigger').$type<RunTrigger>().notNull(),
    scheduleId: uuid('schedule_id').references(() => schedule.id, { onDelete: 'set null' }),
    // The cron slot this run fills; unique per schedule so a slot never runs twice.
    scheduleSlot: timestamp('schedule_slot', { withTimezone: true }),
    status: text('status').$type<RunStatus>().notNull().default('queued'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb('output'),
    error: text('error'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(1),
    // Snapshot taken at enqueue, so editing a workflow never changes a queued or running run.
    graph: jsonb('graph').$type<Graph>().notNull(),
    timeoutSec: integer('timeout_sec').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    lockedBy: text('locked_by'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    // Earliest time a queued run may start (used for retry back-off).
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('run_schedule_slot_idx').on(t.scheduleId, t.scheduleSlot),
    index('run_queue_idx').on(t.availableAt).where(sql`${t.status} = 'queued'`),
    index('run_workspace_idx').on(t.workspaceId, t.queuedAt),
    index('run_workflow_idx').on(t.workflowId, t.queuedAt),
  ]
);

export const runStep = pgTable(
  'run_step',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => run.id, { onDelete: 'cascade' }),
    // Node id in the run's graph.
    stepId: text('step_id').notNull(),
    // Topological order, for listing.
    position: integer('position').notNull(),
    type: text('type').notNull(),
    status: text('status').$type<'running' | 'success' | 'failed' | 'skipped'>().notNull(),
    attempts: integer('attempts').notNull().default(1),
    output: jsonb('output'),
    error: text('error'),
    logs: text('logs'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer('duration_ms'),
  },
  (t) => [index('run_step_run_idx').on(t.runId, t.position)]
);
