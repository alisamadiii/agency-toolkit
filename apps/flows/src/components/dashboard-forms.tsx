'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  cancelRunAction,
  createApiKeyAction,
  createScheduleAction,
  createWorkspaceAction,
  deleteScheduleAction,
  deleteSecretAction,
  deleteWorkflowAction,
  deleteWorkspaceAction,
  putSecretAction,
  revokeApiKeyAction,
  rotateTriggerAction,
  runWorkflowAction,
  saveWorkflowAction,
  toggleScheduleAction,
  updateWorkspaceAction,
  type ActionResult,
} from '@/app/actions';
import { CopyText } from '@/components/copy-text';
import { JsonEditor } from '@/components/json-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

// Runs a server action and toasts errors. Resolves to the data (or true) on success, undefined on failure.
function useAction() {
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, success?: string) =>
    new Promise<NonNullable<T> | true | undefined>((resolve) => {
      start(async () => {
        const result = await fn();
        if (!result.ok) {
          toast.error(result.error);
          resolve(undefined);
          return;
        }
        if (success) toast.success(success);
        resolve(result.data ?? true);
      });
    });
  return { pending, run };
}

// ---------- Workspaces ----------

export function CreateWorkspaceForm() {
  const router = useRouter();
  const { pending, run } = useAction();
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState('');

  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = await run(() => createWorkspaceAction({ name, allowedHosts: hosts }), 'Workspace created');
        if (data && data !== true) router.push(`/w/${data.id}`);
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="ws-name">Client name</Label>
        <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Salah Barbershop" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ws-hosts">Allowed hosts</Label>
        <Input
          id="ws-hosts"
          value={hosts}
          onChange={(e) => setHosts(e.target.value)}
          placeholder="api.client.com, *.clienthub.com"
        />
      </div>
      <Button type="submit" disabled={pending}>
        Create workspace
      </Button>
    </form>
  );
}

export function WorkspaceSettingsForm(props: {
  id: string;
  name: string;
  allowedHosts: string[];
  maxWorkflows: number;
  maxConcurrentRuns: number;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [name, setName] = useState(props.name);
  const [hosts, setHosts] = useState(props.allowedHosts.join('\n'));
  const [maxWorkflows, setMaxWorkflows] = useState(props.maxWorkflows);
  const [maxConcurrentRuns, setMaxConcurrentRuns] = useState(props.maxConcurrentRuns);

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateWorkspaceAction(props.id, { name, allowedHosts: hosts, maxWorkflows, maxConcurrentRuns }), 'Saved');
      }}
    >
      <div className="grid gap-1.5">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label>Allowed hosts (one per line)</Label>
        <Textarea
          rows={4}
          value={hosts}
          onChange={(e) => setHosts(e.target.value)}
          className="font-mono text-xs"
          placeholder={'api.client.com\n*.clienthub.com\n* (any public host)'}
        />
        <p className="text-xs text-muted-foreground">
          HTTP steps and scripts can only reach these hosts. Private and internal addresses are always blocked.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Max workflows</Label>
          <Input type="number" min={1} value={maxWorkflows} onChange={(e) => setMaxWorkflows(Number(e.target.value))} />
        </div>
        <div className="grid gap-1.5">
          <Label>Max concurrent runs</Label>
          <Input
            type="number"
            min={1}
            value={maxConcurrentRuns}
            onChange={(e) => setMaxConcurrentRuns(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="flex justify-between">
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={async () => {
            if (!confirm(`Delete ${props.name} with all its workflows, runs, keys and secrets?`)) return;
            if (await run(() => deleteWorkspaceAction(props.id), 'Workspace deleted')) router.push('/');
          }}
        >
          Delete workspace
        </Button>
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

// ---------- API keys ----------

type KeyRow = { id: string; name: string; prefix: string; lastUsedAt: Date | null; revokedAt: Date | null };

export function ApiKeys({ workspaceId, keys, path }: { workspaceId: string | null; keys: KeyRow[]; path: string }) {
  const { pending, run } = useAction();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);

  return (
    <div className="grid gap-3">
      {created && (
        <div className="grid gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Copy this key now. It won’t be shown again.</p>
          <CopyText text={created} className="break-all text-left font-mono text-xs">
            {created}
          </CopyText>
        </div>
      )}
      <ul className="divide-y rounded-md border text-sm">
        {keys.length === 0 && <li className="p-3 text-muted-foreground">No keys yet.</li>}
        {keys.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{k.name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {k.prefix}… · {k.revokedAt ? 'revoked' : k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleString()}` : 'never used'}
              </p>
            </div>
            {!k.revokedAt && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => confirm(`Revoke "${k.name}"?`) && run(() => revokeApiKeyAction(k.id, path), 'Key revoked')}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const key = await run(() => createApiKeyAction(workspaceId, name));
          if (typeof key === 'string') {
            setCreated(key);
            setName('');
          }
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. Client hub" />
        <Button type="submit" disabled={pending}>
          Create key
        </Button>
      </form>
    </div>
  );
}

// ---------- Secrets ----------

export function Secrets({ workspaceId, names }: { workspaceId: string; names: string[] }) {
  const { pending, run } = useAction();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-md border text-sm">
        {names.length === 0 && <li className="p-3 text-muted-foreground">No secrets yet.</li>}
        {names.map((n) => (
          <li key={n} className="flex items-center justify-between p-3">
            <code className="text-xs">{`{{secrets.${n}}}`}</code>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => confirm(`Delete ${n}?`) && run(() => deleteSecretAction(workspaceId, n), 'Deleted')}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => putSecretAction(workspaceId, name, value), 'Secret saved')) {
            setName('');
            setValue('');
          }
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="NAME" className="font-mono" />
        <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" />
        <Button type="submit" disabled={pending || !name}>
          Save secret
        </Button>
      </form>
    </div>
  );
}

// ---------- Workflows ----------

export const EXAMPLE_WORKFLOW = {
  name: 'Example: fetch and transform',
  description: 'Calls an API, then shapes the response with a script.',
  enabled: true,
  timeoutSec: 120,
  maxAttempts: 1,
  steps: [
    { id: 'fetch', type: 'http', method: 'GET', url: 'https://httpbin.org/get?client={{input.client}}' },
    {
      id: 'shape',
      type: 'script',
      code: 'export default async ({ input, steps }) => {\n  console.log("status", steps.fetch.output.status);\n  return { ok: steps.fetch.output.status === 200, client: input.client ?? null };\n};',
    },
  ],
};

export function WorkflowEditor({
  workspaceId,
  workflowId,
  initial,
}: {
  workspaceId: string;
  workflowId: string | null;
  initial: string;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [value, setValue] = useState(initial);

  return (
    <div className="grid gap-3">
      <JsonEditor value={value} onChange={setValue} />
      <div className="flex justify-between gap-2">
        {workflowId ? (
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              if (!confirm('Delete this workflow, its schedules and runs?')) return;
              if (await run(() => deleteWorkflowAction(workspaceId, workflowId), 'Workflow deleted')) {
                router.push(`/w/${workspaceId}`);
              }
            }}
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button
          disabled={pending}
          onClick={async () => {
            const data = await run(() => saveWorkflowAction(workspaceId, workflowId, value), 'Workflow saved');
            if (data && data !== true && !workflowId) router.push(`/w/${workspaceId}/workflows/${data.id}`);
            else if (data) router.refresh();
          }}
        >
          {workflowId ? 'Save changes' : 'Create workflow'}
        </Button>
      </div>
    </div>
  );
}

export function RunNow({ workspaceId, workflowId }: { workspaceId: string; workflowId: string }) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [input, setInput] = useState('{\n  "client": "demo"\n}');
  return (
    <div className="grid gap-2">
      <Label>Input (JSON)</Label>
      <Textarea rows={4} value={input} onChange={(e) => setInput(e.target.value)} className="font-mono text-xs" />
      <Button
        disabled={pending}
        onClick={async () => {
          const data = await run(() => runWorkflowAction(workspaceId, workflowId, input), 'Run queued');
          if (data && data !== true) router.push(`/runs/${data.runId}`);
        }}
      >
        Run now
      </Button>
    </div>
  );
}

export function RotateTrigger({ workspaceId, workflowId }: { workspaceId: string; workflowId: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        confirm('Make a new trigger URL? The current one stops working.') &&
        run(() => rotateTriggerAction(workspaceId, workflowId), 'New trigger URL')
      }
    >
      Rotate
    </Button>
  );
}

// ---------- Schedules ----------

type ScheduleRow = { id: string; cron: string; timezone: string; enabled: boolean; nextRunAt: Date; lastRunAt: Date | null };

export function Schedules({
  workspaceId,
  workflowId,
  schedules,
}: {
  workspaceId: string;
  workflowId: string;
  schedules: ScheduleRow[];
}) {
  const { pending, run } = useAction();
  const [cron, setCron] = useState('*/15 * * * *');
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-md border text-sm">
        {schedules.length === 0 && <li className="p-3 text-muted-foreground">No schedules. Runs only start from the API, trigger URL or Run now.</li>}
        {schedules.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="font-mono text-xs">
                {s.cron} <span className="text-muted-foreground">({s.timezone})</span>
              </p>
              <p className="text-xs text-muted-foreground">
                next {new Date(s.nextRunAt).toLocaleString()}
                {s.lastRunAt && ` · last ${new Date(s.lastRunAt).toLocaleString()}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={s.enabled}
                disabled={pending}
                onCheckedChange={(enabled) => run(() => toggleScheduleAction(workspaceId, workflowId, s.id, enabled))}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => deleteScheduleAction(workspaceId, workflowId, s.id), 'Schedule deleted')}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createScheduleAction(workspaceId, workflowId, { cron, timezone }), 'Schedule added');
        }}
      >
        <Input value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" placeholder="0 9 * * 1-5" />
        <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" />
        <Button type="submit" disabled={pending}>
          Add schedule
        </Button>
      </form>
    </div>
  );
}

export function CancelRun({ workspaceId, runId }: { workspaceId: string; runId: string }) {
  const { pending, run } = useAction();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => cancelRunAction(workspaceId, runId), 'Cancelling')}>
      Cancel run
    </Button>
  );
}
