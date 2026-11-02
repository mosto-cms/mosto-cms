/**
 * The mosto-cms/1 schema: the "fence".
 *
 * The single source of truth for WHAT can be changed on a site. Every channel
 * (the admin, a platform connector, a script) goes through the same schema:
 * any field path not declared here is refused with `field_not_editable`.
 *
 * Stored as `mosto-cms.schema.json` at the root of the site repository (it can
 * be authored in TypeScript with `defineSchema()` and emitted as JSON).
 */
import { CmsError } from './errors.js';
import { isIndexSegment } from './paths.js';

export const SCHEMA_VERSION = 1 as const;

export const FIELD_KINDS = [
  'text',
  'multiline',
  'image',
  'video',
  'url',
  'list',
  'imageList',
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

/** Kinds whose value is a list of strings; every other kind holds one string. */
export const LIST_KINDS: ReadonlySet<FieldKind> = new Set(['list', 'imageList']);

/** A label: one string, or one string per locale (`{ "it": "Titolo", "en": "Title" }`). */
export type Label = string | Record<string, string>;

/** Hints for AI clients. Open data in the schema; how a client uses them is up to it. */
export type FieldAiHints = {
  /** Free-text guidance, e.g. "elegant tone, max 8 words". */
  instructions?: string;
  /** When true, clients acting as AI (`access.actor = "ai"`) cannot write this field. */
  locked?: boolean;
};

export type FieldDef = {
  /** Dot-path inside an entry, e.g. "it.hero.title", "specs.length", "gallery". */
  path: string;
  kind: FieldKind;
  label: Label;
  description?: Label;
  /** The value cannot be empty (an empty string or an empty list). */
  required?: boolean;
  /** Max characters for string kinds, max characters per item for list kinds. */
  maxLength?: number;
  /** Max number of items for list kinds. */
  maxItems?: number;
  /** MIME types accepted for uploads into this field (image/video/imageList). */
  accept?: string[];
  ai?: FieldAiHints;
};

export type CollectionType = 'single' | 'list';

export type CollectionDef = {
  /** Stable key used in field addresses (`<key>:<id>:<path>`). */
  key: string;
  /** JSON file holding the entries, relative to the repository root. */
  file: string;
  /** Property of an entry used as its stable id. */
  idField: string;
  /** `single` for one-off pages (home, settings), `list` for boats, tours, products. */
  type: CollectionType;
  label: Label;
  description?: Label;
  /** Path of the entry title shown in lists; `{locale}` is replaced by the requested locale. */
  titleField?: string;
  fields: FieldDef[];
};

export type MediaConfig = {
  /** Repository directory where uploads are committed, e.g. "public/uploads". */
  dir: string;
  /** Public URL prefix the site serves `dir` from, e.g. "/uploads". */
  publicPath: string;
  /** Max upload size in bytes (default 10 MB). */
  maxBytes?: number;
  /** Accepted MIME types (default: common web images and mp4/webm video). */
  accept?: string[];
};

export type MostoCmsSchema = {
  $schema?: string;
  version: typeof SCHEMA_VERSION;
  site?: { name?: string; url?: string };
  /** Locales of the site, e.g. ["it", "en"]. A field whose first path segment is a locale belongs to it. */
  locales: string[];
  defaultLocale?: string;
  media?: MediaConfig;
  collections: CollectionDef[];
};

/** A field resolved from an address: a declared field, or one item of a declared list field. */
export type ResolvedField = FieldDef & {
  /** Set when the path targets one item of a list/imageList field ("gallery.2"). */
  item?: { parent: string; index: number };
};

export const DEFAULT_MEDIA: Required<MediaConfig> = {
  dir: 'public/uploads',
  publicPath: '/uploads',
  maxBytes: 10 * 1024 * 1024,
  accept: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/svg+xml',
    'video/mp4',
    'video/webm',
  ],
};

/** Identity helper for authoring a schema in TypeScript with autocompletion. */
export function defineSchema<const T extends MostoCmsSchema>(schema: T): T {
  return schema;
}

export function mediaConfig(schema: MostoCmsSchema): Required<MediaConfig> {
  return { ...DEFAULT_MEDIA, ...(schema.media ?? {}) } as Required<MediaConfig>;
}

export function labelText(label: Label | undefined, locale?: string): string {
  if (label == null) return '';
  if (typeof label === 'string') return label;
  if (locale && label[locale]) return label[locale];
  return Object.values(label)[0] ?? '';
}

export function getCollection(
  schema: MostoCmsSchema,
  key: string,
): CollectionDef | undefined {
  return schema.collections.find((c) => c.key === key);
}

/**
 * Resolve a path against a collection's declared fields: an exact match, or
 * one item of a declared list/imageList field ("gallery.2" → an image field
 * that edits item 2 only). Anything else is outside the fence: undefined.
 */
export function resolveField(
  collection: CollectionDef,
  path: string,
): ResolvedField | undefined {
  const exact = collection.fields.find((f) => f.path === path);
  if (exact) return exact;

  const m = path.match(/^(.+)\.(\d+)$/);
  if (m && isIndexSegment(m[2] as string)) {
    const parent = collection.fields.find((f) => f.path === m[1]);
    if (parent && LIST_KINDS.has(parent.kind)) {
      const item: ResolvedField = {
        path,
        kind: parent.kind === 'imageList' ? 'image' : 'text',
        label: parent.label,
        item: { parent: parent.path, index: Number(m[2]) },
      };
      if (parent.maxLength != null) item.maxLength = parent.maxLength;
      if (parent.accept) item.accept = parent.accept;
      if (parent.ai) item.ai = parent.ai;
      if (parent.required) item.required = true;
      return item;
    }
  }
  return undefined;
}

/* ------------------------------ validation ------------------------------ */

const KEY_RE = /^[A-Za-z0-9_-]+$/;
const SEGMENT_FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export function isSafeRelativePath(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0 || p.length > 512) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function isLabel(v: unknown): v is Label {
  if (typeof v === 'string') return v.length > 0;
  return (
    isPlainObject(v) &&
    Object.keys(v).length > 0 &&
    Object.values(v).every((x) => typeof x === 'string')
  );
}

function isFieldPath(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.split('.').every((s) => s !== '' && !SEGMENT_FORBIDDEN.has(s))
  );
}

/**
 * Validate an unknown value as a mosto-cms/1 schema. Throws `invalid_schema`
 * listing every issue found; returns a deep copy on success.
 */
export function validateSchema(input: unknown): MostoCmsSchema {
  const issues: string[] = [];
  const at = (where: string, msg: string) => issues.push(`${where}: ${msg}`);

  if (!isPlainObject(input)) {
    throw new CmsError('invalid_schema', 'schema must be a JSON object', {
      issues: ['(root): not an object'],
    });
  }
  if (input.version !== SCHEMA_VERSION) {
    at('version', `must be ${SCHEMA_VERSION}`);
  }

  const locales = input.locales;
  if (
    !Array.isArray(locales) ||
    locales.length === 0 ||
    !locales.every((l) => typeof l === 'string' && l.length > 0)
  ) {
    at('locales', 'must be a non-empty array of locale codes');
  } else if (new Set(locales).size !== locales.length) {
    at('locales', 'must not contain duplicates');
  }
  if (input.defaultLocale !== undefined) {
    if (!Array.isArray(locales) || !locales.includes(input.defaultLocale)) {
      at('defaultLocale', 'must be one of locales');
    }
  }

  if (input.site !== undefined && !isPlainObject(input.site)) {
    at('site', 'must be an object');
  }

  if (input.media !== undefined) {
    const m = input.media;
    if (!isPlainObject(m)) at('media', 'must be an object');
    else {
      if (typeof m.dir !== 'string' || !isSafeRelativePath(m.dir)) {
        at('media.dir', 'must be a safe relative directory');
      }
      if (typeof m.publicPath !== 'string' || !m.publicPath.startsWith('/')) {
        at('media.publicPath', 'must start with "/"');
      }
      if (
        m.maxBytes !== undefined &&
        !(Number.isInteger(m.maxBytes) && (m.maxBytes as number) > 0)
      ) {
        at('media.maxBytes', 'must be a positive integer');
      }
      if (
        m.accept !== undefined &&
        !(Array.isArray(m.accept) && m.accept.every((x) => typeof x === 'string'))
      ) {
        at('media.accept', 'must be an array of MIME types');
      }
    }
  }

  const cols = input.collections;
  if (!Array.isArray(cols)) {
    at('collections', 'must be an array');
  } else {
    const keys = new Set<string>();
    cols.forEach((c, ci) => {
      const w = `collections[${ci}]`;
      if (!isPlainObject(c)) return at(w, 'must be an object');
      if (typeof c.key !== 'string' || !KEY_RE.test(c.key)) {
        at(`${w}.key`, 'must match [A-Za-z0-9_-]+');
      } else if (keys.has(c.key)) {
        at(`${w}.key`, `duplicate key "${c.key}"`);
      } else keys.add(c.key);
      if (
        typeof c.file !== 'string' ||
        !isSafeRelativePath(c.file) ||
        !c.file.endsWith('.json')
      ) {
        at(`${w}.file`, 'must be a safe relative path to a .json file');
      }
      if (typeof c.idField !== 'string' || !isFieldPath(c.idField)) {
        at(`${w}.idField`, 'must be a property name');
      }
      if (c.type !== 'single' && c.type !== 'list') {
        at(`${w}.type`, 'must be "single" or "list"');
      }
      if (!isLabel(c.label)) at(`${w}.label`, 'must be a string or a locale map');
      if (c.description !== undefined && !isLabel(c.description)) {
        at(`${w}.description`, 'must be a string or a locale map');
      }
      if (c.titleField !== undefined && typeof c.titleField !== 'string') {
        at(`${w}.titleField`, 'must be a string');
      }
      if (!Array.isArray(c.fields)) return at(`${w}.fields`, 'must be an array');
      const paths = new Set<string>();
      c.fields.forEach((f, fi) => {
        const fw = `${w}.fields[${fi}]`;
        if (!isPlainObject(f)) return at(fw, 'must be an object');
        if (!isFieldPath(f.path)) at(`${fw}.path`, 'must be a dot-path');
        else if (paths.has(f.path)) at(`${fw}.path`, `duplicate path "${f.path}"`);
        else paths.add(f.path);
        if (!FIELD_KINDS.includes(f.kind as FieldKind)) {
          at(`${fw}.kind`, `must be one of ${FIELD_KINDS.join(', ')}`);
        }
        if (!isLabel(f.label)) at(`${fw}.label`, 'must be a string or a locale map');
        if (f.description !== undefined && !isLabel(f.description)) {
          at(`${fw}.description`, 'must be a string or a locale map');
        }
        if (f.required !== undefined && typeof f.required !== 'boolean') {
          at(`${fw}.required`, 'must be a boolean');
        }
        for (const k of ['maxLength', 'maxItems'] as const) {
          if (
            f[k] !== undefined &&
            !(Number.isInteger(f[k]) && (f[k] as number) > 0)
          ) {
            at(`${fw}.${k}`, 'must be a positive integer');
          }
        }
        if (
          f.accept !== undefined &&
          !(Array.isArray(f.accept) && f.accept.every((x) => typeof x === 'string'))
        ) {
          at(`${fw}.accept`, 'must be an array of MIME types');
        }
        if (f.ai !== undefined) {
          if (!isPlainObject(f.ai)) at(`${fw}.ai`, 'must be an object');
          else {
            if (f.ai.instructions !== undefined && typeof f.ai.instructions !== 'string') {
              at(`${fw}.ai.instructions`, 'must be a string');
            }
            if (f.ai.locked !== undefined && typeof f.ai.locked !== 'boolean') {
              at(`${fw}.ai.locked`, 'must be a boolean');
            }
          }
        }
      });
    });
  }

  if (issues.length > 0) {
    throw new CmsError(
      'invalid_schema',
      `invalid mosto-cms schema (${issues.length} issue${issues.length > 1 ? 's' : ''})`,
      { issues },
    );
  }
  return structuredClone(input) as MostoCmsSchema;
}
