import { createContext, useContext } from 'react';

import type { AdminError, ProtocolClient } from './client.js';
import type { Translate, UiLanguage } from './i18n.js';
import type { CollectionInfo, Draft, Drafts, EntryData, FieldRef, FieldValue, SiteInfo } from './model.js';
import type { ResolvedField } from '@mosto-cms/core';

export type Store = {
  client: ProtocolClient;
  site: SiteInfo;
  collections: CollectionInfo[];
  entries: Record<string, EntryData>;
  entryLists: Record<string, Array<{ id: string; title: string }>>;
  drafts: Drafts;
  publishing: boolean;
  previewNonce: number;
  loadEntry(collection: string, id: string, force?: boolean): Promise<EntryData | null>;
  loadEntryList(collection: string, force?: boolean): Promise<Array<{ id: string; title: string }>>;
  valueOf(ref: FieldRef): FieldValue | null;
  draftOf(ref: FieldRef): Draft | undefined;
  /** `stored`: the entry as just read, when the cache may not have it yet. */
  edit(ref: FieldRef, def: ResolvedField, value: FieldValue, stored?: EntryData | null): void;
  revertDraft(ref: FieldRef): void;
  discard(): void;
  publish(): Promise<void>;
  upload(file: File, ref: FieldRef, def: ResolvedField, onStage?: (stage: 'compressing' | 'uploading') => void): Promise<string>;
  refresh(): Promise<void>;
  report(err: unknown): void;
  toast(message: string): void;
  bumpPreview(): void;
  /** Visual mode registers how to show an edit on the page. */
  previewSink: { current: ((ref: FieldRef, kind: ResolvedField['kind'], value: FieldValue) => void) | null };
};

export type Ui = {
  t: Translate;
  lang: UiLanguage;
  setLang(lang: UiLanguage): void;
  touch: boolean;
};

export const StoreContext = createContext<Store | null>(null);
export const UiContext = createContext<Ui | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('Mosto CMS admin: missing store');
  return s;
}

export function useUi(): Ui {
  const u = useContext(UiContext);
  if (!u) throw new Error('Mosto CMS admin: missing ui context');
  return u;
}

export type { AdminError };
