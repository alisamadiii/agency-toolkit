'use client';

import { createContext, useContext } from 'react';

import * as dashboardActions from '@/app/actions';

// Shared screens (canvas editor, channels, keys…) run in two places:
// the owner dashboard (/w/:id) and the client hub embed (/iframe). Each provides its own
// server actions and links; embed actions are pinned to the session's workspace.

export type FlowActions = Pick<
  typeof dashboardActions,
  | 'createApiKeyAction'
  | 'revokeApiKeyAction'
  | 'putSecretAction'
  | 'deleteSecretAction'
  | 'createWorkflowAction'
  | 'saveGraphAction'
  | 'getRunAction'
  | 'saveWorkflowAction'
  | 'deleteWorkflowAction'
  | 'runWorkflowAction'
  | 'cancelRunAction'
  | 'createScheduleAction'
  | 'toggleScheduleAction'
  | 'deleteScheduleAction'
  | 'rotateTriggerAction'
  | 'createChannelAction'
  | 'updateChannelAction'
  | 'deleteChannelAction'
  | 'testChannelAction'
>;

export type FlowPaths = {
  workspace: (workspaceId: string, tab?: string) => string;
  workflow: (workspaceId: string, workflowId: string) => string;
  newWorkflow: (workspaceId: string) => string;
  run: (runId: string) => string;
};

export type AppContextValue = {
  actions: FlowActions;
  paths: FlowPaths;
  // Can edit workflows, schedules, channels and secrets.
  canEdit: boolean;
  // Can see and manage API keys, the signing secret and trigger URLs.
  canManageKeys: boolean;
  embedded: boolean;
};

export const dashboardPaths: FlowPaths = {
  workspace: (id, tab) => (tab ? `/w/${id}?tab=${tab}` : `/w/${id}`),
  workflow: (id, wf) => `/w/${id}/workflows/${wf}`,
  newWorkflow: (id) => `/w/${id}/workflows/new`,
  run: (runId) => `/runs/${runId}`,
};

const AppContext = createContext<AppContextValue>({
  actions: dashboardActions,
  paths: dashboardPaths,
  canEdit: true,
  canManageKeys: true,
  embedded: false,
});

export function AppProvider({ value, children }: { value: AppContextValue; children: React.ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
