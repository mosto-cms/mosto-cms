/**
 * Local file-system content adapter, for development: the dev server edits
 * the JSON files of the working copy, and git (run by the developer) records
 * history. Writes are all-or-nothing within one process: every file is
 * checked against its base revision first, written to a temp file, then
 * renamed into place.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile as fsReadFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

import {
  CmsError,
  isSafeRelativePath,
  type CommitInput,
  type CommitResult,
  type ContentAdapter,
  type StoredFile,
} from '@mosto-cms/core';

export type FsAdapterOptions = {
  /** Directory all paths are relative to (usually the site root). */
  root: string;
};

function revisionOf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export function createFsAdapter(options: FsAdapterOptions): ContentAdapter {
  const root = resolve(options.root);

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
      if (opts?.at) throw new CmsError('unsupported', 'the fs adapter has no history');
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
        const digest = createHash('sha256');
        for (const { f } of targets) digest.update(f.path).update('\0').update(f.content.data);
        return { revision: `fs-${digest.digest('hex').slice(0, 12)}` };
      };
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p;
    },
  };
}
