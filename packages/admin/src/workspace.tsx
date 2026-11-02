/**
 * The signed-in admin: header (site, modes, Publish, account), the current
 * mode, notices and toasts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminError, type Editor, type ProtocolClient } from './client.js';
import { StoreContext, useUi } from './context.js';
import { FormsMode } from './forms.js';
import { HistoryMode } from './history.js';
import { LANGUAGE_NAMES, UI_LANGUAGES } from './i18n.js';
import { labelFor, type CollectionInfo, type SiteInfo } from './model.js';
import { useWorkspaceStore } from './store.js';
import { errorText, Notice, PoweredBy, Spinner, Toasts, useToasts } from './ui.js';
import { VisualMode, type PreviewPage } from './visual.js';

export type Mode = 'visual' | 'forms' | 'history';
const MODES: Mode[] = ['visual', 'forms', 'history'];

function initialMode(): Mode {
  if (typeof window === 'undefined') return 'visual';
  const h = window.location.hash.replace('#', '');
  return (MODES as string[]).includes(h) ? (h as Mode) : 'visual';
}

export function Workspace(props: {
  client: ProtocolClient;
  editor: Editor;
  siteName: string;
  pages: PreviewPage[];
  siteOrigin: string;
  poweredBy: boolean;
  onSignedOut(reason?: 'ended'): void;
}) {
  const { t } = useUi();
  const [data, setData] = useState<{ site: SiteInfo; collections: CollectionInfo[] } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [toasts, toast] = useToasts();
  const { onSignedOut, client } = props;

  const load = useCallback(async () => {
    setFatal(null);
    try {
      const [site, collections] = await Promise.all([client.call<SiteInfo>('describe'), client.call<CollectionInfo[]>('listEditableFields')]);
      setData({ site, collections });
    } catch (err) {
      if (err instanceof AdminError && err.code === 'unauthorized') onSignedOut('ended');
      else setFatal(errorText(err, t));
    }
  }, [client, onSignedOut, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="mc-center">
        {fatal ? (
          <Notice
            tone="error"
            actions={
              <button type="button" className="mc-btn mc-btn-small" onClick={() => void load()}>
                {t('common.retry')}
              </button>
            }
          >
            {fatal}
          </Notice>
        ) : (
          <Spinner label={t('common.loading')} />
        )}
      </div>
    );
  }
  return <Loaded {...props} site={data.site} collections={data.collections} toasts={toasts} toast={toast} />;
}

function Loaded(props: Parameters<typeof Workspace>[0] & { site: SiteInfo; collections: CollectionInfo[]; toasts: Array<{ id: number; text: string }>; toast(text: string): void }) {
  const ui = useUi();
  const { t, lang } = ui;
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [error, setError] = useState<unknown>(null);
  const { onSignedOut } = props;

  const onError = useCallback(
    (err: unknown) => {
      if (err instanceof AdminError && err.code === 'unauthorized') {
        onSignedOut('ended');
        return;
      }
      setError(err);
    },
    [onSignedOut],
  );

  const store = useWorkspaceStore({ client: props.client, site: props.site, collections: props.collections, t, lang, onError, toast: props.toast });
  const pending = Object.keys(store.drafts).length;

  const setMode = (m: Mode) => {
    setModeState(m);
    if (typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${m}`);
  };

  // Leaving with unpublished changes asks first.
  useEffect(() => {
    if (pending === 0) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t('publish.leave');
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [pending, t]);

  const conflict = error instanceof AdminError && error.code === 'conflict';
  const files = Object.fromEntries(props.collections.filter((c) => c.file).map((c) => [c.file as string, labelFor(c.label, lang, props.site.locales)]));
  const name = props.site.site?.name || props.siteName;

  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = (i + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length;
    setMode(MODES[next] as Mode);
    tabs.current[next]?.focus();
  };

  return (
    <StoreContext.Provider value={store}>
      <header className="mc-header">
        <div className="mc-brand">
          <span className="mc-brand-name" title={name}>
            {name}
          </span>
          <span className="mc-brand-sub">{t('app.title')}</span>
        </div>
        <div className="mc-tabs" role="tablist" aria-label={t('tabs.label')}>
          {MODES.map((m, i) => (
            <button
              key={m}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`mc-tab-${m}`}
              aria-selected={mode === m}
              aria-controls="mc-main"
              tabIndex={mode === m ? 0 : -1}
              className="mc-tab"
              onClick={() => setMode(m)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t(`tabs.${m}`)}
            </button>
          ))}
        </div>
        <div className="mc-actions">
          {pending > 0 ? (
            <>
              <span className="mc-pending" aria-live="polite">
                {pending === 1 ? t('publish.count.one') : t('publish.count.other', { count: pending })}
              </span>
              <button
                type="button"
                className="mc-btn mc-btn-quiet mc-discard"
                onClick={() => {
                  if (window.confirm(t('publish.discardConfirm'))) store.discard();
                }}
              >
                {t('publish.discard')}
              </button>
            </>
          ) : null}
          <button type="button" className="mc-btn mc-btn-primary" disabled={pending === 0 || store.publishing || !props.site.access.write} onClick={() => void store.publish()} data-testid="mc-publish">
            {store.publishing ? (
              <>
                <span className="mc-spinner" aria-hidden="true" /> {t('publish.busy')}
              </>
            ) : (
              <>
                {t('publish.button')}
                {pending > 0 ? <span className="mc-badge" aria-label={t('publish.count', { count: pending })}>{pending}</span> : null}
              </>
            )}
          </button>
          <AccountMenu editor={props.editor} poweredBy={props.poweredBy} onSignOut={async () => {
            await props.client.logout().catch(() => undefined);
            onSignedOut();
          }} />
        </div>
      </header>

      {error ? (
        <div style={{ padding: '12px 24px 0' }}>
          <Notice
            tone={conflict ? 'warn' : 'error'}
            actions={
              <>
                {conflict ? (
                  <button
                    type="button"
                    className="mc-btn mc-btn-primary mc-btn-small"
                    onClick={() => {
                      setError(null);
                      void store.refresh();
                    }}
                  >
                    {t('common.reload')}
                  </button>
                ) : null}
                <button type="button" className="mc-btn mc-btn-small" onClick={() => setError(null)}>
                  {t('common.close')}
                </button>
              </>
            }
          >
            {errorText(error, t)}
          </Notice>
        </div>
      ) : null}

      <main className="mc-main" id="mc-main" role="tabpanel" aria-labelledby={`mc-tab-${mode}`}>
        {mode === 'visual' ? <VisualMode pages={props.pages} siteOrigin={props.siteOrigin} /> : null}
        {mode === 'forms' ? <FormsMode /> : null}
        {mode === 'history' ? <HistoryMode files={files} /> : null}
      </main>
      <Toasts items={props.toasts} />
    </StoreContext.Provider>
  );
}

function AccountMenu({ editor, poweredBy, onSignOut }: { editor: Editor; poweredBy: boolean; onSignOut(): void }) {
  const { t, lang, setLang } = useUi();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (editor.name || editor.email).trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="mc-menu-wrap" ref={wrap}>
      <button ref={button} type="button" className="mc-avatar" aria-haspopup="true" aria-expanded={open} aria-label={`${t('menu.account')}: ${editor.name}`} onClick={() => setOpen((o) => !o)}>
        {initial}
      </button>
      {open ? (
        <div className="mc-menu" role="dialog" aria-label={t('menu.account')}>
          <div className="mc-menu-section">
            <span className="mc-menu-label">{t('menu.signedInAs')}</span>
            <span style={{ fontWeight: 600 }}>{editor.name}</span>
            <span className="mc-small mc-muted">{editor.email}</span>
          </div>
          <div className="mc-menu-section">
            <span className="mc-menu-label" id="mc-lang-label">
              {t('menu.language')}
            </span>
            <div className="mc-seg" role="group" aria-labelledby="mc-lang-label">
              {UI_LANGUAGES.map((l) => (
                <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
                  {LANGUAGE_NAMES[l]}
                </button>
              ))}
            </div>
          </div>
          <div className="mc-menu-section" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <a className="mc-link" href="/" target="_blank" rel="noopener">
              {t('menu.viewSite')} ↗
            </a>
            <button type="button" className="mc-btn mc-btn-small" onClick={onSignOut}>
              {t('menu.signOut')}
            </button>
          </div>
          {poweredBy ? (
            <div className="mc-menu-section" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <PoweredBy />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
