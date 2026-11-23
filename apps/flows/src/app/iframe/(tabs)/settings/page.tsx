import { CopyText } from '@/components/copy-text';
import { HubCard, HubCardHeader } from '@/components/hub/card';
import { decrypt } from '@/lib/crypto';
import { roleAtLeast } from '@/lib/embed';

import { embedPage } from '../../session';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-divider px-6 py-4 last:border-b-0 sm:grid-cols-[220px_1fr] sm:gap-6">
      <p className="text-[13px] font-medium text-ink">{label}</p>
      <div className="min-w-0 text-[13px] text-ink-3">{children}</div>
    </div>
  );
}

export default async function IframeSettings() {
  const { session, ws } = await embedPage();
  const hosts = ws.allowedHosts;
  return (
    <HubCard>
      <HubCardHeader title="Settings" description="Managed by your agency. Ask them if you need a limit or host changed." />
      <Row label="Project">{ws.name}</Row>
      <Row label="Allowed hosts">
        {hosts.includes('*') ? (
          'Any public website or API'
        ) : hosts.length ? (
          <span className="font-mono text-xs">{hosts.join(', ')}</span>
        ) : (
          <span className="text-faint">None yet</span>
        )}
        <p className="mt-1 text-xs text-faint">HTTP and Code steps can only reach these. Private and internal addresses are always blocked.</p>
      </Row>
      <Row label="Limits">
        Up to {ws.maxWorkflows} workflows · {ws.maxConcurrentRuns} runs at the same time
      </Row>
      <Row label="Signed in as">
        {session.name || session.email || 'Client hub user'} · <span className="capitalize">{session.role.replace('-', ' ')}</span>
      </Row>
      {roleAtLeast(session.role, 'full-access') && (
        <Row label="Callback signing secret">
          <CopyText text={decrypt(ws.signingSecret)} className="break-all rounded-control border border-line bg-subtle px-2 py-1.5 text-left font-mono text-xs">
            {decrypt(ws.signingSecret)}
          </CopyText>
          <p className="mt-1 text-xs text-faint">
            Finished-run callbacks carry <code className="font-mono">x-flows-signature: sha256=HMAC(secret, body)</code>.
          </p>
        </Row>
      )}
    </HubCard>
  );
}
