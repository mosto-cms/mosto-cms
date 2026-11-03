import { generateKeyPairSync } from 'node:crypto';

import { CmsError, createCms, fromLegacySchema, type CmsErrorCode } from '@mosto-cms/core';
import { describe, expect, it } from 'vitest';

import { createAppJwt, createGithubAdapter } from '../src/index.js';
import { FakeGithub } from './fake-github.js';

const TOURS = JSON.stringify([{ slug: 'giro', it: { name: 'Giro' }, price: '€ 120' }], null, 2) + '\n';
const HOME = JSON.stringify([{ id: 'home', it: { title: 'Ciao' }, secret: 'x' }], null, 2) + '\n';

function setup() {
  const gh = new FakeGithub();
  gh.commitFiles({ 'data/tours.json': TOURS, 'data/home.json': HOME, 'README.md': '# site' }, 'content');
  const adapter = createGithubAdapter({ owner: 'acme', repo: 'site', branch: 'main', auth: { token: gh.token }, fetch: gh.fetch });
  return { gh, adapter };
}

async function code(p: Promise<unknown>): Promise<CmsErrorCode | 'none'> {
  try {
    await p;
    return 'none';
  } catch (e) {
    if (e instanceof CmsError) return e.code;
    throw e;
  }
}

const schema = fromLegacySchema({
  collections: [
    { key: 'tours', file: 'data/tours.json', idField: 'slug', label: 'Tours', fields: [{ path: 'price', kind: 'text', label: 'Price' }] },
    { key: 'home', file: 'data/home.json', idField: 'id', label: 'Home', fields: [{ path: 'it.title', kind: 'text', label: 'Title' }] },
  ],
});

describe('github adapter: read', () => {
  it('reads a file at head with its blob sha, null when missing', async () => {
    const { adapter, gh } = setup();
    const f = await adapter.readFile('data/tours.json');
    expect(f?.text).toBe(TOURS);
    expect(f?.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(await adapter.readFile('data/missing.json')).toBeNull();
    const old = gh.head()!;
    gh.commitFiles({ 'data/tours.json': '[]\n' }, 'wipe');
    expect((await adapter.readFile('data/tours.json', { at: old }))?.text).toBe(TOURS);
  });

  it('reads files over 1 MB through the blob API', async () => {
    const { adapter, gh } = setup();
    const big = JSON.stringify([{ slug: 'x', blob: 'a'.repeat(1_100_000) }]);
    gh.commitFiles({ 'data/big.json': big }, 'big');
    expect((await adapter.readFile('data/big.json'))?.text).toBe(big);
    expect(gh.calls.some((c) => c.includes('/git/blobs/'))).toBe(true);
  });

  it('refuses unsafe paths', async () => {
    const { adapter } = setup();
    expect(await code(adapter.readFile('../etc/passwd'))).toBe('bad_request');
    expect(await code(adapter.commit({ message: 'x', files: [{ path: '/abs.json', content: { encoding: 'utf8', data: '' } }] }))).toBe('bad_request');
  });

  it('reports bad site credentials without leaking them', async () => {
    const gh = new FakeGithub();
    const adapter = createGithubAdapter({ owner: 'acme', repo: 'site', branch: 'main', auth: { token: 'wrong' }, fetch: gh.fetch });
    const err = await adapter.readFile('data/tours.json').catch((e: CmsError) => e);
    expect(err).toBeInstanceOf(CmsError);
    expect((err as CmsError).message).toMatch(/refused the site credentials \(401\)/);
    expect((err as CmsError).message).not.toContain('wrong');
  });
});

describe('github adapter: commit', () => {
  it('writes several files in one atomic commit', async () => {
    const { adapter, gh } = setup();
    const before = gh.head()!;
    const tours = await adapter.readFile('data/tours.json');
    const r = await adapter.commit({
      message: 'two files',
      author: { name: 'Editor', email: 'editor@example.com' },
      files: [
        { path: 'data/tours.json', content: { encoding: 'utf8', data: '[1]\n' }, baseRevision: tours!.revision },
        { path: 'public/uploads/a.png', content: { encoding: 'base64', data: Buffer.from([137, 80, 78, 71]).toString('base64') }, baseRevision: null },
      ],
    });
    expect(gh.head()).toBe(r.revision);
    expect(gh.commits.get(r.revision)!.parents).toEqual([before]);
    expect(gh.commits.get(r.revision)!.author.name).toBe('Editor');
    expect(gh.fileAt('data/tours.json')).toBe('[1]\n');
    expect([...gh.blobs.get(gh.trees.get(gh.commits.get(r.revision)!.tree)!.get('public/uploads/a.png')!)!]).toEqual([137, 80, 78, 71]);
    expect(gh.fileAt('README.md')).toBe('# site');
    expect(r.url).toContain(r.revision);
  });

  it('refuses a stale base revision and leaves the branch untouched', async () => {
    const { adapter, gh } = setup();
    const tours = await adapter.readFile('data/tours.json');
    gh.commitFiles({ 'data/tours.json': '[]\n' }, 'someone else');
    const head = gh.head();
    expect(
      await code(
        adapter.commit({
          message: 'late',
          files: [
            { path: 'data/home.json', content: { encoding: 'utf8', data: '[]' } },
            { path: 'data/tours.json', content: { encoding: 'utf8', data: '[2]' }, baseRevision: tours!.revision },
          ],
        }),
      ),
    ).toBe('conflict');
    expect(gh.head()).toBe(head);
    expect(gh.fileAt('data/home.json')).toBe(HOME);
  });

  it('refuses to create a file that already exists when baseRevision is null', async () => {
    const { adapter } = setup();
    expect(await code(adapter.commit({ message: 'x', files: [{ path: 'README.md', content: { encoding: 'utf8', data: 'x' }, baseRevision: null }] }))).toBe('conflict');
  });

  it('rebuilds on the new head when the branch moved for unrelated files', async () => {
    const { adapter, gh } = setup();
    const tours = await adapter.readFile('data/tours.json');
    let once = true;
    gh.beforeRefUpdate = () => {
      if (once) {
        once = false;
        gh.commitFiles({ 'README.md': '# changed by a dev' }, 'docs');
      }
    };
    const r = await adapter.commit({
      message: 'price',
      files: [{ path: 'data/tours.json', content: { encoding: 'utf8', data: '[3]\n' }, baseRevision: tours!.revision }],
    });
    expect(gh.head()).toBe(r.revision);
    expect(gh.fileAt('README.md')).toBe('# changed by a dev');
    expect(gh.fileAt('data/tours.json')).toBe('[3]\n');
  });

  it('turns a race on the same file into a conflict', async () => {
    const { adapter, gh } = setup();
    const tours = await adapter.readFile('data/tours.json');
    let once = true;
    gh.beforeRefUpdate = () => {
      if (once) {
        once = false;
        gh.commitFiles({ 'data/tours.json': '["theirs"]\n' }, 'race');
      }
    };
    expect(
      await code(
        adapter.commit({ message: 'mine', files: [{ path: 'data/tours.json', content: { encoding: 'utf8', data: '["mine"]\n' }, baseRevision: tours!.revision }] }),
      ),
    ).toBe('conflict');
    expect(gh.fileAt('data/tours.json')).toBe('["theirs"]\n');
  });

  it('gives up with conflict when the branch keeps moving', async () => {
    const { adapter, gh } = setup();
    let n = 0;
    gh.beforeRefUpdate = () => {
      gh.commitFiles({ [`noise-${n++}.txt`]: 'x' }, 'noise');
    };
    expect(await code(adapter.commit({ message: 'x', files: [{ path: 'data/x.json', content: { encoding: 'utf8', data: '[]' } }] }))).toBe('conflict');
    expect(n).toBe(3);
  });
});

describe('github adapter: history', () => {
  it('lists revisions touching content files and resolves one revision', async () => {
    const { adapter, gh } = setup();
    gh.commitFiles({ 'README.md': 'docs only' }, 'docs');
    const c2 = gh.commitFiles({ 'data/home.json': HOME.replace('Ciao', 'Salve') }, 'home');
    const h = await adapter.history!({ paths: ['data/tours.json', 'data/home.json'], limit: 10 });
    expect(h.map((e) => e.message)).toEqual(['home', 'content']);
    expect(h[1]!.files.sort()).toEqual(['data/home.json', 'data/tours.json']);
    const r = await adapter.getRevision!(c2, { paths: ['data/home.json', 'data/tours.json'] });
    expect(r).toMatchObject({ revision: c2, files: ['data/home.json'], message: 'home' });
    expect(await adapter.getRevision!('0'.repeat(40), { paths: [] })).toBeNull();
    expect(await adapter.getRevision!('not-a-sha', { paths: [] })).toBeNull();
  });
});

describe('github adapter + core engine', () => {
  it('publishes through the fence and reverts', async () => {
    const { adapter, gh } = setup();
    const cms = createCms({ schema, adapter });
    expect(await code(cms.publish({ changes: [{ collection: 'home', id: 'home', path: 'secret', value: 'pwned' }] }))).toBe('field_not_editable');
    const p = await cms.publish({
      message: 'Prices and title',
      changes: [
        { collection: 'tours', id: 'giro', path: 'price', value: '€ 130' },
        { collection: 'home', id: 'home', path: 'it.title', value: 'Benvenuti' },
      ],
    });
    expect(gh.commits.get(p.revision!)!.message).toBe('Prices and title');
    expect(JSON.parse(gh.fileAt('data/tours.json')!)[0].price).toBe('€ 130');
    expect(JSON.parse(gh.fileAt('data/home.json')!)[0]).toEqual({ id: 'home', it: { title: 'Benvenuti' }, secret: 'x' });
    const r = await cms.revert({ revision: p.revision! });
    expect(r.published).toBe(true);
    expect(gh.fileAt('data/tours.json')).toBe(TOURS);
    expect(gh.fileAt('data/home.json')).toBe(HOME);
    expect((await cms.history({ limit: 5 })).entries.map((e) => e.message)).toEqual(['Revert "Prices and title"', 'Prices and title', 'content']);
  });
});

describe('github app auth', () => {
  it('signs a JWT, mints an installation token and caches it', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const gh = new FakeGithub();
    gh.appPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    gh.commitFiles({ 'data/tours.json': TOURS }, 'content');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n');
    const adapter = createGithubAdapter({
      owner: 'acme',
      repo: 'site',
      branch: 'main',
      auth: { app: { appId: '123', privateKey: pem } },
      fetch: gh.fetch,
    });
    expect((await adapter.readFile('data/tours.json'))?.text).toBe(TOURS);
    await adapter.readFile('data/tours.json');
    expect(gh.calls.filter((c) => c.includes('/access_tokens'))).toHaveLength(1);
    expect(gh.calls.filter((c) => c.endsWith('/installation'))).toHaveLength(1);
    const [, payload] = createAppJwt('123', pem, 1_000_000).split('.');
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual({ iat: 999_940, exp: 1_000_540, iss: '123' });
  });
});

describe('github adapter: rootDir (monorepos)', () => {
  function monorepo() {
    const gh = new FakeGithub();
    gh.commitFiles({ 'apps/web/data/tours.json': TOURS, 'README.md': '# repo' }, 'content');
    const adapter = createGithubAdapter({
      owner: 'acme',
      repo: 'site',
      branch: 'main',
      auth: { token: gh.token },
      fetch: gh.fetch,
      rootDir: 'apps/web',
    });
    return { gh, adapter };
  }

  it('reads and writes schema paths under the rootDir, one commit', async () => {
    const { adapter, gh } = monorepo();
    const f = await adapter.readFile('data/tours.json');
    expect(f?.text).toBe(TOURS);
    expect(await adapter.readFile('README.md')).toBeNull(); // outside the rootDir

    const result = await adapter.commit({
      message: 'Update price',
      files: [{ path: 'data/tours.json', content: { encoding: 'utf8', data: '[]\n' }, baseRevision: f!.revision }],
    });
    expect(result.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(gh.fileAt('apps/web/data/tours.json')).toBe('[]\n');
    expect(gh.fileAt('data/tours.json')).toBeUndefined();
  });

  it('keeps history and revisions on schema paths (prefix stripped)', async () => {
    const { adapter, gh } = monorepo();
    gh.commitFiles({ 'apps/web/data/tours.json': '[1]\n', 'other.txt': 'x' }, 'edit');
    const history = await adapter.history!({ paths: ['data/tours.json'], limit: 10 });
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]!.files).toEqual(['data/tours.json']);
    const rev = await adapter.getRevision!(gh.head()!, { paths: ['data/tours.json'] });
    expect(rev?.files).toEqual(['data/tours.json']);
  });

  it('a stale base revision still conflicts through the prefix', async () => {
    const { adapter, gh } = monorepo();
    const f = await adapter.readFile('data/tours.json');
    gh.commitFiles({ 'apps/web/data/tours.json': '[2]\n' }, 'someone else');
    await expect(
      adapter.commit({
        message: 'x',
        files: [{ path: 'data/tours.json', content: { encoding: 'utf8', data: '[]\n' }, baseRevision: f!.revision }],
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses an unsafe rootDir', () => {
    expect(() =>
      createGithubAdapter({ owner: 'a', repo: 'b', branch: 'main', auth: { token: 't' }, rootDir: '../other' }),
    ).toThrow(/unsafe rootDir/);
  });
});

describe('github adapter: GitHub slow or briefly down', () => {
  const resilient = (gh: FakeGithub, extra: Partial<Parameters<typeof createGithubAdapter>[0]> = {}) =>
    createGithubAdapter({ owner: 'acme', repo: 'site', branch: 'main', auth: { token: gh.token }, fetch: gh.fetch, retryDelayMs: 0, ...extra });
  const status = (n: number) => new Response(JSON.stringify({ message: `status ${n}` }), { status: n });

  it('retries a read after a 502 or no answer, then succeeds', async () => {
    const { gh } = setup();
    let failures = 2;
    gh.fault = (c) => {
      if (!c.startsWith('GET') || failures === 0) return undefined;
      failures--;
      return failures === 1 ? { when: 'before', response: status(502) } : { when: 'before', throws: new TypeError('fetch failed') };
    };
    expect((await resilient(gh).readFile('data/tours.json'))?.text).toBe(TOURS);
  });

  it('gives up after the retries with an internal error naming the request', async () => {
    const { gh } = setup();
    gh.fault = () => ({ when: 'before', response: status(503) });
    await expect(resilient(gh).readFile('data/tours.json')).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringMatching(/GitHub GET .*contents.* failed: 503/),
    });
  });

  it('times out a request that never answers', async () => {
    const { gh } = setup();
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    const adapter = resilient(gh, { fetch: hang, requestTimeoutMs: 20, retries: 1 });
    await expect(adapter.readFile('data/tours.json')).rejects.toMatchObject({ code: 'internal', message: expect.stringMatching(/did not answer/) });
  });

  it('a commit whose branch update answered 502 but landed is a success, committed once', async () => {
    const { gh } = setup();
    const before = gh.head()!;
    gh.fault = (c) => (c.startsWith('PATCH') ? { when: 'after', response: status(502) } : undefined);
    const r = await resilient(gh).commit({ message: 'edit', files: [{ path: 'data/tours.json', content: { encoding: 'utf8', data: '[1]\n' } }] });
    expect(gh.head()).toBe(r.revision);
    expect(gh.commits.get(r.revision)!.parents).toEqual([before]);
    expect(gh.calls.filter((c) => c.startsWith('PATCH'))).toHaveLength(1);
  });

  it('a branch update that failed before landing is tried again', async () => {
    const { gh } = setup();
    let failed = false;
    gh.fault = (c) => {
      if (!c.startsWith('PATCH') || failed) return undefined;
      failed = true;
      return { when: 'before', response: status(500) };
    };
    const r = await resilient(gh).commit({ message: 'edit', files: [{ path: 'data/tours.json', content: { encoding: 'utf8', data: '[2]\n' } }] });
    expect(gh.head()).toBe(r.revision);
    expect(gh.fileAt('data/tours.json')).toBe('[2]\n');
  });

  it('a publish retried after a lost answer does not commit twice', async () => {
    const { gh } = setup();
    const adapter = resilient(gh);
    const cms = createCms({ schema, adapter, author: { name: 'Editor', email: 'editor@example.com' } });
    const change = { collection: 'tours', id: 'giro', path: 'price', value: '€ 130', before: '€ 120' };
    gh.fault = (c) => (c.startsWith('PATCH') ? { when: 'after', response: status(504) } : undefined);
    const first = await cms.publish({ changes: [change] }).catch((e: unknown) => e);
    expect(first).toMatchObject({ published: true });
    gh.fault = undefined;
    const head = gh.head();
    const again = await cms.publish({ changes: [change] });
    expect(again).toMatchObject({ published: false, alreadyPublished: true });
    expect(gh.head()).toBe(head);
  });
});

describe('github adapter: committer', () => {
  it('keeps the editor as author and commits as the configured committer', async () => {
    const { gh } = setup();
    const adapter = createGithubAdapter({
      owner: 'acme',
      repo: 'site',
      branch: 'main',
      auth: { token: gh.token },
      fetch: gh.fetch,
      committer: { name: 'Site bot', email: 'bot@example.com' },
    });
    const r = await adapter.commit({
      message: 'edit',
      author: { name: 'Editor', email: 'editor@example.com' },
      files: [{ path: 'data/tours.json', content: { encoding: 'utf8', data: '[3]\n' } }],
    });
    const c = gh.commits.get(r.revision)!;
    expect(c.author).toMatchObject({ name: 'Editor', email: 'editor@example.com' });
    expect(c.committer).toEqual({ name: 'Site bot', email: 'bot@example.com' });
    const history = await adapter.history!({ paths: ['data/tours.json'], limit: 5 });
    expect(history[0]!.author).toEqual({ name: 'Editor', email: 'editor@example.com' });
  });
});
