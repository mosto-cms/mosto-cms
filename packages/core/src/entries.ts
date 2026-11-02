/**
 * Reading and writing a collection file while preserving its layout.
 *
 * A `list` collection file is a JSON array of entries. A `single` collection
 * file is either a JSON object (the entry) or an array with exactly one entry.
 * The id of an entry is `entry[idField]`; a `single` entry without it is
 * addressed by the collection key.
 */
import { CmsError } from './errors.js';
import type { CollectionDef } from './schema.js';

export type Entry = Record<string, unknown>;

export type CollectionDoc = {
  entries: Entry[];
  shape: 'array' | 'object';
  indent: string | number;
  trailingNewline: boolean;
};

function detectIndent(text: string): string | number {
  const m = text.match(/\n([ \t]+)\S/);
  if (!m) return 2;
  const ws = m[1] as string;
  return ws.includes('\t') ? '\t' : ws.length;
}

export function parseCollectionFile(c: CollectionDef, text: string): CollectionDoc {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new CmsError('internal', `${c.file}: invalid JSON (${(err as Error).message})`);
  }
  const base = { indent: detectIndent(text), trailingNewline: text.endsWith('\n') };
  if (Array.isArray(data)) {
    if (!data.every((e) => e != null && typeof e === 'object' && !Array.isArray(e))) {
      throw new CmsError('internal', `${c.file}: every entry must be an object`);
    }
    if (c.type === 'single' && data.length !== 1) {
      throw new CmsError(
        'internal',
        `${c.file}: a single collection holds exactly one entry (found ${data.length})`,
      );
    }
    return { entries: data as Entry[], shape: 'array', ...base };
  }
  if (data != null && typeof data === 'object' && c.type === 'single') {
    return { entries: [data as Entry], shape: 'object', ...base };
  }
  throw new CmsError(
    'internal',
    `${c.file}: expected ${c.type === 'list' ? 'an array of entries' : 'an object or a one-entry array'}`,
  );
}

export function serializeCollectionFile(doc: CollectionDoc): string {
  const value = doc.shape === 'object' ? doc.entries[0] : doc.entries;
  return JSON.stringify(value, null, doc.indent) + (doc.trailingNewline ? '\n' : '');
}

export function entryId(c: CollectionDef, entry: Entry): string {
  const raw = entry[c.idField];
  if (raw != null && raw !== '') return String(raw);
  if (c.type === 'single') return c.key;
  throw new CmsError('internal', `${c.file}: an entry has no "${c.idField}"`);
}

export function findEntry(c: CollectionDef, doc: CollectionDoc, id: string): Entry {
  const entry = doc.entries.find((e) => entryId(c, e) === id);
  if (!entry) throw new CmsError('not_found', `no entry "${id}" in "${c.key}"`);
  return entry;
}
