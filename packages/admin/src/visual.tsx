/**
 * Visual mode: the site in an iframe, opened with `?mostoEdit=1`. The overlay
 * on the page reports clicks (`mosto:select`); the side panel (a bottom sheet
 * on phones) edits the field, and every keystroke is mirrored on the page
 * with `mosto:set`. Messages are accepted only from the iframe's window and
 * the site's origin.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ResolvedField } from '@mosto-cms/core';
import { MESSAGE_VERSION, readMessage, type AdminMessage, type SelectedField } from '@mosto-cms/overlay';

import { useStore, useUi } from './context.js';
import { FieldEditor } from './field-editor.js';
import { entryKey, fieldDef, labelFor, prettyPath, siblingPaths, splitLocale, type FieldRef, type FieldValue } from './model.js';

export type PreviewPage = { path: string; label?: string };

function withEditParams(path: string, nonce: number): string {
  const u = new URL(path, 'http://x');
  u.searchParams.set('mostoEdit', '1');
  if (nonce > 0) u.searchParams.set('mostoPreview', String(nonce));
  return u.pathname + u.search + u.hash;
}

export function VisualMode({ pages, siteOrigin }: { pages: PreviewPage[]; siteOrigin: string }) {
  const store = useStore();
  const { t, lang, touch } = useUi();
  const frame = useRef<HTMLIFrameElement>(null);
  const [path, setPath] = useState(pages[0]?.path ?? '/');
  // The connection status belongs to one preview URL: a new URL starts as loading.
  const [statusFor, setStatusFor] = useState<{ src: string; status: 'loading' | 'ready' | 'noOverlay' }>({ src: '', status: 'loading' });
  const [fields, setFields] = useState(0);
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [selected, setSelected] = useState<(SelectedField & { def: ResolvedField }) | null>(null);
  const [notEditable, setNotEditable] = useState(false);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const src = useMemo(() => withEditParams(path, store.previewNonce), [path, store.previewNonce]);
  const srcRef = useRef(src);
  srcRef.current = src;
  const status = statusFor.src === src ? statusFor.status : 'loading';

  const post = useCallback(
    (message: AdminMessage) => {
      frame.current?.contentWindow?.postMessage(message, siteOrigin);
    },
    [siteOrigin],
  );

  // Every edit, from this panel or the forms, is mirrored on the page.
  useEffect(() => {
    store.previewSink.current = (ref: FieldRef, kind, value: FieldValue) => {
      post({ type: 'mosto:set', v: MESSAGE_VERSION, field: { ...ref, kind }, value });
    };
    return () => {
      store.previewSink.current = null;
    };
  }, [post, store.previewSink]);

  const draftsRef = useRef(store.drafts);
  draftsRef.current = store.drafts;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      if (event.origin !== siteOrigin) return;
      const m = readMessage(event.data);
      if (!m) return;
      if (m.type === 'mosto:overlay-loaded') {
        post({ type: 'mosto:init', v: MESSAGE_VERSION, locale: lang });
      } else if (m.type === 'mosto:ready') {
        setStatusFor({ src: srcRef.current, status: 'ready' });
        setFields(m.fields);
        // The page was reloaded: show the unpublished edits on it again.
        for (const d of Object.values(draftsRef.current)) {
          post({ type: 'mosto:set', v: MESSAGE_VERSION, field: { collection: d.collection, id: d.id, path: d.path, kind: d.kind }, value: d.value });
        }
      } else if (m.type === 'mosto:select') {
        const def = fieldDef(store.collections, m.field);
        if (!def) {
          setSelected(null);
          setNotEditable(true);
          return;
        }
        setNotEditable(false);
        setSelected({ ...m.field, kind: def.kind, def });
        void store.loadEntry(m.field.collection, m.field.id);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [lang, post, siteOrigin, store]);

  // No overlay answering a few seconds after the page loaded: say so.
  const onLoad = () => {
    const mine = srcRef.current;
    setTimeout(() => {
      setStatusFor((cur) => (cur.src === mine && cur.status === 'ready') || srcRef.current !== mine ? cur : { src: mine, status: 'noOverlay' });
    }, 5000);
  };

  useEffect(() => {
    if (selected) panelHeading.current?.focus();
  }, [selected?.collection, selected?.id, selected?.path]);

  const close = () => {
    setSelected(null);
    post({ type: 'mosto:highlight', v: MESSAGE_VERSION, field: null });
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const collection = selected ? store.collections.find((c) => c.key === selected.collection) : undefined;
  const entry = selected ? store.entries[entryKey(selected.collection, selected.id)] : undefined;
  const entryTitle = selected && collection?.type === 'list' ? store.entryLists[selected.collection]?.find((e) => e.id === selected.id)?.title ?? selected.id : null;
  const siblings = selected && collection ? siblingPaths(collection, selected.path, store.site.locales).filter((s) => s.path !== selected.path) : [];
  const selLocale = selected ? splitLocale(selected.path, store.site.locales).locale : null;

  useEffect(() => {
    if (selected && collection?.type === 'list') void store.loadEntryList(selected.collection);
  }, [selected?.collection]);

  // After a publish or a reload the cache is empty: read the entry again.
  useEffect(() => {
    if (selected && !entry) void store.loadEntry(selected.collection, selected.id);
  }, [selected?.collection, selected?.id, entry]);

  const pageOptions = pages.length > 1 || !pages.some((p) => p.path === path) ? [...pages, ...(pages.some((p) => p.path === path) ? [] : [{ path }])] : pages;

  return (
    <div className="mc-visual">
      <section className="mc-stage" aria-label={t('visual.preview')}>
        <div className="mc-toolbar">
          {pageOptions.length > 1 ? (
            <label className="mc-row" style={{ gap: 6 }}>
              <span className="mc-small mc-muted">{t('visual.page')}</span>
              <select value={path} onChange={(e) => setPath(e.target.value)}>
                {pageOptions.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.label ?? p.path}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" className="mc-btn mc-btn-quiet mc-btn-small" onClick={() => store.bumpPreview()}>
            ↻ {t('visual.reload')}
          </button>
          <div className="mc-seg mc-device" style={{ marginLeft: 'auto' }} role="group" aria-label="Preview size">
            <button type="button" aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>
              Desktop
            </button>
            <button type="button" aria-pressed={device === 'phone'} onClick={() => setDevice('phone')}>
              {lang === 'it' ? 'Telefono' : 'Phone'}
            </button>
          </div>
        </div>
        {status === 'noOverlay' ? (
          <div style={{ padding: '0 16px 12px' }}>
            <div className="mc-notice">{t('visual.noOverlay')}</div>
          </div>
        ) : null}
        <div className="mc-frame-wrap">
          <iframe
            ref={frame}
            key={src}
            src={src}
            title={t('visual.preview')}
            className={`mc-frame${device === 'phone' ? ' mc-frame-phone' : ''}`}
            data-status={status}
            onLoad={onLoad}
          />
        </div>
      </section>

      {!selected ? (
        <div className="mc-hint" role="status">
          {notEditable ? t('visual.notEditable') : status === 'ready' && fields === 0 ? t('visual.noFields') : status === 'loading' ? t('visual.loading') : touch ? t('visual.hintTouch') : t('visual.hint')}
        </div>
      ) : null}

      <aside className={`mc-panel${selected ? ' mc-panel-open' : ''}`} aria-label={selected ? labelFor(selected.def.label, lang, store.site.locales) : t('visual.hint')}>
        <div className="mc-sheet-handle" aria-hidden="true" />
        {selected && collection ? (
          <>
            <div className="mc-field-head" style={{ alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span className="mc-eyebrow">
                  {labelFor(collection.label, lang, store.site.locales)}
                  {entryTitle ? ` · ${entryTitle}` : ''}
                </span>
                <h2 ref={panelHeading} tabIndex={-1} className="mc-serif" style={{ fontSize: 24, lineHeight: 1.2 }}>
                  {labelFor(selected.def.label, lang, store.site.locales) || prettyPath(selected.path, store.site.locales)}
                  {selected.def.item ? ` · ${t('field.photo', { n: selected.def.item.index + 1 })}` : ''}
                </h2>
              </div>
              <button type="button" className="mc-btn mc-btn-quiet mc-btn-small" onClick={close}>
                {touch ? t('visual.done') : t('visual.close')}
              </button>
            </div>
            {!entry ? (
              <span className="mc-progress" role="status">
                <span className="mc-spinner" aria-hidden="true" /> {t('common.loading')}
              </span>
            ) : (
              <>
                <FieldEditor
                  fieldRef={selected}
                  def={selected.def}
                  locale={siblings.length > 0 ? selLocale : null}
                  hideLabel
                  autoFocus={!touch}
                />
                {siblings.length > 0 ? (
                  <div className="mc-siblings">
                    <span className="mc-eyebrow">{t('visual.otherLanguages')}</span>
                    {siblings.map((s) => {
                      const def = fieldDef(store.collections, { collection: selected.collection, path: s.path });
                      return def ? <FieldEditor key={s.path} fieldRef={{ collection: selected.collection, id: selected.id, path: s.path }} def={def} locale={s.locale} hideLabel /> : null;
                    })}
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : (
          <div className="mc-panel-empty">
            <h2>{touch ? t('visual.hintTouch') : t('visual.hint')}</h2>
            {status === 'noOverlay' ? <p className="mc-muted">{t('visual.noOverlay')}</p> : null}
            {status === 'ready' && fields === 0 ? <p className="mc-muted">{t('visual.noFields')}</p> : null}
            {notEditable ? <p className="mc-muted">{t('visual.notEditable')}</p> : null}
          </div>
        )}
      </aside>
    </div>
  );
}
