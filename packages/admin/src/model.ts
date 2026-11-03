/**
 * The admin's pure logic: drafts, locale grouping, labels, change sets.
 * No React and no DOM here, so it is unit tested directly.
 */
import { labelText, resolveField, validateValue, CmsError, type FieldDef, type Label, type ResolvedField } from '@mosto-cms/core';

export type FieldValue = string | string[];

export type CollectionInfo = {
  key: string;
  type: 'single' | 'list';
  label: Label;
  idField: string;
  /** Content file, to name what a history entry touched. */
  file?: string;
  fields: FieldDef[];
};

export type SiteInfo = {
  site: { name?: string; url?: string } | null;
  locales: string[];
  defaultLocale: string;
  capabilities: { history: boolean; revert: boolean; uploadAsset: boolean };
  media: { publicPath: string; maxBytes: number; accept: string[] };
  access: { write: boolean; collections: string[] | 'all'; actor: 'human' | 'ai' };
};

export type EntryData = { revision: string; fields: Record<string, FieldValue | null> };

export type FieldRef = { collection: string; id: string; path: string };

export type Draft = FieldRef & { kind: ResolvedField['kind']; value: FieldValue; before: FieldValue | null };

export type Change = FieldRef & { value: FieldValue; before?: FieldValue };

export const addressOf = (r: FieldRef): string => `${r.collection}:${r.id}:${r.path}`;
export const entryKey = (collection: string, id: string): string => `${collection}:${id}`;

export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The schema definition behind a path, including list items (`gallery.2`). */
export function fieldDef(collections: CollectionInfo[], ref: { collection: string; path: string }): ResolvedField | undefined {
  const c = collections.find((x) => x.key === ref.collection);
  if (!c) return undefined;
  return resolveField({ key: c.key, file: 'x.json', idField: c.idField, type: c.type, label: c.label, fields: c.fields }, ref.path);
}

/** The value of a path inside an entry's declared fields, list items included. */
export function storedValue(entry: EntryData | undefined, path: string): FieldValue | null {
  if (!entry) return null;
  if (path in entry.fields) return entry.fields[path] ?? null;
  const m = /^(.+)\.(\d+)$/.exec(path);
  if (m) {
    const list = entry.fields[m[1] as string];
    if (Array.isArray(list)) return list[Number(m[2])] ?? null;
  }
  return null;
}

/** Split `it.hero.title` into `{ locale: 'it', rest: 'hero.title' }` when the first segment is a locale. */
export function splitLocale(path: string, locales: string[]): { locale: string | null; rest: string } {
  const dot = path.indexOf('.');
  const first = dot < 0 ? path : path.slice(0, dot);
  if (dot > 0 && locales.includes(first)) return { locale: first, rest: path.slice(dot + 1) };
  return { locale: null, rest: path };
}

/** The same field in the other locales, when the schema declares it (`it.hero.title` → `en.hero.title`). */
export function siblingPaths(collection: CollectionInfo, path: string, locales: string[]): Array<{ locale: string; path: string }> {
  const { locale, rest } = splitLocale(path, locales);
  if (!locale) return [];
  const out: Array<{ locale: string; path: string }> = [];
  for (const l of locales) {
    const p = `${l}.${rest}`;
    if (collection.fields.some((f) => f.path === p) || resolveField({ ...collection, file: 'x.json' }, p)) out.push({ locale: l, path: p });
  }
  return out;
}

export type FormRow =
  | { type: 'shared'; key: string; field: FieldDef }
  | { type: 'localized'; key: string; fields: Record<string, FieldDef>; first: FieldDef };

/**
 * Rows of the forms mode: one row per shared field, and one row per localized
 * field holding every locale side by side, in the schema's order.
 */
export function formRows(collection: CollectionInfo, locales: string[]): FormRow[] {
  const rows: FormRow[] = [];
  const byRest = new Map<string, Extract<FormRow, { type: 'localized' }>>();
  for (const f of collection.fields) {
    const { locale, rest } = splitLocale(f.path, locales);
    if (!locale) {
      rows.push({ type: 'shared', key: f.path, field: f });
      continue;
    }
    let row = byRest.get(rest);
    if (!row) {
      row = { type: 'localized', key: `*.${rest}`, fields: {}, first: f };
      byRest.set(rest, row);
      rows.push(row);
    }
    row.fields[locale] = f;
  }
  return rows;
}

/** A label in the editor's language, falling back to the site's languages. */
export function labelFor(label: Label | undefined, uiLang: string, siteLocales: string[] = []): string {
  if (!label) return '';
  if (typeof label === 'string') return label;
  for (const l of [uiLang, ...siteLocales]) if (label[l]) return label[l] as string;
  return labelText(label);
}

/** Readable name of a path when the schema has no label: `en.hero.title` → `Hero title`, `gallery.2` → `gallery #3`. */
export function prettyPath(path: string, locales: string[] = []): string {
  const { rest } = splitLocale(path, locales);
  const item = /^(.+)\.(\d+)$/.exec(rest);
  const base = item ? (item[1] as string) : rest;
  const words = base
    .split('.')
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  const text = words.charAt(0).toUpperCase() + words.slice(1);
  return item ? `${text} #${Number(item[2]) + 1}` : text;
}

/** Client-side check before publishing; returns the problem or null. Mirrors the server, which decides. */
export function checkValue(field: ResolvedField, value: FieldValue): { code: 'required' | 'tooLong' | 'tooMany' | 'singleLine' | 'scheme' | 'invalid'; limit?: number } | null {
  try {
    validateValue(field, value);
    return null;
  } catch (err) {
    if (!(err instanceof CmsError)) return { code: 'invalid' };
    const m = err.message;
    if (m.includes('is required')) return { code: 'required' };
    if (err.details?.maxLength != null) return { code: 'tooLong', limit: err.details.maxLength as number };
    if (err.details?.maxItems != null) return { code: 'tooMany', limit: err.details.maxItems as number };
    if (m.includes('single line')) return { code: 'singleLine' };
    if (m.includes('scheme')) return { code: 'scheme' };
    return { code: 'invalid' };
  }
}

export type Drafts = Record<string, Draft>;

/** Add or update a draft; editing a field back to its stored value drops it. */
export function withDraft(drafts: Drafts, draft: Draft): Drafts {
  const key = addressOf(draft);
  const next = { ...drafts };
  if (jsonEqual(draft.value, draft.before)) delete next[key];
  else next[key] = draft;
  return next;
}

/**
 * The changes to publish. A draft of one list item (`gallery.2`) next to a
 * draft of its whole list (`gallery`) is folded into the list, since the same
 * call cannot write both. `before` carries what the editor saw, so the server
 * refuses with `conflict` if someone changed it meanwhile.
 */
export function buildChanges(drafts: Drafts): Change[] {
  const list = Object.values(drafts);
  const whole = new Map(list.filter((d) => Array.isArray(d.value)).map((d) => [addressOf(d), d]));
  const merged = new Map<string, Change>();
  for (const d of list) {
    const m = /^(.+)\.(\d+)$/.exec(d.path);
    const parent = m ? whole.get(addressOf({ ...d, path: m[1] as string })) : undefined;
    if (parent && typeof d.value === 'string') {
      const key = addressOf(parent);
      const current = merged.get(key) ?? { collection: parent.collection, id: parent.id, path: parent.path, value: [...(parent.value as string[])], ...(parent.before !== null ? { before: parent.before } : {}) };
      const arr = current.value as string[];
      const i = Number(m![2]);
      if (i < arr.length) arr[i] = d.value;
      merged.set(key, current);
      continue;
    }
    const key = addressOf(d);
    if (!merged.has(key)) merged.set(key, { collection: d.collection, id: d.id, path: d.path, value: d.value, ...(d.before !== null ? { before: d.before } : {}) });
  }
  return [...merged.values()];
}

/**
 * The entries as they are after `published` went live: each published value
 * written into the cached entry, so the editor sees the result at once without
 * reading the site again (that read may fail or lag right after a commit).
 * Entries not loaded yet are left out; they are read on demand.
 */
export function withPublished(entries: Record<string, EntryData>, published: Drafts): Record<string, EntryData> {
  const next = { ...entries };
  for (const d of Object.values(published)) {
    const key = entryKey(d.collection, d.id);
    const e = next[key];
    if (!e) continue;
    const fields = { ...e.fields };
    const m = /^(.+)\.(\d+)$/.exec(d.path);
    const parent = m ? fields[m[1] as string] : undefined;
    if (!(d.path in fields) && m && Array.isArray(parent) && typeof d.value === 'string') {
      const list = [...parent];
      list[Number(m[2])] = d.value;
      fields[m[1] as string] = list;
    } else {
      fields[d.path] = d.value;
    }
    next[key] = { ...e, fields };
  }
  return next;
}

/** True when `entry` (read from the site) already shows every published value of its entry. */
export function showsPublished(entry: EntryData, collection: string, id: string, published: Drafts): boolean {
  return Object.values(published)
    .filter((d) => d.collection === collection && d.id === id)
    .every((d) => jsonEqual(storedValue(entry, d.path), d.value));
}

/** A short commit message for non-technical readers: "Headline, Hero image (Home page)". */
export function publishMessage(drafts: Drafts, collections: CollectionInfo[], uiLang: string, locales: string[], fallback: string): string {
  const parts: string[] = [];
  for (const d of Object.values(drafts)) {
    const def = fieldDef(collections, d);
    const name = def ? labelFor(def.label, uiLang, locales) : prettyPath(d.path, locales);
    const loc = splitLocale(d.path, locales).locale;
    const label = loc && locales.length > 1 ? `${name} (${loc.toUpperCase()})` : name;
    if (!parts.includes(label)) parts.push(label);
  }
  if (parts.length === 0) return fallback;
  const head = parts.slice(0, 3).join(', ');
  return parts.length > 3 ? `${head} +${parts.length - 3}` : head;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Kinds that hold a file the editor can upload. */
export const isMediaKind = (kind: string): boolean => kind === 'image' || kind === 'video' || kind === 'imageList';
