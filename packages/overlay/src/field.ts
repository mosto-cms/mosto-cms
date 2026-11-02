/**
 * Writing annotations: `mostoField()` returns the data attributes that make
 * an element editable, so nobody hand-writes `collection:id:path` strings.
 *
 *   <h1 {...mostoField('home:home', 'en.hero.title')}>…</h1>
 *   <img {...mostoField({ collection: 'fleet', id: 'libeccio' }, 'gallery', 2)} … />
 */

/** Kinds of the `mosto-cms/1` schema, plus the item kinds of list fields. */
export type FieldKind = 'text' | 'multiline' | 'image' | 'video' | 'url' | 'list' | 'imageList';

export type FieldRef = { collection: string; id: string; path: string };
export type SelectedField = FieldRef & { kind: FieldKind };

/** An entry: `{ collection, id }` or the string `"collection:id"`. */
export type EntryRef = { collection: string; id: string } | string;

export type MostoFieldAttributes = {
  'data-mosto-field': string;
  'data-mosto-kind'?: FieldKind;
};

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const KINDS = new Set<string>(['text', 'multiline', 'image', 'video', 'url', 'list', 'imageList']);

export function isFieldKind(v: unknown): v is FieldKind {
  return typeof v === 'string' && KINDS.has(v);
}

function checkPath(path: string): void {
  if (typeof path !== 'string' || path === '' || path.split('.').some((s) => s === '' || FORBIDDEN_SEGMENTS.has(s))) {
    throw new TypeError(`mostoField: invalid path "${String(path)}"`);
  }
}

function toEntry(entry: EntryRef): { collection: string; id: string } {
  if (typeof entry === 'string') {
    const i = entry.indexOf(':');
    if (i <= 0 || i === entry.length - 1 || entry.indexOf(':', i + 1) >= 0) {
      throw new TypeError(`mostoField: invalid entry "${entry}" (expected "collection:id")`);
    }
    return { collection: entry.slice(0, i), id: entry.slice(i + 1) };
  }
  if (!entry || typeof entry.collection !== 'string' || typeof entry.id !== 'string' || !entry.collection || !entry.id) {
    throw new TypeError('mostoField: entry needs a collection and an id');
  }
  if (entry.collection.includes(':') || entry.id.includes(':')) {
    throw new TypeError('mostoField: collection and id must not contain ":"');
  }
  return entry;
}

/** `"collection:id:path"` */
export function fieldAddress(ref: FieldRef): string {
  const e = toEntry({ collection: ref.collection, id: ref.id });
  checkPath(ref.path);
  return `${e.collection}:${e.id}:${ref.path}`;
}

/** Parse `"collection:id:path"`; null when malformed. */
export function parseFieldAddress(address: string | null | undefined): FieldRef | null {
  if (typeof address !== 'string') return null;
  const first = address.indexOf(':');
  const second = first < 0 ? -1 : address.indexOf(':', first + 1);
  if (first <= 0 || second <= first + 1 || second === address.length - 1) return null;
  const path = address.slice(second + 1);
  if (path.split('.').some((s) => s === '' || FORBIDDEN_SEGMENTS.has(s))) return null;
  return { collection: address.slice(0, first), id: address.slice(first + 1, second), path };
}

/**
 * The attributes that make an element editable.
 *
 * @param entry  `{ collection, id }` or `"collection:id"`
 * @param path   the field path, e.g. `"en.hero.title"` or `"gallery"`
 * @param index  for one item of a list field (`gallery.2`)
 * @param options.kind  what the element shows; inferred for `<img>`/`<video>`, else text
 */
export function mostoField(
  entry: EntryRef,
  path: string,
  index?: number | null,
  options: { kind?: FieldKind } = {},
): MostoFieldAttributes {
  const e = toEntry(entry);
  checkPath(path);
  let full = path;
  if (index !== undefined && index !== null) {
    if (!Number.isInteger(index) || index < 0) throw new TypeError(`mostoField: invalid index ${String(index)}`);
    full = `${path}.${index}`;
  }
  const attrs: MostoFieldAttributes = { 'data-mosto-field': `${e.collection}:${e.id}:${full}` };
  if (options.kind) {
    if (!isFieldKind(options.kind)) throw new TypeError(`mostoField: unknown kind "${String(options.kind)}"`);
    attrs['data-mosto-kind'] = options.kind;
  }
  return attrs;
}
