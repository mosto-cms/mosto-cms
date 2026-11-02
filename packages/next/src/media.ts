/**
 * Optional media proxy, for sites whose repository is private.
 *
 * Uploads are committed to the schema's `media.dir` (e.g. `public/uploads`).
 * A public repo or a rebuilt site serves them as static files. With a private
 * repo, a file uploaded a minute ago is neither in the deployed bundle nor
 * reachable by the browser on GitHub; this route streams it from the repo
 * with the site's server-side read token, same-origin, right away.
 *
 *   // app/media/[...path]/route.ts
 *   import { createMediaHandler, githubSourceFromEnv } from '@mosto-cms/next';
 *   import schema from '@/mosto-cms.schema.json';
 *   export const GET = createMediaHandler({ schema, source: () => githubSourceFromEnv(process.env) });
 *
 * With `media.publicPath` set to "/media" in the schema, `uploadAsset`
 * returns paths this route serves: `/media/<file>` → `<media.dir>/<file>`.
 *
 * Only files with a known media extension are served, never anything outside
 * `media.dir`, and SVGs get a sandboxing Content-Security-Policy so a script
 * inside one cannot run on the site's origin.
 */
import { loadSchema, mediaConfig } from '@mosto-cms/core';

import type { RouteContext } from './handler.js';
import type { ContentSource } from './source.js';

export const MEDIA_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export type MediaHandlerOptions = {
  /** The site schema, for `media.dir`. Or pass `dir` directly. */
  schema?: unknown;
  /** Repository directory served (default: the schema's `media.dir`). */
  dir?: string;
  source: ContentSource | null | (() => ContentSource | null);
  /** Browser/CDN cache seconds. Default 300. Upload names are unique, so a long value is safe. */
  maxAgeSeconds?: number;
};

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

export function createMediaHandler(options: MediaHandlerOptions) {
  let dir: string | null = options.dir ?? null;
  const getDir = (): string => {
    dir ??= mediaConfig(loadSchema(options.schema)).dir;
    return dir.replace(/\/+$/, '');
  };
  const maxAge = options.maxAgeSeconds ?? 300;

  return async function GET(_request: Request, context?: RouteContext): Promise<Response> {
    const params = context?.params ? await context.params : undefined;
    let segments: string[] | undefined;
    if (params) for (const v of Object.values(params)) if (Array.isArray(v)) segments = v;
    if (!segments) return text(400, 'mount the media handler on a catch-all route: app/media/[...path]/route.ts');
    if (segments.length === 0 || segments.some((s) => !SEGMENT_RE.test(s) || s.includes('..'))) {
      return text(400, 'bad path');
    }
    const ext = (segments[segments.length - 1] as string).split('.').pop()?.toLowerCase() ?? '';
    const type = MEDIA_CONTENT_TYPES[ext];
    if (!type) return text(404, 'not found');
    const source = typeof options.source === 'function' ? options.source() : options.source;
    if (!source) return text(404, 'not found');
    const bytes = await source.readBytes(`${getDir()}/${segments.join('/')}`);
    if (!bytes) return text(404, 'not found');
    const headers: Record<string, string> = {
      'content-type': type,
      'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400`,
      'x-content-type-options': 'nosniff',
    };
    if (ext === 'svg') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    return new Response(bytes, { status: 200, headers });
  };
}
