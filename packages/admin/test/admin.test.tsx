// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MostoAdmin } from '../src/index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const schemaFields = [
  { key: 'home', type: 'single', label: { en: 'Home page', it: 'Pagina iniziale' }, idField: 'id', file: 'content/home.json', fields: [
    { path: 'en.title', kind: 'text', label: { en: 'Headline', it: 'Titolo' }, maxLength: 40 },
    { path: 'it.title', kind: 'text', label: { en: 'Headline', it: 'Titolo' } },
  ] },
];
const describeResult = {
  site: { name: 'Trattoria' },
  locales: ['en', 'it'],
  defaultLocale: 'en',
  capabilities: { history: true, revert: true, uploadAsset: true },
  media: { publicPath: '/media', maxBytes: 1000, accept: ['image/png'] },
  access: { write: true, collections: 'all', actor: 'human' },
};

type Call = { url: string; body: { op?: string; input?: Record<string, unknown>; email?: string } };
let calls: Call[] = [];
let respond: (c: Call) => { status: number; body: unknown } | undefined;

const ok = (result: unknown) => ({ status: 200, body: { ok: true, protocol: 'mosto-cms/1', result } });
const fail = (status: number, code: string, details = {}) => ({ status, body: { ok: false, protocol: 'mosto-cms/1', error: { code, message: code, details } } });

function defaults(c: Call) {
  if (c.body.op === 'describe') return ok(describeResult);
  if (c.body.op === 'listEditableFields') return ok(schemaFields);
  if (c.body.op === 'listEntries') return ok([{ id: 'home', title: 'home' }]);
  if (c.body.op === 'getField') return ok({ revision: 'r1', fields: { 'en.title': 'Hello', 'it.title': 'Ciao' } });
  if (c.body.op === 'publish') return ok({ published: true, revision: 'r2', files: ['content/home.json'] });
  if (c.body.op === 'history') return ok({ entries: [{ revision: 'abc', parent: 'p', message: 'Headline (EN)', author: { name: 'Anna' }, date: new Date().toISOString(), files: ['content/home.json'] }] });
  return ok({});
}

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  calls = [];
  respond = () => undefined;
  window.location.hash = '#forms'; // visual mode would load an iframe, which happy-dom does not
  window.localStorage.clear();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const c: Call = { url, body: init?.body ? JSON.parse(String(init.body)) : {} };
    calls.push(c);
    const r = respond(c) ?? defaults(c);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
});
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const byText = (sel: string, text: string | RegExp) =>
  [...document.querySelectorAll<HTMLElement>(sel)].find((e) => (typeof text === 'string' ? e.textContent?.includes(text) : text.test(e.textContent ?? '')));
async function click(el: Element | null | undefined) {
  if (!el) throw new Error('element not found');
  await act(async () => (el as HTMLElement).click());
  await flush();
}
async function type(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('input not found');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function render(props: Parameters<typeof MostoAdmin>[0]) {
  await act(async () => root.render(<MostoAdmin language="en" {...props} />));
  await flush();
}
const ops = () => calls.map((c) => c.body.op ?? c.url);

describe('sign-in', () => {
  it('explains a wrong password and a lockout, then signs in', async () => {
    await render({ siteName: 'Trattoria' });
    expect(byText('h1', 'Sign in')).toBeTruthy();
    const form = $<HTMLFormElement>('form')!;
    expect(form.getAttribute('action')).toBe('/api/mosto-cms/login');
    await type($('input[type=email]'), 'anna@example.com');
    await type($('input[autocomplete=current-password]'), 'nope');

    respond = (c) => (c.url.endsWith('/login') ? fail(401, 'unauthorized') : undefined);
    await act(async () => form.requestSubmit());
    await flush();
    expect($('[role=alert]')?.textContent).toBe('Wrong email or password.');

    respond = (c) => (c.url.endsWith('/login') ? fail(429, 'unauthorized', { reason: 'locked', retryAfterSeconds: 600 }) : undefined);
    await type($('input[autocomplete=current-password]'), 'nope again');
    await act(async () => form.requestSubmit());
    await flush();
    expect($('[role=alert]')?.textContent).toBe('Too many attempts. Wait 10 minutes and try again.');

    respond = (c) => (c.url.endsWith('/login') ? ok({ editor: { email: 'anna@example.com', name: 'Anna' } }) : undefined);
    await type($('input[autocomplete=current-password]'), 'right one');
    await act(async () => form.requestSubmit());
    await flush();
    expect($('.mc-brand-name')?.textContent).toBe('Trattoria');
    expect(calls.find((c) => c.url.endsWith('/login'))?.body).toMatchObject({ email: 'anna@example.com' });
  });

  it('speaks Italian when asked', async () => {
    await render({ siteName: 'Trattoria', language: 'it' });
    expect(byText('h1', 'Accedi')).toBeTruthy();
  });
});

describe('workspace', () => {
  const editor = { email: 'anna@example.com', name: 'Anna' };

  async function openForms() {
    window.location.hash = '#forms';
    await render({ editor });
    await click(byText('.mc-nav-item', 'Home page'));
    expect(byText('.mc-page-title', 'Home page')).toBeTruthy();
  }

  it('edits in forms mode with languages side by side and publishes with before values', async () => {
    await openForms();
    const inputs = document.querySelectorAll<HTMLInputElement>('.mc-content input');
    expect([...inputs].map((i) => i.value)).toEqual(['Hello', 'Ciao']);
    expect([...document.querySelectorAll('.mc-locale')].map((e) => e.textContent)).toEqual(['EN', 'IT']);
    await type(inputs[0]!, 'Hello there');
    expect(byText('.mc-pending', '1 unpublished change')).toBeTruthy();
    await click($('[data-testid=mc-publish]'));
    const pub = calls.find((c) => c.body.op === 'publish')!;
    expect(pub.body.input).toEqual({
      message: 'Headline (EN)',
      changes: [{ collection: 'home', id: 'home', path: 'en.title', value: 'Hello there', before: 'Hello' }],
    });
    expect($('.mc-toast')?.textContent).toBe('Published. Your site updates in a few seconds.');
    expect($('.mc-pending')).toBeNull();
  });

  it('warns before publishing a value the server would refuse', async () => {
    await openForms();
    await type(document.querySelector<HTMLInputElement>('.mc-content input'), 'x'.repeat(41));
    expect($('.mc-field-error')?.textContent).toBe('Too long: at most 40 characters.');
    expect($('.mc-count-over')?.textContent).toBe('41 / 40');
  });

  it('explains a conflict and reloads fresh content', async () => {
    await openForms();
    await type(document.querySelector<HTMLInputElement>('.mc-content input'), 'Mine');
    respond = (c) => (c.body.op === 'publish' ? fail(409, 'conflict') : undefined);
    await click($('[data-testid=mc-publish]'));
    expect($('.mc-notice')?.textContent).toContain('Someone else changed this while you were editing');
    const before = calls.filter((c) => c.body.op === 'getField').length;
    respond = () => undefined;
    await click(byText('.mc-notice button', 'Reload'));
    expect(calls.filter((c) => c.body.op === 'getField').length).toBeGreaterThan(before);
    expect($('.mc-pending')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('.mc-content input')?.value).toBe('Hello');
  });

  it('goes back to sign-in when the session has ended', async () => {
    respond = (c) => (c.body.op === 'describe' ? fail(401, 'unauthorized') : undefined);
    await render({ editor });
    expect($('[role=alert]')?.textContent).toBe('Your session has ended. Please sign in again.');
  });

  it('undoes from history, asking again when it was changed afterwards', async () => {
    window.location.hash = '#history';
    await render({ editor });
    expect(byText('.mc-event-title', 'Headline (EN)')).toBeTruthy();
    expect(byText('.mc-event-meta', 'Changed: Home page')).toBeTruthy();
    await click(byText('.mc-event button', 'Undo'));
    respond = (c) => (c.body.op === 'revert' && !c.body.input?.force ? fail(409, 'conflict') : undefined);
    await click(byText('.mc-event-confirm button', 'Yes, undo'));
    expect($('.mc-event-confirm')?.textContent).toContain('changed again afterwards');
    await click(byText('.mc-event-confirm button', 'Yes, undo'));
    expect(calls.filter((c) => c.body.op === 'revert').map((c) => c.body.input)).toEqual([{ revision: 'abc' }, { revision: 'abc', force: true }]);
    expect($('.mc-toast')?.textContent).toBe('Undone. Your site updates in a few seconds.');
  });

  it('switches the interface language from the account menu and remembers it', async () => {
    await render({ editor });
    await click($('.mc-avatar'));
    expect(byText('.mc-menu', 'Powered by Mosto CMS')).toBeTruthy();
    await click(byText('.mc-menu button', 'Italiano'));
    expect(byText('.mc-tab', 'Tutti i contenuti')).toBeTruthy();
    expect(window.localStorage.getItem('mosto-cms-admin-language')).toBe('it');
    expect(ops()).toContain('describe');
  });

  it('can hide the Powered by link', async () => {
    await render({ editor, poweredBy: false });
    await click($('.mc-avatar'));
    expect(byText('.mc-menu', 'Powered by')).toBeUndefined();
  });
});
