import { z } from 'zod';

import {
  apiKeyCreateSchema,
  channelCreateSchema,
  channelUpdateSchema,
  runCreateSchema,
  scheduleCreateSchema,
  scheduleUpdateSchema,
  secretPutSchema,
  stepSchema,
  validateSchema,
  workflowCreateSchema,
  workflowUpdateSchema,
  workspaceCreateSchema,
  workspaceUpdateSchema,
} from '@/lib/schemas';

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });

const jsonBody = (ref: string) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
});

const ok = (description: string) => ({ description });
const idParam = (name = 'id') => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const admin = { description: 'Admin key only' };

function spec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Flows API',
      version: '1.0.0',
      description:
        'Cron jobs and workflows. Authenticate with `Authorization: Bearer fl_...`. Workspace keys act on their own workspace; admin keys manage workspaces and pick one with the `x-workspace-id` header.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Step: schema(stepSchema),
        WorkflowCreate: schema(workflowCreateSchema),
        WorkflowUpdate: schema(workflowUpdateSchema),
        ScheduleCreate: schema(scheduleCreateSchema),
        ScheduleUpdate: schema(scheduleUpdateSchema),
        RunCreate: schema(runCreateSchema),
        WorkspaceCreate: schema(workspaceCreateSchema),
        WorkspaceUpdate: schema(workspaceUpdateSchema),
        ApiKeyCreate: schema(apiKeyCreateSchema),
        SecretPut: schema(secretPutSchema),
        Validate: schema(validateSchema),
        ChannelCreate: schema(channelCreateSchema),
        ChannelUpdate: schema(channelUpdateSchema),
      },
    },
    paths: {
      '/me': { get: { summary: 'Who this key belongs to', responses: { 200: ok('Key info') } } },
      '/workspaces': {
        get: { summary: 'List workspaces', ...admin, responses: { 200: ok('Workspaces') } },
        post: { summary: 'Create a workspace', ...admin, requestBody: jsonBody('WorkspaceCreate'), responses: { 201: ok('Created') } },
      },
      '/workspaces/{id}': {
        parameters: [idParam()],
        get: { summary: 'Get a workspace', ...admin, responses: { 200: ok('Workspace') } },
        patch: { summary: 'Update a workspace', ...admin, requestBody: jsonBody('WorkspaceUpdate'), responses: { 200: ok('Updated') } },
        delete: { summary: 'Delete a workspace and everything in it', ...admin, responses: { 204: ok('Deleted') } },
      },
      '/workspaces/{id}/keys': {
        parameters: [idParam()],
        get: { summary: 'List API keys', ...admin, responses: { 200: ok('Keys (no secrets)') } },
        post: { summary: 'Create an API key (full key returned once)', ...admin, requestBody: jsonBody('ApiKeyCreate'), responses: { 201: ok('Created') } },
      },
      '/keys/{id}': { parameters: [idParam()], delete: { summary: 'Revoke an API key', ...admin, responses: { 200: ok('Revoked') } } },
      '/workflows': {
        get: { summary: 'List workflows', responses: { 200: ok('Workflows') } },
        post: { summary: 'Create a workflow', requestBody: jsonBody('WorkflowCreate'), responses: { 201: ok('Created') } },
      },
      '/workflows/{id}': {
        parameters: [idParam()],
        get: { summary: 'Get a workflow', responses: { 200: ok('Workflow') } },
        patch: { summary: 'Update a workflow', requestBody: jsonBody('WorkflowUpdate'), responses: { 200: ok('Updated') } },
        delete: { summary: 'Delete a workflow', responses: { 204: ok('Deleted') } },
      },
      '/workflows/{id}/run': {
        parameters: [idParam()],
        post: { summary: 'Start a run', requestBody: jsonBody('RunCreate'), responses: { 202: ok('{ runId }') } },
      },
      '/workflows/{id}/trigger-token': {
        parameters: [idParam()],
        post: { summary: 'Rotate the public trigger URL', responses: { 200: ok('Workflow with new triggerUrl') } },
      },
      '/workflows/{id}/schedules': {
        parameters: [idParam()],
        get: { summary: "List a workflow's schedules", responses: { 200: ok('Schedules') } },
        post: { summary: 'Add a cron schedule', requestBody: jsonBody('ScheduleCreate'), responses: { 201: ok('Created') } },
      },
      '/schedules': { get: { summary: 'List all schedules', responses: { 200: ok('Schedules') } } },
      '/schedules/{id}': {
        parameters: [idParam()],
        patch: { summary: 'Update a schedule', requestBody: jsonBody('ScheduleUpdate'), responses: { 200: ok('Updated') } },
        delete: { summary: 'Delete a schedule', responses: { 204: ok('Deleted') } },
      },
      '/runs': {
        get: {
          summary: 'List runs, newest first',
          parameters: ['workflowId', 'status', 'limit', 'cursor'].map((name) => ({ name, in: 'query', schema: { type: 'string' } })),
          responses: { 200: ok('{ data, nextCursor }') },
        },
      },
      '/runs/{id}': { parameters: [idParam()], get: { summary: 'Get a run with step outputs and logs', responses: { 200: ok('Run') } } },
      '/runs/{id}/cancel': { parameters: [idParam()], post: { summary: 'Cancel a run', responses: { 202: ok('Cancelling') } } },
      '/secrets': { get: { summary: 'List secret names', responses: { 200: ok('Names') } } },
      '/secrets/{name}': {
        parameters: [idParam('name')],
        put: { summary: 'Set a secret (write-only)', requestBody: jsonBody('SecretPut'), responses: { 200: ok('Saved') } },
        delete: { summary: 'Delete a secret', responses: { 204: ok('Deleted') } },
      },
      '/channel-types': { get: { summary: 'Channel types and their form fields', responses: { 200: ok('Types') } } },
      '/channels': {
        get: { summary: "List this workspace's notification channels (secrets masked)", responses: { 200: ok('Channels') } },
        post: { summary: 'Add a notification channel', requestBody: jsonBody('ChannelCreate'), responses: { 201: ok('Created') } },
      },
      '/channels/{id}': {
        parameters: [idParam()],
        get: { summary: 'Get a channel (secrets masked)', responses: { 200: ok('Channel') } },
        patch: { summary: 'Update a channel; masked secrets keep their value', requestBody: jsonBody('ChannelUpdate'), responses: { 200: ok('Updated') } },
        delete: { summary: 'Delete a channel (also removed from workflow alerts)', responses: { 204: ok('Deleted') } },
      },
      '/channels/{id}/test': {
        parameters: [idParam()],
        post: { summary: 'Send a test notification ({ "to"? })', responses: { 200: ok('{ ok, error? }') } },
      },
      '/signing-secret': { get: { summary: 'Workspace secret that signs callbacks', responses: { 200: ok('{ signingSecret }') } } },
      '/validate': { post: { summary: 'Validate steps and preview a cron', requestBody: jsonBody('Validate'), responses: { 200: ok('Result') } } },
    },
  };
}

export function GET() {
  return Response.json(spec());
}
