/**
 * The click-to-edit overlay that runs on the live site.
 *
 * Inert for visitors. It starts only when the page is opened as `?mostoEdit=1`
 * inside a frame, announces itself to the parent, and stays passive until the
 * parent sends `mosto:init` from an allowed origin (by default only the site's
 * own origin, where `/admin` lives). From then on it talks to that exact
 * origin only, never `*`, and ignores messages from any other window.
 */
import { isFieldKind, parseFieldAddress, type FieldKind, type SelectedField } from './field.js';
import { MESSAGE_VERSION, normalizeOrigin, readMessage, type SiteMessage } from './messages.js';

export type OverlayOptions = {
  /**
   * Other admin origins allowed to drive the overlay (for example a connected
   * platform). The site's own origin is always allowed.
   */
  allowedOrigins?: string[];
  /** Outline color of editable elements. */
  accent?: string;
  /** For tests: the window to attach to. */
  window?: Window;
};

const ACTIVE = 'mosto-cms-active';
const REVEAL = 'mosto-cms-reveal';
const STYLE_ID = 'mosto-cms-overlay-style';
const NOOP = () => undefined;

/** Optimizer URLs (`/_next/image?url=…`, Vercel and Netlify image CDNs) → the source path. */
export function cleanMediaSrc(src: string | null | undefined, base = 'http://localhost'): string {
  if (!src) return '';
  if (/\/(_next\/image|_vercel\/image|\.netlify\/images)\?/.test(src)) {
    try {
      const inner = new URL(src, base).searchParams.get('url');
      if (inner) return inner;
    } catch {
      // keep the raw value
    }
  }
  return src;
}

export function inferKind(el: Element): FieldKind {
  const explicit = el.getAttribute('data-mosto-kind');
  if (isFieldKind(explicit)) return explicit;
  if (el.tagName === 'IMG') return 'image';
  if (el.tagName === 'VIDEO') return 'video';
  return 'text';
}

function find<T extends Element>(el: Element, tag: string): T | null {
  return (el.tagName === tag.toUpperCase() ? el : el.querySelector(tag)) as T | null;
}

export function readElementValue(el: Element, kind: FieldKind, base?: string): string {
  if (kind === 'image' || kind === 'imageList') return cleanMediaSrc(find(el, 'img')?.getAttribute('src'), base);
  if (kind === 'video') {
    const v = find(el, 'video');
    return cleanMediaSrc(v?.getAttribute('src') ?? v?.querySelector('source')?.getAttribute('src'), base);
  }
  if (kind === 'url') return (el.tagName === 'A' ? el : el.querySelector('a'))?.getAttribute('href') ?? '';
  if (kind === 'list') return '';
  const html = el as HTMLElement;
  const text = typeof html.innerText === 'string' && html.innerText !== '' ? html.innerText : (el.textContent ?? '');
  return text.trim();
}

export function writeElementValue(el: Element, kind: FieldKind, value: string): void {
  if (kind === 'image' || kind === 'imageList') {
    const img = find<HTMLImageElement>(el, 'img');
    if (!img) return;
    img.setAttribute('src', value);
    // next/image and responsive images keep showing the old picture through srcset.
    img.removeAttribute('srcset');
    img.closest('picture')?.querySelectorAll('source').forEach((s) => s.setAttribute('srcset', value));
    return;
  }
  if (kind === 'video') {
    const video = find<HTMLVideoElement>(el, 'video');
    if (!video) return;
    const source = video.querySelector('source');
    if (source && !video.getAttribute('src')) source.setAttribute('src', value);
    else video.setAttribute('src', value);
    if (typeof video.load === 'function') {
      try {
        video.load();
      } catch {
        // jsdom-like environments
      }
    }
    return;
  }
  if (kind === 'url') {
    (el.tagName === 'A' ? el : el.querySelector('a'))?.setAttribute('href', value);
    return;
  }
  if (kind === 'list') return;
  el.textContent = value;
}

/** How visible an element really is: 0 when hidden, else the product of its and its ancestors' opacity. */
function visibility(win: Window, el: Element): number {
  let alpha = 1;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    const o = Number.parseFloat(cs.opacity);
    if (Number.isFinite(o)) alpha *= o;
    if (alpha === 0) return 0;
  }
  return alpha;
}

function isVisible(win: Window, el: Element): boolean {
  return visibility(win, el) > 0;
}

function annotated(node: EventTarget | Element | null): Element | null {
  return node && typeof (node as Element).closest === 'function' ? (node as Element).closest('[data-mosto-field]') : null;
}

/**
 * The editable element a click is meant for. Walks the elements under the
 * pointer from the top: a non-editable element on top (a carousel arrow)
 * wins and nothing is selected; among stacked editable elements (the frames
 * of a carousel) the most visible one wins, so an invisible frame on top, or
 * one fading out, never steals the click.
 */
export function pickTarget(win: Window, event: MouseEvent): Element | null {
  const doc = win.document;
  const stack =
    typeof doc.elementsFromPoint === 'function' && (event.clientX !== 0 || event.clientY !== 0)
      ? doc.elementsFromPoint(event.clientX, event.clientY)
      : [];
  let best: Element | null = null;
  let bestAlpha = 0;
  for (const node of stack) {
    const el = annotated(node);
    if (!el) break;
    const alpha = visibility(win, el);
    if (alpha > bestAlpha + 0.01) {
      best = el;
      bestAlpha = alpha;
    }
  }
  if (best || stack.length > 0) return best;
  const el = annotated(event.target);
  return el && isVisible(win, el) ? el : null;
}

function css(accent: string): string {
  const ring = `outline:2px solid ${accent};outline-offset:3px;box-shadow:0 0 0 5px rgba(255,255,255,.7)`;
  return [
    `[data-mosto-field]{cursor:pointer;outline:1px dashed transparent;outline-offset:3px;transition:outline-color .15s,box-shadow .15s}`,
    `[data-mosto-field]:hover,[data-mosto-field]:focus-visible{${ring}}`,
    `[data-mosto-field].${ACTIVE}{${ring}}`,
    `html.${REVEAL} [data-mosto-field]{outline:1px dashed ${accent}}`,
    `@media (prefers-reduced-motion:reduce){[data-mosto-field]{transition:none}}`,
  ].join('\n');
}

/**
 * Start the overlay. Returns a function that removes everything it added.
 * Safe to call on every page: it returns at once unless the page is
 * `?mostoEdit=1` inside a frame.
 */
export function initMostoOverlay(options: OverlayOptions = {}): () => void {
  const win = options.window ?? (typeof window === 'undefined' ? undefined : window);
  if (!win || !win.document) return NOOP;
  if (new URLSearchParams(win.location.search).get('mostoEdit') !== '1') return NOOP;
  if (win.parent === win) return NOOP;

  const doc = win.document;
  const own = win.location.origin;
  const allowed = new Set<string>([own]);
  for (const o of options.allowedOrigins ?? []) {
    const n = normalizeOrigin(o);
    if (n) allowed.add(n);
  }
  const accent = options.accent ?? '#8f2437';

  let adminOrigin: string | null = null;
  let active = false;
  const cleanups: Array<() => void> = [];
  const focusable = new Set<Element>();

  function post(message: SiteMessage): void {
    if (adminOrigin) win!.parent.postMessage(message, adminOrigin);
  }

  function all(): Element[] {
    return Array.from(doc.querySelectorAll('[data-mosto-field]'));
  }

  function makeFocusable(): void {
    for (const el of all()) {
      if (!el.hasAttribute('tabindex') && !focusable.has(el)) {
        el.setAttribute('tabindex', '0');
        focusable.add(el);
      }
    }
  }

  function select(el: Element): void {
    const ref = parseFieldAddress(el.getAttribute('data-mosto-field'));
    if (!ref) return;
    const kind = inferKind(el);
    doc.querySelectorAll(`.${ACTIVE}`).forEach((x) => x.classList.remove(ACTIVE));
    el.classList.add(ACTIVE);
    const r = el.getBoundingClientRect();
    post({
      type: 'mosto:select',
      v: MESSAGE_VERSION,
      field: { ...ref, kind },
      value: readElementValue(el, kind, win!.location.href),
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    });
  }

  function apply(field: SelectedField, value: string | string[]): void {
    const address = `${field.collection}:${field.id}:${field.path}`;
    for (const el of all()) {
      const a = el.getAttribute('data-mosto-field');
      if (a === address && typeof value === 'string') {
        writeElementValue(el, isFieldKind(el.getAttribute('data-mosto-kind')) ? inferKind(el) : field.kind, value);
      } else if (Array.isArray(value) && a && a.startsWith(`${address}.`)) {
        // A whole list was edited: update the elements annotated per item.
        const i = Number(a.slice(address.length + 1));
        if (Number.isInteger(i) && i >= 0 && i < value.length) {
          writeElementValue(el, field.kind === 'imageList' ? 'image' : inferKind(el), value[i] as string);
        }
      }
    }
  }

  function highlight(field: SelectedField | null): void {
    doc.querySelectorAll(`.${ACTIVE}`).forEach((x) => x.classList.remove(ACTIVE));
    if (!field) return;
    const address = `${field.collection}:${field.id}:${field.path}`;
    const el = all().find((e) => e.getAttribute('data-mosto-field') === address && isVisible(win!, e)) ??
      all().find((e) => e.getAttribute('data-mosto-field') === address);
    if (!el) return;
    el.classList.add(ACTIVE);
    if (typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  const onClick = (event: MouseEvent) => {
    if (!active) return;
    const el = pickTarget(win, event);
    if (el) {
      event.preventDefault();
      event.stopPropagation();
      select(el);
      return;
    }
    // Following a link inside the editor keeps the editor on the next page.
    const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link || event.defaultPrevented || link.target === '_blank' || event.metaKey || event.ctrlKey) return;
    let url: URL;
    try {
      url = new URL(link.getAttribute('href') ?? '', win.location.href);
    } catch {
      return;
    }
    if (url.origin !== own || url.searchParams.get('mostoEdit') === '1') return;
    event.preventDefault();
    event.stopPropagation();
    url.searchParams.set('mostoEdit', '1');
    win.location.assign(url.toString());
  };

  const onKey = (event: KeyboardEvent) => {
    if (!active || (event.key !== 'Enter' && event.key !== ' ')) return;
    const el = doc.activeElement;
    if (el && el.hasAttribute('data-mosto-field')) {
      event.preventDefault();
      select(el);
    }
  };

  function activate(): void {
    if (active) return;
    active = true;
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css(accent);
      doc.head.appendChild(style);
      cleanups.push(() => style.remove());
    }
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey, true);
    cleanups.push(() => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKey, true);
    });
    makeFocusable();
    if (typeof MutationObserver === 'function' && doc.body) {
      const mo = new MutationObserver(makeFocusable);
      mo.observe(doc.body, { childList: true, subtree: true });
      cleanups.push(() => mo.disconnect());
    }
    // Show what can be edited for a moment.
    doc.documentElement.classList.add(REVEAL);
    const t = win!.setTimeout(() => doc.documentElement.classList.remove(REVEAL), 1600);
    cleanups.push(() => {
      win!.clearTimeout(t);
      doc.documentElement.classList.remove(REVEAL);
    });
  }

  const onMessage = (event: MessageEvent) => {
    if (event.source !== win.parent) return;
    if (!allowed.has(event.origin)) return;
    if (adminOrigin && event.origin !== adminOrigin) return;
    const message = readMessage(event.data);
    if (!message) return;
    if (message.type === 'mosto:init') {
      adminOrigin = event.origin;
      activate();
      const url = new URL(win.location.href);
      url.searchParams.delete('mostoEdit');
      post({ type: 'mosto:ready', v: MESSAGE_VERSION, fields: all().length, url: url.pathname + url.search + url.hash });
      return;
    }
    if (!active) return;
    if (message.type === 'mosto:set') apply(message.field, message.value);
    else if (message.type === 'mosto:highlight') highlight(message.field);
  };

  win.addEventListener('message', onMessage);
  cleanups.push(() => win.removeEventListener('message', onMessage));

  // Announce to each allowed origin: the browser delivers it only to the one
  // the parent actually has, so nothing goes to an unknown page.
  for (const origin of allowed) {
    try {
      win.parent.postMessage({ type: 'mosto:overlay-loaded', v: MESSAGE_VERSION }, origin);
    } catch {
      // an origin the browser refuses as target
    }
  }

  return () => {
    for (const c of cleanups.splice(0).reverse()) c();
    for (const el of focusable) el.removeAttribute('tabindex');
    focusable.clear();
    doc.querySelectorAll(`.${ACTIVE}`).forEach((x) => x.classList.remove(ACTIVE));
    active = false;
    adminOrigin = null;
  };
}
