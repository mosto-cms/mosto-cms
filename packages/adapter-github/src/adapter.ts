/**
 * GitHub content adapter.
 *
 * Reads files through the Contents API and writes through the Git Data API so
 * that a publish touching several files is ONE commit (blobs → tree → commit →
 * fast-forward ref update). Every file can carry a base revision (its blob
 * sha): if the file moved on since, the commit is refused with `conflict`.
 * If the branch moved for unrelated reasons, the commit is rebuilt on the new
 * head (base revisions are re-checked) a few times before giving up.
 */
import {
  CmsError,
  isSafeRelativePath,
  type CommitInput,
  type CommitResult,
  type ContentAdapter,
  type HistoryEntry,
  type StoredFile,
} from '@mosto-cms/core';

import { createInstallationToken, type GithubAppCredentials, type InstallationToken } from './github-app.js';

export type GithubAuth = { token: string } | { app: GithubAppCredentials };

export type GithubAdapterOptions = {
  owner: string;
  repo: string;
  /** Branch content is read from and committed to (e.g. "main"). */
  branch: string;
  auth: GithubAuth;
  /**
   * Directory of the repository all content paths live in, for monorepos:
   * with `rootDir: 'apps/web'`, the schema path `content/home.json` is the
   * repository file `apps/web/content/home.json`. History entries come back
   * as schema paths (the prefix is stripped). Default: the repository root.
   */
  rootDir?: string;
  /** Default https://api.github.com (set for GitHub Enterprise). */
  apiUrl?: string;
  /** Injected fetch (tests, custom agents). Default: global fetch. */
  fetch?: typeof fetch;
  /** Attempts to rebuild a commit when the branch moved meanwhile. Default 3. */
  maxAttempts?: number;
};

type GitCommit = {
  sha: string;
  html_url?: string;
  parents: Array<{ sha: string }>;
  commit: { message: string; author: { name: string; email: string; date: string } | null };
  files?: Array<{ filename: string }>;
};

const NOT_FAST_FORWARD = Symbol('not-fast-forward');

function encodePath(path: string): string {
  if (!isSafeRelativePath(path)) {
    throw new CmsError('bad_request', `unsafe file path "${path}"`);
  }
  return path.split('/').map(encodeURIComponent).join('/');
}

/** "apps/web" from " /apps/web/ ", refusing anything unsafe. Empty for none. */
export function normalizeRootDir(rootDir: string | undefined): string {
  const dir = (rootDir ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (dir && !isSafeRelativePath(dir)) {
    throw new CmsError('bad_request', `unsafe rootDir "${rootDir}"`);
  }
  return dir;
}

export function createGithubAdapter(options: GithubAdapterOptions): ContentAdapter {
  const apiUrl = (options.apiUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  const maxAttempts = options.maxAttempts ?? 3;
  const repoUrl = `${apiUrl}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;
  const rootDir = normalizeRootDir(options.rootDir);
  let appToken: InstallationToken | null = null;

  /** The repository path of a schema path (validates the schema path first). */
  function repoPath(path: string): string {
    if (!isSafeRelativePath(path)) throw new CmsError('bad_request', `unsafe file path "${path}"`);
    return rootDir ? `${rootDir}/${path}` : path;
  }

  async function token(): Promise<string> {
    if ('token' in options.auth) return options.auth.token;
    if (!appToken || appToken.expiresAt - 60_000 < Date.now()) {
      appToken = await createInstallationToken({
        app: options.auth.app,
        owner: options.owner,
        repo: options.repo,
        apiUrl,
        fetch: doFetch,
      });
    }
    return appToken.token;
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
    const res = await doFetch(`${repoUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401 || res.status === 403) {
      throw new CmsError('internal', `GitHub refused the site credentials (${res.status}) on ${method} ${path.split('?')[0]}`);
    }
    if (res.status === 404) return { status: 404, data: null };
    if (res.status === 409 || res.status === 422) {
      const text = await res.text();
      if (/fast.?forward|reference cannot be updated|is at .* but expected/i.test(text)) {
        throw NOT_FAST_FORWARD;
      }
      if (/no commit found/i.test(text)) return { status: 404, data: null };
      throw new CmsError('internal', `GitHub ${method} ${path.split('?')[0]} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new CmsError('internal', `GitHub ${method} ${path.split('?')[0]} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    return { status: res.status, data: (await res.json()) as T };
  }

  async function blobSha(path: string, ref: string): Promise<string | null> {
    const { data } = await call<{ sha: string; type: string } | unknown[]>(
      'GET',
      `/contents/${encodePath(repoPath(path))}?ref=${encodeURIComponent(ref)}`,
    );
    if (data == null) return null;
    if (Array.isArray(data)) throw new CmsError('bad_request', `"${path}" is a directory`);
    return (data as { sha: string }).sha;
  }

  async function readFile(path: string, opts?: { at?: string }): Promise<StoredFile | null> {
    const ref = opts?.at ?? options.branch;
    const { data } = await call<{ sha: string; content?: string; encoding?: string; size?: number } | unknown[]>(
      'GET',
      `/contents/${encodePath(repoPath(path))}?ref=${encodeURIComponent(ref)}`,
    );
    if (data == null) return null;
    if (Array.isArray(data)) throw new CmsError('bad_request', `"${path}" is a directory`);
    const file = data as { sha: string; content?: string; encoding?: string; size?: number };
    let base64 = file.encoding === 'base64' ? file.content ?? '' : '';
    if (!base64 && (file.size ?? 0) > 0) {
      // Files over 1 MB come without inline content: fetch the blob.
      const blob = await call<{ content: string }>('GET', `/git/blobs/${file.sha}`);
      base64 = blob.data?.content ?? '';
    }
    return { text: Buffer.from(base64, 'base64').toString('utf8'), revision: file.sha };
  }

  async function commitOnce(input: CommitInput): Promise<CommitResult> {
    const ref = await call<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(options.branch)}`);
    if (!ref.data) throw new CmsError('not_found', `branch "${options.branch}" not found`);
    const head = ref.data.object.sha;
    const headCommit = await call<{ tree: { sha: string } }>('GET', `/git/commits/${head}`);
    if (!headCommit.data) throw new CmsError('internal', `commit ${head} not found`);

    for (const f of input.files) {
      if (f.baseRevision === undefined) continue;
      const current = await blobSha(f.path, head);
      if (current !== f.baseRevision) {
        throw new CmsError('conflict', `${f.path} was changed by someone else`, {
          file: f.path,
          expected: f.baseRevision,
          current,
        });
      }
    }

    const tree = [];
    for (const f of input.files) {
      const blob = await call<{ sha: string }>('POST', '/git/blobs', {
        content: f.content.data,
        encoding: f.content.encoding === 'base64' ? 'base64' : 'utf-8',
      });
      tree.push({ path: repoPath(f.path), mode: '100644', type: 'blob', sha: blob.data!.sha });
    }
    const newTree = await call<{ sha: string }>('POST', '/git/trees', {
      base_tree: headCommit.data.tree.sha,
      tree,
    });
    const now = new Date().toISOString();
    const commit = await call<{ sha: string; html_url?: string }>('POST', '/git/commits', {
      message: input.message,
      tree: newTree.data!.sha,
      parents: [head],
      ...(input.author ? { author: { ...input.author, date: now } } : {}),
    });
    await call('PATCH', `/git/refs/heads/${encodeURIComponent(options.branch)}`, {
      sha: commit.data!.sha,
      force: false,
    });
    return {
      revision: commit.data!.sha,
      ...(commit.data!.html_url ? { url: commit.data!.html_url } : {}),
    };
  }

  async function commit(input: CommitInput): Promise<CommitResult> {
    if (input.files.length === 0) throw new CmsError('bad_request', 'nothing to commit');
    for (const f of input.files) encodePath(repoPath(f.path)); // refuse unsafe paths up front
    for (let attempt = 1; ; attempt++) {
      try {
        return await commitOnce(input);
      } catch (err) {
        if (err !== NOT_FAST_FORWARD) throw err;
        if (attempt >= maxAttempts) {
          throw new CmsError('conflict', `branch "${options.branch}" keeps moving, try again`);
        }
      }
    }
  }

  function toEntry(c: GitCommit, files: string[]): HistoryEntry {
    const a = c.commit.author;
    return {
      revision: c.sha,
      parent: c.parents[0]?.sha ?? null,
      message: c.commit.message,
      author: a ? { name: a.name, email: a.email } : null,
      date: a?.date ?? '',
      files,
    };
  }

  async function history({ paths, limit }: { paths: string[]; limit: number }): Promise<HistoryEntry[]> {
    const byRevision = new Map<string, { commit: GitCommit; files: string[] }>();
    for (const path of paths) {
      const { data } = await call<GitCommit[]>(
        'GET',
        `/commits?sha=${encodeURIComponent(options.branch)}&path=${encodeURIComponent(encodePath(repoPath(path)))}&per_page=${limit}`,
      );
      for (const c of data ?? []) {
        const e = byRevision.get(c.sha) ?? { commit: c, files: [] };
        e.files.push(path);
        byRevision.set(c.sha, e);
      }
    }
    return [...byRevision.values()]
      .map((e) => toEntry(e.commit, e.files))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
  }

  async function getRevision(revision: string, { paths }: { paths: string[] }): Promise<HistoryEntry | null> {
    if (!/^[0-9a-f]{7,64}$/i.test(revision)) return null;
    const { data } = await call<GitCommit>('GET', `/commits/${revision}`);
    if (!data) return null;
    const prefix = rootDir ? `${rootDir}/` : '';
    const files = (data.files ?? [])
      .map((f) => f.filename)
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(prefix.length))
      .filter((f) => paths.includes(f));
    return toEntry(data, files);
  }

  return { name: 'github', readFile, commit, history, getRevision };
}
