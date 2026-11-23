'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bell, Code2, GitBranch, Globe, Zap } from 'lucide-react';
import { createContext, useContext } from 'react';

import { cn } from '@/lib/utils';
import type { NodeType } from '@/lib/schemas';

import { summary, type ChannelOption, type FlowNode } from './graph-utils';

const ICONS: Record<NodeType, typeof Globe> = { trigger: Zap, http: Globe, code: Code2, if: GitBranch, notify: Bell };
const TINTS: Record<NodeType, string> = {
  trigger: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  http: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  code: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  if: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  notify: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

// Channel names for Notify node summaries.
export const ChannelsContext = createContext<ChannelOption[]>([]);
const STATUS_RING: Record<string, string> = {
  success: 'ring-2 ring-emerald-500',
  failed: 'ring-2 ring-red-500',
  running: 'ring-2 ring-blue-500 animate-pulse',
  skipped: 'opacity-50',
};

const handleClass = '!size-3 !border-2 !border-background !bg-muted-foreground';

function Card({ type, data, selected }: { type: NodeType; data: FlowNode['data']; selected: boolean }) {
  const Icon = ICONS[type];
  const channels = useContext(ChannelsContext);
  return (
    <div
      className={cn(
        'w-56 rounded-xl border bg-card px-3 py-2.5 text-card-foreground shadow-sm transition-shadow',
        selected && 'border-primary shadow-md',
        data.status && STATUS_RING[data.status]
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', TINTS[type])}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{data.name}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{summary(type, data.config, channels)}</p>
        </div>
      </div>
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps<FlowNode>) {
  return (
    <>
      <Card type="trigger" data={data} selected={selected} />
      <Handle type="source" position={Position.Right} className={handleClass} />
    </>
  );
}

function StepNode({ type, data, selected }: NodeProps<FlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <Card type={type as NodeType} data={data} selected={selected} />
      <Handle type="source" position={Position.Right} className={handleClass} />
    </>
  );
}

function IfNode({ data, selected }: NodeProps<FlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} className={handleClass} />
      <Card type="if" data={data} selected={selected} />
      <Handle id="true" type="source" position={Position.Right} style={{ top: '30%' }} className={cn(handleClass, '!bg-emerald-500')} />
      <BranchTag top="30%" className="text-emerald-600 dark:text-emerald-400">true</BranchTag>
      <Handle id="false" type="source" position={Position.Right} style={{ top: '70%' }} className={cn(handleClass, '!bg-red-500')} />
      <BranchTag top="70%" className="text-red-600 dark:text-red-400">false</BranchTag>
    </>
  );
}

// Small label just above each IF output, clear of the connector line.
function BranchTag({ top, className, children }: { top: string; className: string; children: string }) {
  return (
    <span
      style={{ top }}
      className={cn('pointer-events-none absolute left-full ml-2 -translate-y-[calc(100%+3px)] text-[10px] leading-none font-medium', className)}
    >
      {children}
    </span>
  );
}

export const nodeTypes = { trigger: TriggerNode, http: StepNode, code: StepNode, if: IfNode, notify: StepNode };
