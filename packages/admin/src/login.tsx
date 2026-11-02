/**
 * The sign-in screen. A plain HTML form that also works without JavaScript
 * (it posts to the login route, which redirects back), enhanced to sign in
 * with fetch and show errors in place.
 */
import { useState, type FormEvent } from 'react';

import { AdminError, type Editor, type ProtocolClient } from './client.js';
import { useUi } from './context.js';
import { LANGUAGE_NAMES, UI_LANGUAGES } from './i18n.js';
import { PoweredBy, useStableId } from './ui.js';

export function LoginScreen(props: {
  client: ProtocolClient;
  apiPath: string;
  adminPath: string;
  siteName: string;
  initialError?: 'invalid' | 'locked' | 'ended' | null;
  poweredBy: boolean;
  onSignedIn(editor: Editor): void;
}) {
  const { t, lang, setLang } = useUi();
  const id = useStableId('mc-login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    props.initialError === 'invalid' ? t('login.invalid') : props.initialError === 'locked' ? t('login.locked', { minutes: 15 }) : props.initialError === 'ended' ? t('login.ended') : null,
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const editor = await props.client.login(email.trim(), password);
      props.onSignedIn(editor ?? { email: email.trim(), name: email.trim() });
    } catch (err) {
      if (err instanceof AdminError && err.status === 429) {
        const seconds = Number(err.details.retryAfterSeconds ?? err.details.retryAfter ?? 900);
        setError(t('login.locked', { minutes: Math.max(1, Math.ceil(seconds / 60)) }));
      } else if (err instanceof AdminError && err.status === 401) {
        setError(t('login.invalid'));
      } else if (err instanceof AdminError && err.code === 'network') {
        setError(t('error.network'));
      } else {
        setError(err instanceof AdminError ? `${t('error.internal')} (${err.message})` : t('error.internal'));
      }
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mc-login">
      <form className="mc-login-card" method="post" action={`${props.apiPath}/login`} onSubmit={submit} aria-labelledby={`${id}-h`} noValidate>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="mc-eyebrow">{props.siteName}</span>
          <h1 id={`${id}-h`}>{t('login.title')}</h1>
          <p className="mc-muted">{t('login.subtitle')}</p>
        </div>
        <div aria-live="assertive">
          {error ? (
            <div className="mc-notice mc-notice-error" role="alert">
              {error}
            </div>
          ) : null}
        </div>
        <input type="hidden" name="next" value={props.adminPath} />
        <input type="hidden" name="back" value={props.adminPath} />
        <div className="mc-field">
          <label className="mc-label" htmlFor={`${id}-email`}>
            {t('login.email')}
          </label>
          <input id={`${id}-email`} className="mc-input" name="email" type="email" autoComplete="username" inputMode="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="mc-field">
          <label className="mc-label" htmlFor={`${id}-password`}>
            {t('login.password')}
          </label>
          <div className="mc-password">
            <input
              id={`${id}-password`}
              className="mc-input"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="mc-btn mc-btn-quiet mc-btn-small" aria-controls={`${id}-password`} aria-pressed={show} onClick={() => setShow((s) => !s)}>
              {show ? t('login.hide') : t('login.show')}
            </button>
          </div>
        </div>
        <button type="submit" className="mc-btn mc-btn-primary" style={{ width: '100%', minHeight: 46 }} disabled={busy}>
          {busy ? (
            <>
              <span className="mc-spinner" aria-hidden="true" /> {t('login.busy')}
            </>
          ) : (
            t('login.submit')
          )}
        </button>
        <div className="mc-footer-line">
          <div className="mc-seg" role="group" aria-label={t('menu.language')}>
            {UI_LANGUAGES.map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} lang={l}>
                {LANGUAGE_NAMES[l]}
              </button>
            ))}
          </div>
          {props.poweredBy ? <PoweredBy /> : null}
        </div>
      </form>
    </main>
  );
}
