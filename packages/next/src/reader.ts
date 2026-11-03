/**
 * The content reader a site renders with.
 *
 * Three layers, in order:
 *   1. live: the latest published content from a source (GitHub through the
 *      Next.js data cache, or the disk in development);
 *   2. bundled: the JSON imported at build time, used when the live read is
 *      not configured or fails;
 *   3. nothing: null / [].
 * The site never breaks because of the CMS: a failed live read falls back to
 * the bundle silently.
 *
 * Freshness: GitHub reads are cached for `revalidate` seconds AND tagged, and
 * `/api/mosto-cms` expires the tags right after a publish, so the next visit
 * renders the new content. Pages should be ISR (`export const revalidate = …`),
 * dynamic, or — on Next.js 16 with `cacheComponents: true`, where segment
 * configs are a build error — read through a `'use cache'` function tagged
 * `cacheTag(fileTag('content/….json'))` with a `cacheLife(…)` profile: a
 * publish expires exactly that tag.
 */
import {
  entryId,
  getCollection,
  loadSchema,
  parseCollectionFile,
  type CollectionDef,
  type Entry,
  type MostoCmsSchema,
} from '@mosto-cms/core';

import type { ContentSource } from './source.js';

export type ContentReaderOptions = {
  /** The site schema (v1 or legacy JSON), to address content by collection key. */
  schema?: unknown;
  /** Live source, or a function returning one (resolved per read, so env can change). Null: bundle only. */
  source?: ContentSource | null | (() => ContentSource | null);
  /** Content bundled at build time, by file path: `{ 'content/home.json': homeJson }`. */
  bundled?: Record<string, unknown>;
  /** Called when a live read fails or returns invalid JSON (default: silent). */
  onError?: (file: string, error: unknown) => void;
};

export type ContentReader = {
  /** A whole JSON file: live, else bundled, else null. */
  file<T = unknown>(path: string): Promise<T | null>;
  /** The entries of a collection (a `single` collection gives one entry). */
  collection<T extends Entry = Entry>(key: string): Promise<T[]>;
  /** One entry by id (for a `single` collection, its id or the collection key). Null if absent. */
  entry<T extends Entry = Entry>(key: string, id?: string): Promise<T | null>;
};

export function createContentReader(options: ContentReaderOptions = {}): ContentReader {
  let schema: MostoCmsSchema | null = null;
  const getSchema = (): MostoCmsSchema => {
    if (!options.schema) throw new Error('createContentReader: pass `schema` to read by collection key');
    schema ??= loadSchema(options.schema);
    return schema;
  };
  const source = (): ContentSource | null =>
    typeof options.source === 'function' ? options.source() : (options.source ?? null);

  async function file<T>(path: string): Promise<T | null> {
    const s = source();
    if (s) {
      try {
        const text = await s.readText(path);
        if (text != null) return JSON.parse(text) as T;
      } catch (err) {
        options.onError?.(path, err);
      }
    }
    const b = options.bundled?.[path];
    return b === undefined ? null : (b as T);
  }

  function collectionDef(key: string): CollectionDef {
    const c = getCollection(getSchema(), key);
    if (!c) throw new Error(`unknown collection "${key}"`);
    return c;
  }

  function entriesOf(c: CollectionDef, data: unknown): Entry[] {
    if (data == null) return [];
    try {
      return parseCollectionFile(c, JSON.stringify(data)).entries;
    } catch (err) {
      options.onError?.(c.file, err);
      return [];
    }
  }

  async function collection<T extends Entry>(key: string): Promise<T[]> {
    const c = collectionDef(key);
    return entriesOf(c, await file(c.file)) as T[];
  }

  async function entry<T extends Entry>(key: string, id?: string): Promise<T | null> {
    const c = collectionDef(key);
    const entries = entriesOf(c, await file(c.file));
    if (c.type === 'single' && id === undefined) return (entries[0] as T | undefined) ?? null;
    const found = entries.find((e) => {
      try {
        return entryId(c, e) === (id ?? '');
      } catch {
        return false;
      }
    });
    return (found as T | undefined) ?? null;
  }

  return { file, collection, entry };
}
