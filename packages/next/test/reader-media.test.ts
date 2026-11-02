import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createContentReader,
  createMediaHandler,
  fileTag,
  fsSource,
  githubSource,
  githubSourceFromEnv,
  nextRevalidator,
  parseRepo,
  type ContentSource,
} from '../src/index.js';
import { files, schema } from './fixtures.js';

const memorySource = (data: Record<string, string>, fail = false): ContentSource => ({
  name: 'memory',
  async readText(p) {
    if (fail) throw new Error('network down');
    return data[p] ?? null;
  },
  async readBytes(p) {
    return data[p] ? new TextEncoder().encode(data[p]).buffer : null;
  },
});

const bundled = {
  'content/home.json': { id: 'home', en: { title: 'Bundled' } },
  'content/products.json': [{ slug: 'pasta', name: 'Bundled pasta' }],
};

describe('content reader', () => {
  it('reads live content first', async () => {
    const r = createContentReader({ schema, source: memorySource(files), bundled });
    expect((await r.entry<{ en: { title: string } }>('home'))?.en.title).toBe('Hello');
    expect(await r.entry('home', 'home')).not.toBeNull();
    expect((await r.collection('products')).map((p) => p.slug)).toEqual(['pasta']);
    expect(await r.entry('products', 'pasta')).toMatchObject({ price: '€ 12' });
    expect(await r.entry('products', 'nope')).toBeNull();
  });

  it('falls back to the bundle when the live read fails or is not configured, and reports it', async () => {
    const onError = vi.fn();
    const failing = createContentReader({ schema, source: memorySource(files, true), bundled, onError });
    expect((await failing.entry<{ en: { title: string } }>('home'))?.en.title).toBe('Bundled');
    expect(onError).toHaveBeenCalledWith('content/home.json', expect.any(Error));

    const none = createContentReader({ schema, source: () => null, bundled });
    expect((await none.collection<{ name: string }>('products'))[0]?.name).toBe('Bundled pasta');

    const broken = createContentReader({ schema, source: memorySource({ 'content/home.json': '{nope' }), bundled });
    expect((await broken.entry<{ en: { title: string } }>('home'))?.en.title).toBe('Bundled');

    const empty = createContentReader({ schema });
    expect(await empty.collection('products')).toEqual([]);
    expect(await empty.file('anything.json')).toBeNull();
  });

  it('does not crash the page on a wrongly shaped file', async () => {
    const onError = vi.fn();
    const r = createContentReader({ schema, source: memorySource({ 'content/products.json': '{"not":"a list"}' }), onError });
    expect(await r.collection('products')).toEqual([]);
    expect(onError).toHaveBeenCalled();
    await expect(r.collection('nope')).rejects.toThrow(/unknown collection/);
    await expect(createContentReader().collection('home')).rejects.toThrow(/schema/);
  });

  it('reads the disk with fsSource, inside the root only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mosto-next-'));
    await mkdir(join(root, 'content'));
    await writeFile(join(root, 'content/home.json'), files['content/home.json']);
    const s = fsSource({ root });
    expect(JSON.parse((await s.readText('content/home.json')) ?? 'null').id).toBe('home');
    expect(await s.readText('../etc/passwd')).toBeNull();
    expect(await s.readText('/etc/passwd')).toBeNull();
    expect(await s.readText('content/missing.json')).toBeNull();
    expect((await s.readBytes('content/home.json'))?.byteLength).toBeGreaterThan(10);
  });
});

describe('githubSource', () => {
  it('reads raw files through the contents API with Next.js cache tags', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":1}', { status: 200 }));
    const s = githubSource({ owner: 'acme', repo: 'site', branch: 'main', token: 'read-token', revalidate: 30, fetch: fetchMock as unknown as typeof fetch });
    expect(await s.readText('content/home page.json')).toBe('{"ok":1}');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { next: { revalidate: number; tags: string[] } }];
    expect(url).toBe('https://api.github.com/repos/acme/site/contents/content/home%20page.json?ref=main');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer read-token');
    expect(init.next).toEqual({ revalidate: 30, tags: ['mosto-cms', 'mosto-cms:file:content/home page.json'] });
  });

  it('returns null on errors and refuses unsafe paths', async () => {
    const notFound = githubSource({ owner: 'a', repo: 'b', fetch: (async () => new Response('', { status: 404 })) as unknown as typeof fetch });
    expect(await notFound.readText('x.json')).toBeNull();
    const throwing = githubSource({ owner: 'a', repo: 'b', fetch: (async () => { throw new Error('down'); }) as unknown as typeof fetch });
    expect(await throwing.readBytes('x.png')).toBeNull();
    const spy = vi.fn();
    const s = githubSource({ owner: 'a', repo: 'b', fetch: spy as unknown as typeof fetch });
    expect(await s.readText('../secrets.json')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('builds from env', () => {
    expect(githubSourceFromEnv({})).toBeNull();
    expect(githubSourceFromEnv({ MOSTO_CMS_GITHUB_REPO: 'acme/site' })?.name).toBe('github');
    expect(parseRepo('acme/site')).toEqual({ owner: 'acme', repo: 'site' });
    expect(parseRepo('https://github.com/acme/site')).toBeNull();
    expect(fileTag('x'.repeat(400)).length).toBe(256);
  });
});

describe('media proxy', () => {
  const data = { 'public/uploads/boat.png': 'PNGDATA', 'public/uploads/logo.svg': '<svg/>', 'public/uploads/notes.txt': 'x' };
  const handler = createMediaHandler({ schema, source: memorySource(data) });
  const get = (segments: string[] | undefined) =>
    handler(new Request('https://site.example/media/x'), segments ? { params: Promise.resolve({ path: segments }) } : (undefined as never));

  it('streams a committed upload with its content type', async () => {
    const res = await get(['boat.png']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('PNGDATA');
  });

  it('sandboxes SVGs', async () => {
    const res = await get(['logo.svg']);
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('refuses traversal, unknown types, missing files and missing params', async () => {
    expect((await get(['..', 'secret.png'])).status).toBe(400);
    expect((await get(['a..b.png'])).status).toBe(400);
    expect((await get(['.hidden.png'])).status).toBe(400);
    expect((await get([])).status).toBe(400);
    expect((await get(['notes.txt'])).status).toBe(404);
    expect((await get(['missing.png'])).status).toBe(404);
    expect((await get(undefined)).status).toBe(400);
    const noSource = createMediaHandler({ dir: 'public/uploads', source: () => null });
    expect((await noSource(new Request('https://x/media/a.png'), { params: Promise.resolve({ path: ['a.png'] }) })).status).toBe(404);
  });
});

vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

describe('nextRevalidator', () => {
  it('expires the changed files immediately and the route tree', async () => {
    const cache = (await import('next/cache')) as unknown as { revalidateTag: ReturnType<typeof vi.fn>; revalidatePath: ReturnType<typeof vi.fn> };
    await nextRevalidator()({ op: 'publish', files: ['content/home.json'], revision: 'r1' });
    expect(cache.revalidateTag).toHaveBeenCalledWith('mosto-cms:file:content/home.json', { expire: 0 });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/', 'layout');

    cache.revalidatePath.mockClear();
    await nextRevalidator({ paths: ['/menu'] })({ op: 'revert', files: ['content/products.json'], revision: 'r2' });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/menu');

    cache.revalidateTag.mockClear();
    await nextRevalidator()({ op: 'uploadAsset', files: [], revision: 'r3' });
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });
});
