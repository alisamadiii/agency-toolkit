import type { HttpStep, ScriptStep, Step } from '@/lib/schemas';
import { guardedRequest } from '@/lib/net';
import { render, renderText, type TemplateContext } from '@/lib/template';

import { runDeno } from './deno-runner';

export type StepResult = { ok: boolean; output: unknown; error?: string; logs?: string };

export type StepEnv = {
  ctx: TemplateContext;
  allowedHosts: string[];
  signal: AbortSignal;
};

export function runStep(step: Step, env: StepEnv): Promise<StepResult> {
  return step.type === 'http' ? runHttp(step, env) : runScript(step, env);
}

async function runHttp(step: HttpStep, env: StepEnv): Promise<StepResult> {
  const url = renderText(step.url, env.ctx);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(step.headers ?? {})) headers[k.toLowerCase()] = renderText(v, env.ctx);

  let body: string | undefined;
  if (step.body !== undefined && step.method !== 'GET' && step.method !== 'HEAD') {
    const rendered = render(step.body, env.ctx);
    if (typeof rendered === 'string') {
      body = rendered;
    } else {
      body = JSON.stringify(rendered);
      headers['content-type'] ??= 'application/json';
    }
  }

  try {
    const res = await guardedRequest({
      url,
      method: step.method,
      headers,
      body,
      allowedHosts: env.allowedHosts,
      timeoutMs: step.timeoutSec * 1000,
      signal: env.signal,
    });
    let parsed: unknown = res.body;
    if ((res.headers['content-type'] ?? '').includes('json')) {
      try {
        parsed = JSON.parse(res.body);
      } catch {
        // keep text
      }
    }
    const output = { status: res.status, headers: res.headers, body: parsed, truncated: res.truncated || undefined };
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      output,
      error: ok ? undefined : `${step.method} ${redact(url)} returned ${res.status}`,
      logs: `${step.method} ${redact(url)} → ${res.status}`,
    };
  } catch (error) {
    return { ok: false, output: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runScript(step: ScriptStep, env: StepEnv): Promise<StepResult> {
  const result = await runDeno({
    code: step.code,
    context: env.ctx,
    allowedHosts: env.allowedHosts,
    timeoutMs: step.timeoutSec * 1000,
    signal: env.signal,
  });
  return result.ok
    ? { ok: true, output: result.output, logs: result.logs }
    : { ok: false, output: null, error: result.error, logs: result.logs };
}

// Query strings often carry tokens; keep them out of logs.
function redact(url: string) {
  return url.split('?')[0];
}
