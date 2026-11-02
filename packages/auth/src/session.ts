/**
 * Editor sessions: a signed token in an `HttpOnly`, `SameSite=Strict` cookie.
 *
 * Token: `mcs1.<base64url(json)>.<hmac>` with `{ v, sub, name, iat, exp, ph }`,
 * signed with the `session/v1` subkey of the site secret. `ph` is a keyed
 * fingerprint of the editor's password hash: when an editor is removed from
 * the list or their password changes, their sessions stop working at once.
 * Rotating the site secret ends every session.
 */
import { b64url, deriveKey, hmac, signToken, verifyToken } from './crypto.js';
import { findEditor, type Editor } from './editors.js';

export const SESSION_PREFIX = 'mcs1';
/** Cookie name over HTTPS. The `__Host-` prefix pins it to this exact host, path `/`, Secure. */
export const SESSION_COOKIE_SECURE = '__Host-mosto-cms-session';
/** Cookie name on plain-HTTP local development. */
export const SESSION_COOKIE_DEV = 'mosto-cms-session';
export const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;

export type Session = { email: string; name: string; issuedAt: number; expiresAt: number };

export type SessionOptions = { secret: string; ttlSeconds?: number; now?: () => number };

function key(secret: string): Buffer {
  return deriveKey(secret, 'session/v1');
}

function fingerprint(k: Buffer, editor: Editor): string {
  return b64url(hmac(k, `ph:${editor.passwordHash}`)).slice(0, 22);
}

export function createSessionToken(editor: Editor, opts: SessionOptions): { token: string; session: Session } {
  const k = key(opts.secret);
  const iat = Math.floor((opts.now ?? Date.now)() / 1000);
  const exp = iat + (opts.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS);
  const token = signToken(SESSION_PREFIX, k, {
    v: 1,
    sub: editor.email,
    name: editor.name,
    iat,
    exp,
    ph: fingerprint(k, editor),
  });
  return { token, session: { email: editor.email, name: editor.name, issuedAt: iat, expiresAt: exp } };
}

/** The session behind a token, or null (forged, expired, editor removed, password changed). */
export function readSessionToken(token: string, editors: Editor[], opts: SessionOptions): Session | null {
  const k = key(opts.secret);
  const p = verifyToken(SESSION_PREFIX, k, token);
  if (!p || p.v !== 1 || typeof p.sub !== 'string' || typeof p.exp !== 'number' || typeof p.iat !== 'number') {
    return null;
  }
  const now = Math.floor((opts.now ?? Date.now)() / 1000);
  if (p.exp <= now) return null;
  const editor = findEditor(editors, p.sub);
  if (!editor || p.ph !== fingerprint(k, editor)) return null;
  return { email: editor.email, name: editor.name, issuedAt: p.iat, expiresAt: p.exp };
}

/* ------------------------------ cookies ------------------------------ */

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (!(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

/** True when the request reached the site over HTTPS (directly or behind a proxy). */
export function isSecureRequest(request: Request): boolean {
  if (new URL(request.url).protocol === 'https:') return true;
  const fwd = request.headers.get('x-forwarded-proto');
  return fwd != null && fwd.split(',')[0]?.trim() === 'https';
}

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_DEV;
}

export function serializeSessionCookie(token: string, opts: { secure: boolean; maxAgeSeconds: number }): string {
  const attrs = [
    `${sessionCookieName(opts.secure)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`,
  ];
  if (opts.secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** Set-Cookie values that delete the session cookie (both names). */
export function clearSessionCookies(secure: boolean): string[] {
  const out = [`${SESSION_COOKIE_DEV}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`];
  if (secure) out.unshift(`${SESSION_COOKIE_SECURE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`);
  return out;
}

/** The session token sent with a request, if any. */
export function sessionTokenFromCookies(cookieHeader: string | null | undefined): string | null {
  const c = parseCookies(cookieHeader);
  return c[SESSION_COOKIE_SECURE] ?? c[SESSION_COOKIE_DEV] ?? null;
}
