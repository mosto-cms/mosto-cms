/**
 * The click-to-edit overlay that runs on the live site.
 *
 * Inert for visitors. It starts only when the page is opened as `?mostoEdit=1`
 * inside a frame, announces itself to the parent, and stays passive until the
 * parent sends `mosto:init` from an allowed origin (by default only the site's
 * own origin, where `/admin` lives). From then on it talks to that exact
 * origin only, never `*`, and ignores messages from any other window.
 */
import { isFieldKind, parseFieldAddress, type FieldKind, type FieldRef, type SelectedField } from './field.js';
import { MESSAGE_VERSION, normalizeOrigin, readMessage, type EditorMode, type SiteMessage } from './messages.js';

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
const HOVER = 'mosto-cms-hover';
const LOCKED = 'mosto-cms-locked';
const EDITING = 'mosto-cms-editing';
const EDIT_MODE = 'mosto-cms-edit';
const REVEAL = 'mosto-cms-reveal';
const STYLE_ID = 'mosto-cms-overlay-style';
const CHIP_ID = 'mosto-cms-chip';
const SELECTED_CHIP_ID = 'mosto-cms-chip-selected';
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

/**
 * Whether a text field can be edited in place: a text kind on an element that
 * holds only text (and line breaks), so editing it cannot touch the markup.
 */
export function isInlineEditable(el: Element): boolean {
  const kind = inferKind(el);
  if (kind !== 'text' && kind !== 'multiline') return false;
  if (el.tagName === 'IMG' || el.tagName === 'VIDEO') return false;
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 || n.nodeType === 8) continue;
    if (n.nodeType === 1 && (n as Element).tagName === 'BR') continue;
    return false;
  }
  return true;
}

/** Text of an element as typed: line breaks and the blocks a browser adds while editing become `\n`. */
function typedText(node: Node): string {
  let out = '';
  for (const n of Array.from(node.childNodes)) {
    if (n.nodeType === 3) out += n.textContent ?? '';
    else if (n.nodeType === 1) {
      const tag = (n as Element).tagName;
      if (tag === 'BR') out += '\n';
      else if (tag === 'DIV' || tag === 'P') out += (out !== '' && !out.endsWith('\n') ? '\n' : '') + typedText(n);
      else out += typedText(n);
    }
  }
  return out;
}

/** The text an editor typed in place: one line for `text`, line breaks kept for `multiline`. */
export function readInlineValue(el: Element, kind: FieldKind): string {
  const text = typedText(el).replace(/\u00a0/g, ' ');
  if (kind === 'multiline') return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
  return text.replace(/\s+/g, ' ').trim();
}

const LOCALE_PATH = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

/** The name shown on hover: the schema label when the admin sent one, else a readable path. */
export function fieldLabel(ref: FieldRef, labels?: Record<string, string> | null): string {
  const exact = labels?.[`${ref.collection}:${ref.path}`];
  if (exact) return exact;
  const item = /^(.+)\.(\d+)$/.exec(ref.path);
  if (item) {
    const parent = labels?.[`${ref.collection}:${item[1] as string}`];
    if (parent) return `${parent} · ${Number(item[2]) + 1}`;
  }
  const segs = ref.path.split('.');
  if (segs.length > 1 && LOCALE_PATH.test(segs[0] as string)) segs.shift();
  const named = segs.filter((s) => !/^\d+$/.test(s));
  return (named.length > 0 ? named : segs)
    .slice(-2)
    .map((s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())
    .join(' › ');
}

const TEXTS = {
  en: { locked: 'Not editable', editing: 'Enter to apply · Esc to cancel', editingMulti: 'Shift+Enter new line · Enter to apply · Esc to cancel' },
  it: { locked: 'Non modificabile', editing: 'Invio per applicare · Esc per annullare', editingMulti: 'Maiusc+Invio a capo · Invio per applicare · Esc per annullare' },
};

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
  const on = `html.${EDIT_MODE}`;
  return [
    `${on} [data-mosto-field]{cursor:pointer}`,
    `${on} [data-mosto-field][data-mosto-inline]{cursor:text}`,
    `${on} .${HOVER}{outline:1px solid ${accent} !important;outline-offset:3px}`,
    `${on} .${ACTIVE}{outline:2px solid ${accent} !important;outline-offset:3px}`,
    `${on} .${EDITING}{outline:2px solid ${accent} !important;outline-offset:3px;cursor:text;caret-color:${accent};user-select:text;-webkit-user-select:text}`,
    `${on} .${EDITING}:focus{outline:2px solid ${accent} !important}`,
    `${on} .${LOCKED}{outline:1px dashed rgba(120,120,120,.55) !important;outline-offset:3px;cursor:not-allowed}`,
    `${on} [data-mosto-field]:focus-visible{outline:2px solid ${accent};outline-offset:3px}`,
    `html.${REVEAL} [data-mosto-field]{outline:1px dashed ${accent}}`,
    `#${CHIP_ID},#${SELECTED_CHIP_ID}{position:fixed;z-index:2147483647;pointer-events:none;display:none;max-width:min(60vw,420px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;` +
      `font:600 11px/1.2 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.01em;text-transform:none;font-style:normal;` +
      `padding:3px 7px;border-radius:5px;background:${accent};color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18)}`,
    `#${CHIP_ID}.is-muted{background:rgba(32,32,32,.82)}`,
    `@media (prefers-reduced-motion:reduce){[data-mosto-field]{transition:none}}`,
  ].join('\n');
}

/**
 * Start the overlay. Returns a function that removes everything it added.
 * Safe to call on every page: it returns at once unless the page is
 * `?mostoEdit=1` inside a frame.
 *
 * Two modes, set by the admin: `edit` (the default) outlines editable
 * elements on hover with their name, selects them on click, edits texts in
 * place and keeps links from navigating; `browse` leaves the page alone so
 * links work (the next page stays in the editor).
 */
export function initMostoOverlay(options: OverlayOptions = {}): () => void {
  const maybe = options.window ?? (typeof window === 'undefined' ? undefined : window);
  if (!maybe || !maybe.document) return NOOP;
  const win: Window = maybe;
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
  let mode: EditorMode = 'edit';
  let texts = TEXTS.en;
  let labels: Record<string, string> | null = null;
  let hovered: Element | null = null;
  let locked: Element | null = null;
  let selected: Element | null = null;
  let editing: { el: HTMLElement; field: SelectedField; original: string; before: string; off: () => void } | null = null;
  let chip: HTMLElement | null = null;
  let selectedChip: HTMLElement | null = null;
  let revealTimer: number | undefined;
  const cleanups: Array<() => void> = [];
  const focusable = new Set<Element>();

  function post(message: SiteMessage): void {
    if (adminOrigin) win.parent.postMessage(message, adminOrigin);
  }

  function all(): Element[] {
    return Array.from(doc.querySelectorAll('[data-mosto-field]'));
  }

  function refOf(el: Element): SelectedField | null {
    const ref = parseFieldAddress(el.getAttribute('data-mosto-field'));
    return ref ? { ...ref, kind: inferKind(el) } : null;
  }

  function prepare(): void {
    for (const el of all()) {
      if (mode === 'edit' && !el.hasAttribute('tabindex') && !focusable.has(el)) {
        el.setAttribute('tabindex', '0');
        focusable.add(el);
      }
      if (isInlineEditable(el)) el.setAttribute('data-mosto-inline', '');
      else el.removeAttribute('data-mosto-inline');
    }
  }

  function unprepare(): void {
    for (const el of focusable) el.removeAttribute('tabindex');
    focusable.clear();
  }

  function makeChip(id: string): HTMLElement {
    const el = doc.createElement('div');
    el.id = id;
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-mosto-ui', '');
    doc.body.appendChild(el);
    cleanups.push(() => el.remove());
    return el;
  }

  function place(el: HTMLElement | null, target: Element | null, text: string, muted = false): void {
    if (!el) return;
    if (!target || !text) {
      el.style.display = 'none';
      return;
    }
    el.textContent = text;
    el.classList.toggle('is-muted', muted);
    el.style.display = 'block';
    const r = target.getBoundingClientRect();
    const h = el.offsetHeight || 18;
    const top = r.top - h - 6 >= 2 ? r.top - h - 6 : Math.min(r.bottom + 6, (win.innerHeight || 0) - h - 2);
    const maxLeft = Math.max(2, (win.innerWidth || 0) - (el.offsetWidth || 0) - 2);
    el.style.top = `${Math.max(2, top)}px`;
    el.style.left = `${Math.min(Math.max(2, r.left), maxLeft)}px`;
  }

  function labelOf(el: Element): string {
    const ref = refOf(el);
    return ref ? fieldLabel(ref, labels) : '';
  }

  function refreshChips(): void {
    if (mode !== 'edit' || !active) {
      place(chip, null, '');
      place(selectedChip, null, '');
      return;
    }
    if (editing) {
      place(selectedChip, editing.el, `${labelOf(editing.el)} · ${editing.field.kind === 'multiline' ? texts.editingMulti : texts.editing}`);
    } else if (selected && selected.isConnected) {
      place(selectedChip, selected, labelOf(selected));
    } else {
      place(selectedChip, null, '');
    }
    if (hovered && hovered !== selected && hovered.isConnected && !editing) place(chip, hovered, labelOf(hovered));
    else if (locked && locked.isConnected && !editing) place(chip, locked, texts.locked, true);
    else place(chip, null, '');
  }

  function setHover(el: Element | null, lockedEl: Element | null): void {
    if (hovered !== el) {
      hovered?.classList.remove(HOVER);
      hovered = el;
      if (el && el !== selected) el.classList.add(HOVER);
    }
    if (locked !== lockedEl) {
      locked?.classList.remove(LOCKED);
      locked = lockedEl;
      lockedEl?.classList.add(LOCKED);
    }
    refreshChips();
  }

  function clearSelection(): void {
    doc.querySelectorAll(`.${ACTIVE}`).forEach((x) => x.classList.remove(ACTIVE));
    selected = null;
    refreshChips();
  }

  function select(el: Element): void {
    const field = refOf(el);
    if (!field) return;
    doc.querySelectorAll(`.${ACTIVE}`).forEach((x) => x.classList.remove(ACTIVE));
    el.classList.remove(HOVER);
    el.classList.add(ACTIVE);
    selected = el;
    refreshChips();
    const r = el.getBoundingClientRect();
    post({
      type: 'mosto:select',
      v: MESSAGE_VERSION,
      field,
      value: readElementValue(el, field.kind, win.location.href),
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      inline: mode === 'edit' && isInlineEditable(el),
    });
  }

  function placeCaret(el: HTMLElement, x?: number, y?: number): void {
    const sel = win.getSelection?.();
    if (!sel) return;
    let range: Range | null = null;
    const d = doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    if (x !== undefined && y !== undefined && (x !== 0 || y !== 0)) {
      if (typeof d.caretRangeFromPoint === 'function') range = d.caretRangeFromPoint(x, y);
      else if (typeof d.caretPositionFromPoint === 'function') {
        const p = d.caretPositionFromPoint(x, y);
        if (p) {
          range = doc.createRange();
          range.setStart(p.offsetNode, p.offset);
        }
      }
      if (range && !el.contains(range.startContainer)) range = null;
    }
    if (!range) {
      range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function startInline(el: HTMLElement, field: SelectedField, x?: number, y?: number): void {
    if (editing?.el === el) return;
    if (editing) commit();
    const original = el.innerHTML;
    const before = readInlineValue(el, field.kind);
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');
    el.classList.add(EDITING);
    // A multiline field shows its line breaks while it is edited.
    const whiteSpace = el.style.whiteSpace;
    if (field.kind === 'multiline') el.style.whiteSpace = 'pre-wrap';
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      } else if (e.key === 'Enter' && !(field.kind === 'multiline' && e.shiftKey) && !e.isComposing) {
        e.preventDefault();
        commit();
      }
    };
    const onBlur = () => commit();
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain');
      if (text === undefined) return;
      e.preventDefault();
      const clean = field.kind === 'multiline' ? text : text.replace(/\s+/g, ' ');
      const sel = win.getSelection?.();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = doc.createTextNode(clean);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    };
    // Typed text, not a click, must not bubble into the site's own handlers (a link, a carousel).
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('blur', onBlur);
    el.addEventListener('paste', onPaste);
    el.addEventListener('keyup', stop);
    el.addEventListener('keypress', stop);
    editing = {
      el,
      field,
      original,
      before,
      off: () => {
        el.removeEventListener('keydown', onKeyDown);
        el.removeEventListener('blur', onBlur);
        el.removeEventListener('paste', onPaste);
        el.removeEventListener('keyup', stop);
        el.removeEventListener('keypress', stop);
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
        el.classList.remove(EDITING);
        el.style.whiteSpace = whiteSpace;
        if (el.getAttribute('style') === '') el.removeAttribute('style');
      },
    };
    el.focus({ preventScroll: true });
    placeCaret(el, x, y);
    refreshChips();
  }

  function stopInline(): typeof editing {
    const e = editing;
    if (!e) return null;
    editing = null;
    e.off();
    return e;
  }

  function commit(): void {
    const e = stopInline();
    if (!e) return;
    const value = readInlineValue(e.el, e.field.kind);
    // Leave the element as plain text: what a browser adds while typing (<br>, <div>) goes.
    writeElementValue(e.el, e.field.kind, value);
    if (value !== e.before) post({ type: 'mosto:edit', v: MESSAGE_VERSION, field: e.field, value });
    refreshChips();
  }

  function cancel(): void {
    const e = stopInline();
    if (!e) return;
    e.el.innerHTML = e.original;
    refreshChips();
  }

  function apply(field: SelectedField, value: string | string[]): void {
    const address = `${field.collection}:${field.id}:${field.path}`;
    for (const el of all()) {
      if (editing?.el === el) continue;
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
    refreshChips();
  }

  function highlight(field: SelectedField | null): void {
    if (!field) {
      if (editing) commit();
      clearSelection();
      return;
    }
    const address = `${field.collection}:${field.id}:${field.path}`;
    const el = all().find((e) => e.getAttribute('data-mosto-field') === address && isVisible(win!, e)) ??
      all().find((e) => e.getAttribute('data-mosto-field') === address);
    doc.querySelectorAll(`.${ACTIVE}`).forEach((x) => x.classList.remove(ACTIVE));
    selected = el ?? null;
    if (!el) {
      refreshChips();
      return;
    }
    el.classList.add(ACTIVE);
    if (typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    refreshChips();
  }

  /** Something on the page that shows content but is not annotated. */
  function lockedTarget(node: EventTarget | null): Element | null {
    const el = node && typeof (node as Element).closest === 'function' ? (node as Element) : null;
    if (!el || el.closest('[data-mosto-ui]')) return null;
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO') return el;
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3 && (n.textContent ?? '').trim() !== '') return el;
    }
    return null;
  }

  function followLink(event: MouseEvent): void {
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
  }

  const onClick = (event: MouseEvent) => {
    if (!active) return;
    if (mode === 'browse') {
      followLink(event);
      return;
    }
    // Clicks inside the text being edited move the caret, nothing else.
    if (editing && editing.el.contains(event.target as Node)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const el = pickTarget(win, event);
    if (el) {
      event.preventDefault();
      event.stopPropagation();
      if (editing) commit();
      if (el !== selected) select(el);
      const field = refOf(el);
      if (field && isInlineEditable(el)) startInline(el as HTMLElement, field, event.clientX, event.clientY);
      return;
    }
    if (editing) commit();
    // In edit mode links do not navigate (buttons, like carousel arrows, still work).
    const link = (event.target as Element | null)?.closest?.('a[href]');
    if (link) {
      event.preventDefault();
      event.stopPropagation();
    }
    const control = (event.target as Element | null)?.closest?.('button,[role="button"],input,select,textarea,label,summary');
    if (selected && !control && lockedTarget(event.target)) {
      clearSelection();
      post({ type: 'mosto:deselect', v: MESSAGE_VERSION });
    }
  };

  const onSubmit = (event: Event) => {
    if (active && mode === 'edit') {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onMove = (event: MouseEvent) => {
    if (!active || mode !== 'edit') return;
    const el = pickTarget(win, event);
    setHover(el, el ? null : lockedTarget(event.target));
  };

  const onLeave = () => setHover(null, null);

  const onKey = (event: KeyboardEvent) => {
    if (!active) return;
    const t = event.target as HTMLElement | null;
    const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'e' || event.key === 'E')) {
      event.preventDefault();
      post({ type: 'mosto:mode', v: MESSAGE_VERSION, mode: mode === 'edit' ? 'browse' : 'edit' });
      return;
    }
    if (mode !== 'edit' || typing) return;
    if (event.key === 'Escape' && selected) {
      event.preventDefault();
      clearSelection();
      post({ type: 'mosto:deselect', v: MESSAGE_VERSION });
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = doc.activeElement;
    if (el && el.hasAttribute('data-mosto-field')) {
      event.preventDefault();
      select(el);
      const field = refOf(el);
      if (field && isInlineEditable(el)) startInline(el as HTMLElement, field);
    }
  };

  let frame = 0;
  const onScroll = () => {
    if (frame || mode !== 'edit') return;
    frame = win.requestAnimationFrame
      ? win.requestAnimationFrame(() => {
          frame = 0;
          refreshChips();
        })
      : 0;
  };

  function setMode(next: EditorMode): void {
    if (next !== 'edit') {
      if (editing) commit();
      setHover(null, null);
    }
    const changed = next !== mode;
    mode = next;
    doc.documentElement.classList.toggle(EDIT_MODE, active && mode === 'edit');
    if (mode === 'edit') prepare();
    else unprepare();
    if (changed && mode === 'edit') reveal();
    refreshChips();
  }

  function reveal(): void {
    // Show what can be edited for a moment.
    doc.documentElement.classList.add(REVEAL);
    win.clearTimeout(revealTimer);
    revealTimer = win.setTimeout(() => doc.documentElement.classList.remove(REVEAL), 1200);
  }

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
    chip = makeChip(CHIP_ID);
    selectedChip = makeChip(SELECTED_CHIP_ID);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('submit', onSubmit, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('mousemove', onMove, true);
    doc.addEventListener('mouseleave', onLeave);
    win.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', onScroll);
    cleanups.push(() => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('submit', onSubmit, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('mousemove', onMove, true);
      doc.removeEventListener('mouseleave', onLeave);
      win.removeEventListener('scroll', onScroll, true);
      win.removeEventListener('resize', onScroll);
      if (frame && win.cancelAnimationFrame) win.cancelAnimationFrame(frame);
    });
    if (typeof MutationObserver === 'function' && doc.body) {
      const mo = new MutationObserver(() => {
        if (mode === 'edit') prepare();
      });
      mo.observe(doc.body, { childList: true, subtree: true });
      cleanups.push(() => mo.disconnect());
    }
    cleanups.push(() => {
      win.clearTimeout(revealTimer);
      doc.documentElement.classList.remove(REVEAL, EDIT_MODE);
    });
    doc.documentElement.classList.toggle(EDIT_MODE, mode === 'edit');
    if (mode === 'edit') {
      prepare();
      reveal();
    }
  }

  const onMessage = (event: MessageEvent) => {
    if (event.source !== win.parent) return;
    if (!allowed.has(event.origin)) return;
    if (adminOrigin && event.origin !== adminOrigin) return;
    const message = readMessage(event.data);
    if (!message) return;
    if (message.type === 'mosto:init') {
      adminOrigin = event.origin;
      if (message.locale) texts = message.locale.toLowerCase().startsWith('it') ? TEXTS.it : TEXTS.en;
      if (message.labels) labels = message.labels;
      if (message.mode) mode = message.mode;
      activate();
      const url = new URL(win.location.href);
      url.searchParams.delete('mostoEdit');
      url.searchParams.delete('mostoPreview');
      post({ type: 'mosto:ready', v: MESSAGE_VERSION, fields: all().length, url: url.pathname + url.search + url.hash });
      return;
    }
    if (!active) return;
    if (message.type === 'mosto:set') apply(message.field, message.value);
    else if (message.type === 'mosto:highlight') highlight(message.field);
    else if (message.type === 'mosto:mode') setMode(message.mode);
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
    if (editing) cancel();
    for (const c of cleanups.splice(0).reverse()) c();
    unprepare();
    for (const el of all()) el.removeAttribute('data-mosto-inline');
    doc.querySelectorAll(`.${ACTIVE},.${HOVER},.${LOCKED}`).forEach((x) => x.classList.remove(ACTIVE, HOVER, LOCKED));
    active = false;
    adminOrigin = null;
    selected = hovered = locked = null;
  };
}
