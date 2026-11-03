/**
 * The `/api/mosto-cms` route handler (Next.js App Router, Node.js runtime).
 *
 * Mount it on a catch-all route so the sign-in endpoints live next to the
 * protocol:
 *
 *   // app/api/mosto-cms/[[...route]]/route.ts
 *   import { createRouteHandlers } from '@mosto-cms/next';
 *   import { cms } from '@/mosto-cms.config';
 *   const handlers = createRouteHandlers(cms);
 *   export const GET = handlers.GET;
 *   export const POST = handlers.POST;
 *
 * Only GET and POST: no `runtime` or `dynamic` segment config, so the route
 * builds on Next.js 16 with `cacheComponents: true` too (segment configs are
 * a build error there). Next.js 15+ does not cache route handlers by default.
 *
 * Routes:
 *   POST /api/mosto-cms          the protocol: { op, input } (connector key or editor session)
 *   GET  /api/mosto-cms          discovery: protocol version and auth methods, no secrets
 *   POST /api/mosto-cms/login    editor sign-in    (see @mosto-cms/auth)
 *   POST /api/mosto-cms/logout   editor sign-out
 *   GET  /api/mosto-cms/session  the signed-in editor, if any
 *
 * Authentication of a protocol call:
 *   1. `Authorization: Bearer <connector key>`: the key's scope becomes the
 *      access (write, collections, actor). A present but bad key is always
 *      `unauthorized`, it never falls back to the cookie.
 *   2. Otherwise the editor session cookie: full access as a human, commits
 *      authored by the editor. Cookie calls must be `application/json` and,
 *      when the browser sends an `Origin`, come from the site itself or an
 *      allowed origin (cross-site request forgery protection on top of
 *      SameSite=Strict).
 *   3. Otherwise `unauthorized`.
 * A caller may send `X-Mosto-Actor: ai` to act as AI (never the other way).
 */
import {
  CmsError,
  createCms,
  handleRequest,
  mediaConfig,
  PROTOCOL_VERSION,
  toCmsError,
  ERROR_HTTP_STATUS,
  type Access,
  type ProtocolResponse,
} from '@mosto-cms/core';
import { isAllowedOrigin, verifyConnectorKey } from '@mosto-cms/auth';

import type { MostoCmsSite } from './site.js';

/**
 * The second argument Next.js passes to a route handler. Required in the type
 * (Next.js 15 rejects an optional one at build time), tolerated as missing at runtime.
 */
export type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };
export type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>;

type Caller = { access: Access; author: { name: string; email: string }; via: 'key' | 'session'; keyId?: string };

const WRITE_OPS = new Set(['publish', 'revert', 'uploadAsset']);

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function errorResponse(err: unknown): Response {
  const e = toCmsError(err);
  return respond(ERROR_HTTP_STATUS[e.code], { ok: false, protocol: PROTOCOL_VERSION, error: e.toJSON() });
}

/** The sub-route after the mount point (`[]` for the protocol itself). */
async function subRoute(site: MostoCmsSite, request: Request, context: RouteContext | undefined): Promise<string[]> {
  const params = context?.params ? await context.params : undefined;
  if (params) {
    for (const v of Object.values(params)) if (Array.isArray(v)) return v;
  }
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (path.startsWith(`${site.apiPath}/`)) return path.slice(site.apiPath.length + 1).split('/');
  return [];
}

async function authenticate(site: MostoCmsSite, request: Request): Promise<Caller> {
  const header = request.headers.get('authorization');
  if (header) {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (!m) throw new CmsError('unauthorized', 'malformed Authorization header');
    const result = verifyConnectorKey(m[1] as string, {
      secret: site.getSecret(),
      epoch: site.keyEpoch(),
      revoked: await site.revokedKeys(),
      now: site.now,
    });
    if (!result.ok) {
      throw new CmsError('unauthorized', `invalid connector key (${result.reason})`, { reason: result.reason });
    }
    const { claims } = result;
    return {
      via: 'key',
      keyId: claims.kid,
      access: {
        write: claims.scope.write,
        actor: claims.scope.actor,
        ...(claims.scope.collections ? { collections: claims.scope.collections } : {}),
      },
      author: {
        name: claims.label ? `${claims.label} (connector)` : 'Mosto CMS connector',
        email: site.connectorEmail ?? `connector+${claims.kid}@mosto-cms.invalid`,
      },
    };
  }
  const session = site.editorAuth().getSession(request);
  if (!session) throw new CmsError('unauthorized', 'sign in or send a connector key');
  if (!isAllowedOrigin(request, site.allowedOrigins())) {
    throw new CmsError('forbidden', 'cross-site request refused');
  }
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw new CmsError('bad_request', 'send the request as application/json');
  }
  return { via: 'session', access: { write: true, actor: 'human' }, author: { name: session.name, email: session.email } };
}

/** Largest accepted body: an upload of `media.maxBytes` in base64, plus room for JSON. */
function maxBodyBytes(site: MostoCmsSite): number {
  return Math.ceil((mediaConfig(site.getSchema()).maxBytes * 4) / 3) + 64 * 1024;
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) throw new CmsError('too_large', `request body over ${limit} bytes`);
  const text = await request.text();
  if (text.length > limit) throw new CmsError('too_large', `request body over ${limit} bytes`);
  try {
    return JSON.parse(text);
  } catch {
    throw new CmsError('bad_request', 'the body is not valid JSON');
  }
}

async function protocol(site: MostoCmsSite, request: Request): Promise<Response> {
  let cms;
  let body: unknown;
  try {
    const schema = site.getSchema();
    const caller = await authenticate(site, request);
    if (request.headers.get('x-mosto-actor')?.trim().toLowerCase() === 'ai') {
      caller.access = { ...caller.access, actor: 'ai' };
    }
    body = await readJson(request, maxBodyBytes(site));
    cms = createCms({ schema, adapter: site.getAdapter(), access: caller.access, author: caller.author });
  } catch (err) {
    return errorResponse(err);
  }
  const { status, body: out } = await handleRequest(cms, body);
  if (!out.ok && status >= 500) {
    // Server-side failures (storage unreachable, misconfiguration) are logged
    // so they show up in the host's function logs; the message carries no secrets.
    console.error(`[mosto-cms] ${String((body as { op?: unknown })?.op)} failed: ${out.error.message}`);
  }
  // A write that succeeded stays a success: nothing after the commit can turn
  // it into an error response (see afterWrite).
  await afterWrite(site, body, out);
  return respond(status, out);
}

async function afterWrite(site: MostoCmsSite, body: unknown, out: ProtocolResponse): Promise<void> {
  if (!out.ok || !site.revalidate) return;
  const op = (body as { op?: string }).op;
  if (!op || !WRITE_OPS.has(op)) return;
  const r = out.result as { published?: boolean; files?: string[]; revision?: string | null };
  if (op !== 'uploadAsset' && !r.published) return;
  try {
    await site.revalidate({
      op: op as 'publish' | 'revert' | 'uploadAsset',
      files: op === 'uploadAsset' ? [] : (r.files ?? []),
      revision: r.revision ?? null,
    });
  } catch (err) {
    // The commit is done; a failed cache expiry only delays the update until the next revalidation.
    console.warn('[mosto-cms] revalidation after write failed:', err instanceof Error ? err.message : err);
  }
}

function notFound(): Response {
  return respond(404, { ok: false, protocol: PROTOCOL_VERSION, error: { code: 'not_found', message: 'no such Mosto CMS route' } });
}

export function createRouteHandlers(site: MostoCmsSite): { GET: RouteHandler; POST: RouteHandler } {
  return {
    async GET(request, context) {
      const route = await subRoute(site, request, context);
      if (route.length === 0) {
        return respond(200, {
          ok: true,
          protocol: PROTOCOL_VERSION,
          result: { name: 'mosto-cms', protocol: PROTOCOL_VERSION, auth: ['connector-key', 'editor-session'] },
        });
      }
      if (route.length === 1 && route[0] === 'session') {
        try {
          return site.editorAuth().handleSession(request);
        } catch (err) {
          return errorResponse(err);
        }
      }
      return notFound();
    },
    async POST(request, context) {
      const route = await subRoute(site, request, context);
      try {
        if (route.length === 0) return await protocol(site, request);
        if (route.length === 1 && route[0] === 'login') return await site.editorAuth().handleLogin(request);
        if (route.length === 1 && route[0] === 'logout') return await site.editorAuth().handleLogout(request);
      } catch (err) {
        return errorResponse(err);
      }
      return notFound();
    },
  };
}
