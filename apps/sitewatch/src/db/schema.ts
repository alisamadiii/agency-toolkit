import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  unique,
  integer,
  jsonb,
  date,
  index,
} from 'drizzle-orm/pg-core';

// ---------- Better Auth tables ----------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('user'),
  // Read/create API access token (visible + regenerable in Account settings).
  apiKey: text('api_key').unique(),
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

// ---------- Monitoring ----------

// Optional per-client configs. Everything works with just a baseUrl; these
// unlock the deeper checks when filled in later.
export type FormConfig = {
  pageUrl: string;
  fields: Record<string, string>; // CSS selector -> value to type
  submitSelector: string;
  successSelector: string;
};

export type QuoteConfig = {
  endpoint: string;
  method: 'POST' | 'PUT';
  sampleBody: Record<string, unknown>;
  expectKeys: string[]; // keys that must exist in the JSON response
};

// Repeatable HTTP endpoint monitors, hit on every crawl. A check fails (and
// opens an incident) when the status/keys don't match.
export type EndpointCheck = {
  id: string; // stable; used for row key + incident fingerprint
  name: string;
  url: string; // absolute URL or path resolved against baseUrl
  method: 'GET' | 'POST' | 'PUT';
  body?: string | null; // raw JSON string (POST/PUT)
  expectStatus?: number | null; // default: any 2xx (res.ok)
  expectKeys?: string[] | null; // keys that must exist in the JSON response
};

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  checkEveryHours: integer('check_every_hours').notNull().default(24),
  sitemapUrl: text('sitemap_url'),
  criticalPaths: jsonb('critical_paths').$type<string[]>(),
  cdnHosts: jsonb('cdn_hosts').$type<string[]>(),
  formConfig: jsonb('form_config').$type<FormConfig>(),
  quoteConfig: jsonb('quote_config').$type<QuoteConfig>(),
  endpointChecks: jsonb('endpoint_checks').$type<EndpointCheck[]>(),
  // Uptime pulse state (tier 1): streak-based so a single blip never alerts.
  uptimeStatus: text('uptime_status', { enum: ['unknown', 'up', 'down'] })
    .notNull()
    .default('unknown'),
  uptimeFailStreak: integer('uptime_fail_streak').notNull().default(0),
  lastUptimeAt: timestamp('last_uptime_at'),
  // Cert + domain expiry, refreshed on every deep crawl so the dashboard can
  // always show "valid until" — not just when they're about to expire.
  sslValidTo: timestamp('ssl_valid_to'),
  domainExpiry: timestamp('domain_expiry'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
    lastSeenInSitemapAt: timestamp('last_seen_in_sitemap_at').notNull().defaultNow(),
  },
  (t) => [unique().on(t.clientId, t.url)]
);

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  // Set when this crawl was part of a scheduled/manual deep-crawl job; null
  // for a single-site Run-now or the initial crawl on add.
  jobExecutionId: uuid('job_execution_id'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
  // error = the crawl itself crashed, not the website.
  status: text('status', {
    enum: ['running', 'ok', 'degraded', 'failed', 'error'],
  })
    .notNull()
    .default('running'),
  pagesTotal: integer('pages_total').notNull().default(0),
  pagesChecked: integer('pages_checked').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  warningCount: integer('warning_count').notNull().default(0),
});

// checkType values live in src/lib/checker/types.ts (plain text column so
// new checks never need a migration).
export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    pageUrl: text('page_url').notNull(),
    checkType: text('check_type').notNull(),
    severity: text('severity', { enum: ['error', 'warning'] }).notNull(),
    message: text('message').notNull(),
    details: jsonb('details'),
  },
  (t) => [index('findings_run_idx').on(t.runId)]
);

// One row per distinct problem; alerts fire only on open and on resolve,
// never on repeats — that's what keeps Discord quiet between state changes.
export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    checkType: text('check_type').notNull(),
    pageUrl: text('page_url').notNull(),
    severity: text('severity', { enum: ['error', 'warning'] }).notNull(),
    message: text('message').notNull(),
    details: jsonb('details'),
    firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
    alertedAt: timestamp('alerted_at'),
    // Muted by the user: hidden from the active Problems list and never
    // re-alerts, even if the finding flaps (resolves then reopens). Sticky per
    // fingerprint — see reconcileIncidents.
    ignoredAt: timestamp('ignored_at'),
  },
  (t) => [index('incidents_client_idx').on(t.clientId, t.fingerprint)]
);

export const uptimeChecks = pgTable(
  'uptime_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    checkedAt: timestamp('checked_at').notNull().defaultNow(),
    ok: boolean('ok').notNull(),
    status: integer('status'),
    responseMs: integer('response_ms'),
    error: text('error'),
  },
  (t) => [index('uptime_client_time_idx').on(t.clientId, t.checkedAt)]
);

export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['discord', 'slack', 'telegram', 'email', 'webhook'],
    }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    config: jsonb('config').notNull().default({}),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.type)]
);

export const jobRuns = pgTable('job_runs', {
  jobName: text('job_name').primaryKey(),
  lastRunAt: timestamp('last_run_at'),
  lastSuccessDate: date('last_success_date'),
  lastError: text('last_error'),
});

// Singleton global config (one row, id = 'global'). Drives the scheduler.
export const settings = pgTable('settings', {
  id: text('id').primaryKey().default('global'),
  uptimePulseIntervalMinutes: integer('uptime_pulse_interval_minutes')
    .notNull()
    .default(5),
  deepCrawlIntervalHours: integer('deep_crawl_interval_hours').notNull().default(24),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Append-only history: one row per actual job run (the Jobs page reads this).
export const jobExecutions = pgTable(
  'job_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobName: text('job_name').notNull(),
    trigger: text('trigger', { enum: ['scheduled', 'manual'] })
      .notNull()
      .default('scheduled'),
    status: text('status', { enum: ['running', 'ok', 'failed'] })
      .notNull()
      .default('running'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
    durationMs: integer('duration_ms'),
    result: jsonb('result'),
    error: text('error'),
  },
  (t) => [index('job_exec_name_time_idx').on(t.jobName, t.startedAt)]
);

export type Client = typeof clients.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type UptimeCheck = typeof uptimeChecks.$inferSelect;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type JobExecution = typeof jobExecutions.$inferSelect;
