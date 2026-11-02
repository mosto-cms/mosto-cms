/**
 * Editor sign-in over HTTP, framework-agnostic (Web `Request` → `Response`).
 *
 *   POST <base>/login    JSON { email, password }  → 200 + Set-Cookie, or 401 / 429
 *                        form  email, password, next, back → 303 to `next` (or to `back?error=…`)
 *   POST <base>/logout   clears the cookie (JSON 200, or form → 303 to `next`)
 *   GET  <base>/session  { editor: { email, name } | null, expiresAt }
 *
 * Every POST is refused (403) when the `Origin` header names another site:
 * together with the SameSite=Strict cookie this stops cross-site requests.
 */
import { PROTOCOL_VERSION } from '@mosto-cms/core';

import { assertSecret } from './crypto.js';
import { findEditor, normalizeEmail, type Editor } from './editors.js';
import { getDummyHash, MAX_PASSWORD_LENGTH, verifyPassword } from './password.js';
import { createRateLimiter, type RateLimitOptions } from './rate-limit.js';
import {
  clearSessionCookies,
  createSessionToken,
  DEFAULT_SESSION_TTL_SECONDS,
  isSecureRequest,
  readSessionToken,
  serializeSessionCookie,
  sessionTokenFromCookies,
  type Session,
} from './session.js';

export type EditorAuthOptions = {
  secret: string;
  /** The editor list, or a function returning it (read lazily, e.g. from env). */
  editors: Editor[] | (() => Editor[]);
  sessionTtlSeconds?: number;
  rateLimit?: RateLimitOptions;
  /** Other origins allowed to POST (default: only the site itself). */
  allowedOrigins?: string[];
  /** Where form logins go back to by default. Default "/admin". */
  adminPath?: string;
  now?: () => number;
};

export type LoginResult =
  | { ok: true; session: Session; token: string }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'locked'; retryAfterSeconds: number };

function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

function failure(status: number, code: string, message: string, details?: Record<string, unknown>, headers?: HeadersInit): Response {
  return json(status, { ok: false, protocol: PROTOCOL_VERSION, error: { code, message, ...(details ? { details } : {}) } }, headers);
}

/** Client IP from standard proxy headers (first hop), or null. */
export function clientIp(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  const first = fwd?.split(',')[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = request.headers.get('x-real-ip')?.trim();
  return real ? real.slice(0, 64) : null;
}

/** A same-site path for redirects (`/admin?x=1`), never `//evil.com` or a full URL. */
export function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === '\\') return fallback;
  }
  return value;
}

/** True when the request comes from the site itself (or an allowed origin), or carries no Origin. */
export function isAllowedOrigin(request: Request, allowed: string[] = []): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === 'null') return false;
  const own = new URL(request.url).origin;
  const fwdHost = request.headers.get('x-forwarded-host');
  const candidates = new Set([own, ...allowed.map((o) => o.replace(/\/+$/, ''))]);
  if (fwdHost) {
    const proto = isSecureRequest(request) ? 'https' : 'http';
    candidates.add(`${proto}://${fwdHost.split(',')[0]?.trim()}`);
  }
  return candidates.has(origin);
}

function withQuery(path: string, key: string, value: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

async function readBody(request: Request): Promise<{ form: boolean; data: Record<string, unknown> } | null> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > 16 * 1024) return null;
  try {
    if (type.startsWith('application/json')) {
      const text = await request.text();
      if (text.length > 16 * 1024) return null;
      const data: unknown = JSON.parse(text);
      return data && typeof data === 'object' && !Array.isArray(data) ? { form: false, data: data as Record<string, unknown> } : null;
    }
    if (type.startsWith('application/x-www-form-urlencoded') || type.startsWith('multipart/form-data')) {
      const fd = await request.formData();
      const data: Record<string, unknown> = {};
      for (const [k, v] of fd.entries()) if (typeof v === 'string') data[k] = v;
      return { form: true, data };
    }
  } catch {
    return null;
  }
  return null;
}

export function createEditorAuth(options: EditorAuthOptions) {
  const now = options.now ?? Date.now;
  const ttl = options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const limiter = createRateLimiter(options.rateLimit, now);
  const adminPath = options.adminPath ?? '/admin';
  const editors = (): Editor[] => (typeof options.editors === 'function' ? options.editors() : options.editors);
  const secret = (): string => assertSecret(options.secret);

  /** Check credentials (rate limited). Does not touch cookies. */
  async function login(input: { email: string; password: string; ip?: string | null }): Promise<LoginResult> {
    const email = normalizeEmail(String(input.email ?? '')).slice(0, 254);
    const password = String(input.password ?? '');
    const ip = input.ip ?? null;
    const lock = await limiter.check(email, ip);
    if (lock.locked) return { ok: false, reason: 'locked', retryAfterSeconds: lock.retryAfterSeconds };
    const editor = email ? findEditor(editors(), email) : undefined;
    // Always run one scrypt verification, so unknown emails take as long as known ones.
    const valid =
      password.length > 0 &&
      password.length <= MAX_PASSWORD_LENGTH &&
      (await verifyPassword(password, editor?.passwordHash ?? (await getDummyHash()))) &&
      editor !== undefined;
    if (!valid || !editor) {
      await limiter.failure(email, ip);
      return { ok: false, reason: 'invalid' };
    }
    await limiter.success(email);
    const { token, session } = createSessionToken(editor, { secret: secret(), ttlSeconds: ttl, now });
    return { ok: true, session, token };
  }

  /** The signed-in editor of a request, or null. */
  function getSession(request: Request): Session | null {
    const token = sessionTokenFromCookies(request.headers.get('cookie'));
    if (!token) return null;
    return readSessionToken(token, editors(), { secret: secret(), now });
  }

  /** Same, from a raw cookie value (server components read cookies with next/headers). */
  function getSessionFromToken(token: string | null | undefined): Session | null {
    return token ? readSessionToken(token, editors(), { secret: secret(), now }) : null;
  }

  async function handleLogin(request: Request): Promise<Response> {
    if (request.method !== 'POST') return failure(405, 'bad_request', 'use POST', undefined, { allow: 'POST' });
    if (!isAllowedOrigin(request, options.allowedOrigins)) return failure(403, 'forbidden', 'cross-site sign-in refused');
    const body = await readBody(request);
    if (!body) return failure(400, 'bad_request', 'send { email, password } as JSON or a form');
    const result = await login({
      email: typeof body.data.email === 'string' ? body.data.email : '',
      password: typeof body.data.password === 'string' ? body.data.password : '',
      ip: clientIp(request),
    });
    const secure = isSecureRequest(request);
    if (body.form) {
      const back = safeRedirectPath(body.data.back, adminPath);
      if (!result.ok) {
        return new Response(null, { status: 303, headers: { location: withQuery(back, 'error', result.reason), 'cache-control': 'no-store' } });
      }
      const headers = new Headers({ location: safeRedirectPath(body.data.next, adminPath), 'cache-control': 'no-store' });
      headers.append('set-cookie', serializeSessionCookie(result.token, { secure, maxAgeSeconds: ttl }));
      return new Response(null, { status: 303, headers });
    }
    if (!result.ok) {
      return result.reason === 'locked'
        ? failure(429, 'unauthorized', 'too many failed sign-ins, try again later', { reason: 'locked', retryAfterSeconds: result.retryAfterSeconds }, { 'retry-after': String(result.retryAfterSeconds) })
        : failure(401, 'unauthorized', 'wrong email or password', { reason: 'invalid' });
    }
    const headers = new Headers();
    headers.append('set-cookie', serializeSessionCookie(result.token, { secure, maxAgeSeconds: ttl }));
    return json(
      200,
      { ok: true, protocol: PROTOCOL_VERSION, result: { editor: { email: result.session.email, name: result.session.name }, expiresAt: result.session.expiresAt } },
      headers,
    );
  }

  async function handleLogout(request: Request): Promise<Response> {
    if (request.method !== 'POST') return failure(405, 'bad_request', 'use POST', undefined, { allow: 'POST' });
    if (!isAllowedOrigin(request, options.allowedOrigins)) return failure(403, 'forbidden', 'cross-site sign-out refused');
    const body = await readBody(request);
    const headers = new Headers({ 'cache-control': 'no-store' });
    for (const c of clearSessionCookies(isSecureRequest(request))) headers.append('set-cookie', c);
    if (body?.form) {
      headers.set('location', safeRedirectPath(body.data.next, adminPath));
      return new Response(null, { status: 303, headers });
    }
    return json(200, { ok: true, protocol: PROTOCOL_VERSION, result: { signedOut: true } }, headers);
  }

  function handleSession(request: Request): Response {
    const s = getSession(request);
    return json(200, {
      ok: true,
      protocol: PROTOCOL_VERSION,
      result: s ? { editor: { email: s.email, name: s.name }, expiresAt: s.expiresAt } : { editor: null },
    });
  }

  return { login, getSession, getSessionFromToken, handleLogin, handleLogout, handleSession };
}

export type EditorAuth = ReturnType<typeof createEditorAuth>;
