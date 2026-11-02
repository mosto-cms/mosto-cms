/**
 * Content adapters: where content files live (a GitHub repo, the local disk…).
 *
 * Adapters are deliberately dumb. They read and write whole files and report
 * revisions; every rule (the fence, value validation, addressing) lives in the
 * core operations, so it is identical whatever the storage.
 */

export type StoredFile = {
  text: string;
  /** Opaque revision of this file's content (e.g. a git blob sha or a hash). */
  revision: string;
};

export type FileContent =
  | { encoding: 'utf8'; data: string }
  | { encoding: 'base64'; data: string };

export type FileChange = {
  path: string;
  content: FileContent;
  /**
   * Optimistic concurrency guard:
   * - a string: the file must currently be at this revision;
   * - null: the file must not exist yet;
   * - undefined: no check.
   * A mismatch makes the whole commit fail with `conflict`.
   */
  baseRevision?: string | null;
};

export type CommitAuthor = { name: string; email: string };

export type CommitInput = {
  message: string;
  files: FileChange[];
  author?: CommitAuthor;
};

export type CommitResult = {
  /** Revision of the whole change set (e.g. the commit sha). */
  revision: string;
  url?: string;
};

export type HistoryEntry = {
  revision: string;
  parent: string | null;
  message: string;
  author: { name: string; email?: string } | null;
  /** ISO 8601 date. */
  date: string;
  /** Files of interest touched by this revision. */
  files: string[];
};

export interface ContentAdapter {
  readonly name: string;
  /** Read a file at the current head (or at a past revision). Null if it does not exist. */
  readFile(path: string, opts?: { at?: string }): Promise<StoredFile | null>;
  /** Write every file in ONE atomic change. All or nothing; `conflict` on a stale base. */
  commit(input: CommitInput): Promise<CommitResult>;
  /** Optional: recent revisions touching `paths`, newest first. Enables history/revert. */
  history?(opts: { paths: string[]; limit: number }): Promise<HistoryEntry[]>;
  /** Optional (required with history): one revision with its files. */
  getRevision?(revision: string, opts: { paths: string[] }): Promise<HistoryEntry | null>;
}
