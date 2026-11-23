import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BLOCKED_CIDRS } from '@/lib/net';

const MARKER = '\u0000FLOWS_RESULT\u0000';
const MAX_LOGS = 64 * 1024;
const MAX_RESULT = 1024 * 1024;

// Console goes to stderr (captured as logs); the return value goes to stdout after a marker.
const RUNNER = `
const enc = new TextEncoder();
const write = (s) => { try { Deno.stderr.writeSync(enc.encode(s + "\\n")); } catch {} };
const fmt = (x) => typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })();
for (const k of ["log", "info", "warn", "error", "debug"]) console[k] = (...a) => write(a.map(fmt).join(" "));
const ctx = JSON.parse(await new Response(Deno.stdin.readable).text());
let result;
try {
  const mod = await import("./user.ts");
  if (typeof mod.default !== "function") throw new Error("Script must export a default function");
  result = { ok: true, output: (await mod.default(ctx)) ?? null };
} catch (e) {
  result = { ok: false, error: e instanceof Error ? (e.stack || e.message) : String(e) };
}
let body;
try { body = JSON.stringify(result); } catch { body = JSON.stringify({ ok: false, error: "Return value is not JSON-serializable" }); }
Deno.stdout.writeSync(enc.encode(${JSON.stringify(MARKER)} + body));
`;

export type ScriptResult = { ok: true; output: unknown; logs: string } | { ok: false; error: string; logs: string };

export async function runDeno(opts: {
  code: string;
  context: unknown;
  allowedHosts: string[];
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ScriptResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'flows-'));
  try {
    await writeFile(path.join(dir, 'user.ts'), opts.code);
    await writeFile(path.join(dir, 'runner.ts'), RUNNER);

    const hosts = opts.allowedHosts.map((h) => h.trim()).filter(Boolean);
    const args = ['run', '--no-prompt', '--no-config', '--no-lock', '--no-remote', '--no-npm', '--quiet'];
    if (hosts.includes('*')) args.push('--allow-net');
    else if (hosts.length) args.push(`--allow-net=${hosts.join(',')}`);
    // Checked against resolved IPs as well, so public names pointing inward are refused.
    // Deno has no IPv6 CIDR support; Docker networks are IPv4, and IPv6 loopback is listed.
    args.push(`--deny-net=${[...BLOCKED_CIDRS, '[::1]'].join(',')}`);
    args.push('--v8-flags=--max-old-space-size=128', 'runner.ts');

    return await new Promise<ScriptResult>((resolve) => {
      // Empty environment: the app's own env (DATABASE_URL, MASTER_KEY...) never reaches scripts.
      const child = spawn(process.env.DENO_BIN || 'deno', args, {
        cwd: dir,
        env: {
          PATH: '/usr/local/bin:/usr/bin:/bin',
          DENO_DIR: process.env.DENO_DIR || path.join(tmpdir(), 'flows-deno-cache'),
          NO_COLOR: '1',
        } as unknown as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let logs = '';
      let settled = false;
      const done = (r: ScriptResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(r);
      };
      const kill = (reason: string) => {
        child.kill('SIGKILL');
        done({ ok: false, error: reason, logs: cap(logs) });
      };
      const timer = setTimeout(() => kill(`Script timed out after ${opts.timeoutMs / 1000}s`), opts.timeoutMs);
      const onAbort = () => kill('Run was cancelled or timed out');
      opts.signal?.addEventListener('abort', onAbort);

      child.stdout.on('data', (d: Buffer) => {
        if (stdout.length < MAX_RESULT + MARKER.length) stdout += d.toString('utf8');
      });
      child.stderr.on('data', (d: Buffer) => {
        if (logs.length < MAX_LOGS) logs += d.toString('utf8');
      });
      child.on('error', (e) => done({ ok: false, error: `Could not start Deno: ${e.message}`, logs: '' }));
      child.on('close', (code) => {
        const at = stdout.lastIndexOf(MARKER);
        if (at === -1) {
          const oom = /out of memory|heap limit/i.test(logs);
          return done({
            ok: false,
            error: oom ? 'Script ran out of memory (128 MB limit)' : `Script exited with code ${code}`,
            logs: cap(logs),
          });
        }
        const raw = stdout.slice(at + MARKER.length);
        if (raw.length > MAX_RESULT) return done({ ok: false, error: 'Return value is larger than 1 MB', logs: cap(logs) });
        try {
          const parsed = JSON.parse(raw) as { ok: boolean; output?: unknown; error?: string };
          done(parsed.ok ? { ok: true, output: parsed.output, logs: cap(logs) } : { ok: false, error: parsed.error ?? 'Script failed', logs: cap(logs) });
        } catch {
          done({ ok: false, error: 'Could not read the script result', logs: cap(logs) });
        }
      });

      child.stdin.end(JSON.stringify(opts.context));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function cap(s: string) {
  return s.length > MAX_LOGS ? s.slice(0, MAX_LOGS) + '\n…(truncated)' : s;
}
