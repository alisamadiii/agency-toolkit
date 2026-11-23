'use client';

import 'highlight.js/styles/github-dark.css';

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import { Check, Copy, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Graph } from '@/lib/schemas';
import { cn } from '@/lib/utils';

import { aiPrompt, inputFields, sampleInput, steps, type Mode } from './integration-doc';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);

type Lang = 'bash' | 'typescript' | 'json' | 'markdown' | 'python' | 'plaintext';

function Code({ children, label, lang = 'plaintext', wrap }: { children: string; label?: string; lang?: Lang; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(
    () => (lang === 'plaintext' ? null : hljs.highlight(children, { language: lang }).value),
    [children, lang]
  );
  return (
    <div className="grid min-w-0 gap-1">
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="relative">
        <pre
          className={cn(
            'hljs max-h-80 overflow-auto rounded-md !bg-zinc-950 p-3 pr-10 text-xs leading-relaxed whitespace-pre-wrap !text-zinc-100',
            wrap ? 'break-all' : '[overflow-wrap:anywhere]'
          )}
        >
          {html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{children}</code>}
        </pre>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(children);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="absolute top-2 right-4 rounded-md bg-zinc-950/80 p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Copy"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

// Copy-ready instructions for an AI coding assistant, tailored to the selected tab.
function AiPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-violet-500" /> AI prompt
        </p>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste into Claude Code, Cursor or ChatGPT inside the project that should trigger this workflow. It has the endpoint,
        the input fields, what each step does and the rules for calling it.
      </p>
      <Code lang="markdown">{prompt}</Code>
    </div>
  );
}

function Note({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <p
      className={cn(
        'rounded-md px-3 py-2 text-xs break-words',
        tone === 'warn' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </p>
  );
}

const indent = (json: string, spaces: number) => json.replace(/\n/g, '\n' + ' '.repeat(spaces));

export function IntegrateDialog({
  open,
  onOpenChange,
  workflowId,
  workflowName,
  workspaceId,
  triggerUrl,
  graph,
  onFinishUrl,
  description,
  dirty,
  enabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  workflowName: string;
  workspaceId: string;
  triggerUrl: string;
  graph: Graph;
  onFinishUrl: string;
  description: string;
  dirty: boolean;
  enabled: boolean;
}) {
  const [tab, setTab] = useState<Mode>('overview');
  const origin = new URL(triggerUrl).origin;
  const input = sampleInput(graph);
  const body = JSON.stringify(input, null, 2);
  const envName = `FLOWS_${workflowName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'WORKFLOW'}_URL`;
  const apiUrl = `${origin}/api/v1/workflows/${workflowId}/run`;

  const curlHook = `curl -X POST "${triggerUrl}" \\
  -H "content-type: application/json" \\
  -d '${JSON.stringify(input)}'`;

  const fetchHook = `// .env  →  ${envName}=${triggerUrl}

// Call this where "${workflowName}" should start, after your data is saved
// (route handler, server action, background job, webhook…).
// Run it on your server: the URL is a secret.
export async function triggerFlow(input: Record<string, unknown>) {
  try {
    const res = await fetch(process.env.${envName}!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000), // never hold up your request
    });
    if (!res.ok) console.error('Flows trigger failed', res.status, await res.text());
    else return (await res.json()) as { runId: string };
  } catch (error) {
    console.error('Flows trigger failed', error); // your request still succeeds
  }
}

// Example
await triggerFlow(${indent(body, 0)});`;

  const pythonHook = `import os, requests

def trigger_flow(data: dict):
    try:
        r = requests.post(os.environ["${envName}"], json=data, timeout=5)
        r.raise_for_status()
        return r.json()  # {"runId": "..."}
    except requests.RequestException as e:
        print("Flows trigger failed:", e)  # don't break your request

trigger_flow(${body.replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')})`;

  const curlApi = `curl -X POST "${apiUrl}" \\
  -H "authorization: Bearer $FLOWS_API_KEY" \\
  -H "content-type: application/json" \\
  -d '${JSON.stringify({ input })}'`;

  const fetchApi = `// .env  →  FLOWS_URL=${origin}
//          FLOWS_API_KEY=fl_live_...   (workspace key from the workspace page)

const res = await fetch(\`\${process.env.FLOWS_URL}/api/v1/workflows/${workflowId}/run\`, {
  method: 'POST',
  headers: {
    authorization: \`Bearer \${process.env.FLOWS_API_KEY}\`,
    'content-type': 'application/json',
    // Only with an admin key (fl_admin_…):
    // 'x-workspace-id': '${workspaceId}',
  },
  body: JSON.stringify({
    input: ${indent(body, 4)},
  }),
  signal: AbortSignal.timeout(5000),
});
const { runId } = await res.json();`;

  const poll = `const run = await fetch(\`\${process.env.FLOWS_URL}/api/v1/runs/\${runId}\`, {
  headers: { authorization: \`Bearer \${process.env.FLOWS_API_KEY}\` },
}).then((r) => r.json());

run.status;  // queued | running | success | failed | cancelled | timeout
run.output;  // what the last node returned
run.steps;   // every node: status, output, logs`;

  const verify = `// e.g. app/api/flows-callback/route.ts (Next.js)
import { createHmac, timingSafeEqual } from 'node:crypto';

export async function POST(req: Request) {
  const raw = await req.text();
  const expected = 'sha256=' + createHmac('sha256', process.env.FLOWS_SIGNING_SECRET!).update(raw).digest('hex');
  const got = req.headers.get('x-flows-signature') ?? '';
  if (got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    return new Response('bad signature', { status: 401 });
  }
  const { run } = JSON.parse(raw); // { id, workflowId, status, output, error, ... }
  // ...react to the result: run.status, run.output
  return new Response('ok');
}`;

  const fields = inputFields(graph);
  const flow = steps(graph);
  const prompt = aiPrompt(tab, {
    workflowName,
    description,
    workflowId,
    workspaceId,
    origin,
    triggerUrl,
    envName,
    graph,
    onFinishUrl,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-x-hidden overflow-y-auto sm:max-w-3xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Trigger this workflow from your app</DialogTitle>
          <DialogDescription>
            Start <strong>{workflowName}</strong> from another project. The JSON you send becomes <code>input</code> for every
            node{fields[0] ? (
              <>
                , e.g. <code>{`{{input.${fields[0].path}}}`}</code>
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>

        {dirty && <Note tone="warn">You have unsaved changes. Runs use the saved version, so save first.</Note>}
        {!enabled && <Note tone="warn">This workflow is inactive. Triggers return 409 until you turn it on.</Note>}

        <Tabs value={tab} onValueChange={(v) => setTab(v as Mode)} className="grid min-w-0 gap-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="url">Trigger URL</TabsTrigger>
            <TabsTrigger value="api">API with key</TabsTrigger>
            <TabsTrigger value="result">Get the result</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="grid min-w-0 gap-4">
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">What it does</h3>
              {description && <p className="text-sm text-muted-foreground">{description}</p>}
              <ol className="grid gap-1.5 text-sm">
                {flow.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                      {i + 1}
                    </span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-medium">{s.name}</span>{' '}
                      <span className="text-muted-foreground">({s.type})</span> — {s.text}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="grid gap-2">
              <h3 className="text-sm font-medium">Input fields</h3>
              {fields.length ? (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="p-2 font-medium">Field</th>
                        <th className="p-2 font-medium">Type</th>
                        <th className="p-2 font-medium">Used by</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {fields.map((f) => (
                        <tr key={f.path}>
                          <td className="p-2 font-mono text-xs">{f.path}</td>
                          <td className="p-2 text-xs text-muted-foreground">{f.kind}</td>
                          <td className="p-2 text-xs">{f.usedIn.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Note>
                  This workflow doesn&apos;t read any input, so an empty body <code>{'{}'}</code> is enough. Use{' '}
                  <code>{'{{input.field}}'}</code> in a node (or <code>input.field</code> in Code) and its fields show up here.
                </Note>
              )}
              {fields.length > 0 && (
                <Code label="Example body" lang="json">
                  {body}
                </Code>
              )}
            </section>

            <Note>
              Pick <strong>Trigger URL</strong> for any app that just needs to fire the workflow, or{' '}
              <strong>API with key</strong> if the app already holds a Flows key (like the client hub).
            </Note>
          </TabsContent>

          <TabsContent value="url" className="grid min-w-0 gap-3">
            <p className="text-sm text-muted-foreground">One URL, no API key. POST JSON to it and the workflow starts.</p>
            <Code label="Trigger URL" wrap>
              {triggerUrl}
            </Code>
            <Note>
              Keep it on your server (env var), never in browser code: anyone with the URL can start the workflow. If it
              leaks, rotate it on the Trigger node. Responds <code>202 {'{ "runId": "…" }'}</code> right away; the workflow
              runs in the background.
            </Note>
            <Tabs defaultValue="js" className="grid min-w-0 gap-2">
              <TabsList>
                <TabsTrigger value="js">JavaScript / Next.js</TabsTrigger>
                <TabsTrigger value="curl">curl</TabsTrigger>
                <TabsTrigger value="py">Python</TabsTrigger>
              </TabsList>
              <TabsContent value="js" className="min-w-0">
                <Code lang="typescript">{fetchHook}</Code>
              </TabsContent>
              <TabsContent value="curl" className="min-w-0">
                <Code lang="bash">{curlHook}</Code>
              </TabsContent>
              <TabsContent value="py" className="min-w-0">
                <Code lang="python">{pythonHook}</Code>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="api" className="grid min-w-0 gap-3">
            <p className="text-sm text-muted-foreground">
              Use this when your app already holds a Flows API key (e.g. the client hub). Create a key for this workspace on
              the workspace page; it can only touch this workspace.
            </p>
            <Code label="Endpoint" wrap>{`POST ${apiUrl}`}</Code>
            <Tabs defaultValue="js" className="grid min-w-0 gap-2">
              <TabsList>
                <TabsTrigger value="js">JavaScript</TabsTrigger>
                <TabsTrigger value="curl">curl</TabsTrigger>
              </TabsList>
              <TabsContent value="js" className="min-w-0">
                <Code lang="typescript">{fetchApi}</Code>
              </TabsContent>
              <TabsContent value="curl" className="min-w-0">
                <Code lang="bash">{curlApi}</Code>
              </TabsContent>
            </Tabs>
            <Note>
              Workflow id <code>{workflowId}</code> · workspace id <code>{workspaceId}</code>. Full reference:{' '}
              <a href="/api/v1/openapi.json" target="_blank" className="underline">
                /api/v1/openapi.json
              </a>
            </Note>
          </TabsContent>

          <TabsContent value="result" className="grid min-w-0 gap-3">
            <p className="text-sm text-muted-foreground">
              Triggering returns a <code>runId</code> immediately. Get the outcome by polling, or let Flows call you back.
            </p>
            <Code label="Poll the run (needs an API key)" lang="typescript">
              {poll}
            </Code>
            <p className="text-sm text-muted-foreground">
              Callback:{' '}
              {onFinishUrl ? (
                <>
                  each finished run is POSTed to <code className="[overflow-wrap:anywhere]">{onFinishUrl}</code>.
                </>
              ) : (
                <>none set. Add a Callback URL in the Trigger node&apos;s workflow settings to get each result POSTed to you.</>
              )}{' '}
              Verify it with the workspace signing secret (workspace page → Settings, or <code>GET /api/v1/signing-secret</code>):
            </p>
            <Code lang="typescript">{verify}</Code>
          </TabsContent>
        </Tabs>

        <AiPrompt prompt={prompt} />
      </DialogContent>
    </Dialog>
  );
}
