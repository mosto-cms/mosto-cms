// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanMediaSrc, initMostoOverlay, MESSAGE_VERSION } from '../src/index.js';

const SITE = window.location.origin;

type Fake = { win: Window; parent: { postMessage: ReturnType<typeof vi.fn> }; stop: () => void };
let current: Fake | null = null;

/** A page at `url` framed by a fake parent window whose postMessage we record. */
function framed(html: string, url = `${SITE}/?mostoEdit=1`, allowedOrigins?: string[]): Fake {
  window.history.replaceState(null, '', url.replace(SITE, ''));
  document.body.innerHTML = html;
  const parent = { postMessage: vi.fn() };
  const win = new Proxy(window, {
    get(target, prop) {
      if (prop === 'parent') return parent;
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as Window;
  const stop = initMostoOverlay({ window: win, ...(allowedOrigins ? { allowedOrigins } : {}) });
  current = { win, parent, stop };
  return current;
}

function send(f: Fake, data: unknown, origin = SITE, source: unknown = f.parent) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as MessageEventSource }));
}

type Sent = { type?: string; to: string; [k: string]: unknown };
const sent = (f: Fake): Sent[] => f.parent.postMessage.mock.calls.map(([m, o]) => ({ ...(m as object), to: o as string }) as Sent);

afterEach(() => {
  current?.stop();
  current = null;
  document.body.innerHTML = '';
});

describe('activation', () => {
  it('stays inert without ?mostoEdit=1 or outside a frame', () => {
    window.history.replaceState(null, '', '/');
    const parent = { postMessage: vi.fn() };
    const win = new Proxy(window, { get: (t, p) => (p === 'parent' ? parent : Reflect.get(t, p, t)) }) as Window;
    initMostoOverlay({ window: win })();
    expect(parent.postMessage).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/?mostoEdit=1');
    initMostoOverlay({ window })(); // window.parent === window
    expect(document.getElementById('mosto-cms-overlay-style')).toBeNull();
  });

  it('announces itself only to allowed origins, never "*"', () => {
    const f = framed('<h1 data-mosto-field="home:home:en.title">Hi</h1>', undefined, ['https://studio.example/x', 'javascript:x']);
    const targets = sent(f).map((m) => m.to);
    expect(targets).toEqual([SITE, 'https://studio.example']);
    expect(sent(f)[0]).toMatchObject({ type: 'mosto:overlay-loaded', v: MESSAGE_VERSION });
  });

  it('does nothing until the handshake, then answers ready to that exact origin', () => {
    const f = framed('<h1 data-mosto-field="home:home:en.title">Hi</h1><p data-mosto-field="bad">x</p>');
    document.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(sent(f).filter((m) => m.type === 'mosto:select')).toHaveLength(0);
    expect(document.getElementById('mosto-cms-overlay-style')).toBeNull();

    send(f, { type: 'mosto:init', v: 1 });
    expect(sent(f).at(-1)).toEqual({ type: 'mosto:ready', v: 1, fields: 2, url: '/', to: SITE });
    expect(document.getElementById('mosto-cms-overlay-style')).not.toBeNull();
    expect(document.querySelector('h1')!.getAttribute('tabindex')).toBe('0');
  });
});

describe('origin checks', () => {
  it('ignores init from an unknown origin or another window', () => {
    const f = framed('<h1 data-mosto-field="home:home:en.title">Hi</h1>');
    send(f, { type: 'mosto:init', v: 1 }, 'https://evil.example');
    send(f, { type: 'mosto:init', v: 1 }, SITE, { postMessage() {} });
    send(f, { type: 'mosto:init', v: 2 });
    expect(sent(f).filter((m) => m.type === 'mosto:ready')).toHaveLength(0);
  });

  it('after the handshake, ignores other allowed origins too', () => {
    const f = framed('<h1 data-mosto-field="home:home:en.title">Hi</h1>', undefined, ['https://studio.example']);
    send(f, { type: 'mosto:init', v: 1 }, 'https://studio.example');
    const field = { collection: 'home', id: 'home', path: 'en.title', kind: 'text' };
    send(f, { type: 'mosto:set', v: 1, field, value: 'Hacked' }, SITE);
    expect(document.querySelector('h1')!.textContent).toBe('Hi');
    send(f, { type: 'mosto:set', v: 1, field, value: 'Hello' }, 'https://studio.example');
    expect(document.querySelector('h1')!.textContent).toBe('Hello');
    expect(sent(f).filter((m) => m.type !== 'mosto:overlay-loaded').every((m) => m.to === 'https://studio.example')).toBe(true);
  });
});

describe('selection and updates', () => {
  it('selects the clicked field with its value and kind', () => {
    const f = framed(`
      <h1 data-mosto-field="home:home:en.hero.title"><span>Fresh pasta</span></h1>
      <img data-mosto-field="home:home:hero.image" src="/_next/image?url=%2Fhero.jpg&w=1080&q=75" srcset="/_next/image?url=%2Fhero.jpg&w=640 1x">
      <a data-mosto-field="home:home:cta.url" data-mosto-kind="url" href="/book">Book</a>`);
    send(f, { type: 'mosto:init', v: 1 });
    document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sent(f).at(-1)).toMatchObject({
      type: 'mosto:select',
      field: { collection: 'home', id: 'home', path: 'en.hero.title', kind: 'text' },
      value: 'Fresh pasta',
    });
    document.querySelector('img')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(sent(f).at(-1)).toMatchObject({ field: { path: 'hero.image', kind: 'image' }, value: '/hero.jpg' });
    expect(document.querySelector('img')!.classList.contains('mosto-cms-active')).toBe(true);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('a')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(sent(f).at(-1)).toMatchObject({ field: { path: 'cta.url', kind: 'url' }, value: '/book' });
  });

  it('selects with the keyboard', () => {
    const f = framed('<h1 data-mosto-field="home:home:en.title">Hi</h1>');
    send(f, { type: 'mosto:init', v: 1 });
    const h1 = document.querySelector('h1') as HTMLElement;
    h1.focus();
    h1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sent(f).at(-1)).toMatchObject({ type: 'mosto:select', field: { path: 'en.title' } });
  });

  it('per-index gallery: a click hits the visible frame, not the top-most hidden one', () => {
    const f = framed(`
      <div class="carousel">
        <img id="f0" data-mosto-field="fleet:libeccio:gallery.0" src="/a.jpg" style="opacity:0">
        <img id="f1" data-mosto-field="fleet:libeccio:gallery.1" src="/b.jpg">
        <img id="f2" data-mosto-field="fleet:libeccio:gallery.2" src="/c.jpg" style="opacity:0">
        <button id="next">›</button>
      </div>`);
    send(f, { type: 'mosto:init', v: 1 });
    const $ = (id: string) => document.getElementById(id)!;
    const stack = vi.fn();
    Object.defineProperty(document, 'elementsFromPoint', { value: stack, configurable: true });

    stack.mockReturnValue([$('f2'), $('f1'), $('f0')]);
    $('f2').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(sent(f).at(-1)).toMatchObject({ field: { path: 'gallery.1', kind: 'image' }, value: '/b.jpg' });

    // Mid-fade, the frame more visible wins.
    $('f2').style.opacity = '0.3';
    $('f1').style.opacity = '0.7';
    stack.mockReturnValue([$('f2'), $('f1'), $('f0')]);
    $('f2').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    expect(sent(f).at(-1)).toMatchObject({ field: { path: 'gallery.1' } });

    // A control on top of the gallery keeps working: nothing is selected.
    const before = sent(f).length;
    stack.mockReturnValue([$('next'), $('f2'), $('f1')]);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
    $('next').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(sent(f)).toHaveLength(before);
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
  });

  it('applies mosto:set in place: text, image (dropping srcset), video, whole lists', () => {
    const f = framed(`
      <h1 data-mosto-field="home:home:en.title">Old</h1>
      <h2 data-mosto-field="home:home:en.title">Old twin</h2>
      <img data-mosto-field="home:home:hero.image" src="/old.jpg" srcset="/old.jpg 1x">
      <video data-mosto-field="home:home:hero.video"><source src="/old.mp4"></video>
      <img data-mosto-field="fleet:x:gallery.0" src="/0.jpg"><img data-mosto-field="fleet:x:gallery.1" src="/1.jpg">`);
    send(f, { type: 'mosto:init', v: 1 });
    const set = (path: string, kind: string, value: unknown, collection = 'home', id = 'home') =>
      send(f, { type: 'mosto:set', v: 1, field: { collection, id, path, kind }, value });
    set('en.title', 'text', 'New <b>title</b>');
    expect(document.querySelector('h1')!.textContent).toBe('New <b>title</b>');
    expect(document.querySelector('h1 b')).toBeNull();
    expect(document.querySelector('h2')!.textContent).toBe('New <b>title</b>');
    set('hero.image', 'image', '/uploads/new.webp');
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/uploads/new.webp');
    expect(img.hasAttribute('srcset')).toBe(false);
    set('hero.video', 'video', '/uploads/new.mp4');
    expect(document.querySelector('source')!.getAttribute('src')).toBe('/uploads/new.mp4');
    set('gallery', 'imageList', ['/n0.jpg', '/n1.jpg'], 'fleet', 'x');
    expect([...document.querySelectorAll('[data-mosto-field^="fleet"]')].map((e) => e.getAttribute('src'))).toEqual(['/n0.jpg', '/n1.jpg']);
  });

  it('cleans up everything it added', () => {
    const f = framed('<h1 data-mosto-field="home:home:en.title">Hi</h1>');
    send(f, { type: 'mosto:init', v: 1 });
    f.stop();
    current = null;
    expect(document.getElementById('mosto-cms-overlay-style')).toBeNull();
    expect(document.querySelector('h1')!.hasAttribute('tabindex')).toBe(false);
  });
});

describe('cleanMediaSrc', () => {
  it('unwraps image optimizer URLs', () => {
    expect(cleanMediaSrc('/_next/image?url=%2Ffleet%2Fa%20b.jpg&w=1920&q=75')).toBe('/fleet/a b.jpg');
    expect(cleanMediaSrc('https://site.example/_next/image?url=https%3A%2F%2Fcdn.example%2Fx.png&w=64')).toBe('https://cdn.example/x.png');
    expect(cleanMediaSrc('/_vercel/image?url=%2Fx.jpg&w=640')).toBe('/x.jpg');
    expect(cleanMediaSrc('/.netlify/images?url=%2Fy.jpg')).toBe('/y.jpg');
    expect(cleanMediaSrc('/plain.jpg')).toBe('/plain.jpg');
    expect(cleanMediaSrc(null)).toBe('');
  });
});
