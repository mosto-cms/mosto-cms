/**
 * End to end on the built starter: a real `next start`, the file-system
 * adapter on a temporary copy of content/, and plain HTTP calls.
 *
 * Proves: sign-in → describe / listEditableFields → previewChange → publish
 * writes the JSON file → the page shows the new value after on-demand
 * revalidation, plus the fence, conflicts and connector key scopes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConnectorKey, hashPassword } from '@mosto-cms/auth';

const starter = join(dirname(fileURLToPath(import.meta.url)), '..');
const secret = `e2e-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const PASSWORD = 'correct horse battery';

let server: ChildProcess;
let base = '';
let contentRoot = '';
let log = '';

const keys = {
  write: createConnectorKey({ secret, write: true, label: 'Platform' }),
  readOnly: createConnectorKey({ secret }),
  ai: createConnectorKey({ secret, write: true, actor: 'ai' }),
  revoked: createConnectorKey({ secret, write: true }),
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (server.exitCode !== null) throw new Error(`next start exited:\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start:\n${log}`);
}

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

async function eventually(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('condition not met in time');
}

beforeAll(async () => {
  contentRoot = await mkdtemp(join(tmpdir(), 'mosto-cms-starter-'));
  await cp(join(starter, 'content'), join(contentRoot, 'content'), { recursive: true });
  const passwordHash = await hashPassword(PASSWORD, { logN: 10 });
  const port = await freePort();
  base = `http://localhost:${port}`;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('MOSTO_CMS_')) env[k] = v;
  Object.assign(env, {
    NODE_ENV: 'production',
    MOSTO_CMS_SECRET: secret,
    MOSTO_CMS_EDITORS: JSON.stringify([{ email: 'anna@example.com', name: 'Anna', passwordHash }]),
    MOSTO_CMS_REVOKED_KEYS: keys.revoked.kid,
    MOSTO_CMS_CONTENT_ROOT: contentRoot,
  });
  const nextBin = createRequire(join(starter, 'package.json')).resolve('next/dist/bin/next');
  server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], { cwd: starter, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout?.on('data', (d) => (log += d));
  server.stderr?.on('data', (d) => (log += d));
  await waitForServer(`${base}/api/mosto-cms`);
});

afterAll(async () => {
  server?.kill('SIGTERM');
  if (contentRoot) await rm(contentRoot, { recursive: true, force: true });
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
    expect(admin).toContain('Signed in as');
    expect(admin).toContain('Anna');
  });

  it('describes the site and lists the editable fields', async () => {
    const d = await api({ op: 'describe' }, { cookie });
    expect(d.body.result).toMatchObject({ protocol: 'mosto-cms/1', locales: ['en'], access: { write: true, actor: 'human' } });
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

  it('uploads an image into the media directory', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    const up = await api({ op: 'uploadAsset', input: { filename: 'Pasta Shot.png', contentType: 'image/png', dataBase64: png } }, { cookie });
    expect(up.status).toBe(200);
    expect(up.body.result.path).toMatch(/^\/uploads\/pasta-shot-[a-z0-9]+\.png$/);
    expect((await readFile(join(contentRoot, up.body.result.file))).length).toBe(8);
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
