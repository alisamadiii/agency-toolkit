'use client';

import '@xyflow/react/dist/style.css';

import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react';
import { ArrowLeft, Bell, Braces, Code2, GitBranch, Globe, Loader2, Play, Plug, Save } from 'lucide-react';
import { useTheme } from 'next-themes';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getRunAction, runWorkflowAction, saveGraphAction, saveWorkflowAction } from '@/app/actions';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { graphProblems, type Graph, type NodeType } from '@/lib/schemas';
import { cn } from '@/lib/utils';

import {
  branchStyle,
  createsCycle,
  defaultConfig,
  fromFlow,
  graphKey,
  NODE_META,
  nextNodeId,
  type ChannelOption,
  toFlow,
  upstreamOf,
  type FlowNode,
} from './graph-utils';
import { IntegrateDialog } from './integrate-dialog';
import { NodePanel, type NodeResult, type WorkflowSettings } from './node-panel';
import { ChannelsContext, nodeTypes } from './nodes';

const CodeEditor = dynamic(() => import('@/components/code-editor'), { ssr: false });

const DND_TYPE = 'application/x-flows-node';
const PALETTE: { type: Exclude<NodeType, 'trigger'>; icon: typeof Globe }[] = [
  { type: 'http', icon: Globe },
  { type: 'code', icon: Code2 },
  { type: 'if', icon: GitBranch },
  { type: 'notify', icon: Bell },
];

export type EditorWorkflow = {
  id: string;
  name: string;
  enabled: boolean;
  description: string | null;
  timeoutSec: number;
  maxAttempts: number;
  onFinishUrl: string | null;
  alertOn: 'failure' | 'always' | 'never';
  alertChannelIds: string[];
  graph: Graph;
};

type RunSummary = { id: string; status: string; trigger: string; queuedAt: Date };
type ScheduleRow = { id: string; cron: string; timezone: string; enabled: boolean; nextRunAt: Date; lastRunAt: Date | null };
type RunState = { id: string; status: string; error: string | null; results: Record<string, NodeResult> };

type Props = {
  workspaceId: string;
  workspaceName: string;
  workflow: EditorWorkflow;
  triggerUrl: string;
  schedules: ScheduleRow[];
  secretNames: string[];
  channels?: ChannelOption[];
  runs: RunSummary[];
  initialRunId?: string | null;
  readOnly?: boolean;
};

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}

const edgeDefaults = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  style: { strokeWidth: 2 },
};

function Editor({
  workspaceId,
  workspaceName,
  workflow,
  triggerUrl,
  schedules,
  secretNames,
  channels = [],
  runs,
  initialRunId,
  readOnly,
}: Props) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const { screenToFlowPosition, getNodes, getEdges, setCenter, getZoom } = useReactFlow();
  const initial = useMemo(() => toFlow(workflow.graph), [workflow.graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(workflow.name);
  const [enabled, setEnabled] = useState(workflow.enabled);
  const [settings, setSettings] = useState<WorkflowSettings>({
    description: workflow.description ?? '',
    timeoutSec: workflow.timeoutSec,
    maxAttempts: workflow.maxAttempts,
    onFinishUrl: workflow.onFinishUrl ?? '',
    alertOn: workflow.alertOn,
    alertChannelIds: workflow.alertChannelIds,
  });
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [integrateOpen, setIntegrateOpen] = useState(false);

  // ---------- Dirty tracking ----------

  const currentGraph = useMemo(() => fromFlow(nodes, edges), [nodes, edges]);
  const snapshot = (g: Graph, s = settings, n = name, e = enabled) => graphKey(g) + JSON.stringify([s, n, e]);
  const [savedKey, setSavedKey] = useState(() =>
    snapshot(fromFlow(initial.nodes, initial.edges), {
      description: workflow.description ?? '',
      timeoutSec: workflow.timeoutSec,
      maxAttempts: workflow.maxAttempts,
      onFinishUrl: workflow.onFinishUrl ?? '',
      alertOn: workflow.alertOn,
      alertChannelIds: workflow.alertChannelIds,
    }, workflow.name, workflow.enabled)
  );
  const dirty = !readOnly && snapshot(currentGraph) !== savedKey;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---------- Run results painted on the canvas ----------

  const paint = useCallback(
    (results: Record<string, NodeResult> | null) => {
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, status: results?.[n.id]?.status } })));
    },
    [setNodes]
  );

  const loadRun = useCallback(
    async (runId: string, follow: boolean) => {
      for (;;) {
        const res = await getRunAction(runId);
        if (!res.ok || !res.data) {
          if (!res.ok) toast.error(res.error);
          return;
        }
        const r = res.data;
        const results: Record<string, NodeResult> = {};
        for (const s of r.steps) {
          results[s.stepId] = {
            status: s.status,
            output: s.output,
            error: s.error,
            logs: s.logs,
            durationMs: s.durationMs,
            attempts: s.attempts,
          };
        }
        setRun({ id: r.id, status: r.status, error: r.error, results });
        paint(results);
        if (!follow || (r.status !== 'queued' && r.status !== 'running')) return r.status;
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    },
    [paint]
  );

  useEffect(() => {
    if (!initialRunId) return;
    const t = setTimeout(() => void loadRun(initialRunId, true), 0);
    return () => clearTimeout(t);
  }, [initialRunId, loadRun]);

  // ---------- Undo / redo ----------
  // Snapshots of the canvas (nodes, connections, positions, node settings). Text boxes keep
  // their own undo; Cmd/Ctrl+Z only reaches the canvas when focus isn't in a field.

  type Snapshot = { nodes: FlowNode[]; edges: Edge[] };
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastTyped = useRef<{ id: string; at: number } | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const takeSnapshot = useCallback(
    (): Snapshot => ({
      nodes: (getNodes() as FlowNode[]).map((n) => ({ ...n, selected: false, dragging: false, data: { ...n.data, status: undefined } })),
      edges: getEdges().map((e) => ({ ...e, selected: false })),
    }),
    [getNodes, getEdges]
  );

  // Call before a change so it can be undone.
  const remember = useCallback(() => {
    if (readOnly) return;
    past.current.push(takeSnapshot());
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    lastTyped.current = null;
  }, [readOnly, takeSnapshot]);

  const restore = useCallback(
    (from: React.RefObject<Snapshot[]>, to: React.RefObject<Snapshot[]>) => {
      const target = from.current.pop();
      if (!target) return;
      to.current.push(takeSnapshot());
      // Keep the last run's status rings on nodes that still exist.
      const status = new Map(getNodes().map((n) => [n.id, (n as FlowNode).data.status]));
      setNodes(target.nodes.map((n) => ({ ...n, data: { ...n.data, status: status.get(n.id) } })));
      setEdges(target.edges);
      setSelectedId((id) => (id && target.nodes.some((n) => n.id === id) ? id : null));
      lastTyped.current = null;
      setHistoryVersion((v) => v + 1);
    },
    [getNodes, setEdges, setNodes, takeSnapshot]
  );
  const undo = useCallback(() => restore(past, future), [restore]);
  const redo = useCallback(() => restore(future, past), [restore]);

  // ---------- Editing ----------

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const target = getNodes().find((n) => n.id === c.target);
      if (target?.type === 'trigger') return false;
      if (edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))) {
        return false;
      }
      return !createsCycle(c.source, c.target, edges);
    },
    [edges, getNodes]
  );

  const onConnect = useCallback(
    (c: Connection) => {
      remember();
      setEdges((es) =>
        addEdge({ ...c, id: `e_${c.source}_${c.sourceHandle ?? 'out'}_${c.target}`, style: branchStyle(c.sourceHandle) }, es)
      );
    },
    [remember, setEdges]
  );

  const addNode = useCallback(
    (type: Exclude<NodeType, 'trigger'>, position?: { x: number; y: number }) => {
      remember();
      const current = getNodes();
      const id = nextNodeId(type, current.map((n) => n.id));
      const anchor = current.find((n) => n.id === selectedId) ?? current[current.length - 1];
      const pos = position ?? { x: (anchor?.position.x ?? 0) + 300, y: anchor?.position.y ?? 0 };
      const node: FlowNode = {
        id,
        type,
        position: pos,
        data: { name: NODE_META[type].label, config: defaultConfig(type) },
      };
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
      // Clicking the palette chains the new node after the selected one.
      if (!position && anchor && anchor.type !== 'if') {
        setEdges((es) => addEdge({ id: `e_${anchor.id}_out_${id}`, source: anchor.id, target: id }, es));
      }
      setSelectedId(id);
      // Palette clicks place the node off to the right; bring it into view (left of the panel).
      if (!position) setTimeout(() => setCenter(pos.x + 300, pos.y + 30, { zoom: getZoom(), duration: 300 }), 0);
    },
    [getNodes, getZoom, remember, selectedId, setCenter, setEdges, setNodes]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(DND_TYPE) as Exclude<NodeType, 'trigger'>;
      if (!type) return;
      addNode(type, screenToFlowPosition({ x: event.clientX - 112, y: event.clientY - 28 }));
    },
    [addNode, screenToFlowPosition]
  );

  const updateNode = (id: string, patch: Partial<FlowNode['data']>) => {
    // A burst of typing in one node is one undo step.
    const now = Date.now();
    if (!lastTyped.current || lastTyped.current.id !== id || now - lastTyped.current.at > 1500) remember();
    lastTyped.current = { id, at: now };
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const deleteNode = (id: string) => {
    remember();
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  };

  // ---------- Save / Run ----------

  async function save(): Promise<boolean> {
    const graph = fromFlow(getNodes() as FlowNode[], edges);
    const problems = graphProblems(graph);
    if (problems.length) {
      toast.error(problems[0]);
      return false;
    }
    setSaving(true);
    const res = await saveGraphAction(workspaceId, workflow.id, {
      name,
      enabled,
      graph,
      description: settings.description || null,
      timeoutSec: settings.timeoutSec,
      maxAttempts: settings.maxAttempts,
      onFinishUrl: settings.onFinishUrl || null,
      alertOn: settings.alertOn,
      alertChannelIds: settings.alertChannelIds,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setSavedKey(snapshot(graph));
    toast.success('Saved');
    router.refresh();
    return true;
  }

  async function runNow(input = '{}') {
    if (dirty && !(await save())) return;
    setRunning(true);
    paint(null);
    const res = await runWorkflowAction(workspaceId, workflow.id, input);
    if (!res.ok || !res.data) {
      setRunning(false);
      if (!res.ok) toast.error(res.error);
      return;
    }
    const status = await loadRun(res.data.runId, true);
    setRunning(false);
    router.refresh();
    if (status === 'success') toast.success('Run succeeded');
    else if (status) toast.error(`Run ${status}`);
  }

  // Cmd/Ctrl+S saves; Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z or Ctrl+Y redoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || readOnly) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void save();
        return;
      }
      const inField = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"], .cm-editor');
      if (inField) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selected = nodes.find((n) => n.id === selectedId);
  const upstream = selected
    ? [...upstreamOf(selected.id, edges)].map((id) => {
        const n = nodes.find((x) => x.id === id)!;
        return { id, type: n.type as NodeType, name: n.data.name };
      })
    : [];

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Link href={`/w/${workspaceId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {workspaceName}
        </Link>
        <span className="text-muted-foreground">/</span>
        <Input
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          className="h-8 max-w-xs border-transparent font-medium shadow-none hover:border-input focus-visible:border-input"
        />
        {dirty && <span className="size-2 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />}
        <div className="ml-auto flex items-center gap-2">
          {run && (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Link href={`/runs/${run.id}`} className="hover:underline">
                Last run
              </Link>
              <StatusBadge status={run.status} />
            </span>
          )}
          {!readOnly && (
            <>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Active <Switch checked={enabled} onCheckedChange={setEnabled} />
              </label>
              <Button size="sm" variant="ghost" onClick={() => setIntegrateOpen(true)}>
                <Plug /> Use in app
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setJsonOpen(true)}>
                <Braces /> JSON
              </Button>
              <Button size="sm" variant="outline" onClick={() => runNow()} disabled={running || saving}>
                {running ? <Loader2 className="animate-spin" /> : <Play />} Run
              </Button>
              <Button size="sm" onClick={save} disabled={saving || !dirty}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        {!readOnly && (
          <aside className="flex w-52 shrink-0 flex-col gap-2 border-r p-3">
            <p className="text-xs font-medium text-muted-foreground">Drag onto the canvas, or click to add after the selected node</p>
            {PALETTE.map(({ type, icon: Icon }) => (
              <button
                key={type}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_TYPE, type);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => addNode(type)}
                className="flex cursor-grab items-start gap-2 rounded-lg border bg-card p-2.5 text-left hover:border-primary/50 active:cursor-grabbing"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">{NODE_META[type].label}</span>
                  <span className="block text-xs text-muted-foreground">{NODE_META[type].description}</span>
                </span>
              </button>
            ))}
            <RunList runs={runs} activeId={run?.id} onPick={(id) => loadRun(id, false)} />
          </aside>
        )}

        {/* Canvas */}
        <div className="relative min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <ChannelsContext.Provider value={channels}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            onBeforeDelete={async ({ nodes: ns, edges: es }) => {
              remember();
              return { nodes: ns.filter((n) => n.type !== 'trigger'), edges: es };
            }}
            onNodeDragStart={() => remember()}
            defaultEdgeOptions={edgeDefaults}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable
            deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
            forceColorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-background" />
          </ReactFlow>
          </ChannelsContext.Provider>
          {run?.error && (
            <div className="absolute bottom-4 left-1/2 max-w-xl -translate-x-1/2 rounded-md border border-red-500/30 bg-background px-3 py-2 text-sm text-red-700 shadow dark:text-red-400">
              {run.error}
            </div>
          )}
        </div>

        {/* Node panel */}
        {selected && (
          <NodePanel
            // Remount after undo/redo so the form shows the restored values.
            key={`${selected.id}:${historyVersion}`}
            node={selected}
            readOnly={readOnly}
            onChange={(patch) => updateNode(selected.id, patch)}
            onDelete={() => deleteNode(selected.id)}
            onClose={() => setSelectedId(null)}
            upstream={upstream}
            secretNames={secretNames}
            channels={channels}
            result={run?.results[selected.id]}
            workspaceId={workspaceId}
            workflowId={workflow.id}
            triggerUrl={triggerUrl}
            schedules={schedules}
            settings={settings}
            onSettingsChange={setSettings}
            onRun={(input) => runNow(input)}
          />
        )}
      </div>

      {!readOnly && integrateOpen && (
        <IntegrateDialog
          open={integrateOpen}
          onOpenChange={setIntegrateOpen}
          workflowId={workflow.id}
          workflowName={name}
          workspaceId={workspaceId}
          triggerUrl={triggerUrl}
          graph={currentGraph}
          onFinishUrl={settings.onFinishUrl}
          description={settings.description}
          dirty={dirty}
          enabled={enabled}
        />
      )}

      {!readOnly && jsonOpen && (
        <JsonDialog
          open={jsonOpen}
          onOpenChange={setJsonOpen}
          workspaceId={workspaceId}
          workflowId={workflow.id}
          value={{ name, enabled, ...settings, onFinishUrl: settings.onFinishUrl || null, graph: currentGraph }}
        />
      )}
    </div>
  );
}

function RunList({ runs, activeId, onPick }: { runs: RunSummary[]; activeId?: string; onPick: (id: string) => void }) {
  if (runs.length === 0) return null;
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
      <p className="text-xs font-medium text-muted-foreground">Recent runs</p>
      {runs.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r.id)}
          className={cn(
            'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted',
            activeId === r.id && 'bg-muted'
          )}
        >
          <span className="truncate text-muted-foreground">{new Date(r.queuedAt).toLocaleString()}</span>
          <StatusBadge status={r.status} />
        </button>
      ))}
    </div>
  );
}

function JsonDialog({
  open,
  onOpenChange,
  workspaceId,
  workflowId,
  value,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workflowId: string;
  value: unknown;
}) {
  const router = useRouter();
  // Mounted only while open, so this captures the canvas at the moment it opened.
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Workflow JSON</DialogTitle>
          <DialogDescription>The same shape the API takes. Saving here replaces the canvas.</DialogDescription>
        </DialogHeader>
        <CodeEditor value={text} onChange={setText} language="json" height="60vh" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const res = await saveWorkflowAction(workspaceId, workflowId, text);
              setSaving(false);
              if (!res.ok) return toast.error(res.error);
              toast.success('Saved');
              onOpenChange(false);
              // Reload so the canvas picks up the new graph.
              router.refresh();
              window.location.reload();
            }}
          >
            Save JSON
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
