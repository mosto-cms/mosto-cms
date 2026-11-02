import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CmsError, createCms, fromLegacySchema } from '@mosto-cms/core';
import { describe, expect, it } from 'vitest';

import { createFsAdapter } from '../src/index.js';

const TOURS = JSON.stringify([{ slug: 'giro', price: '€ 120', internal: 1 }], null, 2) + '\n';

function site() {
  const root = mkdtempSync(join(tmpdir(), 'mosto-cms-fs-'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data/tours.json'), TOURS);
  return { root, adapter: createFsAdapter({ root }) };
}

const schema = fromLegacySchema({
  collections: [
    { key: 'tours', file: 'data/tours.json', idField: 'slug', label: 'Tours', fields: [{ path: 'price', kind: 'text', label: 'Price' }] },
  ],
});

async function code(p: Promise<unknown>) {
  return p.then(
    () => 'none',
    (e: unknown) => (e instanceof CmsError ? e.code : Promise.reject(e)),
  );
}

describe('fs adapter', () => {
  it('reads files with a content revision', async () => {
    const { adapter } = site();
    const f = await adapter.readFile('data/tours.json');
    expect(f?.text).toBe(TOURS);
    expect(f?.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(await adapter.readFile('data/none.json')).toBeNull();
    expect(await code(adapter.readFile('data/tours.json', { at: 'x' }))).toBe('unsupported');
  });

  it('stays inside the root', async () => {
    const { adapter } = site();
    expect(await code(adapter.readFile('../outside.json'))).toBe('bad_request');
    expect(await code(adapter.readFile('/etc/passwd'))).toBe('bad_request');
    expect(await code(adapter.commit({ message: 'x', files: [{ path: 'a/../../b.json', content: { encoding: 'utf8', data: '' } }] }))).toBe('bad_request');
  });

  it('writes text and binary files, creating folders', async () => {
    const { adapter, root } = site();
    await adapter.commit({
      message: 'x',
      files: [
        { path: 'data/new.json', content: { encoding: 'utf8', data: '[]\n' }, baseRevision: null },
        { path: 'public/uploads/a.png', content: { encoding: 'base64', data: Buffer.from([1, 2, 3]).toString('base64') } },
      ],
    });
    expect(readFileSync(join(root, 'data/new.json'), 'utf8')).toBe('[]\n');
    expect([...readFileSync(join(root, 'public/uploads/a.png'))]).toEqual([1, 2, 3]);
    expect(readdirSync(join(root, 'data')).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('refuses stale base revisions without writing anything', async () => {
    const { adapter, root } = site();
    const f = await adapter.readFile('data/tours.json');
    writeFileSync(join(root, 'data/tours.json'), '[]\n');
    expect(
      await code(
        adapter.commit({
          message: 'x',
          files: [
            { path: 'data/other.json', content: { encoding: 'utf8', data: '{}' } },
            { path: 'data/tours.json', content: { encoding: 'utf8', data: '[1]' }, baseRevision: f!.revision },
          ],
        }),
      ),
    ).toBe('conflict');
    expect(existsSync(join(root, 'data/other.json'))).toBe(false);
    expect(await code(adapter.commit({ message: 'x', files: [{ path: 'data/tours.json', content: { encoding: 'utf8', data: '' }, baseRevision: null }] }))).toBe('conflict');
  });

  it('serializes concurrent publishes so the second one sees the first', async () => {
    const { adapter, root } = site();
    const cms = createCms({ schema, adapter });
    const [a, b] = await Promise.allSettled([
      cms.publish({ changes: [{ collection: 'tours', id: 'giro', path: 'price', value: '€ 1', before: '€ 120' }] }),
      cms.publish({ changes: [{ collection: 'tours', id: 'giro', path: 'price', value: '€ 2', before: '€ 120' }] }),
    ]);
    const outcomes = [a, b].map((r) => (r.status === 'fulfilled' ? 'ok' : (r.reason as CmsError).code)).sort();
    expect(outcomes).toEqual(['conflict', 'ok']);
    expect(JSON.parse(readFileSync(join(root, 'data/tours.json'), 'utf8'))[0].internal).toBe(1);
  });

  it('works with the engine, without history', async () => {
    const { adapter, root } = site();
    const cms = createCms({ schema, adapter });
    expect(cms.describe().capabilities).toMatchObject({ history: false, revert: false });
    await cms.publish({ changes: [{ collection: 'tours', id: 'giro', path: 'price', value: '€ 140' }] });
    expect(readFileSync(join(root, 'data/tours.json'), 'utf8')).toBe(TOURS.replace('€ 120', '€ 140'));
    expect(await code(cms.publish({ changes: [{ collection: 'tours', id: 'giro', path: 'internal', value: '2' }] }))).toBe('field_not_editable');
  });
});
