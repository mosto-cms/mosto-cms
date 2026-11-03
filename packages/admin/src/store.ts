/**
 * The workspace store: what the site declares, the entries read so far, and
 * the editor's drafts. Drafts live in memory until Publish, which sends them
 * all in one `publish` call (one commit).
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import type { ResolvedField } from '@mosto-cms/core';

import { AdminError, type ProtocolClient } from './client.js';
import { prepareUpload, readAsBase64 } from './compress.js';
import type { Store } from './context.js';
import type { Translate, UiLanguage } from './i18n.js';
import {
  addressOf,
  buildChanges,
  entryKey,
  formatBytes,
  publishMessage,
  showsPublished,
  storedValue,
  withDraft,
  withPublished,
  type CollectionInfo,
  type Drafts,
  type EntryData,
  type FieldRef,
  type FieldValue,
  type SiteInfo,
} from './model.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Pause before asking again after a publish without a definite answer. */
const PUBLISH_RETRY_DELAY = 800;
/** Waits before each background re-read of a published entry. */
const SETTLE_DELAYS = [300, 1200, 3000];

class UploadCheck extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadCheck';
  }
}

const TYPE_NAMES: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'image/avif': 'AVIF',
  'image/svg+xml': 'SVG',
  'video/mp4': 'MP4',
  'video/webm': 'WebM',
};

export function useWorkspaceStore(opts: {
  client: ProtocolClient;
  site: SiteInfo;
  collections: CollectionInfo[];
  t: Translate;
  lang: UiLanguage;
  onError(err: unknown): void;
  toast(text: string): void;
}): Store {
  const { client, site, collections, t, lang, onError, toast } = opts;
  const [entries, setEntries] = useState<Record<string, EntryData>>({});
  const [entryLists, setEntryLists] = useState<Record<string, Array<{ id: string; title: string }>>>({});
  const [drafts, setDrafts] = useState<Drafts>({});
  const [publishing, setPublishing] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const previewSink = useRef<Store['previewSink']['current']>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const inflight = useRef(new Map<string, Promise<EntryData | null>>());

  const loadEntry = useCallback(
    async (collection: string, id: string, force = false): Promise<EntryData | null> => {
      const key = entryKey(collection, id);
      if (!force && entriesRef.current[key]) return entriesRef.current[key] ?? null;
      const pending = inflight.current.get(key);
      if (pending && !force) return pending;
      const p = client
        .call<{ revision: string; fields: Record<string, FieldValue | null> }>('getField', { collection, id })
        .then((r) => {
          const data = { revision: r.revision, fields: r.fields };
          setEntries((e) => ({ ...e, [key]: data }));
          return data;
        })
        .catch((err: unknown) => {
          onError(err);
          return null;
        })
        .finally(() => inflight.current.delete(key));
      inflight.current.set(key, p);
      return p;
    },
    [client, onError],
  );

  const loadEntryList = useCallback(
    async (collection: string, force = false) => {
      const cached = entryLists[collection];
      if (cached && !force) return cached;
      try {
        const list = await client.call<Array<{ id: string; title: string }>>('listEntries', { collection, locale: lang });
        setEntryLists((l) => ({ ...l, [collection]: list }));
        return list;
      } catch (err) {
        onError(err);
        return [];
      }
    },
    [client, entryLists, lang, onError],
  );

  const draftOf = useCallback((ref: FieldRef) => drafts[addressOf(ref)], [drafts]);

  const valueOf = useCallback(
    (ref: FieldRef): FieldValue | null => {
      const d = drafts[addressOf(ref)];
      if (d) return d.value;
      // An item inside a drafted list shows the list's draft.
      const m = /^(.+)\.(\d+)$/.exec(ref.path);
      if (m) {
        const parent = drafts[addressOf({ ...ref, path: m[1] as string })];
        if (parent && Array.isArray(parent.value)) return parent.value[Number(m[2])] ?? null;
      }
      return storedValue(entries[entryKey(ref.collection, ref.id)], ref.path);
    },
    [drafts, entries],
  );

  const edit = useCallback((ref: FieldRef, def: ResolvedField, value: FieldValue, stored?: EntryData | null) => {
    const before = storedValue(stored ?? entriesRef.current[entryKey(ref.collection, ref.id)], ref.path);
    setDrafts((d) => withDraft(d, { ...ref, kind: def.kind, value, before }));
    previewSink.current?.(ref, def.kind, value);
  }, []);

  const revertDraft = useCallback((ref: FieldRef) => {
    const d = draftsRef.current[addressOf(ref)];
    setDrafts((all) => {
      const next = { ...all };
      delete next[addressOf(ref)];
      return next;
    });
    if (d) previewSink.current?.(ref, d.kind, d.before ?? (Array.isArray(d.value) ? [] : ''));
  }, []);

  const discard = useCallback(() => {
    setDrafts({});
    setPreviewNonce((n) => n + 1);
  }, []);

  const refresh = useCallback(async () => {
    setDrafts({});
    setEntries({});
    setEntryLists({});
    setPreviewNonce((n) => n + 1);
  }, []);

  /**
   * After a publish: read the published entries again in the background and
   * keep the fresh copy once it shows the new values. Failures stay silent:
   * the cache already holds the published values, so there is nothing to
   * warn about (the storage may lag or hiccup right after a commit).
   */
  const settlePublished = useCallback(
    async (published: Drafts) => {
      const keys = new Map<string, { collection: string; id: string }>();
      for (const d of Object.values(published)) keys.set(entryKey(d.collection, d.id), { collection: d.collection, id: d.id });
      const lists = new Set([...keys.values()].map((k) => k.collection).filter((c) => collections.find((x) => x.key === c)?.type === 'list'));
      await Promise.all(
        [...keys].map(async ([key, { collection, id }]) => {
          for (const wait of SETTLE_DELAYS) {
            await sleep(wait);
            try {
              const r = await client.call<{ revision: string; fields: Record<string, FieldValue | null> }>('getField', { collection, id });
              const fresh = { revision: r.revision, fields: r.fields };
              if (!showsPublished(fresh, collection, id, published)) continue;
              // Keep drafts made meanwhile on top: only the stored copy is replaced.
              setEntries((e) => (e[key] ? { ...e, [key]: fresh } : e));
              return;
            } catch {
              // try again after the next delay
            }
          }
        }),
      );
      for (const collection of lists) {
        try {
          const list = await client.call<Array<{ id: string; title: string }>>('listEntries', { collection, locale: lang });
          setEntryLists((l) => ({ ...l, [collection]: list }));
        } catch {
          // titles refresh at the next load
        }
      }
    },
    [client, collections, lang],
  );

  const publish = useCallback(async () => {
    const current = draftsRef.current;
    if (Object.keys(current).length === 0 || publishing) return;
    setPublishing(true);
    try {
      const message = publishMessage(current, collections, lang, site.locales, t('publish.fallbackMessage'));
      const input = { message, changes: buildChanges(current) };
      type Published = { published: boolean; alreadyPublished?: boolean };
      let r: Published;
      try {
        r = await client.call<Published>('publish', input);
      } catch (err) {
        // No definite answer (network, timeout, a 5xx) does not mean nothing
        // was published: the commit may have landed. Publishing is idempotent
        // (a field already holding its new value is not written again), so
        // asking once more either publishes now or reports it already did.
        if (!(err instanceof AdminError) || (err.code !== 'internal' && err.code !== 'network')) throw err;
        await sleep(PUBLISH_RETRY_DELAY);
        r = await client.call<Published>('publish', input);
      }
      // Drafts edited while publishing stay; the published ones go.
      setDrafts((d) => {
        const next = { ...d };
        for (const [k, v] of Object.entries(current)) if (next[k] === v) delete next[k];
        return next;
      });
      setEntries((e) => withPublished(e, current));
      toast(r.published || r.alreadyPublished ? t('publish.done') : t('publish.nothing'));
      setTimeout(() => setPreviewNonce((n) => n + 1), 400);
      void settlePublished(current);
    } catch (err) {
      onError(err);
    } finally {
      setPublishing(false);
    }
  }, [client, collections, lang, onError, publishing, settlePublished, site.locales, t, toast]);

  const upload = useCallback(
    async (file: File, ref: FieldRef, def: ResolvedField, onStage?: (s: 'compressing' | 'uploading') => void): Promise<string> => {
      const accept = def.accept ?? site.media.accept;
      const allowed = accept.filter((m) => (def.kind === 'video' ? m.startsWith('video/') : m.startsWith('image/')));
      if (!accept.includes(file.type)) {
        throw new UploadCheck(t('media.unsupported', { types: allowed.map((m) => TYPE_NAMES[m] ?? m).join(', ') }));
      }
      onStage?.('compressing');
      const ready = file.type.startsWith('image/') ? await prepareUpload(file, accept) : file;
      if (ready.size > site.media.maxBytes) {
        throw new UploadCheck(t('media.tooLarge', { size: formatBytes(ready.size), max: formatBytes(site.media.maxBytes) }));
      }
      onStage?.('uploading');
      try {
        const r = await client.call<{ path: string }>('uploadAsset', {
          filename: ready.name,
          contentType: ready.type,
          dataBase64: await readAsBase64(ready),
          field: { collection: ref.collection, path: ref.path },
        });
        return r.path;
      } catch (err) {
        if (err instanceof AdminError && err.code === 'too_large') {
          throw new UploadCheck(t('media.tooLarge', { size: formatBytes(ready.size), max: formatBytes(site.media.maxBytes) }));
        }
        if (err instanceof AdminError && err.code === 'unauthorized') onError(err);
        throw err;
      }
    },
    [client, onError, site.media.accept, site.media.maxBytes, t],
  );

  return useMemo<Store>(
    () => ({
      client,
      site,
      collections,
      entries,
      entryLists,
      drafts,
      publishing,
      previewNonce,
      loadEntry,
      loadEntryList,
      valueOf,
      draftOf,
      edit,
      revertDraft,
      discard,
      publish,
      upload,
      refresh,
      report: onError,
      toast,
      bumpPreview: () => setPreviewNonce((n) => n + 1),
      previewSink,
    }),
    [client, site, collections, entries, entryLists, drafts, publishing, previewNonce, loadEntry, loadEntryList, valueOf, draftOf, edit, revertDraft, discard, publish, upload, refresh, onError, toast],
  );
}
