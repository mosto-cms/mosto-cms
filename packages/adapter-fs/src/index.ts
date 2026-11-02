/**
 * Local file-system content adapter, for development: the dev server edits
 * the JSON files of the working copy, and git (run by the developer) records
 * history. Writes are all-or-nothing within one process: every file is
 * checked against its base revision first, written to a temp file, then
 * renamed into place.
 *
 * With `git: true` (the root must be inside a git working copy), every write
 * is also committed, only the files it touched, and the adapter offers
 * history and revert like the GitHub adapter. Useful to try `/admin` history
 * locally; it commits in your working copy, so it is opt-in.
 */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile as fsReadFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  CmsError,
  isSafeRelativePath,
  type CommitInput,
  type CommitResult,
  type ContentAdapter,
  type HistoryEntry,
  type StoredFile,
} from '@mosto-cms/core';

export type FsAdapterOptions = {
  /** Directory all paths are relative to (usually the site root). */
  root: string;
  /**
   * Commit every write with git and enable history/revert. The root must be
   * inside a git working copy. Default false.
   */
  git?: boolean;
};

const execFileAsync = promisify(execFile);

/** Committer identity when git has none configured (CI, containers). */
const GIT_IDENTITY = ['-c', 'user.name=Mosto CMS', '-c', 'user.email=cms@mosto-cms.invalid'];

const REV_RE = /^[0-9a-fA-F]{4,64}$/;
const FIELD = '\x1f';
const RECORD = '\x1e';

function revisionOf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export function createFsAdapter(options: FsAdapterOptions): ContentAdapter {
  const root = resolve(options.root);
  const useGit = options.git === true;

  async function git(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', [...GIT_IDENTITY, '-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      throw new CmsError('internal', `git ${args[0]} failed: ${(e.stderr || e.message || '').trim()}`);
    }
  }

  function checkRevision(rev: string): void {
    if (!REV_RE.test(rev)) throw new CmsError('not_found', `revision "${rev}" not found`);
  }

  function parseLog(out: string, paths: string[]): HistoryEntry[] {
    const wanted = new Set(paths);
    return out
      .split(RECORD)
      .map((r) => r.replace(/^\n+/, ''))
      .filter((r) => r.trim())
      .map((record) => {
        const [sha = '', parents = '', name = '', email = '', date = '', message = '', files = ''] = record.split(FIELD);
        return {
          revision: sha,
          parent: parents.split(' ').filter(Boolean)[0] ?? null,
          message: message.trim(),
          author: name ? { name, ...(email ? { email } : {}) } : null,
          date,
          files: files
            .split('\n')
            .map((f) => f.trim())
            .filter((f) => f && (wanted.size === 0 || wanted.has(f))),
        };
      });
  }

  const LOG_FORMAT = `--format=${RECORD}%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%B${FIELD}`;

  function abs(path: string): string {
    if (!isSafeRelativePath(path)) throw new CmsError('bad_request', `unsafe file path "${path}"`);
    const full = resolve(root, path);
    if (!full.startsWith(root + sep)) throw new CmsError('bad_request', `path escapes the root: "${path}"`);
    return full;
  }

  async function read(path: string): Promise<Buffer | null> {
    try {
      return await fsReadFile(abs(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  // Serialize commits inside this process so check-then-write is not interleaved.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    name: 'fs',

    async readFile(path, opts): Promise<StoredFile | null> {
      if (opts?.at) {
        if (!useGit) throw new CmsError('unsupported', 'the fs adapter has no history (enable git: true)');
        checkRevision(opts.at);
        abs(path);
        try {
          const { stdout } = await execFileAsync('git', ['-C', root, 'show', `${opts.at}:./${path}`], {
            encoding: 'buffer',
            maxBuffer: 64 * 1024 * 1024,
          });
          const data = stdout as unknown as Buffer;
          return { text: data.toString('utf8'), revision: revisionOf(data) };
        } catch {
          return null;
        }
      }
      const data = await read(path);
      return data ? { text: data.toString('utf8'), revision: revisionOf(data) } : null;
    },

    commit(input: CommitInput): Promise<CommitResult> {
      const run = async (): Promise<CommitResult> => {
        if (input.files.length === 0) throw new CmsError('bad_request', 'nothing to commit');
        const targets = input.files.map((f) => ({ f, full: abs(f.path) }));
        for (const { f } of targets) {
          if (f.baseRevision === undefined) continue;
          const current = await read(f.path);
          const rev = current ? revisionOf(current) : null;
          if (rev !== f.baseRevision) {
            throw new CmsError('conflict', `${f.path} was changed by someone else`, { file: f.path });
          }
        }
        const staged: Array<{ tmp: string; full: string }> = [];
        try {
          for (const { f, full } of targets) {
            const data =
              f.content.encoding === 'base64' ? Buffer.from(f.content.data, 'base64') : Buffer.from(f.content.data, 'utf8');
            await mkdir(dirname(full), { recursive: true });
            const tmp = `${full}.${randomUUID().slice(0, 8)}.tmp`;
            await writeFile(tmp, data);
            staged.push({ tmp, full });
          }
        } catch (err) {
          await Promise.all(staged.map((s) => rm(s.tmp, { force: true })));
          throw err;
        }
        for (const s of staged) await rename(s.tmp, s.full);
        if (useGit) {
          const paths = targets.map(({ f }) => `./${f.path}`);
          await git(['add', '--', ...paths]);
          const author = input.author ? [`--author=${input.author.name.replace(/[<>]/g, '')} <${input.author.email.replace(/[<>\s]/g, '')}>`] : [];
          await git(['commit', '--no-verify', '-q', '-m', input.message || 'Update content', ...author, '--', ...paths]);
          return { revision: (await git(['rev-parse', 'HEAD'])).trim() };
        }
        const digest = createHash('sha256');
        for (const { f } of targets) digest.update(f.path).update('\0').update(f.content.data);
        return { revision: `fs-${digest.digest('hex').slice(0, 12)}` };
      };
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p;
    },

    ...(useGit
      ? {
          async history(opts: { paths: string[]; limit: number }): Promise<HistoryEntry[]> {
            const out = await git(['log', `-n${Math.max(1, Math.trunc(opts.limit))}`, LOG_FORMAT, '--name-only', '--relative', '--', ...opts.paths.map((p) => `./${p}`)]);
            return parseLog(out, opts.paths);
          },
          async getRevision(revision: string, opts: { paths: string[] }): Promise<HistoryEntry | null> {
            checkRevision(revision);
            let out: string;
            try {
              out = await git(['show', '-s', '--no-patch', LOG_FORMAT, revision]);
            } catch {
              return null;
            }
            const [entry] = parseLog(out, []);
            if (!entry) return null;
            const files = await git(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '--relative', revision, '--', ...opts.paths.map((p) => `./${p}`)]);
            return { ...entry, files: files.split('\n').map((f) => f.trim()).filter(Boolean) };
          },
        }
      : {}),
  };
}
