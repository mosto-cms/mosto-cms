import { describe, expect, it } from 'vitest';

import { createRouteHandlers } from '../src/index.js';
import { bearer, call, setup, SITE } from './fixtures.js';

async function run(h: ReturnType<typeof createRouteHandlers>, req: Request, route: string[] = []) {
  const res = await h.POST(req, { params: Promise.resolve({ route }) });
  return { status: res.status, body: await res.json(), res };
}

const change = (path: string, value: string | string[], extra: Record<string, unknown> = {}) => ({
  collection: 'home',
  id: 'home',
  path,
  value,
  ...extra,
});

describe('GET /api/mosto-cms', () => {
  it('answers discovery without auth, and 404 on unknown routes', async () => {
    const { site } = await setup();
    const h = createRouteHandlers(site);
    const res = await h.GET(new Request(`${SITE}/api/mosto-cms`), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({
      ok: true,
      protocol: 'mosto-cms/1',
      result: { name: 'mosto-cms', protocol: 'mosto-cms/1', auth: ['connector-key', 'editor-session'] },
    });
    const missing = await h.GET(new Request(`${SITE}/api/mosto-cms/nope`), { params: Promise.resolve({ route: ['nope'] }) });
    expect(missing.status).toBe(404);
    expect((await run(h, call({}), ['nope'])).body.error.code).toBe('not_found');
  });

  it('finds the sub-route from the URL when mounted without params', async () => {
    const { site } = await setup();
    const h = createRouteHandlers(site);
    // No context at all (tolerated at runtime): the route comes from the URL.
    const res = await h.GET(new Request(`${SITE}/api/mosto-cms/session`), undefined as never);
    expect((await res.json()).result).toEqual({ editor: null });
  });
});

describe('authentication', () => {
  it('is unauthorized without credentials, with a malformed header or a bad key', async () => {
    const { site } = await setup();
    const h = createRouteHandlers(site);
    expect((await run(h, call({ op: 'describe' }))).status).toBe(401);
    const malformed = await run(h, call({ op: 'describe' }, { authorization: 'Basic abc' }));
    expect(malformed.status).toBe(401);
    const bad = await run(h, call({ op: 'describe' }, bearer('mck1.e30.AAAA')));
    expect(bad.body.error).toMatchObject({ code: 'unauthorized', details: { reason: 'bad_signature' } });
  });

  it('never falls back to the cookie when a bad key is sent', async () => {
    const { site } = await setup();
    const h = createRouteHandlers(site);
    const login = await h.POST(call({ email: 'anna@example.com', password: 'correct horse battery' }, {}, '/api/mosto-cms/login'), {
      params: Promise.resolve({ route: ['login'] }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] as string;
    const r = await run(h, call({ op: 'describe' }, { cookie, ...bearer('mck1.e30.AAAA') }));
    expect(r.status).toBe(401);
  });

  it('revokes keys from config, env and the repo revocation file; the key epoch revokes all', async () => {
    const { site, env, key, adapter } = await setup({ keys: { revoked: [], revocationCacheSeconds: 0 } });
    const h = createRouteHandlers(site);
    const a = key({ write: true });
    const b = key({ write: true });
    const c = key({ write: true });
    expect((await run(h, call({ op: 'describe' }, bearer(a.key)))).status).toBe(200);

    env.MOSTO_CMS_REVOKED_KEYS = `${a.kid}`;
    const ra = await run(h, call({ op: 'describe' }, bearer(a.key)));
    expect(ra.body.error).toMatchObject({ code: 'unauthorized', details: { reason: 'revoked' } });

    adapter.seed({ 'mosto-cms.revoked.json': JSON.stringify({ revoked: [b.kid] }) });
    expect((await run(h, call({ op: 'describe' }, bearer(b.key)))).body.error.details.reason).toBe('revoked');
    expect((await run(h, call({ op: 'describe' }, bearer(c.key)))).status).toBe(200);

    env.MOSTO_CMS_KEY_EPOCH = '1';
    expect((await run(h, call({ op: 'describe' }, bearer(c.key)))).status).toBe(401);
  });

  it('refuses every key while the revocation file is broken, and caches it per instance', async () => {
    const { site, key, adapter } = await setup({ keys: { revocationCacheSeconds: 30 } });
    const h = createRouteHandlers(site);
    const a = key();
    expect((await run(h, call({ op: 'describe' }, bearer(a.key)))).status).toBe(200);
    adapter.seed({ 'mosto-cms.revoked.json': JSON.stringify({ revoked: [a.kid] }) });
    // Still cached for this instance…
    expect((await run(h, call({ op: 'describe' }, bearer(a.key)))).status).toBe(200);
    site.clearRevocationCache();
    expect((await run(h, call({ op: 'describe' }, bearer(a.key)))).status).toBe(401);

    adapter.seed({ 'mosto-cms.revoked.json': '{broken' });
    site.clearRevocationCache();
    const r = await run(h, call({ op: 'describe' }, bearer(key().key)));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('internal');
  });

  it('gives an internal error when the site secret is missing', async () => {
    const { site } = await setup({ secret: '' });
    const h = createRouteHandlers(site);
    const r = await run(h, call({ op: 'describe' }, bearer('mck1.e30.AAAA')));
    expect(r.status).toBe(500);
    expect(r.body.error.message).toMatch(/MOSTO_CMS_SECRET/);
  });

  it('accepts an editor session, checks Origin and JSON, and commits as the editor', async () => {
    const { site, adapter, revalidations } = await setup();
    const h = createRouteHandlers(site);
    const login = await h.POST(call({ email: 'anna@example.com', password: 'correct horse battery' }, {}, '/api/mosto-cms/login'), {
      params: Promise.resolve({ route: ['login'] }),
    });
    expect(login.status).toBe(200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] as string;

    const d = await run(h, call({ op: 'describe' }, { cookie, origin: SITE }));
    expect(d.body.result.access).toEqual({ write: true, collections: 'all', actor: 'human' });

    const cross = await run(h, call({ op: 'describe' }, { cookie, origin: 'https://evil.example' }));
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe('forbidden');

    const form = await run(h, call('{"op":"describe"}', { cookie, 'content-type': 'text/plain' }));
    expect(form.status).toBe(400);

    const p = await run(h, call({ op: 'publish', input: { changes: [change('en.title', 'Welcome')] } }, { cookie }));
    expect(p.body.result.published).toBe(true);
    const history = await adapter.history!({ paths: ['content/home.json'], limit: 1 });
    expect(history[0]?.author).toMatchObject({ name: 'Anna', email: 'anna@example.com' });
    expect(revalidations).toEqual([{ op: 'publish', files: ['content/home.json'], revision: p.body.result.revision }]);

    const out = await h.POST(call({}, { cookie }, '/api/mosto-cms/logout'), { params: Promise.resolve({ route: ['logout'] }) });
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('every operation through a connector key', () => {
  it('runs the read operations', async () => {
    const { site, key } = await setup();
    const h = createRouteHandlers(site);
    const k = bearer(key({ label: 'Platform' }).key);

    const d = await run(h, call({ op: 'describe' }, k));
    expect(d.body.result).toMatchObject({ protocol: 'mosto-cms/1', locales: ['en', 'it'], access: { write: false, actor: 'human' } });

    const f = await run(h, call({ op: 'listEditableFields', input: { collection: 'home' } }, k));
    expect(f.body.result[0].fields.map((x: { path: string }) => x.path)).toEqual(['en.title', 'it.title', 'gallery']);

    const e = await run(h, call({ op: 'listEntries', input: { collection: 'products' } }, k));
    expect(e.body.result).toEqual([{ id: 'pasta', title: 'Pasta' }]);

    const g = await run(h, call({ op: 'getField', input: { collection: 'home', id: 'home', path: 'gallery.1' } }, k));
    expect(g.body.result).toMatchObject({ kind: 'image', value: '/b.jpg' });

    const whole = await run(h, call({ op: 'getField', input: { collection: 'home', id: 'home' } }, k));
    expect(Object.keys(whole.body.result.fields)).toEqual(['en.title', 'it.title', 'gallery']);

    const pv = await run(h, call({ op: 'previewChange', input: { changes: [change('en.title', 'Hi there')] } }, k));
    expect(pv.body.result.changes[0]).toMatchObject({ before: 'Hello', after: 'Hi there', changed: true });
    expect(pv.body.result.revisions['content/home.json']).toBeTypeOf('string');

    const hist = await run(h, call({ op: 'history', input: { limit: 5 } }, k));
    expect(hist.body.result.entries.length).toBeGreaterThan(0);
  });

  it('runs publish, uploadAsset and revert with a write key, and revalidates', async () => {
    const { site, key, adapter, revalidations } = await setup();
    const h = createRouteHandlers(site);
    const k = bearer(key({ write: true, label: 'Platform' }).key);

    const p = await run(h, call({ op: 'publish', input: { message: 'New title', changes: [change('en.title', 'Welcome'), change('gallery.0', '/c.jpg')] } }, k));
    expect(p.status).toBe(200);
    expect(p.body.result).toMatchObject({ published: true, files: ['content/home.json'] });
    expect(JSON.parse(adapter.files()['content/home.json'] as string)).toMatchObject({ en: { title: 'Welcome' }, gallery: ['/c.jpg', '/b.jpg'], layout: 'x' });
    const [last] = await adapter.history!({ paths: ['content/home.json'], limit: 1 });
    expect(last?.author).toMatchObject({ name: 'Platform (connector)' });

    const noop = await run(h, call({ op: 'publish', input: { changes: [change('en.title', 'Welcome')] } }, k));
    expect(noop.body.result.published).toBe(false);

    const u = await run(
      h,
      call({ op: 'uploadAsset', input: { filename: 'Boat Photo.png', contentType: 'image/png', dataBase64: Buffer.from('png').toString('base64') } }, k),
    );
    expect(u.body.result.path).toMatch(/^\/uploads\/boat-photo-[a-z0-9]+\.png$/);

    const r = await run(h, call({ op: 'revert', input: { revision: p.body.result.revision } }, k));
    expect(r.status).toBe(200);
    expect(r.body.result.reverted).toBe(p.body.result.revision);
    expect(JSON.parse(adapter.files()['content/home.json'] as string).en.title).toBe('Hello');

    expect(revalidations.map((x) => x.op)).toEqual(['publish', 'uploadAsset', 'revert']);
    expect(revalidations[1]?.files).toEqual([]);
  });

  it('returns the standard errors', async () => {
    const { site, key } = await setup();
    const h = createRouteHandlers(site);
    const rw = bearer(key({ write: true }).key);

    const notEditable = await run(h, call({ op: 'publish', input: { changes: [change('layout', 'y')] } }, rw));
    expect(notEditable.status).toBe(403);
    expect(notEditable.body.error.code).toBe('field_not_editable');

    const conflict = await run(h, call({ op: 'publish', input: { changes: [change('en.title', 'New', { before: 'Old' })] } }, rw));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('conflict');

    const pv = await run(h, call({ op: 'previewChange', input: { changes: [change('it.title', 'Salve')] } }, rw));
    await run(h, call({ op: 'publish', input: { changes: [change('it.title', 'Buongiorno')] } }, rw));
    const stale = await run(h, call({ op: 'publish', input: { changes: [change('it.title', 'Salve')], baseRevisions: pv.body.result.revisions } }, rw));
    expect(stale.body.error.code).toBe('conflict');

    const invalid = await run(h, call({ op: 'publish', input: { changes: [change('en.title', 'x'.repeat(41))] } }, rw));
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('invalid_value');

    const notFound = await run(h, call({ op: 'getField', input: { collection: 'products', id: 'pizza', path: 'name' } }, rw));
    expect(notFound.status).toBe(404);

    const unsupported = await run(h, call({ op: 'uploadAsset', input: { filename: 'x.exe', contentType: 'application/x-msdownload', dataBase64: 'AA==' } }, rw));
    expect(unsupported.body.error.code).toBe('unsupported');

    const unknownOp = await run(h, call({ op: 'dropTables' }, rw));
    expect(unknownOp.status).toBe(400);
    expect(unknownOp.body.error.code).toBe('bad_request');

    const badJson = await run(h, call('{not json', rw));
    expect(badJson.status).toBe(400);

    const tooLarge = await run(h, call('x', { ...rw, 'content-length': String(50 * 1024 * 1024) }));
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe('too_large');
  });

  it('enforces the key scope: read-only, collections, AI actor', async () => {
    const { site, key } = await setup();
    const h = createRouteHandlers(site);

    const ro = await run(h, call({ op: 'publish', input: { changes: [change('en.title', 'Nope')] } }, bearer(key().key)));
    expect(ro.status).toBe(403);
    expect(ro.body.error.code).toBe('forbidden');

    const scoped = bearer(key({ write: true, collections: ['products'] }).key);
    expect((await run(h, call({ op: 'getField', input: { collection: 'home', id: 'home', path: 'en.title' } }, scoped))).body.error.code).toBe('forbidden');
    const d = await run(h, call({ op: 'describe' }, scoped));
    expect(d.body.result.collections.map((c: { key: string }) => c.key)).toEqual(['products']);

    const price = { collection: 'products', id: 'pasta', path: 'price', value: '€ 1' };
    const ai = await run(h, call({ op: 'publish', input: { changes: [price] } }, bearer(key({ write: true, actor: 'ai' }).key)));
    expect(ai.body.error).toMatchObject({ code: 'field_not_editable', details: { reason: 'ai_locked' } });

    const human = bearer(key({ write: true }).key);
    const downgraded = await run(h, call({ op: 'publish', input: { changes: [price] } }, { ...human, 'x-mosto-actor': 'ai' }));
    expect(downgraded.body.error.details.reason).toBe('ai_locked');
    expect((await run(h, call({ op: 'publish', input: { changes: [price] } }, human))).status).toBe(200);
  });

  it('reports an invalid schema with every issue, and survives a failing revalidation', async () => {
    const broken = await setup({ schema: { version: 1, locales: [], collections: [] } });
    const r = await run(createRouteHandlers(broken.site), call({ op: 'describe' }));
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('invalid_schema');

    const { site, key } = await setup({
      revalidate: () => {
        throw new Error('no next here');
      },
    });
    const res = await run(createRouteHandlers(site), call({ op: 'publish', input: { changes: [change('en.title', 'Still fine')] } }, bearer(key({ write: true }).key)));
    expect(res.status).toBe(200);
  });
});
