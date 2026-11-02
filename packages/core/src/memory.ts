/**
 * In-memory adapter with full history. For tests and demos: it behaves like a
 * tiny git (atomic commits, per-file revisions, compare-and-swap) so engine
 * behaviour can be checked without network or disk.
 */
import type {
  CommitInput,
  CommitResult,
  ContentAdapter,
  HistoryEntry,
  StoredFile,
} from './adapter.js';
import { CmsError } from './errors.js';

type Snapshot = Map<string, StoredFile>;
type Commit = HistoryEntry & { tree: Snapshot };

function hash(s: string): string {
  // FNV-1a, enough to give distinct revisions to distinct contents in tests.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type MemoryAdapter = ContentAdapter & {
  /** Write directly, bypassing the engine (simulates someone else committing). */
  seed(files: Record<string, string>, message?: string): string;
  files(): Record<string, string>;
};

export function createMemoryAdapter(initial: Record<string, string> = {}): MemoryAdapter {
  const commits: Commit[] = [];
  let counter = 0;

  const head = (): Snapshot => commits[commits.length - 1]?.tree ?? new Map();

  function record(input: CommitInput): CommitResult {
    const tree: Snapshot = new Map(head());
    for (const f of input.files) {
      const text =
        f.content.encoding === 'utf8'
          ? f.content.data
          : `base64:${f.content.data}`;
      tree.set(f.path, { text, revision: hash(`${f.path}\n${text}`) });
    }
    const revision = `r${++counter}`;
    commits.push({
      revision,
      parent: commits[commits.length - 1]?.revision ?? null,
      message: input.message,
      author: input.author ?? { name: 'memory' },
      date: new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString(),
      files: input.files.map((f) => f.path),
      tree,
    });
    return { revision };
  }

  const adapter: MemoryAdapter = {
    name: 'memory',

    async readFile(path, opts) {
      const tree = opts?.at ? commits.find((c) => c.revision === opts.at)?.tree : head();
      if (!tree) throw new CmsError('not_found', `revision "${opts?.at}" not found`);
      const f = tree.get(path);
      return f ? { ...f } : null;
    },

    async commit(input) {
      const tree = head();
      for (const f of input.files) {
        if (f.baseRevision === undefined) continue;
        const current = tree.get(f.path)?.revision ?? null;
        if (current !== f.baseRevision) {
          throw new CmsError('conflict', `${f.path} was changed by someone else`, {
            file: f.path,
          });
        }
      }
      return record(input);
    },

    async history({ paths, limit }) {
      return commits
        .filter((c) => c.files.some((f) => paths.includes(f)))
        .reverse()
        .slice(0, limit)
        .map(({ tree: _tree, ...c }) => ({ ...c, files: c.files.filter((f) => paths.includes(f)) }));
    },

    async getRevision(revision, { paths }) {
      const c = commits.find((x) => x.revision === revision);
      if (!c) return null;
      const { tree: _tree, ...rest } = c;
      return { ...rest, files: c.files.filter((f) => paths.includes(f)) };
    },

    seed(files, message = 'seed') {
      return record({
        message,
        files: Object.entries(files).map(([path, data]) => ({
          path,
          content: { encoding: 'utf8', data },
        })),
      }).revision;
    },

    files() {
      return Object.fromEntries([...head()].map(([p, f]) => [p, f.text]));
    },
  };

  if (Object.keys(initial).length > 0) adapter.seed(initial, 'initial content');
  return adapter;
}
