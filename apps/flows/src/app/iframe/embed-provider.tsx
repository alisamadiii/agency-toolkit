'use client';

import { AppProvider, type FlowPaths } from '@/components/app-context';
import type { EmbedRole } from '@/db/schema';

import * as embedActions from './actions';

const paths: FlowPaths = {
  workspace: (_id, tab) => (tab && tab !== 'workflows' ? `/iframe/${tab}` : '/iframe'),
  workflow: (_id, wf) => `/iframe/workflows/${wf}`,
  newWorkflow: () => '/iframe/workflows/new',
  run: (runId) => `/iframe/runs/${runId}`,
};

// Shared screens inside the hub use the embed actions (pinned to the session's workspace).
export function EmbedProvider({ role, children }: { role: EmbedRole; children: React.ReactNode }) {
  return (
    <AppProvider
      value={{
        actions: embedActions,
        paths,
        canEdit: role !== 'view-only',
        canManageKeys: role === 'full-access',
        embedded: true,
      }}
    >
      {children}
    </AppProvider>
  );
}
