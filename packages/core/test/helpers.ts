import {
  CmsError,
  createCms,
  createMemoryAdapter,
  fromLegacySchema,
  type Access,
  type CmsErrorCode,
  type MostoCmsSchema,
} from '../src/index.js';
import { files, legacySchema } from './fixtures/site.js';

export function siteSchema(patch?: (s: MostoCmsSchema) => void): MostoCmsSchema {
  const s = fromLegacySchema(legacySchema, { collectionTypes: { content: 'single' } });
  patch?.(s);
  return s;
}

export function setup(opts: { access?: Access; schema?: MostoCmsSchema } = {}) {
  const adapter = createMemoryAdapter(files);
  const cms = createCms({
    schema: opts.schema ?? siteSchema(),
    adapter,
    randomId: () => 'abcd1234',
    ...(opts.access ? { access: opts.access } : {}),
  });
  return { adapter, cms };
}

export async function expectCode(p: Promise<unknown> | (() => unknown), code: CmsErrorCode) {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (err) {
    if (!(err instanceof CmsError)) throw err;
    if (err.code !== code) {
      throw new Error(`expected ${code}, got ${err.code}: ${err.message}`, { cause: err });
    }
    return err;
  }
  throw new Error(`expected CmsError ${code}, nothing was thrown`);
}
