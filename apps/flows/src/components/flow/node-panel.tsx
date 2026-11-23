'use client';

import dynamic from 'next/dynamic';
import { Plus, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
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
import { findAction, PROVIDERS } from '@/lib/integrations/registry';
import { IF_OPERATORS, type GraphNode, type NodeType } from '@/lib/schemas';

import { NODE_META, type ChannelOption, type FlowNode, type IntegrationOption } from './graph-utils';
import { insertVariable, TemplateInput, type TemplateField, TemplateTextarea, useVariables, variableFor, VariablesContext } from './template-input';
import { examplePath, TRIGGER_SOURCE, type Variable } from './variables';

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
type AppConfig = Extract<GraphNode, { type: 'app' }>['config'];
type TriggerConfig = Extract<GraphNode, { type: 'trigger' }>['config'];

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
  // What {{…}} can reference here (trigger fields, earlier outputs, secrets).
  variables: Variable[];
  // Saves the trigger's sample input from any node's {{ menu.
  onSaveSample?: (sample: Record<string, unknown>) => void;
  // JSON shown when the trigger has no saved sample yet (fields the graph already reads).
  inferredSample: Record<string, unknown>;
  // Every node on the canvas (id → name), to explain references to missing steps.
  nodeNames: Record<string, string>;
  channels: ChannelOption[];
  integrations?: IntegrationOption[];
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
  const lastField = useRef<TemplateField | null>(null);
  const scope = useMemo(() => ({ selfId: node.id, nodeNames: props.nodeNames }), [node.id, props.nodeNames]);
  const inferred = Object.keys(props.inferredSample).length ? JSON.stringify(props.inferredSample, null, 2) : undefined;

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

      <VariablesContext.Provider
        value={{ variables: props.variables, onSaveSample: readOnly ? undefined : props.onSaveSample, sampleDraft: inferred, onFieldFocus: (el) => (lastField.current = el), scope }}
      >
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
            {type === 'app' && (
              <AppSettings
                config={node.data.config as AppConfig}
                integrations={props.integrations ?? []}
                workspaceId={props.workspaceId}
                onChange={(config) => onChange({ config })}
              />
            )}
            {type === 'notify' && (
              <NotifySettings
                config={node.data.config as NotifyConfig}
                channels={props.channels}
                workspaceId={props.workspaceId}
                onChange={(config) => onChange({ config })}
              />
            )}
            {type !== 'trigger' && <Variables insertInto={() => lastField.current} />}
          </fieldset>
        </TabsContent>

        <TabsContent value="output" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <ResultView result={props.result} />
        </TabsContent>
      </Tabs>
      </VariablesContext.Provider>
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
  const example = examplePath(useVariables().variables, 'input.id');
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
          <TemplateInput
            value={config.url}
            onChange={(e) => onChange({ ...config, url: e.target.value })}
            className="font-mono text-xs"
            placeholder={`https://api.example.com/items/{{${example}}}`}
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
              <TemplateInput
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
          <TemplateTextarea
            rows={6}
            value={bodyText}
            onChange={(e) => setBody(e.target.value)}
            className="font-mono text-xs"
            placeholder={`{\n  "name": "{{${example}}}"\n}`}
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
  const { variables } = useVariables();
  const completions = useMemo(
    () => variables.map((v) => ({ path: v.path, label: `${v.group} · ${v.label}`, detail: v.preview || v.type })),
    [variables]
  );
  return (
    <>
      <Field
        label="Code"
        hint={
          <>
            Default export gets <code>{'{ input, nodes, secrets, run }'}</code> and returns JSON. <code>console.log</code> goes to
            the logs. <code>fetch</code> works for allowed hosts. Type <code>input.</code> or <code>nodes.</code> for suggestions.
          </>
        }
      >
        <CodeEditor
          value={config.code}
          onChange={(code) => !readOnly && onChange({ ...config, code })}
          height="340px"
          completions={completions}
        />
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
  const { variables } = useVariables();
  const example = examplePath(variables, 'input.status');
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
          <TemplateInput
            value={c.left}
            placeholder={`{{${example}}}  (type {{ for options)`}
            className="font-mono text-xs"
            onChange={(e) => set(i, { left: e.target.value })}
          />
          <PickedValue text={c.left} />
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
            <TemplateInput
              value={c.right}
              placeholder="A value, or {{ for a variable"
              className="font-mono text-xs"
              onChange={(e) => set(i, { right: e.target.value })}
            />
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
  const config = (props.node.data.config ?? {}) as TriggerConfig;
  const [input, setInput] = useState(() => {
    const saved = config.sampleInput ?? props.inferredSample;
    return Object.keys(saved).length ? JSON.stringify(saved, null, 2) : '{\n  \n}';
  });
  const [inputError, setInputError] = useState<string | null>(null);
  const s = props.settings!;
  const set = (patch: Partial<WorkflowSettings>) => props.onSettingsChange?.({ ...s, ...patch });
  const fields = props.variables.filter((v) => v.source === TRIGGER_SOURCE && v.featured && v.path !== 'input');

  const changeInput = (text: string) => {
    setInput(text);
    if (!text.trim()) {
      setInputError(null);
      return props.onChange({ config: { ...config, sampleInput: undefined } });
    }
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Use a JSON object, e.g. { "name": "Ali" }');
      setInputError(null);
      props.onChange({ config: { ...config, sampleInput: Object.keys(value).length ? value : undefined } });
    } catch (e) {
      setInputError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  return (
    <>
      <div className="grid gap-2 rounded-md border p-3">
        <Label>Sample input</Label>
        <Textarea rows={6} value={input} onChange={(e) => changeInput(e.target.value)} className="font-mono text-xs" />
        {inputError ? (
          <p className="text-xs text-red-600">{inputError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            The JSON your app sends. Its fields show up when you type {'{{'} in any step
            {fields.length > 0 && <>: {fields.map((f) => f.path).join(', ')}</>}. Saved with the workflow.
          </p>
        )}
        <Button size="sm" onClick={() => props.onRun?.(input)} disabled={props.readOnly || !!inputError}>
          Run with this input
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

// ---------- App (connected integration) ----------

function AppSettings({
  config,
  integrations,
  workspaceId,
  onChange,
}: {
  config: AppConfig;
  integrations: IntegrationOption[];
  workspaceId: string;
  onChange: (c: AppConfig) => void;
}) {
  const { paths } = useApp();
  const spec = PROVIDERS[config.provider as keyof typeof PROVIDERS];
  const action = findAction(config.provider, config.action);
  const status = integrations.find((i) => i.provider === config.provider);
  const setParam = (key: string, value: string) => onChange({ ...config, params: { ...config.params, [key]: value } });

  return (
    <>
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">{spec?.label ?? config.provider}</p>
        {status?.connected ? (
          <p className="text-xs text-muted-foreground">Connected as {status.accountEmail}</p>
        ) : (
          <p className="text-xs text-amber-700">
            Not connected.{' '}
            <a href={paths.workspace(workspaceId, 'integrations')} className="underline">
              Connect it in Integrations
            </a>
          </p>
        )}
      </div>
      <Field label="Action">
        <select
          className={selectClass}
          value={config.action}
          onChange={(e) => onChange({ ...config, action: e.target.value, params: {} })}
        >
          <option value="">Pick an action…</option>
          {spec?.actions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
      {action && <p className="text-xs text-muted-foreground">{action.description}</p>}
      {action?.fields.map((f) => {
        const value = config.params[f.key] ?? '';
        if (f.kind === 'boolean') {
          return (
            <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
              <span>{f.label}</span>
              <Switch checked={value === 'true'} onCheckedChange={(v) => setParam(f.key, v ? 'true' : 'false')} />
            </label>
          );
        }
        return (
          <Field
            key={f.key}
            label={f.required ? `${f.label} *` : f.label}
            hint={f.help}
          >
            {f.kind === 'textarea' ? (
              <TemplateTextarea rows={4} value={value} placeholder={f.placeholder} onChange={(e) => setParam(f.key, e.target.value)} />
            ) : (
              <TemplateInput
                value={value}
                placeholder={f.placeholder}
                className="font-mono text-xs"
                onChange={(e) => setParam(f.key, e.target.value)}
              />
            )}
          </Field>
        );
      })}
      <CommonStepFields config={config} onChange={onChange} />
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
  const example = examplePath(useVariables().variables);
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
          <TemplateInput
            value={config.to}
            placeholder={spec.recipient.placeholder}
            className="font-mono text-xs"
            onChange={(e) => onChange({ ...config, to: e.target.value })}
          />
        </Field>
      )}
      <Field label="Title" hint="Subject for email; bold first line elsewhere.">
        <TemplateInput
          value={config.title}
          placeholder={`New request from {{${example}}}`}
          onChange={(e) => onChange({ ...config, title: e.target.value })}
        />
      </Field>
      <Field label="Message">
        <TemplateTextarea
          rows={6}
          value={config.message}
          placeholder={`{{${example}}} just sent a request. Type {{ to insert a value.`}
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

// Under an IF value: what the picked variable is, e.g. "string · \"Ali\"".
function PickedValue({ text }: { text: string }) {
  const v = variableFor(useVariables().variables, text);
  if (!v || (!v.type && !v.preview)) return null;
  return (
    <p className="-mt-1 truncate text-[11px] text-muted-foreground">
      {v.group} · {v.label}
      {v.type && <> · {v.type}</>}
      {v.preview && v.preview !== v.type && <span className="font-mono"> · {v.preview}</span>}
    </p>
  );
}

function Variables({ insertInto }: { insertInto: () => TemplateField | null }) {
  const { variables } = useVariables();
  const items = variables.filter((v) => v.featured);

  return (
    <div className="grid gap-2">
      <Label>Variables</Label>
      <p className="text-xs text-muted-foreground">
        Click to insert into the last field you used, or type {'{{'} in a field to see everything.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.path}
            type="button"
            title={`{{${item.path}}}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const el = insertInto();
              if (el && el.isConnected && !el.disabled) return insertVariable(el, item.path);
              navigator.clipboard.writeText(`{{${item.path}}}`);
              toast.success(`Copied {{${item.path}}}`);
            }}
            className="rounded-md border bg-muted/40 px-2 py-1 text-left font-mono text-[11px] hover:bg-muted"
          >
            {item.source === TRIGGER_SOURCE ? `input · ${item.label}` : `${item.group} · ${item.label}`}
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
