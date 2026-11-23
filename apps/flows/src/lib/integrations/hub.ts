// Google lives in the client hub, not here: Flows calls the hub API's flowsService
// tRPC routes, server to server, with the shared HUB_API_KEY (the hub's
// FLOWS_HUB_KEY). A workspace id is the hub project id, so each call reaches only
// that project's calendar. No Google credentials or tokens are stored in Flows.

export class IntegrationError extends Error {}

const TIMEOUT_MS = 20_000;

export function hubConfigured() {
  return Boolean(process.env.HUB_API_URL && process.env.HUB_API_KEY);
}

type TrpcResponse = {
  result?: { data?: unknown };
  error?: { message?: string; data?: { code?: string; httpStatus?: number } };
};

// tRPC over HTTP without a transformer: queries are GET ?input=<json>, mutations
// POST <json>; the answer is { result: { data } } or { error: { message } }.
export async function hubCall<T>(procedure: string, input: Record<string, unknown>, kind: 'query' | 'mutation' = 'mutation'): Promise<T> {
  const base = process.env.HUB_API_URL?.replace(/\/+$/, '');
  const key = process.env.HUB_API_KEY;
  if (!base || !key) throw new IntegrationError('The client hub connection is not set up on this server (HUB_API_URL, HUB_API_KEY).');

  const url = new URL(`${base}/api/trpc/flowsService.${procedure}`);
  if (kind === 'query') url.searchParams.set('input', JSON.stringify(input));
  let res: Response;
  try {
    res = await fetch(url, {
      method: kind === 'query' ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        ...(kind === 'mutation' ? { 'content-type': 'application/json' } : {}),
      },
      body: kind === 'mutation' ? JSON.stringify(input) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new IntegrationError(timedOut ? 'The client hub did not answer in time.' : 'Could not reach the client hub.');
  }

  const body = (await res.json().catch(() => ({}))) as TrpcResponse;
  if (res.ok && body.result) return body.result.data as T;
  if (res.status === 401) throw new IntegrationError('The client hub refused Flows (check HUB_API_KEY matches FLOWS_HUB_KEY).');
  if (res.status === 404 && body.error?.data?.code === 'NOT_FOUND') {
    throw new IntegrationError('This workspace is not linked to a client hub project.');
  }
  throw new IntegrationError(body.error?.message || `The client hub returned ${res.status}.`);
}
