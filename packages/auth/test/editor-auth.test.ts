import { describe, expect, it } from 'vitest';

import {
  createEditorAuth,
  createMemoryRateLimitStore,
  createRateLimiter,
  hashPassword,
  isAllowedOrigin,
  safeRedirectPath,
  type Editor,
} from '../src/index.js';

const secret = 'a-test-site-secret-that-is-long-enough-1234';
const SITE = 'https://site.example';

async function setup(opts: { maxPerEmail?: number } = {}) {
  let clock = 1_800_000_000_000;
  const editors: Editor[] = [{ email: 'anna@example.com', name: 'Anna', passwordHash: await hashPassword('correct horse battery', { logN: 10 }) }];
  const auth = createEditorAuth({
    secret,
    editors,
    now: () => clock,
    rateLimit: { maxPerEmail: opts.maxPerEmail ?? 3, maxPerIp: 50, windowSeconds: 60 },
  });
  return { auth, editors, advance: (ms: number) => (clock += ms) };
}

function jsonLogin(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${SITE}/api/mosto-cms/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  });
}

function formLogin(fields: Record<string, string>) {
  return new Request(`${SITE}/api/mosto-cms/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: SITE },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('editor sign-in', () => {
  it('signs in with JSON and sets a secure session cookie', async () => {
    const { auth } = await setup();
    const res = await auth.handleLogin(jsonLogin({ email: 'Anna@example.com', password: 'correct horse battery' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.editor).toEqual({ email: 'anna@example.com', name: 'Anna' });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^__Host-mosto-cms-session=mcs1\./);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');

    const token = cookie.split(';')[0] as string;
    const session = auth.getSession(new Request(`${SITE}/admin`, { headers: { cookie: token } }));
    expect(session?.email).toBe('anna@example.com');
    const sres = await auth.handleSession(new Request(`${SITE}/api/mosto-cms/session`, { headers: { cookie: token } })).json();
    expect(sres.result.editor.name).toBe('Anna');
  });

  it('refuses a wrong password or an unknown email with the same answer', async () => {
    const { auth } = await setup();
    const a = await auth.handleLogin(jsonLogin({ email: 'anna@example.com', password: 'wrong password!' }));
    const b = await auth.handleLogin(jsonLogin({ email: 'nobody@example.com', password: 'wrong password!' }));
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect((await a.json()).error).toEqual((await b.json()).error);
    expect(a.headers.get('set-cookie')).toBeNull();
  });

  it('locks an email after too many failures, even for the right password, until the window ends', async () => {
    const { auth, advance } = await setup({ maxPerEmail: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await auth.handleLogin(jsonLogin({ email: 'anna@example.com', password: `wrong ${i} attempt` }))).status).toBe(401);
    }
    const locked = await auth.handleLogin(jsonLogin({ email: 'anna@example.com', password: 'correct horse battery' }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await locked.json()).error.details.reason).toBe('locked');
    advance(61_000);
    expect((await auth.handleLogin(jsonLogin({ email: 'anna@example.com', password: 'correct horse battery' }))).status).toBe(200);
  });

  it('signs in with a form and redirects to a same-site path only', async () => {
    const { auth } = await setup();
    const ok = await auth.handleLogin(formLogin({ email: 'anna@example.com', password: 'correct horse battery', next: '/admin/edit' }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/admin/edit');
    expect(ok.headers.get('set-cookie')).toContain('__Host-mosto-cms-session=');
    const evil = await auth.handleLogin(formLogin({ email: 'anna@example.com', password: 'correct horse battery', next: '//evil.example/x' }));
    expect(evil.headers.get('location')).toBe('/admin');
    const bad = await auth.handleLogin(formLogin({ email: 'anna@example.com', password: 'nope nope nope', back: '/admin' }));
    expect(bad.headers.get('location')).toBe('/admin?error=invalid');
  });

  it('refuses cross-site sign-in and bad bodies', async () => {
    const { auth } = await setup();
    const res = await auth.handleLogin(jsonLogin({ email: 'anna@example.com', password: 'correct horse battery' }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    const bad = await auth.handleLogin(new Request(`${SITE}/api/mosto-cms/login`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }));
    expect(bad.status).toBe(400);
    const get = await auth.handleLogin(new Request(`${SITE}/api/mosto-cms/login`));
    expect(get.status).toBe(405);
  });

  it('signs out by clearing the cookie', async () => {
    const { auth } = await setup();
    const res = await auth.handleLogout(new Request(`${SITE}/api/mosto-cms/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    const form = await auth.handleLogout(formLogin({ next: '/' }));
    expect(form.status).toBe(303);
    expect(form.headers.get('location')).toBe('/');
  });

  it('uses a plain cookie name on http://localhost', async () => {
    const { auth } = await setup();
    const res = await auth.handleLogin(
      new Request('http://localhost:3000/api/mosto-cms/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'anna@example.com', password: 'correct horse battery' }),
      }),
    );
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie.startsWith('mosto-cms-session=')).toBe(true);
    expect(cookie).not.toContain('Secure');
  });
});

describe('helpers', () => {
  it('only allows same-site redirect paths', () => {
    expect(safeRedirectPath('/admin?x=1', '/f')).toBe('/admin?x=1');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'admin', '/a\nb', 42]) {
      expect(safeRedirectPath(bad, '/f')).toBe('/f');
    }
  });

  it('checks the Origin header against the site and allowed origins', () => {
    const req = (origin?: string) => new Request(`${SITE}/x`, { headers: origin ? { origin } : {} });
    expect(isAllowedOrigin(req())).toBe(true);
    expect(isAllowedOrigin(req(SITE))).toBe(true);
    expect(isAllowedOrigin(req('https://evil.example'))).toBe(false);
    expect(isAllowedOrigin(req('null'))).toBe(false);
    expect(isAllowedOrigin(req('https://studio.example'), ['https://studio.example/'])).toBe(true);
  });

  it('rate limits per IP too, and the memory store forgets expired windows', async () => {
    let t = 0;
    const store = createMemoryRateLimitStore(() => t, 3);
    const limiter = createRateLimiter({ maxPerEmail: 100, maxPerIp: 2, windowSeconds: 10, store }, () => t);
    await limiter.failure('a@x.io', '1.1.1.1');
    await limiter.failure('b@x.io', '1.1.1.1');
    expect((await limiter.check('c@x.io', '1.1.1.1')).locked).toBe(true);
    expect((await limiter.check('c@x.io', '2.2.2.2')).locked).toBe(false);
    t = 11_000;
    expect((await limiter.check('c@x.io', '1.1.1.1')).locked).toBe(false);
    for (let i = 0; i < 10; i++) await store.increment(`k${i}`, 1000);
    expect(await store.get('k9')).not.toBeNull();
  });
});
