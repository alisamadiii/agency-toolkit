# Flows

Self-hosted cron jobs and workflows with a REST API. Built so the client hub can let
each client schedule their own automations, and light enough to run as one container
next to Postgres on Coolify.

- **Workflow**: a graph of nodes on a canvas (n8n-style: drag, connect, click to edit).
  A **cron job** is a workflow with a schedule.
- **Nodes**: Trigger, HTTP Request (call any URL on the workspace's allow-list), Code
  (JavaScript/TypeScript run by Deno in a sandbox: no files, no env, no subprocesses,
  network limited to the allow-list, 128 MB memory, per-node timeout) and IF (true/false
  branches). Branches run in parallel; a node with several inputs waits for all of them.
- **Triggers**: cron schedules (with timezone), the API, a public trigger URL, or Run now.
- **Workspaces**: one per client. A workspace API key only sees its own workflows,
  runs and secrets. Admin keys manage workspaces.
- **Secrets**: encrypted with `MASTER_KEY`, write-only through the API, masked in logs.
- **Callbacks**: set `onFinishUrl` and each finished run is POSTed there, signed.
- **Notifications** (per workspace): each client adds their own Slack, Discord, Telegram,
  email (SMTP), SMS and WhatsApp (Twilio), Microsoft Teams, Google Chat, ntfy or webhook
  channels. Use them in a **Notify** node, or as **run alerts** (on failure or every run).
- **Dashboard**: a small owner-only UI for workspaces, keys, secrets, workflows and run logs.
- **Client hub embed**: `/iframe` gives each hub project its own workspace inside the hub,
  locked to that project (see below).

## How it works

Postgres is the queue (the graphile-worker / pg-boss approach), so there is no Redis.

1. The **scheduler** ticks every 15 s, locks due schedules with `FOR UPDATE SKIP LOCKED`
   and inserts one run per cron slot. A unique (schedule, slot) index means a slot never
   runs twice, even with several containers. Missed slots aren't back-filled: after
   downtime a schedule fires once, then continues on time.
2. **Workers** claim queued runs with `SKIP LOCKED` (respecting each workspace's
   concurrency limit), wake instantly on `LISTEN/NOTIFY`, and run steps in order.
   Each run holds a 60 s lease that the worker renews.
3. The **reaper** re-queues runs whose worker died (expired lease) and deletes runs older
   than `RUN_RETENTION_DAYS`.

To scale, run more containers from the same image with `ROLE=worker`. Locking in Postgres
keeps them from stepping on each other.

## Run locally

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres on :5435
cp .env.example .env.local                       # then fill in the secrets (see below)
pnpm install
pnpm db:migrate
pnpm dev                                         # http://localhost:3300
```

In `.env.local`, set `BETTER_AUTH_SECRET` and `MASTER_KEY` to random strings
(`openssl rand -base64 32`). `pnpm install` downloads Deno into `node_modules`; point
`DENO_BIN` at the real binary, e.g.
`DENO_BIN=$(realpath node_modules/.pnpm/@deno+darwin-arm64@*/node_modules/@deno/darwin-arm64/deno)`.

Open http://localhost:3300, create the owner account (sign-up closes after the first
one), then create an admin key on the home page, or from the terminal:

```bash
pnpm admin-key "Client hub"
```

Check everything end to end (creates and deletes throwaway workspaces):

```bash
FLOWS_ADMIN_KEY=fl_admin_... pnpm smoke
SMOKE_WAIT_SCHEDULE=1 FLOWS_ADMIN_KEY=fl_admin_... pnpm smoke   # also waits for a cron run
```

## API quickstart

All endpoints are under `/api/v1` and take `Authorization: Bearer <key>`. The spec is at
`/api/v1/openapi.json`. Admin keys act on a workspace by sending `x-workspace-id`.

```bash
URL=http://localhost:3300/api/v1
ADMIN=fl_admin_...

# 1. A workspace per client, and a key for it (the key is shown once)
curl -s $URL/workspaces -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"name":"Acme","allowedHosts":["api.acme.com","httpbin.org"]}'
curl -s $URL/workspaces/<workspaceId>/keys -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"name":"client hub"}'
KEY=fl_live_...

# 2. A secret and a workflow
curl -s -X PUT $URL/secrets/ACME_TOKEN -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"value":"tok_123"}'
curl -s $URL/workflows -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{
  "name": "Daily report",
  "onFinishUrl": "https://hub.example.com/api/flows-callback",
  "steps": [
    { "id": "fetch", "type": "http", "method": "GET",
      "url": "https://api.acme.com/orders?day={{input.day}}",
      "headers": { "authorization": "Bearer {{secrets.ACME_TOKEN}}" } },
    { "id": "summary", "type": "script",
      "code": "export default async ({ steps }) => ({ count: steps.fetch.output.body.length })" }
  ]
}'

# 3. Run it now, or put it on a schedule (that makes it a cron job)
curl -s $URL/workflows/<id>/run -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"input":{"day":"today"}}'
curl -s $URL/workflows/<id>/schedules -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"cron":"0 8 * * *","timezone":"America/New_York","input":{"day":"today"}}'

# 4. Results
curl -s "$URL/runs?workflowId=<id>" -H "authorization: Bearer $KEY"
curl -s $URL/runs/<runId> -H "authorization: Bearer $KEY"     # step outputs and logs
```

| Endpoint | Notes |
|---|---|
| `GET /me` | Which workspace a key belongs to |
| `GET/POST /workspaces`, `GET/PATCH/DELETE /workspaces/:id` | Admin only |
| `GET/POST /workspaces/:id/keys`, `DELETE /keys/:id` | Admin only; keys are stored hashed |
| `GET/POST /workflows`, `GET/PATCH/DELETE /workflows/:id` | Responses include `triggerUrl` |
| `POST /workflows/:id/run` | `{ input }` → `202 { runId }` |
| `POST /workflows/:id/trigger-token` | New trigger URL, old one stops working |
| `GET/POST /workflows/:id/schedules`, `GET /schedules`, `PATCH/DELETE /schedules/:id` | `cron`, `timezone`, `enabled`, `input` |
| `GET /runs?workflowId&status&limit&cursor`, `GET /runs/:id`, `POST /runs/:id/cancel` | Paged with `nextCursor` |
| `GET /secrets`, `PUT/DELETE /secrets/:NAME` | Values are write-only |
| `GET /channel-types`, `GET/POST /channels`, `GET/PATCH/DELETE /channels/:id`, `POST /channels/:id/test` | This workspace's notification channels |
| `GET /signing-secret` | Secret that signs this workspace's callbacks |
| `POST /validate` | Check steps and preview the next 5 cron times |
| `POST /api/hooks/:workflowId/:token` | Public trigger (no key); the JSON body becomes `input` |

### Nodes and connections

A workflow is `{ nodes, edges }` (the dashboard canvas edits the same JSON):

```jsonc
{
  "nodes": [
    { "id": "trigger", "type": "trigger", "name": "Trigger", "position": { "x": 0, "y": 0 }, "config": {} },
    { "id": "fetch", "type": "http", "name": "Fetch", "position": { "x": 300, "y": 0 },
      "config": { "method": "GET", "url": "https://api.acme.com/orders", "headers": {}, "timeoutSec": 30, "retries": 0, "continueOnError": false } },
    { "id": "ok", "type": "if", "name": "OK?", "position": { "x": 600, "y": 0 },
      "config": { "conditions": [{ "left": "{{nodes.fetch.output.status}}", "op": "equals", "right": "200" }], "combine": "and" } },
    { "id": "shape", "type": "code", "name": "Shape", "position": { "x": 900, "y": 0 },
      "config": { "code": "export default async ({ input, nodes, secrets }) => ({ count: nodes.fetch.output.body.length })" } }
  ],
  "edges": [
    { "id": "e1", "source": "trigger", "target": "fetch" },
    { "id": "e2", "source": "fetch", "target": "ok" },
    { "id": "e3", "source": "ok", "target": "shape", "sourceHandle": "true" }
  ]
}
```

- Exactly one trigger; no loops; edges out of an IF need `sourceHandle: "true" | "false"`.
- Instead of `graph` you can send `steps: [...]` (a straight line of `http`/`script` steps);
  it's converted to a graph.
- In HTTP and IF fields, `{{input.x}}`, `{{nodes.<id>.output.body.y}}` and `{{secrets.NAME}}` are
  replaced. A field that is only a placeholder keeps the value's type.
- HTTP output is `{ status, headers, body }` (JSON bodies are parsed). A non-2xx status fails the node.
- Notify: sends through one of the workspace's channels; `title`, `message` and `to` take templates.
- IF operators: `equals`, `notEquals`, `contains`, `gt`, `lt`, `isEmpty`, `isNotEmpty`, `isTrue`.
  Nodes only reachable through the branch not taken are skipped.
- Code: `console.log` goes to the node's logs; the return value (JSON) is its output.
- A failed node stops the run unless it has `continueOnError` (then the next nodes run and see
  `{ error }`). Whole-run retries: `maxAttempts`; whole-run limit: `timeoutSec`.
- Run output is the output of the end node that ran (or `{ nodeId: output }` when several did).

### Notifications (per workspace)

Channels belong to one workspace: a client only sees and uses their own. Credentials are
encrypted; secret fields come back as `••••••••` and a PATCH that sends the mask (or leaves
the field out) keeps the stored value.

| Type | Settings | Recipient (`to` on the Notify node) |
|---|---|---|
| `slack`, `discord`, `teams`, `googlechat` | `webhookUrl` | — |
| `telegram` | `botToken`, `chatId` | chat id (optional) |
| `email` | `host`, `port`, `encryption`, `username`, `password`, `fromEmail`, `defaultTo` | addresses, comma separated |
| `sms`, `whatsapp` | `accountSid`, `authToken`, `from`, `defaultTo` | E.164 phone |
| `ntfy` | `serverUrl`, `topic`, `token`, `priority` | — |
| `webhook` | `url`, `headers` (JSON), `secret` (signs with `x-flows-signature`) | passed through |

- **Notify node**: `{ "type": "notify", "config": { "channelId": "…", "title": "New booking", "message": "{{input.name}} booked", "to": "{{input.phone}}" } }`.
- **Run alerts**: on a workflow, `"alertOn": "failure" | "always" | "never"` and
  `"alertChannelIds": ["…"]`. Alerts include the error and a link to the run (set `PUBLIC_URL`).

Building a client's own "Notifications" screen in the client hub (with that client's workspace key):

```bash
curl -s $URL/channel-types -H "authorization: Bearer $KEY"      # types + form fields to render
curl -s $URL/channels -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"name":"Owner SMS","type":"sms","config":{"accountSid":"AC…","authToken":"…","from":"+15555550100","defaultTo":"+15555550123"}}'
curl -s $URL/channels -H "authorization: Bearer $KEY"           # list (secrets masked)
curl -s -X POST $URL/channels/<id>/test -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"to":"+15555550123"}'
curl -s -X PATCH $URL/channels/<id> …   /   curl -s -X DELETE $URL/channels/<id> …
```

### Finish callback

`POST onFinishUrl` with `{ event: "run.finished", run: { id, workflowId, status, output, error, … } }`
and the header `X-Flows-Signature: sha256=<hex>`, an HMAC-SHA256 of the raw body using the
workspace's signing secret.

### Network rules

Steps can only reach hosts on the workspace's allow-list: `api.acme.com`, `*.acme.com`,
or `*` for any public host. Private, loopback, link-local (cloud metadata) and CGNAT
addresses are always blocked, including public names that resolve to them, so a client
can't reach Postgres, Coolify or other containers.

## Embed in the client hub (`/iframe`)

The client hub shows each project's own workspace inside an iframe, styled like the hub.
Clients manage their workflows, runs, notification channels and secrets there; nothing
has to be rebuilt in the hub.

How a session starts:

1. The hub's **server** calls `POST /api/v1/embed-sessions` with an **admin** key:
   `{ "projectId": "<hub project uuid>", "projectName": "Acme", "user": { "email", "name" }, "role": "full-access" | "content-editor" | "view-only" }`.
   Flows finds the workspace for that project (`workspace.external_id`) or creates it, and
   returns `{ url }`: a one-time link, valid for 60 seconds.
2. The hub puts the link in `<iframe src>`. `/iframe/start` checks the ticket (unused, not
   expired, referer is the hub), then sets an `HttpOnly; Secure; SameSite=None; Partitioned`
   cookie, signed with `MASTER_KEY` and pinned to that one workspace for 8 hours.
3. Every `/iframe` page and action reads the workspace **only** from that cookie. A request
   for another workspace's data, or with an edited cookie, is refused.
4. When the session ends, the iframe posts `{ source: "flows", type: "session-expired" }` to
   the hub, which fetches a new link.

Roles: `view-only` can look at workflows and runs; `content-editor` can also edit workflows,
schedules, channels and secrets; `full-access` also manages API keys, trigger URLs and the
callback signing secret.

Framing: `/iframe/**` sends `Content-Security-Policy: frame-ancestors <EMBED_ALLOWED_ORIGINS>`
(default `https://app.alisamadii.com`) and `Referrer-Policy: no-referrer`; every other page
sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`.

In the hub (`saas/Portfolio`): `packages/trpc/src/lib/flows.ts` + `routers/automations.ts`
(api, env `FLOWS_URL`, `FLOWS_API_KEY`) and the **Automations** page
(`apps/hub/components/automations/automations-page.tsx`, env `NEXT_PUBLIC_FLOWS_URL`).

## Deploy (Coolify)

1. New resource → **Docker Compose** → this repo, base directory `apps/flows`,
   compose file `coolify.compose.yml`.
2. Coolify generates `SERVICE_PASSWORD_POSTGRES`, `SERVICE_BASE64_64_AUTHSECRET`,
   `SERVICE_BASE64_64_MASTERKEY` and the domain. **Never change `MASTER_KEY` after the first
   deploy**: stored secrets would become unreadable.
3. Deploy. Migrations run at container start; `/api/health` is the health check.
4. Open the domain, create the owner account, create an admin key, and put it in the client hub.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | — | Dashboard login |
| `MASTER_KEY` | — | Encrypts secrets and signing keys |
| `PUBLIC_URL` | request origin | Base for trigger URLs |
| `ROLE` | `all` | `all`, `web` (API/dashboard only) or `worker` |
| `WORKER_CONCURRENCY` | `4` | Runs at once per container |
| `RUN_RETENTION_DAYS` | `30` | Finished runs older than this are deleted |
| `API_RATE_LIMIT_PER_MIN` | `600` | Requests per key per minute, per container |
| `DENO_BIN` | `deno` | Deno binary (set in the image) |
| `EMBED_ALLOWED_ORIGINS` | `https://app.alisamadii.com` | Who may frame `/iframe` (comma separated) |
| `EMBED_DEFAULT_ALLOWED_HOSTS` | `*` | Allowed hosts for workspaces the hub creates |
