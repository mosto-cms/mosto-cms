/**
 * The mosto-cms/1 operations over a schema and a content adapter.
 *
 * `createCms()` is the engine every channel shares. It is stateless between
 * calls (safe for serverless): `publish` receives the full list of changes and
 * applies them in one atomic commit, each one checked against the fence.
 */
import type { ContentAdapter, FileChange, HistoryEntry } from './adapter.js';
import { CmsError } from './errors.js';
import {
  entryId,
  findEntry,
  parseCollectionFile,
  serializeCollectionFile,
  type CollectionDoc,
} from './entries.js';
import { getByPath, jsonEqual, setByPath } from './paths.js';
import {
  getCollection,
  mediaConfig,
  resolveField,
  validateSchema,
  type CollectionDef,
  type FieldDef,
  type MostoCmsSchema,
  type ResolvedField,
} from './schema.js';
import { validateValue, type FieldValue } from './values.js';

export const PROTOCOL_VERSION = 'mosto-cms/1';

export type Access = {
  /** Write operations allowed (publish, uploadAsset, revert). Default true. */
  write?: boolean;
  /** Collections this caller may see and change. Default: all. */
  collections?: string[];
  /** Who is acting. `ai` cannot write fields marked `ai.locked`. Default `human`. */
  actor?: 'human' | 'ai';
};

export type Change = {
  collection: string;
  id: string;
  path: string;
  value: FieldValue;
  /** Optional: the value the caller saw. If the field changed since, `conflict`. */
  before?: FieldValue;
};

export type ChangeResult = {
  collection: string;
  id: string;
  path: string;
  kind: ResolvedField['kind'];
  before: FieldValue | null;
  after: FieldValue;
  changed: boolean;
};

export type CmsOptions = {
  schema: MostoCmsSchema;
  adapter: ContentAdapter;
  access?: Access;
  /** Commit author for writes (e.g. the signed-in editor). */
  author?: { name: string; email: string };
  /** Random source for upload names (tests). */
  randomId?: () => string;
};

export type DescribeResult = {
  protocol: typeof PROTOCOL_VERSION;
  schemaVersion: number;
  site: MostoCmsSchema['site'] | null;
  locales: string[];
  defaultLocale: string;
  collections: Array<{ key: string; type: CollectionDef['type']; label: CollectionDef['label']; fields: number }>;
  capabilities: { history: boolean; revert: boolean; uploadAsset: boolean };
  /** Upload limits, so a client can check a file before sending it. */
  media: { publicPath: string; maxBytes: number; accept: string[] };
  access: { write: boolean; collections: string[] | 'all'; actor: 'human' | 'ai' };
  operations: string[];
};

export const OPERATIONS = [
  'describe',
  'listEditableFields',
  'listEntries',
  'getField',
  'previewChange',
  'publish',
  'uploadAsset',
  'history',
  'revert',
] as const;

export type OperationName = (typeof OPERATIONS)[number];

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'asset'
  );
}

function defaultRandomId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

type Loaded = { collection: CollectionDef; doc: CollectionDoc; revision: string };

export type Cms = ReturnType<typeof createCms>;

export function createCms(options: CmsOptions) {
  const schema = validateSchema(options.schema);
  const { adapter } = options;
  const access = {
    write: options.access?.write ?? true,
    collections: options.access?.collections ?? null,
    actor: options.access?.actor ?? 'human',
  };
  const randomId = options.randomId ?? defaultRandomId;
  const defaultLocale = schema.defaultLocale ?? (schema.locales[0] as string);

  /* ------------------------------ guards ------------------------------ */

  function visible(c: CollectionDef): boolean {
    return access.collections == null || access.collections.includes(c.key);
  }

  function collectionOrThrow(key: string): CollectionDef {
    const c = getCollection(schema, key);
    if (!c) throw new CmsError('not_found', `unknown collection "${key}"`);
    if (!visible(c)) {
      throw new CmsError('forbidden', `collection "${key}" is outside this key's scope`);
    }
    return c;
  }

  function requireWrite(): void {
    if (!access.write) throw new CmsError('forbidden', 'this key is read-only');
  }

  /** The fence: resolve a path or refuse it. */
  function fieldOrThrow(c: CollectionDef, path: string, forWrite: boolean): ResolvedField {
    const field = resolveField(c, path);
    if (!field) {
      throw new CmsError(
        'field_not_editable',
        `"${path}" is not an editable field of "${c.key}"`,
        { collection: c.key, path },
      );
    }
    if (forWrite && access.actor === 'ai' && field.ai?.locked) {
      throw new CmsError('field_not_editable', `"${path}" of "${c.key}" is locked for AI`, {
        collection: c.key,
        path,
        reason: 'ai_locked',
      });
    }
    return field;
  }

  async function load(c: CollectionDef, at?: string): Promise<Loaded> {
    const file = await adapter.readFile(c.file, at ? { at } : undefined);
    if (!file) throw new CmsError('not_found', `content file "${c.file}" not found`);
    return { collection: c, doc: parseCollectionFile(c, file.text), revision: file.revision };
  }

  /* ---------------------------- operations ---------------------------- */

  function describe(): DescribeResult {
    return {
      protocol: PROTOCOL_VERSION,
      schemaVersion: schema.version,
      site: schema.site ?? null,
      locales: schema.locales,
      defaultLocale,
      collections: schema.collections.filter(visible).map((c) => ({
        key: c.key,
        type: c.type,
        label: c.label,
        fields: c.fields.length,
      })),
      capabilities: {
        history: typeof adapter.history === 'function',
        revert: typeof adapter.history === 'function' && typeof adapter.getRevision === 'function',
        uploadAsset: access.write,
      },
      media: (() => {
        const m = mediaConfig(schema);
        return { publicPath: m.publicPath, maxBytes: m.maxBytes, accept: m.accept };
      })(),
      access: {
        write: access.write,
        collections: access.collections ?? 'all',
        actor: access.actor,
      },
      operations: [...OPERATIONS],
    };
  }

  function listEditableFields(input: { collection?: string } = {}): Array<{
    key: string;
    type: CollectionDef['type'];
    label: CollectionDef['label'];
    idField: string;
    file: string;
    fields: FieldDef[];
  }> {
    const cols = input.collection
      ? [collectionOrThrow(input.collection)]
      : schema.collections.filter(visible);
    return cols.map((c) => ({
      key: c.key,
      type: c.type,
      label: c.label,
      idField: c.idField,
      file: c.file,
      fields: c.fields,
    }));
  }

  async function listEntries(input: { collection: string; locale?: string }): Promise<
    Array<{ id: string; title: string }>
  > {
    const c = collectionOrThrow(input.collection);
    const locale = input.locale ?? defaultLocale;
    const { doc } = await load(c);
    return doc.entries.map((e) => {
      const id = entryId(c, e);
      let title: unknown;
      if (c.titleField) {
        title = getByPath(e, c.titleField.replace(/\{locale\}/g, locale));
      }
      if (typeof title !== 'string' || !title) {
        const loc = e[locale] as Record<string, unknown> | undefined;
        title = [loc?.name, loc?.title, e.name, e.title, e.shortName].find(
          (v) => typeof v === 'string' && v,
        );
      }
      return { id, title: typeof title === 'string' && title ? title : id };
    });
  }

  async function getField(input: { collection: string; id: string; path?: string }): Promise<
    | { collection: string; id: string; path: string; kind: ResolvedField['kind']; value: FieldValue | null; revision: string }
    | { collection: string; id: string; revision: string; fields: Record<string, FieldValue | null> }
  > {
    const c = collectionOrThrow(input.collection);
    if (input.path != null) {
      const field = fieldOrThrow(c, input.path, false);
      const { doc, revision } = await load(c);
      const value = getByPath(findEntry(c, doc, input.id), input.path);
      return {
        collection: c.key,
        id: input.id,
        path: input.path,
        kind: field.kind,
        value: (value ?? null) as FieldValue | null,
        revision,
      };
    }
    const { doc, revision } = await load(c);
    const entry = findEntry(c, doc, input.id);
    const fields: Record<string, FieldValue | null> = {};
    for (const f of c.fields) fields[f.path] = (getByPath(entry, f.path) ?? null) as FieldValue | null;
    return { collection: c.key, id: input.id, revision, fields };
  }

  /** Apply changes to freshly loaded docs (in memory). Shared by preview and publish. */
  async function applyChanges(changes: Change[], ignoreBefore = false): Promise<{
    results: ChangeResult[];
    loaded: Map<string, Loaded>;
    /** Changes whose `before` no longer matched because the field already holds the new value. */
    alreadyApplied: number;
  }> {
    if (changes.length === 0) throw new CmsError('bad_request', 'no changes given');
    const seen = new Set<string>();
    const loaded = new Map<string, Loaded>();
    const results: ChangeResult[] = [];
    let alreadyApplied = 0;

    for (const ch of changes) {
      const c = collectionOrThrow(ch.collection);
      const field = fieldOrThrow(c, ch.path, true);
      validateValue(field, ch.value);
      const key = `${c.key}:${ch.id}:${ch.path}`;
      if (seen.has(key)) throw new CmsError('bad_request', `duplicate change for ${key}`);
      seen.add(key);

      let l = loaded.get(c.file);
      if (!l) {
        l = await load(c);
        loaded.set(c.file, l);
      }
      const entry = findEntry(c, l.doc, ch.id);
      const current = getByPath(entry, ch.path);
      if (!ignoreBefore && ch.before !== undefined && !jsonEqual(current, ch.before)) {
        // The field already holds the requested value: the same publish landed
        // before (a retry after a lost answer) or someone made the same edit.
        // Nothing to write and nothing to refuse, so retries are idempotent.
        if (jsonEqual(current, ch.value)) {
          alreadyApplied++;
          results.push({
            collection: c.key,
            id: ch.id,
            path: ch.path,
            kind: field.kind,
            before: (current ?? null) as FieldValue | null,
            after: ch.value,
            changed: false,
          });
          continue;
        }
        throw new CmsError('conflict', `${key} changed since it was read`, {
          field: key,
          expected: ch.before,
          current: current ?? null,
        });
      }
      setByPath(entry, ch.path, ch.value);
      results.push({
        collection: c.key,
        id: ch.id,
        path: ch.path,
        kind: field.kind,
        before: (current ?? null) as FieldValue | null,
        after: ch.value,
        changed: !jsonEqual(current, ch.value),
      });
    }
    return { results, loaded, alreadyApplied };
  }

  async function previewChange(input: { changes: Change[] }): Promise<{
    changes: ChangeResult[];
    revisions: Record<string, string>;
  }> {
    const { results, loaded } = await applyChanges(input.changes);
    return {
      changes: results,
      revisions: Object.fromEntries([...loaded].map(([file, l]) => [file, l.revision])),
    };
  }

  async function publish(input: {
    message?: string;
    changes: Change[];
    /** Strict mode: each file must still be at this revision (as returned by previewChange). */
    baseRevisions?: Record<string, string>;
  }): Promise<{
    published: boolean;
    /** True when nothing was committed because every change was already live (e.g. a retry). */
    alreadyPublished?: boolean;
    revision: string | null;
    url?: string;
    files: string[];
    changes: ChangeResult[];
  }> {
    requireWrite();
    const message = (input.message ?? '').trim() || 'Update content via Mosto CMS';

    const attempt = async () => {
      const { results, loaded, alreadyApplied } = await applyChanges(input.changes);
      const files: FileChange[] = [];
      for (const [file, l] of loaded) {
        const strict = input.baseRevisions?.[file];
        if (strict !== undefined && strict !== l.revision) {
          throw new CmsError('conflict', `${file} changed since revision ${strict}`, {
            file,
            expected: strict,
            current: l.revision,
          });
        }
        const touched = results.some((r) => r.changed && getCollection(schema, r.collection)?.file === file);
        if (!touched) continue;
        files.push({
          path: file,
          content: { encoding: 'utf8', data: serializeCollectionFile(l.doc) },
          baseRevision: l.revision,
        });
      }
      if (files.length === 0) {
        return {
          published: false,
          ...(alreadyApplied > 0 ? { alreadyPublished: true } : {}),
          revision: null,
          files: [],
          changes: results,
        };
      }
      const commit = await adapter.commit({
        message: message.slice(0, 200),
        files,
        ...(options.author ? { author: options.author } : {}),
      });
      return {
        published: true,
        revision: commit.revision,
        ...(commit.url ? { url: commit.url } : {}),
        files: files.map((f) => f.path),
        changes: results,
      };
    };

    try {
      return await attempt();
    } catch (err) {
      // A concurrent write to the same file between our read and our commit:
      // retry once on fresh content. Field-level `before` checks still apply,
      // so we never overwrite a field someone else changed.
      if (err instanceof CmsError && err.code === 'conflict' && !err.details?.field && !input.baseRevisions) {
        return attempt();
      }
      throw err;
    }
  }

  async function uploadAsset(input: {
    filename: string;
    contentType: string;
    dataBase64: string;
    /** Optional target field, to apply its `accept` list. */
    field?: { collection: string; path: string };
  }): Promise<{ path: string; file: string; bytes: number; revision: string }> {
    requireWrite();
    const media = mediaConfig(schema);
    const type = String(input.contentType || '').toLowerCase().trim();
    let accept = media.accept;
    if (input.field) {
      const c = collectionOrThrow(input.field.collection);
      const f = fieldOrThrow(c, input.field.path, true);
      if (f.kind !== 'image' && f.kind !== 'video' && f.kind !== 'imageList') {
        throw new CmsError('invalid_value', `field "${f.path}" does not hold media`);
      }
      if (f.accept) accept = f.accept;
    }
    const ext = EXT_BY_TYPE[type];
    if (!ext || !accept.includes(type)) {
      throw new CmsError('unsupported', `unsupported file type "${input.contentType}"`, {
        accept,
      });
    }
    const base64 = String(input.dataBase64 || '').replace(/^data:[^;,]+;base64,/, '').replace(/\s/g, '');
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new CmsError('bad_request', 'dataBase64 must be non-empty base64');
    }
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const bytes = Math.floor((base64.length * 3) / 4) - padding;
    if (bytes > media.maxBytes) {
      throw new CmsError('too_large', `file is ${bytes} bytes, max ${media.maxBytes}`, {
        maxBytes: media.maxBytes,
      });
    }
    const name = `${slugify(String(input.filename || '').replace(/\.[^.]+$/, ''))}-${randomId()}.${ext}`;
    const file = `${media.dir.replace(/\/+$/, '')}/${name}`;
    const commit = await adapter.commit({
      message: `Upload ${name} via Mosto CMS`,
      files: [{ path: file, content: { encoding: 'base64', data: base64 }, baseRevision: null }],
      ...(options.author ? { author: options.author } : {}),
    });
    return {
      path: `${media.publicPath.replace(/\/+$/, '')}/${name}`,
      file,
      bytes,
      revision: commit.revision,
    };
  }

  function contentFiles(collection?: string): string[] {
    const cols = collection ? [collectionOrThrow(collection)] : schema.collections.filter(visible);
    return [...new Set(cols.map((c) => c.file))];
  }

  async function history(input: { limit?: number; collection?: string } = {}): Promise<{
    entries: HistoryEntry[];
  }> {
    if (!adapter.history) {
      throw new CmsError('unsupported', `the ${adapter.name} adapter has no history`);
    }
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
    return { entries: await adapter.history({ paths: contentFiles(input.collection), limit }) };
  }

  /**
   * Undo one revision, field by field and inside the fence: every editable
   * field that revision changed goes back to its previous value. Fields it did
   * not change, and anything outside the schema, are left alone. If a field
   * changed again afterwards, `conflict` (unless `force`).
   */
  async function revert(input: { revision: string; message?: string; force?: boolean }): Promise<
    Awaited<ReturnType<typeof publish>> & { reverted: string }
  > {
    requireWrite();
    if (!adapter.getRevision || !adapter.history) {
      throw new CmsError('unsupported', `the ${adapter.name} adapter cannot revert`);
    }
    const files = contentFiles();
    const rev = await adapter.getRevision(input.revision, { paths: files });
    if (!rev) throw new CmsError('not_found', `revision "${input.revision}" not found`);
    if (!rev.parent) throw new CmsError('unsupported', 'cannot revert the first revision');

    const changes: Change[] = [];
    for (const c of schema.collections.filter(visible)) {
      if (!rev.files.includes(c.file)) continue;
      const [after, before] = await Promise.all([load(c, rev.revision), load(c, rev.parent)]);
      for (const entryAfter of after.doc.entries) {
        const id = entryId(c, entryAfter);
        const entryBefore = before.doc.entries.find((e) => entryId(c, e) === id);
        if (!entryBefore) continue; // entry created by that revision: out of scope in v1
        for (const f of c.fields) {
          const a = getByPath(entryAfter, f.path);
          const b = getByPath(entryBefore, f.path);
          if (jsonEqual(a, b) || b === undefined) continue;
          if (typeof b !== 'string' && !(Array.isArray(b) && b.every((x) => typeof x === 'string'))) continue;
          const change: Change = { collection: c.key, id, path: f.path, value: b as FieldValue };
          if (!input.force && a !== undefined) change.before = a as FieldValue;
          changes.push(change);
        }
      }
    }
    if (changes.length === 0) {
      throw new CmsError('bad_request', `revision "${input.revision}" has no editable changes to revert`);
    }
    const result = await publish({
      message: input.message ?? `Revert "${rev.message.split('\n')[0]}"`,
      changes,
    });
    return { ...result, reverted: rev.revision };
  }

  return {
    schema,
    describe,
    listEditableFields,
    listEntries,
    getField,
    previewChange,
    publish,
    uploadAsset,
    history,
    revert,
  };
}
