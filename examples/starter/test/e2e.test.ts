/**
 * End to end on the built starter over plain HTTP: a real `next start`, the
 * file-system adapter (git mode) on a temporary copy of content/.
 *
 * Proves: sign-in → describe / listEditableFields → previewChange → publish
 * writes the JSON file → the page shows the new value after on-demand
 * revalidation, plus the fence, conflicts, uploads through the media route,
 * history and connector key scopes. The admin UI in a browser is covered by
 * admin.e2e.test.ts.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConnectorKey } from '@mosto-cms/auth';

import { EDITOR, eventually, startStarter, type StarterServer } from './server';

const PASSWORD = EDITOR.password;
let srv: StarterServer;
let base = '';
let contentRoot = '';
let keys: Record<'write' | 'readOnly' | 'ai' | 'revoked', ReturnType<typeof createConnectorKey>>;

async function api(body: unknown, headers: Record<string, string> = {}, path = '/api/mosto-cms') {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), res };
}

async function page(path = '/'): Promise<string> {
  return (await fetch(`${base}${path}`)).text();
}

beforeAll(async () => {
  // Keys are signed with the site secret; the revoked one is listed in the env.
  const secret = `e2e-keys-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const revoked = createConnectorKey({ secret, write: true });
  srv = await startStarter({ MOSTO_CMS_SECRET: secret, MOSTO_CMS_REVOKED_KEYS: revoked.kid });
  base = srv.base;
  contentRoot = srv.contentRoot;
  keys = {
    write: createConnectorKey({ secret, write: true, label: 'Platform' }),
    readOnly: createConnectorKey({ secret }),
    ai: createConnectorKey({ secret, write: true, actor: 'ai' }),
    revoked,
  };
});

afterAll(async () => {
  await srv?.stop();
});

describe('starter, end to end', () => {
  let cookie = '';

  it('serves the page and refuses anonymous protocol calls', async () => {
    expect(await page()).toContain('Fresh pasta, made every morning');
    const r = await api({ op: 'describe' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('unauthorized');
  });

  it('signs an editor in (and refuses a wrong password)', async () => {
    const wrong = await api({ email: 'anna@example.com', password: 'not the password' }, {}, '/api/mosto-cms/login');
    expect(wrong.status).toBe(401);
    const ok = await api({ email: 'anna@example.com', password: PASSWORD }, {}, '/api/mosto-cms/login');
    expect(ok.status).toBe(200);
    const setCookie = ok.res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    cookie = setCookie.split(';')[0] as string;
    const admin = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
    // The admin is a client app: the server hands it the signed-in editor only.
    expect(admin).toContain('Anna Rossi');
    expect(admin).toContain('noindex');
  });

  it('describes the site and lists the editable fields', async () => {
    const d = await api({ op: 'describe' }, { cookie });
    expect(d.body.result).toMatchObject({ protocol: 'mosto-cms/1', locales: ['en', 'it'], access: { write: true, actor: 'human' }, capabilities: { history: true, revert: true } });
    const f = await api({ op: 'listEditableFields' }, { cookie });
    expect(f.body.result.map((c: { key: string }) => c.key)).toEqual(['home', 'products']);
  });

  it('previews, refuses the fence and stale writes, then publishes to the file and the page', async () => {
    const title = { collection: 'home', id: 'home', path: 'en.hero.title', value: 'Handmade pasta since 1987' };
    const pv = await api({ op: 'previewChange', input: { changes: [title] } }, { cookie });
    expect(pv.body.result.changes[0]).toMatchObject({ before: 'Fresh pasta, made every morning', after: title.value, changed: true });

    const fence = await api({ op: 'publish', input: { changes: [{ collection: 'home', id: 'home', path: 'layout.theme', value: 'dark' }] } }, { cookie });
    expect(fence.status).toBe(403);
    expect(fence.body.error.code).toBe('field_not_editable');

    const stale = await api({ op: 'publish', input: { changes: [{ ...title, before: 'Someone else saw this' }] } }, { cookie });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('conflict');

    const price = { collection: 'products', id: 'ravioli', path: 'price', value: '€ 15' };
    const pub = await api({ op: 'publish', input: { message: 'New headline and price', changes: [title, price] } }, { cookie });
    expect(pub.status).toBe(200);
    expect(pub.body.result).toMatchObject({ published: true, files: ['content/home.json', 'content/products.json'] });

    const stored = JSON.parse(await readFile(join(contentRoot, 'content/home.json'), 'utf8'));
    expect(stored.en.hero.title).toBe(title.value);
    expect(stored.layout).toEqual({ theme: 'light' });

    await eventually(async () => {
      const html = await page();
      return html.includes('Handmade pasta since 1987') && html.includes('€ 15');
    });
  });

  it('uploads an image, served right away by the media route; SVG is refused', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    const up = await api({ op: 'uploadAsset', input: { filename: 'Pasta Shot.png', contentType: 'image/png', dataBase64: png } }, { cookie });
    expect(up.status).toBe(200);
    expect(up.body.result.path).toMatch(/^\/media\/pasta-shot-[a-z0-9]+\.png$/);
    expect((await readFile(join(contentRoot, up.body.result.file))).length).toBe(8);
    const served = await fetch(`${base}${up.body.result.path}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
    const refused = await api({ op: 'uploadAsset', input: { filename: 'x.svg', contentType: 'image/svg+xml', dataBase64: svg } }, { cookie });
    expect(refused.body.error.code).toBe('unsupported');
  });

  it('lists the history of publishes', async () => {
    const h = await api({ op: 'history', input: { limit: 5 } }, { cookie });
    expect(h.body.result.entries[0]).toMatchObject({ message: 'New headline and price', author: { name: 'Anna Rossi' } });
    expect(h.body.result.entries.at(-1).message).toBe('Initial content');
  });

  it('enforces connector key scopes and revocation', async () => {
    const auth = (k: { key: string }) => ({ authorization: `Bearer ${k.key}` });
    const d = await api({ op: 'describe' }, auth(keys.write));
    expect(d.body.result.access).toEqual({ write: true, collections: 'all', actor: 'human' });

    const change = { collection: 'products', id: 'tagliatelle', path: 'price', value: '€ 16' };
    const ro = await api({ op: 'publish', input: { changes: [change] } }, auth(keys.readOnly));
    expect(ro.body.error.code).toBe('forbidden');

    const ai = await api({ op: 'publish', input: { changes: [change] } }, auth(keys.ai));
    expect(ai.body.error).toMatchObject({ code: 'field_not_editable', details: { reason: 'ai_locked' } });

    const revoked = await api({ op: 'describe' }, auth(keys.revoked));
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.details.reason).toBe('revoked');

    const ok = await api({ op: 'publish', input: { changes: [change] } }, auth(keys.write));
    expect(ok.body.result.published).toBe(true);
    await eventually(async () => (await page()).includes('€ 16'));
  });

  it('signs out', async () => {
    const out = await api({}, { cookie }, '/api/mosto-cms/logout');
    expect(out.res.headers.get('set-cookie')).toContain('Max-Age=0');
    const after = await api({ op: 'describe' }, {});
    expect(after.status).toBe(401);
  });
});
