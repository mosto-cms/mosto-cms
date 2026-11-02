import { execFileSync } from 'node:child_process';
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

  it('with git: true, commits each write and offers history and revert', async () => {
    const { root } = site();
    // The site lives in a sub-directory of the repository, like examples/starter.
    const repo = mkdtempSync(join(tmpdir(), 'mosto-cms-fs-git-'));
    const siteDir = join(repo, 'site');
    mkdirSync(join(siteDir, 'data'), { recursive: true });
    writeFileSync(join(siteDir, 'data/tours.json'), readFileSync(join(root, 'data/tours.json')));
    writeFileSync(join(repo, 'unrelated.txt'), 'draft');
    const g = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-C', repo, ...args], { encoding: 'utf8' });
    g('init', '-q');
    g('add', 'site');
    g('commit', '-q', '-m', 'initial');

    const adapter = createFsAdapter({ root: siteDir, git: true });
    const cms = createCms({ schema, adapter, author: { name: 'Anna', email: 'anna@example.com' } });
    expect(cms.describe().capabilities).toMatchObject({ history: true, revert: true });

    const pub = await cms.publish({ message: 'Summer price', changes: [{ collection: 'tours', id: 'giro', path: 'price', value: '€ 150' }] });
    expect(pub.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(g('log', '-1', '--format=%an <%ae> %s').trim()).toBe('Anna <anna@example.com> Summer price');
    // Only the content file is committed, never the rest of the working copy.
    expect(g('status', '--porcelain')).toContain('unrelated.txt');

    const { entries } = await cms.history({});
    expect(entries.map((e) => e.message)).toEqual(['Summer price', 'initial']);
    expect(entries[0]).toMatchObject({ files: ['data/tours.json'], author: { name: 'Anna' } });

    const old = await adapter.readFile('data/tours.json', { at: entries[1]!.revision });
    expect(JSON.parse(old!.text)[0].price).toBe('€ 120');

    const undo = await cms.revert({ revision: pub.revision! });
    expect(undo.published).toBe(true);
    expect(JSON.parse(readFileSync(join(siteDir, 'data/tours.json'), 'utf8'))[0].price).toBe('€ 120');
    expect((await cms.history({})).entries[0]!.message).toBe('Revert "Summer price"');
    expect(await code(adapter.readFile('data/tours.json', { at: 'not a sha' }))).toBe('not_found');
  });
});
