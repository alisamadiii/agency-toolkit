'use client';

import dynamic from 'next/dynamic';
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useApp } from '@/components/app-context';
import { CopyText } from '@/components/copy-text';
import { RotateTrigger, Schedules } from '@/components/dashboard-forms';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { CHANNELS, type ChannelType } from '@/lib/channels/registry';
import { IF_OPERATORS, type GraphNode, type NodeType } from '@/lib/schemas';

import { NODE_META, type ChannelOption, type FlowNode } from './graph-utils';

const CodeEditor = dynamic(() => import('@/components/code-editor'), {
  ssr: false,
  loading: () => <div className="h-80 rounded-md border bg-muted/40" />,
});

export type NodeResult = {
  status: string;
  output: unknown;
  error: string | null;
  logs: string | null;
  durationMs: number | null;
  attempts: number;
};

type HttpConfig = Extract<GraphNode, { type: 'http' }>['config'];
type CodeConfig = Extract<GraphNode, { type: 'code' }>['config'];
type IfConfig = Extract<GraphNode, { type: 'if' }>['config'];
type NotifyConfig = Extract<GraphNode, { type: 'notify' }>['config'];

export type WorkflowSettings = {
  description: string;
  timeoutSec: number;
  maxAttempts: number;
  onFinishUrl: string;
  alertOn: 'failure' | 'always' | 'never';
  alertChannelIds: string[];
};

type ScheduleRow = { id: string; cron: string; timezone: string; enabled: boolean; nextRunAt: Date; lastRunAt: Date | null };

const selectClass =
  'h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

export function NodePanel(props: {
  node: FlowNode;
  readOnly?: boolean;
  onChange: (patch: Partial<FlowNode['data']>) => void;
  onDelete: () => void;
  onClose: () => void;
  upstream: { id: string; type: NodeType; name: string }[];
  secretNames: string[];
  channels: ChannelOption[];
  result?: NodeResult;
  // Trigger only
  workspaceId: string;
  workflowId: string;
  triggerUrl?: string;
  schedules?: ScheduleRow[];
  settings?: WorkflowSettings;
  onSettingsChange?: (s: WorkflowSettings) => void;
  onRun?: (input: string) => void;
}) {
  const { node, onChange, readOnly } = props;
  const type = node.type as NodeType;
  const [tab, setTab] = useState(props.result ? 'output' : 'settings');

  return (
    <aside className="flex h-full w-[440px] shrink-0 flex-col border-l bg-background">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{NODE_META[type].label}</p>
          <Input
            value={node.data.name}
            disabled={readOnly}
            onChange={(e) => onChange({ name: e.target.value })}
            className="mt-1 h-8 font-medium"
          />
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">id: {node.id}</p>
        </div>
        {!readOnly && type !== 'trigger' && (
          <Button size="icon-sm" variant="ghost" onClick={props.onDelete} aria-label="Delete node">
            <Trash2 />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" onClick={props.onClose} aria-label="Close panel">
          <X />
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="settings">{type === 'trigger' ? 'Trigger' : 'Settings'}</TabsTrigger>
          <TabsTrigger value="output">
            Last output {props.result && <StatusDot status={props.result.status} />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <fieldset disabled={readOnly} className="grid gap-4 pt-3">
            {type === 'trigger' && <TriggerSettings {...props} />}
            {type === 'http' && (
              <HttpSettings config={node.data.config as HttpConfig} onChange={(config) => onChange({ config })} />
            )}
            {type === 'code' && (
              <CodeSettings
                config={node.data.config as CodeConfig}
                readOnly={readOnly}
                onChange={(config) => onChange({ config })}
              />
            )}
            {type === 'if' && <IfSettings config={node.data.config as IfConfig} onChange={(config) => onChange({ config })} />}
            {type === 'notify' && (
              <NotifySettings
                config={node.data.config as NotifyConfig}
                channels={props.channels}
                workspaceId={props.workspaceId}
                onChange={(config) => onChange({ config })}
              />
            )}
            {type !== 'trigger' && <Variables upstream={props.upstream} secretNames={props.secretNames} />}
          </fieldset>
        </TabsContent>

        <TabsContent value="output" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <ResultView result={props.result} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'success' ? 'bg-emerald-500' : status === 'failed' ? 'bg-red-500' : 'bg-muted-foreground';
  return <span className={`ml-1 inline-block size-1.5 rounded-full ${color}`} />;
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CommonStepFields<T extends { timeoutSec: number; retries: number; continueOnError: boolean }>({
  config,
  onChange,
}: {
  config: T;
  onChange: (c: T) => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Timeout (s)">
          <Input
            type="number"
            min={1}
            max={300}
            value={config.timeoutSec}
            onChange={(e) => onChange({ ...config, timeoutSec: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="Retries">
          <Input
            type="number"
            min={0}
            max={5}
            value={config.retries}
            onChange={(e) => onChange({ ...config, retries: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          Continue on error
          <span className="block text-xs text-muted-foreground">Next nodes still run and see {'{ error }'} as output.</span>
        </span>
        <Switch checked={config.continueOnError} onCheckedChange={(v) => onChange({ ...config, continueOnError: v })} />
      </label>
    </div>
  );
}

// ---------- HTTP ----------

function HttpSettings({ config, onChange }: { config: HttpConfig; onChange: (c: HttpConfig) => void }) {
  const headers = Object.entries(config.headers ?? {});
  const [bodyText, setBodyText] = useState(() =>
    config.body === undefined ? '' : typeof config.body === 'string' ? config.body : JSON.stringify(config.body, null, 2)
  );

  const setHeaders = (rows: [string, string][]) => onChange({ ...config, headers: Object.fromEntries(rows) });
  const setBody = (text: string) => {
    setBodyText(text);
    if (!text.trim()) return onChange({ ...config, body: undefined });
    try {
      onChange({ ...config, body: JSON.parse(text) });
    } catch {
      onChange({ ...config, body: text });
    }
  };

  return (
    <>
      <div className="grid grid-cols-[110px_1fr] gap-2">
        <Field label="Method">
          <select
            className={selectClass}
            value={config.method}
            onChange={(e) => onChange({ ...config, method: e.target.value as HttpConfig['method'] })}
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="URL">
          <Input
            value={config.url}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            className="font-mono text-xs"
            placeholder="https://api.example.com/items/{{input.id}}"
          />
        </Field>
      </div>

      <Field label="Headers">
        <div className="grid gap-2">
          {headers.map(([k, v], i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
              <Input
                value={k}
                placeholder="name"
                className="font-mono text-xs"
                onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))}
              />
              <Input
                value={v}
                placeholder="value or {{secrets.TOKEN}}"
                className="font-mono text-xs"
                onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)))}
              />
              <Button size="icon-sm" variant="ghost" onClick={() => setHeaders(headers.filter((_, j) => j !== i))}>
                <X />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => setHeaders([...headers, [headers.some(([k]) => k === '') ? `header-${headers.length}` : '', '']])}
          >
            <Plus /> Add header
          </Button>
        </div>
      </Field>

      {config.method !== 'GET' && config.method !== 'HEAD' && (
        <Field label="Body" hint="JSON is sent as application/json. Templates work inside strings.">
          <Textarea
            rows={6}
            value={bodyText}
            onChange={(e) => setBody(e.target.value)}
            className="font-mono text-xs"
            placeholder={'{\n  "name": "{{input.name}}"\n}'}
          />
        </Field>
      )}

      <CommonStepFields config={config} onChange={onChange} />
    </>
  );
}

// ---------- Code ----------

function CodeSettings({
  config,
  readOnly,
  onChange,
}: {
  config: CodeConfig;
  readOnly?: boolean;
  onChange: (c: CodeConfig) => void;
}) {
  return (
    <>
      <Field
        label="Code"
        hint={
          <>
            Default export gets <code>{'{ input, nodes, secrets, run }'}</code> and returns JSON. <code>console.log</code> goes to
            the logs. <code>fetch</code> works for allowed hosts.
          </>
        }
      >
        <CodeEditor value={config.code} onChange={(code) => !readOnly && onChange({ ...config, code })} height="340px" />
      </Field>
      <CommonStepFields config={config} onChange={onChange} />
    </>
  );
}

// ---------- IF ----------

const OP_LABELS: Record<(typeof IF_OPERATORS)[number], string> = {
  equals: 'equals',
  notEquals: 'does not equal',
  contains: 'contains',
  gt: 'is greater than',
  lt: 'is less than',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
  isTrue: 'is true',
};
const UNARY = new Set(['isEmpty', 'isNotEmpty', 'isTrue']);

function IfSettings({ config, onChange }: { config: IfConfig; onChange: (c: IfConfig) => void }) {
  const set = (i: number, patch: Partial<IfConfig['conditions'][number]>) =>
    onChange({ ...config, conditions: config.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Runs the <span className="font-medium text-emerald-600">true</span> or{' '}
        <span className="font-medium text-red-600">false</span> output. Nodes on the other branch are skipped.
      </p>
      {config.conditions.map((c, i) => (
        <div key={i} className="grid gap-2 rounded-md border p-3">
          {i > 0 && (
            <select
              className={selectClass + ' w-24 uppercase'}
              value={config.combine}
              onChange={(e) => onChange({ ...config, combine: e.target.value as 'and' | 'or' })}
            >
              <option value="and">and</option>
              <option value="or">or</option>
            </select>
          )}
          <Input
            value={c.left}
            placeholder="{{nodes.fetch.output.status}}"
            className="font-mono text-xs"
            onChange={(e) => set(i, { left: e.target.value })}
          />
          <div className="flex gap-2">
            <select className={selectClass + ' flex-1'} value={c.op} onChange={(e) => set(i, { op: e.target.value as typeof c.op })}>
              {IF_OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {config.conditions.length > 1 && (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => onChange({ ...config, conditions: config.conditions.filter((_, j) => j !== i) })}
              >
                <X />
              </Button>
            )}
          </div>
          {!UNARY.has(c.op) && (
            <Input value={c.right} placeholder="200" className="font-mono text-xs" onChange={(e) => set(i, { right: e.target.value })} />
          )}
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="justify-self-start"
        onClick={() => onChange({ ...config, conditions: [...config.conditions, { left: '', op: 'equals', right: '' }] })}
      >
        <Plus /> Add condition
      </Button>
    </>
  );
}

// ---------- Trigger ----------

function TriggerSettings(props: Parameters<typeof NodePanel>[0]) {
  const { paths, canManageKeys } = useApp();
  const [input, setInput] = useState('{\n  \n}');
  const s = props.settings!;
  const set = (patch: Partial<WorkflowSettings>) => props.onSettingsChange?.({ ...s, ...patch });

  return (
    <>
      <div className="grid gap-2 rounded-md border p-3">
        <Label>Run now</Label>
        <Textarea rows={4} value={input} onChange={(e) => setInput(e.target.value)} className="font-mono text-xs" />
        <p className="text-xs text-muted-foreground">
          Becomes <code>input</code> for every node ({'{{input.x}}'}). Saves first if there are changes.
        </p>
        <Button size="sm" onClick={() => props.onRun?.(input)} disabled={props.readOnly}>
          Run workflow
        </Button>
      </div>

      <div className="grid gap-2">
        <Label>Schedules</Label>
        <Schedules workspaceId={props.workspaceId} workflowId={props.workflowId} schedules={props.schedules ?? []} />
        <p className="text-xs text-muted-foreground">Cron: minute hour day month weekday. At least 1 minute apart.</p>
      </div>

      {props.triggerUrl && canManageKeys && (
        <div className="grid gap-2">
          <Label>Trigger URL</Label>
          <CopyText text={props.triggerUrl} className="break-all rounded-md border bg-muted/40 p-2 text-left font-mono text-[11px]">
            {props.triggerUrl}
          </CopyText>
          <p className="text-xs text-muted-foreground">POST JSON here to start a run; the body becomes input. Keep it private.</p>
          <div>
            <RotateTrigger workspaceId={props.workspaceId} workflowId={props.workflowId} />
          </div>
        </div>
      )}

      <div className="grid gap-3 rounded-md border p-3">
        <Label>Workflow settings</Label>
        <Field label="Description">
          <Input value={s.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Run timeout (s)">
            <Input type="number" min={1} max={3600} value={s.timeoutSec} onChange={(e) => set({ timeoutSec: Number(e.target.value) || 1 })} />
          </Field>
          <Field label="Run attempts">
            <Input type="number" min={1} max={10} value={s.maxAttempts} onChange={(e) => set({ maxAttempts: Number(e.target.value) || 1 })} />
          </Field>
        </div>
        <Field label="Callback URL" hint="Each finished run is POSTed here, signed with X-Flows-Signature.">
          <Input
            value={s.onFinishUrl}
            placeholder="https://hub.example.com/api/flows-callback"
            className="font-mono text-xs"
            onChange={(e) => set({ onFinishUrl: e.target.value })}
          />
        </Field>
      </div>

      <div className="grid gap-3 rounded-md border p-3">
        <Label>Run alerts</Label>
        <select
          className={selectClass}
          value={s.alertOn}
          onChange={(e) => set({ alertOn: e.target.value as WorkflowSettings['alertOn'] })}
        >
          <option value="failure">When a run fails or times out</option>
          <option value="always">After every run</option>
          <option value="never">Never</option>
        </select>
        {props.channels.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No channels yet.{' '}
            <a href={paths.workspace(props.workspaceId, 'notifications')} className="underline">
              Add one in this workspace&apos;s notifications
            </a>
            .
          </p>
        ) : (
          <div className="grid gap-1.5">
            {props.channels.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  disabled={s.alertOn === 'never'}
                  checked={s.alertChannelIds.includes(c.id)}
                  onChange={(e) =>
                    set({
                      alertChannelIds: e.target.checked
                        ? [...s.alertChannelIds, c.id]
                        : s.alertChannelIds.filter((id) => id !== c.id),
                    })
                  }
                />
                {c.name} <span className="text-xs text-muted-foreground">({CHANNEL_LABELS[c.type] ?? c.type})</span>
                {!c.enabled && <span className="text-xs text-amber-600">off</span>}
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Sends the workflow name, status, error and a link to the run.</p>
      </div>
    </>
  );
}

// ---------- Notify ----------

function NotifySettings({
  config,
  channels,
  workspaceId,
  onChange,
}: {
  config: NotifyConfig;
  channels: ChannelOption[];
  workspaceId: string;
  onChange: (c: NotifyConfig) => void;
}) {
  const { paths } = useApp();
  const channel = channels.find((c) => c.id === config.channelId);
  const spec = channel ? CHANNELS[channel.type as ChannelType] : null;

  if (channels.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        This workspace has no notification channels yet.{' '}
        <a href={paths.workspace(workspaceId, 'notifications')} className="text-foreground underline">
          Add Slack, email, SMS…
        </a>{' '}
        then come back.
      </p>
    );
  }

  return (
    <>
      <Field label="Channel">
        <select
          className={selectClass}
          value={config.channelId}
          onChange={(e) => onChange({ ...config, channelId: e.target.value })}
        >
          <option value="">Pick a channel…</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {CHANNEL_LABELS[c.type] ?? c.type}
              {c.enabled ? '' : ' (off)'}
            </option>
          ))}
        </select>
      </Field>
      {spec?.recipient && (
        <Field label={spec.recipient.label} hint={spec.recipient.help}>
          <Input
            value={config.to}
            placeholder={spec.recipient.placeholder}
            className="font-mono text-xs"
            onChange={(e) => onChange({ ...config, to: e.target.value })}
          />
        </Field>
      )}
      <Field label="Title" hint="Subject for email; bold first line elsewhere.">
        <Input
          value={config.title}
          placeholder="New booking from {{input.customer.name}}"
          onChange={(e) => onChange({ ...config, title: e.target.value })}
        />
      </Field>
      <Field label="Message">
        <Textarea
          rows={6}
          value={config.message}
          placeholder={'{{input.customer.name}} booked {{input.service}} at {{input.startsAt}}.'}
          onChange={(e) => onChange({ ...config, message: e.target.value })}
        />
      </Field>
      <CommonStepFields config={config} onChange={onChange} />
    </>
  );
}

const CHANNEL_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(CHANNELS).map(([type, spec]) => [type, spec.label])
);

// ---------- Helpers ----------

function Variables({ upstream, secretNames }: { upstream: { id: string; type: NodeType; name: string }[]; secretNames: string[] }) {
  const items: { label: string; value: string }[] = [{ label: 'Run input', value: '{{input}}' }];
  for (const n of upstream) {
    if (n.type === 'trigger') continue;
    if (n.type === 'http') {
      items.push({ label: `${n.name} · status`, value: `{{nodes.${n.id}.output.status}}` });
      items.push({ label: `${n.name} · body`, value: `{{nodes.${n.id}.output.body}}` });
    } else if (n.type === 'if') {
      items.push({ label: `${n.name} · result`, value: `{{nodes.${n.id}.output.result}}` });
    } else if (n.type === 'notify') {
      items.push({ label: `${n.name} · sent`, value: `{{nodes.${n.id}.output.ok}}` });
    } else {
      items.push({ label: `${n.name} · output`, value: `{{nodes.${n.id}.output}}` });
    }
  }
  for (const s of secretNames) items.push({ label: `Secret ${s}`, value: `{{secrets.${s}}}` });

  return (
    <div className="grid gap-2">
      <Label>Variables</Label>
      <p className="text-xs text-muted-foreground">Click to copy. Add .field to go deeper, e.g. .body.items[0].id</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            title={item.value}
            onClick={() => {
              navigator.clipboard.writeText(item.value);
              toast.success(`Copied ${item.value}`);
            }}
            className="rounded-md border bg-muted/40 px-2 py-1 text-left font-mono text-[11px] hover:bg-muted"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultView({ result }: { result?: NodeResult }) {
  if (!result) return <p className="pt-4 text-sm text-muted-foreground">Run the workflow to see this node&apos;s output.</p>;
  return (
    <div className="grid gap-3 pt-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge status={result.status} />
        {result.durationMs != null && <span>{result.durationMs} ms</span>}
        {result.attempts > 1 && <span>{result.attempts} tries</span>}
      </div>
      {result.error && <p className="rounded-md bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-400">{result.error}</p>}
      {result.logs && <pre className="scrollbar-on-dark max-h-60 overflow-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-100">{result.logs}</pre>}
      {result.output !== null && result.output !== undefined && (
        <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(result.output, null, 2)}</pre>
      )}
    </div>
  );
}
