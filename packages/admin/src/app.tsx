/**
 * `<MostoAdmin>`: the whole `/admin` interface. Mounted by
 * `@mosto-cms/next/admin`, or by any React page that serves the site's
 * `/api/mosto-cms` route. It covers the viewport, so the site's own layout
 * stays hidden behind it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createProtocolClient, type Editor } from './client.js';
import { UiContext, type Ui } from './context.js';
import { pickLanguage, STORAGE_KEY, translator, type UiLanguage } from './i18n.js';
import { LoginScreen } from './login.js';
import { ADMIN_CSS } from './styles.js';
import { useTouch } from './ui.js';
import type { PreviewPage } from './visual.js';
import { Workspace } from './workspace.js';

export type MostoAdminProps = {
  /** Where the protocol route is mounted. Default "/api/mosto-cms". */
  apiPath?: string;
  /** Where this admin is mounted. Default "/admin". */
  adminPath?: string;
  /** Shown on the sign-in screen and in the header until the schema is read. */
  siteName?: string;
  /** The signed-in editor, as known by the server when rendering. */
  editor?: Editor | null;
  /** Pages offered in visual mode. Default: the home page. */
  pages?: PreviewPage[];
  /** Show the "Powered by Mosto CMS" link. Default true. */
  poweredBy?: boolean;
  /** Force the interface language (otherwise: the browser's, switchable). */
  language?: UiLanguage;
  /** Error to show on the sign-in screen (from a no-JavaScript sign-in). */
  loginError?: 'invalid' | 'locked' | null;
};

export function MostoAdmin(props: MostoAdminProps) {
  const apiPath = props.apiPath ?? '/api/mosto-cms';
  const adminPath = props.adminPath ?? '/admin';
  const pages = props.pages && props.pages.length > 0 ? props.pages : [{ path: '/' }];
  const client = useMemo(() => createProtocolClient(apiPath), [apiPath]);
  const [editor, setEditor] = useState<Editor | null>(props.editor ?? null);
  const [ended, setEnded] = useState(false);
  const [lang, setLangState] = useState<UiLanguage>(props.language ?? 'en');
  const touch = useTouch();

  useEffect(() => {
    if (props.language) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // private mode
    }
    setLangState(pickLanguage(navigator.languages ?? [navigator.language], stored));
  }, [props.language]);

  // The admin covers the page: stop the site behind it from scrolling.
  useEffect(() => {
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = before;
    };
  }, []);

  const setLang = useCallback((l: UiLanguage) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // private mode
    }
  }, []);

  const ui = useMemo<Ui>(() => ({ t: translator(lang), lang, setLang, touch }), [lang, setLang, touch]);
  const siteOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  const poweredBy = props.poweredBy !== false;

  const signedOut = useCallback((reason?: 'ended') => {
    setEditor(null);
    setEnded(reason === 'ended');
  }, []);

  return (
    <UiContext.Provider value={ui}>
      <style>{ADMIN_CSS}</style>
      <div className="mc-root" lang={lang} data-mosto-cms-admin="">
        {editor ? (
          <Workspace client={client} editor={editor} siteName={props.siteName ?? ''} pages={pages} siteOrigin={siteOrigin} poweredBy={poweredBy} onSignedOut={signedOut} />
        ) : (
          <LoginScreen
            client={client}
            apiPath={apiPath}
            adminPath={adminPath}
            siteName={props.siteName ?? ''}
            initialError={ended ? 'ended' : (props.loginError ?? null)}
            poweredBy={poweredBy}
            onSignedIn={(e) => {
              setEnded(false);
              setEditor(e);
            }}
          />
        )}
      </div>
    </UiContext.Provider>
  );
}
