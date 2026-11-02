/**
 * Pre-v1 schema files (`mosto-edit.schema.json`): `{ collections: [...] }` with
 * no version, no locales and no collection type. `fromLegacySchema` converts
 * one to the v1 format without losing anything; `toLegacySchema` goes back,
 * so a site can keep both while it migrates.
 */
import { CmsError } from './errors.js';
import {
  SCHEMA_VERSION,
  validateSchema,
  type CollectionType,
  type FieldKind,
  type Label,
  type MediaConfig,
  type MostoCmsSchema,
} from './schema.js';

export type LegacyFieldKind = 'text' | 'multiline' | 'image' | 'video' | 'list' | 'imageList';

export type LegacySchema = {
  collections: Array<{
    key: string;
    file: string;
    idField: string;
    label: Label;
    fields: Array<{ path: string; kind: LegacyFieldKind; label: Label }>;
  }>;
};

export type FromLegacyOptions = {
  /** Site locales. Default: the locale keys found in the labels, in order of appearance. */
  locales?: string[];
  defaultLocale?: string;
  /** Collection types by key. Default: `list` (always lossless, the file stays an array). */
  collectionTypes?: Record<string, CollectionType>;
  media?: MediaConfig;
  site?: MostoCmsSchema['site'];
};

export function isLegacySchema(input: unknown): input is LegacySchema {
  return (
    input != null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    !('version' in input) &&
    Array.isArray((input as { collections?: unknown }).collections)
  );
}

function labelLocales(label: Label, into: string[]): void {
  if (typeof label === 'string') return;
  for (const k of Object.keys(label)) if (!into.includes(k)) into.push(k);
}

export function fromLegacySchema(
  legacy: LegacySchema,
  opts: FromLegacyOptions = {},
): MostoCmsSchema {
  if (!isLegacySchema(legacy)) {
    throw new CmsError('invalid_schema', 'not a legacy schema ({ collections: [...] } without version)');
  }
  const found: string[] = [];
  for (const c of legacy.collections) {
    labelLocales(c.label, found);
    for (const f of c.fields) labelLocales(f.label, found);
  }
  const locales = opts.locales ?? (found.length > 0 ? found : ['en']);

  const schema: MostoCmsSchema = {
    version: SCHEMA_VERSION,
    locales,
    collections: legacy.collections.map((c) => ({
      key: c.key,
      file: c.file,
      idField: c.idField,
      type: opts.collectionTypes?.[c.key] ?? 'list',
      label: c.label,
      fields: c.fields.map((f) => ({
        path: f.path,
        kind: f.kind as FieldKind,
        label: f.label,
      })),
    })),
  };
  if (opts.defaultLocale) schema.defaultLocale = opts.defaultLocale;
  if (opts.media) schema.media = opts.media;
  if (opts.site) schema.site = opts.site;
  return validateSchema(schema);
}

/** Back to the legacy shape. Lossless for schemas converted from it; v1-only data is dropped. */
export function toLegacySchema(schema: MostoCmsSchema): LegacySchema {
  return {
    collections: schema.collections.map((c) => ({
      key: c.key,
      file: c.file,
      idField: c.idField,
      label: c.label,
      fields: c.fields.map((f) => {
        if (f.kind === 'url') {
          throw new CmsError('unsupported', `field "${f.path}": kind "url" has no legacy equivalent`);
        }
        return { path: f.path, kind: f.kind, label: f.label };
      }),
    })),
  };
}

/** Load either format: v1 is validated as-is, legacy is converted first. */
export function loadSchema(input: unknown, opts: FromLegacyOptions = {}): MostoCmsSchema {
  return isLegacySchema(input) ? fromLegacySchema(input, opts) : validateSchema(input);
}
