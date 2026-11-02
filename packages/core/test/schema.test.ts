import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  CmsError,
  fromLegacySchema,
  isLegacySchema,
  loadSchema,
  resolveField,
  toLegacySchema,
  validateSchema,
  type LegacySchema,
} from '../src/index.js';
import { legacySchema } from './fixtures/site.js';
import { expectCode, siteSchema } from './helpers.js';

const jsonSchema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema.json', import.meta.url)), 'utf8'),
);
const ajv = new Ajv2020.default({ allErrors: true });
const validateJson = ajv.compile(jsonSchema);

describe('schema v1', () => {
  it('validates a converted schema, also against the published JSON Schema', () => {
    const s = siteSchema();
    expect(s.version).toBe(1);
    expect(s.locales).toEqual(['it', 'en']);
    expect(validateJson(s)).toBe(true);
  });

  it('reports every issue at once', () => {
    let err: CmsError | undefined;
    try {
      validateSchema({
        version: 2,
        locales: [],
        defaultLocale: 'fr',
        collections: [
          { key: 'a:b', file: '../secrets.json', idField: 'id', type: 'many', label: 'A', fields: [] },
          {
            key: 'x',
            file: 'x.json',
            idField: 'id',
            type: 'list',
            label: 'X',
            fields: [
              { path: 'a', kind: 'text', label: 'A' },
              { path: 'a', kind: 'text', label: 'A again' },
              { path: 'b', kind: 'html', label: 'B' },
              { path: '__proto__.x', kind: 'text', label: 'P' },
            ],
          },
        ],
      });
    } catch (e) {
      err = e as CmsError;
    }
    expect(err?.code).toBe('invalid_schema');
    const issues = (err?.details?.issues ?? []) as string[];
    expect(issues.join('\n')).toMatch(/version/);
    expect(issues.join('\n')).toMatch(/locales/);
    expect(issues.join('\n')).toMatch(/defaultLocale/);
    expect(issues.join('\n')).toMatch(/collections\[0\]\.key/);
    expect(issues.join('\n')).toMatch(/collections\[0\]\.file/);
    expect(issues.join('\n')).toMatch(/collections\[0\]\.type/);
    expect(issues.join('\n')).toMatch(/duplicate path "a"/);
    expect(issues.join('\n')).toMatch(/fields\[2\]\.kind/);
    expect(issues.join('\n')).toMatch(/fields\[3\]\.path/);
  });

  it('resolves list items as synthetic fields', () => {
    const fleet = siteSchema().collections.find((c) => c.key === 'fleet')!;
    expect(resolveField(fleet, 'gallery.2')).toMatchObject({
      kind: 'image',
      item: { parent: 'gallery', index: 2 },
    });
    expect(resolveField(fleet, 'it.highlights.0')).toMatchObject({ kind: 'text' });
    expect(resolveField(fleet, 'cover.0')).toBeUndefined();
    expect(resolveField(fleet, 'specs.length')).toBeUndefined();
  });
});

describe('legacy (mosto-edit.schema.json) conversion', () => {
  it('detects the legacy format', () => {
    expect(isLegacySchema(legacySchema)).toBe(true);
    expect(isLegacySchema(siteSchema())).toBe(false);
  });

  it('round-trips without loss', () => {
    const v1 = fromLegacySchema(structuredClone(legacySchema));
    expect(toLegacySchema(v1)).toEqual(legacySchema);
  });

  it('loadSchema accepts both formats', () => {
    expect(loadSchema(legacySchema).collections).toHaveLength(3);
    expect(loadSchema(siteSchema()).collections).toHaveLength(3);
    expect(() => loadSchema({ nope: true })).toThrow(CmsError);
  });
});

/**
 * The real schema of the first production site. It is read from a local
 * checkout when available (MOSTO_CMS_CAPRI_SCHEMA=/path/to/mosto-edit.schema.json)
 * and is not committed here; CI runs the synthetic fixture above instead.
 */
const capriPath = process.env.MOSTO_CMS_CAPRI_SCHEMA;
describe.skipIf(!capriPath || !existsSync(capriPath))('real site schema (local only)', () => {
  it('loads, converts to v1 and round-trips without loss', async () => {
    const legacy = JSON.parse(readFileSync(capriPath as string, 'utf8')) as LegacySchema;
    expect(isLegacySchema(legacy)).toBe(true);
    const v1 = fromLegacySchema(structuredClone(legacy), { collectionTypes: { content: 'single' } });
    expect(validateJson(v1)).toBe(true);
    expect(v1.collections.map((c) => c.key)).toEqual(legacy.collections.map((c) => c.key));
    legacy.collections.forEach((lc, i) => {
      const c = v1.collections[i]!;
      expect([c.file, c.idField, c.label]).toEqual([lc.file, lc.idField, lc.label]);
      expect(c.fields).toEqual(lc.fields);
    });
    expect(toLegacySchema(v1)).toEqual(legacy);
    const total = v1.collections.reduce((n, c) => n + c.fields.length, 0);
    console.info(
      `real schema: ${v1.collections.length} collections, ${total} fields, locales ${v1.locales.join(',')}`,
    );
    await expectCode(() => validateSchema({ ...v1, version: 0 }), 'invalid_schema');
  });
});
