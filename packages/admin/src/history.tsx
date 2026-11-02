/**
 * History: the recent publishes (git commits touching content files), each
 * with Undo. Undo calls `revert`, which restores only the editable fields that
 * change touched; if one was changed again later the server answers
 * `conflict` and the editor can choose to undo anyway.
 */
import { useCallback, useEffect, useState } from 'react';

import { AdminError } from './client.js';
import { useStore, useUi } from './context.js';
import { relativeTime } from './i18n.js';
import { errorText, Spinner } from './ui.js';

type Entry = { revision: string; parent: string | null; message: string; author: { name: string } | null; date: string; files: string[] };

export function HistoryMode({ files }: { files: Record<string, string> }) {
  const store = useStore();
  const { t, lang } = useUi();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ revision: string; force: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const supported = store.site.capabilities.history;

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await store.client.call<{ entries: Entry[] }>('history', { limit: 30 });
      setEntries(r.entries);
    } catch (err) {
      if (err instanceof AdminError && err.code === 'unauthorized') store.report(err);
      setError(errorText(err, t));
    }
  }, [store, t]);

  useEffect(() => {
    if (supported) void load();
  }, [supported]);

  async function undo(revision: string, force: boolean) {
    setBusy(revision);
    setError(null);
    try {
      await store.client.call('revert', { revision, ...(force ? { force: true } : {}) });
      setConfirm(null);
      store.toast(t('history.undone'));
      await store.refresh();
      await load();
    } catch (err) {
      if (err instanceof AdminError && err.code === 'conflict' && !force) {
        setConfirm({ revision, force: true });
      } else {
        if (err instanceof AdminError && err.code === 'unauthorized') store.report(err);
        setError(errorText(err, t));
      }
    } finally {
      setBusy(null);
    }
  }

  const what = (paths: string[]) => [...new Set(paths.map((p) => files[p] ?? p))].join(', ');
  const locale = lang === 'it' ? 'it-IT' : 'en-GB';

  return (
    <div className="mc-history">
      <div className="mc-history-inner">
        <h1 className="mc-page-title">{t('history.title')}</h1>
        {!supported ? <p className="mc-muted">{t('history.unsupported')}</p> : null}
        {error ? (
          <div className="mc-notice mc-notice-error" role="alert">
            <div>{error}</div>
            <div className="mc-row">
              <button type="button" className="mc-btn mc-btn-small" onClick={() => void load()}>
                {t('common.retry')}
              </button>
            </div>
          </div>
        ) : null}
        {supported && !entries && !error ? <Spinner label={t('history.loading')} /> : null}
        {entries && entries.length === 0 ? <p className="mc-muted">{t('history.empty')}</p> : null}
        {entries && entries.length > 0 ? (
          <ol className="mc-timeline">
            {entries.map((e) => {
              const subject = e.message.split('\n')[0] ?? '';
              const asking = confirm?.revision === e.revision;
              return (
                <li key={e.revision} className="mc-event">
                  <div style={{ minWidth: 0 }}>
                    <div className="mc-event-title">{subject}</div>
                    <div className="mc-event-meta">
                      <time dateTime={e.date} title={new Date(e.date).toLocaleString(locale)}>
                        {relativeTime(e.date, lang)}
                      </time>
                      {e.author ? ` · ${t('history.by', { name: e.author.name })}` : ''}
                      {e.files.length ? ` · ${t('history.files', { what: what(e.files) })}` : ''}
                    </div>
                  </div>
                  <div className="mc-event-actions">
                    {e.parent ? (
                      <button type="button" className="mc-btn mc-btn-small" disabled={busy !== null || !store.site.access.write} onClick={() => setConfirm({ revision: e.revision, force: false })}>
                        {t('history.undo')}
                      </button>
                    ) : (
                      <span className="mc-small mc-muted">{t('history.first')}</span>
                    )}
                  </div>
                  {asking ? (
                    <div className="mc-event-confirm">
                      <div className="mc-notice" role="alertdialog" aria-label={t('history.undo')}>
                        <div>{confirm.force ? t('history.undoForce') : t('history.undoConfirm', { message: subject })}</div>
                        <div className="mc-row">
                          <button type="button" className="mc-btn mc-btn-primary mc-btn-small" disabled={busy !== null} onClick={() => void undo(e.revision, confirm.force)} autoFocus>
                            {busy === e.revision ? <span className="mc-spinner" aria-hidden="true" /> : null} {t('common.confirm')}
                          </button>
                          <button type="button" className="mc-btn mc-btn-small" onClick={() => setConfirm(null)}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
