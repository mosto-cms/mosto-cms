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

describe('modes: Edit and Browse', () => {
  const click = (el: Element, init: MouseEventInit = {}) => {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    return e;
  };

  it('starts in Edit: links do not navigate, the page is marked for editing', () => {
    const f = framed('<a id="l" href="/it/tours">Tours</a><h1 data-mosto-field="home:home:it.title">Ciao</h1>');
    send(f, { type: 'mosto:init', v: 1 });
    expect(document.documentElement.classList.contains('mosto-cms-edit')).toBe(true);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    expect(click(document.getElementById('l')!).defaultPrevented).toBe(true);
    expect(assign).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it('Browse leaves the page alone and keeps the editor on the next page', () => {
    const f = framed('<a id="l" href="/it/tours">Tours</a><h1 data-mosto-field="home:home:it.title">Ciao</h1>');
    send(f, { type: 'mosto:init', v: 1, mode: 'browse' });
    expect(document.documentElement.classList.contains('mosto-cms-edit')).toBe(false);
    expect(document.querySelector('h1')!.hasAttribute('tabindex')).toBe(false);
    const before = sent(f).length;
    expect(click(document.querySelector('h1')!).defaultPrevented).toBe(false);
    expect(sent(f)).toHaveLength(before);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    click(document.getElementById('l')!);
    expect(assign).toHaveBeenCalledWith(`${SITE}/it/tours?mostoEdit=1`);
    assign.mockRestore();
  });

  it('switches when the admin says so; E on the page asks the admin', () => {
    const f = framed('<h1 data-mosto-field="home:home:it.title">Ciao</h1>');
    send(f, { type: 'mosto:init', v: 1 });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }));
    expect(sent(f).at(-1)).toMatchObject({ type: 'mosto:mode', mode: 'browse' });
    expect(document.documentElement.classList.contains('mosto-cms-edit')).toBe(true); // the admin decides
    send(f, { type: 'mosto:mode', v: 1, mode: 'browse' });
    expect(document.documentElement.classList.contains('mosto-cms-edit')).toBe(false);
    send(f, { type: 'mosto:mode', v: 1, mode: 'edit' });
    expect(document.documentElement.classList.contains('mosto-cms-edit')).toBe(true);
    send(f, { type: 'mosto:mode', v: 1, mode: 'fly' });
    expect(document.documentElement.classList.contains('mosto-cms-edit')).toBe(true);
  });

  it('hover shows the field name, or "Not editable" on content that is not a field', () => {
    const f = framed('<h2 id="t">Le Esperienze <span data-mosto-field="content:home:it.tours.titleAccent">in mare</span></h2><p id="p">Fixed text</p>');
    send(f, { type: 'mosto:init', v: 1, locale: 'it', labels: { 'content:it.tours.titleAccent': 'IT · tours › titleAccent' } });
    const chip = document.getElementById('mosto-cms-chip')!;
    document.querySelector('span')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(chip.style.display).toBe('block');
    expect(chip.textContent).toBe('IT · tours › titleAccent');
    expect(document.querySelector('span')!.classList.contains('mosto-cms-hover')).toBe(true);
    document.getElementById('p')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(chip.textContent).toBe('Non modificabile');
    expect(document.getElementById('p')!.classList.contains('mosto-cms-locked')).toBe(true);
    expect(document.querySelector('span')!.classList.contains('mosto-cms-hover')).toBe(false);
  });

  it('edits a text in place: Enter applies (one mosto:edit), Esc cancels', () => {
    const f = framed('<h2><span id="s" data-mosto-field="content:home:it.tours.title">Le Esperienze</span></h2>');
    send(f, { type: 'mosto:init', v: 1 });
    const s = document.getElementById('s')!;
    click(s);
    expect(sent(f).at(-1)).toMatchObject({ type: 'mosto:select', inline: true, value: 'Le Esperienze' });
    expect(s.getAttribute('contenteditable')).toMatch(/plaintext-only|true/);
    expect(s.classList.contains('mosto-cms-editing')).toBe(true);
    s.textContent = 'Le Esperienze uniche\n';
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(s.hasAttribute('contenteditable')).toBe(false);
    expect(s.textContent).toBe('Le Esperienze uniche');
    expect(sent(f).at(-1)).toEqual({
      type: 'mosto:edit',
      v: 1,
      field: { collection: 'content', id: 'home', path: 'it.tours.title', kind: 'text' },
      value: 'Le Esperienze uniche',
      to: SITE,
    });

    const before = sent(f).length;
    click(s);
    s.textContent = 'Oops';
    s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(s.textContent).toBe('Le Esperienze uniche');
    expect(s.hasAttribute('contenteditable')).toBe(false);
    expect(sent(f).filter((m) => m.type === 'mosto:edit')).toHaveLength(1);
    expect(sent(f).length).toBeGreaterThanOrEqual(before);
  });

  it('blur applies too; an unchanged text sends nothing', () => {
    const f = framed('<p id="p" data-mosto-field="content:home:it.tours.desc" data-mosto-kind="multiline">Uno</p>');
    send(f, { type: 'mosto:init', v: 1 });
    const p = document.getElementById('p')!;
    click(p);
    p.dispatchEvent(new FocusEvent('blur'));
    expect(sent(f).filter((m) => m.type === 'mosto:edit')).toHaveLength(0);
    click(p);
    p.textContent = 'Uno\nDue';
    p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    expect(p.getAttribute('contenteditable')).not.toBeNull(); // Shift+Enter is a new line in a multiline field
    p.dispatchEvent(new FocusEvent('blur'));
    expect(sent(f).at(-1)).toMatchObject({ type: 'mosto:edit', value: 'Uno\nDue', field: { kind: 'multiline' } });
  });

  it('elements holding markup are edited in the panel, not in place', () => {
    const f = framed('<h2 id="h" data-mosto-field="content:home:it.manifesto.titleLine2">La giornata è <span>tua.</span></h2>');
    send(f, { type: 'mosto:init', v: 1 });
    const h = document.getElementById('h')!;
    click(h);
    expect(sent(f).at(-1)).toMatchObject({ type: 'mosto:select', inline: false });
    expect(h.hasAttribute('contenteditable')).toBe(false);
  });

  it('Esc clears the selection and tells the admin', () => {
    const f = framed('<img id="i" data-mosto-field="tours:capri:image" src="/a.jpg">');
    send(f, { type: 'mosto:init', v: 1 });
    click(document.getElementById('i')!);
    expect(document.getElementById('i')!.classList.contains('mosto-cms-active')).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.getElementById('i')!.classList.contains('mosto-cms-active')).toBe(false);
    expect(sent(f).at(-1)).toMatchObject({ type: 'mosto:deselect' });
  });
});

describe('fieldLabel', () => {
  it('uses the schema label, the list label for an item, else a readable path', async () => {
    const { fieldLabel } = await import('../src/index.js');
    const labels = { 'fleet:gallery': 'Photos', 'content:it.hero.title': 'Hero title' };
    expect(fieldLabel({ collection: 'content', id: 'home', path: 'it.hero.title' }, labels)).toBe('Hero title');
    expect(fieldLabel({ collection: 'fleet', id: 'x', path: 'gallery.2' }, labels)).toBe('Photos · 3');
    expect(fieldLabel({ collection: 'content', id: 'home', path: 'it.tours.titleAccent' })).toBe('tours › title accent');
    expect(fieldLabel({ collection: 'content', id: 'home', path: 'en.tours.list.0.title' })).toBe('list › title');
  });
});
