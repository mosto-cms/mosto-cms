/**
 * Content sources: where the SITE reads its content from at request time.
 *
 * Writes always go through a content adapter (`@mosto-cms/adapter-github`,
 * `@mosto-cms/adapter-fs`) behind `/api/mosto-cms`. Reads for rendering go
 * through a source, so they can use Next.js' data cache: every GitHub read is
 * a `fetch` tagged `mosto-cms` and `mosto-cms:file:<path>`, and a publish
 * expires exactly those tags (see `nextRevalidator`).
 */
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { isSafeRelativePath } from '@mosto-cms/core';

export const CACHE_TAG = 'mosto-cms';

/** Cache tag of one content file (Next.js tags are limited to 256 characters). */
export function fileTag(path: string): string {
  return `${CACHE_TAG}:file:${path}`.slice(0, 256);
}

export interface ContentSource {
  readonly name: string;
  /** A text file at the current head, or null if missing/unreachable. */
  readText(path: string): Promise<string | null>;
  /** A binary file (media proxy), or null if missing/unreachable. */
  readBytes(path: string): Promise<ArrayBuffer | null>;
}

type NextFetchInit = RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };

export type GithubSourceOptions = {
  owner: string;
  repo: string;
  /** Default "main". */
  branch?: string;
  /**
   * Token with read access (a fine-grained token with contents:read is enough).
   * Optional for public repos, but recommended: unauthenticated GitHub API calls
   * are limited to 60 per hour per IP, shared on serverless hosts.
   */
  token?: string;
  /**
   * Seconds a read is reused before Next.js refetches it in the background.
   * A publish through /api/mosto-cms expires it immediately anyway. Default 60.
   */
  revalidate?: number;
  /** Default https://api.github.com */
  apiUrl?: string;
  fetch?: typeof fetch;
};

export function githubSource(options: GithubSourceOptions): ContentSource {
  const apiUrl = (options.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const branch = options.branch ?? 'main';
  const revalidate = options.revalidate ?? 60;
  const doFetch = options.fetch ?? globalThis.fetch;

  async function get(path: string): Promise<Response | null> {
    if (!isSafeRelativePath(path)) return null;
    const url = `${apiUrl}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}/contents/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?ref=${encodeURIComponent(branch)}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.raw+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    try {
      const res = await doFetch(url, {
        headers,
        next: { revalidate, tags: [CACHE_TAG, fileTag(path)] },
      } as NextFetchInit);
      return res.ok ? res : null;
    } catch {
      return null;
    }
  }

  return {
    name: 'github',
    async readText(path) {
      const res = await get(path);
      return res ? res.text() : null;
    },
    async readBytes(path) {
      const res = await get(path);
      return res ? res.arrayBuffer() : null;
    },
  };
}

export type FsSourceOptions = { root: string };

/** Reads the working copy on disk: local development, and the e2e tests. */
export function fsSource(options: FsSourceOptions): ContentSource {
  const root = resolve(options.root);
  async function read(path: string): Promise<Buffer | null> {
    if (!isSafeRelativePath(path)) return null;
    const full = resolve(root, path);
    if (!full.startsWith(root + sep)) return null;
    try {
      return await readFile(full);
    } catch {
      return null;
    }
  }
  return {
    name: 'fs',
    async readText(path) {
      const b = await read(path);
      return b ? b.toString('utf8') : null;
    },
    async readBytes(path) {
      const b = await read(path);
      return b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null;
    },
  };
}

/** `owner/repo` parsing for the `MOSTO_CMS_GITHUB_REPO` variable. */
export function parseRepo(value: string | undefined): { owner: string; repo: string } | null {
  const m = value?.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? { owner: m[1] as string, repo: m[2] as string } : null;
}

/**
 * A GitHub source from the standard variables, or null when the repo is not
 * configured (the caller then uses the content bundled at build time):
 *   MOSTO_CMS_GITHUB_REPO=owner/repo, MOSTO_CMS_GITHUB_BRANCH (default main),
 *   MOSTO_CMS_GITHUB_READ_TOKEN (or MOSTO_CMS_GITHUB_TOKEN), MOSTO_CMS_REVALIDATE.
 */
export function githubSourceFromEnv(env: Record<string, string | undefined>): ContentSource | null {
  const repo = parseRepo(env.MOSTO_CMS_GITHUB_REPO);
  if (!repo) return null;
  const token = env.MOSTO_CMS_GITHUB_READ_TOKEN || env.MOSTO_CMS_GITHUB_TOKEN;
  const revalidate = env.MOSTO_CMS_REVALIDATE ? Number(env.MOSTO_CMS_REVALIDATE) : undefined;
  return githubSource({
    ...repo,
    branch: env.MOSTO_CMS_GITHUB_BRANCH || 'main',
    ...(token ? { token } : {}),
    ...(revalidate !== undefined && Number.isFinite(revalidate) ? { revalidate } : {}),
  });
}
