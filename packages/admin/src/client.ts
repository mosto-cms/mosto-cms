/**
 * A small client for `POST /api/mosto-cms` with the editor session cookie.
 * Every failure becomes an `AdminError` carrying the protocol error code, so
 * the UI branches on codes, never on messages.
 */
export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'field_not_editable'
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'invalid_value'
  | 'unsupported'
  | 'invalid_schema'
  | 'internal'
  | 'network';

export class AdminError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, status = 0, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type Editor = { email: string; name: string };

export type ProtocolClient = {
  call<T = unknown>(op: string, input?: Record<string, unknown>): Promise<T>;
  login(email: string, password: string): Promise<Editor | null>;
  logout(): Promise<void>;
  session(): Promise<Editor | null>;
};

type Envelope = { ok?: boolean; result?: unknown; error?: { code?: string; message?: string; details?: Record<string, unknown> } };

async function send(fetchImpl: typeof fetch, url: string, body: unknown): Promise<{ status: number; data: Envelope; headers: Headers }> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AdminError('network', err instanceof Error ? err.message : String(err));
  }
  let data: Envelope = {};
  try {
    data = (await res.json()) as Envelope;
  } catch {
    // not JSON: a proxy error page, a timeout…
  }
  return { status: res.status, data, headers: res.headers };
}

function toError(status: number, data: Envelope): AdminError {
  const e = data.error ?? {};
  const known = typeof e.code === 'string' ? (e.code as ErrorCode) : status === 413 ? 'too_large' : status >= 500 || status === 0 ? 'internal' : 'bad_request';
  return new AdminError(known, e.message ?? `HTTP ${status}`, status, e.details ?? {});
}

export function createProtocolClient(apiPath: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): ProtocolClient {
  const base = apiPath.replace(/\/+$/, '');
  return {
    async call<T>(op: string, input: Record<string, unknown> = {}): Promise<T> {
      const { status, data } = await send(fetchImpl, base, { op, input });
      if (status >= 200 && status < 300 && data.ok) return data.result as T;
      throw toError(status, data);
    },
    async login(email, password) {
      const { status, data, headers } = await send(fetchImpl, `${base}/login`, { email, password });
      if (status >= 200 && status < 300) {
        const r = (data.result ?? {}) as { editor?: Editor; email?: string; name?: string };
        return r.editor ?? (r.email ? { email: r.email, name: r.name ?? r.email } : null);
      }
      const err = toError(status, data);
      const retry = Number(headers.get('retry-after'));
      if (Number.isFinite(retry) && retry > 0) err.details.retryAfter = retry;
      if (status === 429) err.details.reason ??= 'locked';
      throw err;
    },
    async logout() {
      await send(fetchImpl, `${base}/logout`, {});
    },
    async session() {
      let res: Response;
      try {
        res = await fetchImpl(`${base}/session`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
      } catch (err) {
        throw new AdminError('network', err instanceof Error ? err.message : String(err));
      }
      const data = (await res.json().catch(() => ({}))) as Envelope;
      const r = (data.result ?? {}) as { editor?: Editor | null };
      return r.editor ?? null;
    },
  };
}
