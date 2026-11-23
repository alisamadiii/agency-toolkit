import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { workflow, workspace, type run } from '@/db/schema';
import { decrypt, hmacHex } from '@/lib/crypto';
import { sendToChannel } from '@/lib/channels/senders';
import { guardedRequest } from '@/lib/net';
import { channelForSend } from '@/lib/service';
import { appUrl } from '@/lib/base-url';

type RunRow = typeof run.$inferSelect;

// POSTs a signed summary to the workflow's onFinishUrl.
// Verify with: hex(HMAC-SHA256(workspace signing secret, raw body)) === X-Flows-Signature minus "sha256=".
export async function sendFinishWebhook(row: RunRow) {
  const [wf] = await db.select().from(workflow).where(eq(workflow.id, row.workflowId));
  if (!wf?.onFinishUrl) return;
  const [ws] = await db.select().from(workspace).where(eq(workspace.id, row.workspaceId));

  const body = JSON.stringify({
    event: 'run.finished',
    run: {
      id: row.id,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
      status: row.status,
      trigger: row.trigger,
      attempt: row.attempt,
      output: row.output,
      error: row.error,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    },
  });
  const signature = hmacHex(decrypt(ws.signingSecret), body);
  const host = new URL(wf.onFinishUrl).hostname;

  await guardedRequest({
    url: wf.onFinishUrl,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-flows-signature': `sha256=${signature}`,
      'x-flows-run-id': row.id,
    },
    body,
    // The callback URL is set by the workspace owner, so its host is allowed implicitly;
    // private addresses are still refused.
    allowedHosts: [host],
    timeoutMs: 10_000,
  });
}

// Run alerts: tell the workspace's chosen channels how a run ended.
export async function sendRunAlerts(row: RunRow) {
  if (row.status === 'cancelled') return;
  const [wf] = await db.select().from(workflow).where(eq(workflow.id, row.workflowId));
  if (!wf || wf.alertOn === 'never' || wf.alertChannelIds.length === 0) return;
  const failed = row.status === 'failed' || row.status === 'timeout';
  if (wf.alertOn === 'failure' && !failed) return;

  const [ws] = await db.select().from(workspace).where(eq(workspace.id, row.workspaceId));
  const duration =
    row.startedAt && row.finishedAt ? `${((row.finishedAt.getTime() - row.startedAt.getTime()) / 1000).toFixed(1)}s` : '—';
  const base = appUrl();
  const lines = [
    `Workspace: ${ws?.name ?? row.workspaceId}`,
    `Trigger: ${row.trigger} · attempt ${row.attempt}/${row.maxAttempts} · ${duration}`,
  ];
  if (row.error) lines.push(`Error: ${row.error}`);

  for (const id of wf.alertChannelIds) {
    try {
      const { row: channel, config } = await channelForSend(row.workspaceId, id);
      if (!channel.enabled) continue;
      const result = await sendToChannel(channel.type, config, {
        title: `${failed ? '❌' : '✅'} ${wf.name} ${row.status === 'timeout' ? 'timed out' : failed ? 'failed' : 'succeeded'}`,
        message: lines.join('\n'),
        level: failed ? 'error' : 'success',
        url: base ? `${base}/runs/${row.id}` : undefined,
      });
      if (!result.ok) console.error(`[alerts] ${channel.type} "${channel.name}" failed: ${result.error}`);
    } catch (e) {
      console.error('[alerts] channel failed', id, e);
    }
  }
}
