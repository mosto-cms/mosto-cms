/**
 * Forms mode: every editable field, grouped by collection and entry, with the
 * site's languages side by side. On phones it is a two-step list → form.
 */
import { useEffect, useState } from 'react';

import { useStore, useUi } from './context.js';
import { FieldEditor } from './field-editor.js';
import { entryKey, fieldDef, formRows, labelFor, prettyPath, type CollectionInfo } from './model.js';

export function FormsMode() {
  const store = useStore();
  const { t, lang } = useUi();
  const { collections, site } = store;
  const [current, setCurrent] = useState<{ collection: string; id: string } | null>(null);
  const [openList, setOpenList] = useState<string | null>(null);

  // Single collections (a page) have one entry: load their ids up front.
  useEffect(() => {
    for (const c of collections) if (c.type === 'single') void store.loadEntryList(c.key);
  }, [collections]);

  const openCollection = async (c: CollectionInfo) => {
    if (c.type === 'single') {
      const list = store.entryLists[c.key] ?? (await store.loadEntryList(c.key));
      const first = list[0];
      if (first) setCurrent({ collection: c.key, id: first.id });
      return;
    }
    setOpenList((o) => (o === c.key ? null : c.key));
    void store.loadEntryList(c.key);
  };

  const collection = current ? collections.find((c) => c.key === current.collection) : undefined;
  const entry = current ? store.entries[entryKey(current.collection, current.id)] : undefined;
  const title = current && collection ? (collection.type === 'list' ? store.entryLists[collection.key]?.find((e) => e.id === current.id)?.title ?? current.id : labelFor(collection.label, lang, site.locales)) : '';
  const multi = site.locales.length > 1;

  // Load the entry when opened, and again after a publish or a reload cleared it.
  useEffect(() => {
    if (current && !entry) void store.loadEntry(current.collection, current.id);
  }, [current?.collection, current?.id, entry]);

  return (
    <div className={`mc-forms ${current ? 'mc-forms-detail' : 'mc-forms-list'}`}>
      <nav className="mc-nav" aria-label={t('forms.collections')}>
        <div className="mc-nav-group">
          <span className="mc-nav-title">{t('forms.collections')}</span>
          {collections.map((c) => {
            const isCurrent = current?.collection === c.key;
            const pending = Object.values(store.drafts).filter((d) => d.collection === c.key).length;
            return (
              <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button
                  type="button"
                  className="mc-nav-item"
                  aria-current={c.type === 'single' && isCurrent ? 'true' : undefined}
                  aria-expanded={c.type === 'list' ? openList === c.key : undefined}
                  onClick={() => void openCollection(c)}
                >
                  <span>{labelFor(c.label, lang, site.locales)}</span>
                  <span className="mc-row" style={{ gap: 6 }}>
                    {pending ? <span className="mc-badge" aria-label={t('publish.count', { count: pending })}>{pending}</span> : null}
                    {c.type === 'list' ? <span aria-hidden="true">{openList === c.key ? '−' : '+'}</span> : null}
                  </span>
                </button>
                {c.type === 'list' && openList === c.key ? (
                  <div className="mc-nav-sub">
                    {(store.entryLists[c.key] ?? []).map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        className="mc-nav-item"
                        aria-current={isCurrent && current?.id === e.id ? 'true' : undefined}
                        onClick={() => setCurrent({ collection: c.key, id: e.id })}
                      >
                        {e.title}
                      </button>
                    ))}
                    {!store.entryLists[c.key] ? <span className="mc-progress">{t('forms.loading')}</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>

      <section className="mc-content" aria-live="polite">
        {!current || !collection ? (
          <div className="mc-content-inner">
            <p className="mc-muted">{t('forms.choose')}</p>
          </div>
        ) : (
          <div className="mc-content-inner">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="mc-btn mc-btn-quiet mc-btn-small mc-back" style={{ alignSelf: 'flex-start' }} onClick={() => setCurrent(null)}>
                ← {t('forms.back')}
              </button>
              {collection.type === 'list' ? <span className="mc-eyebrow">{labelFor(collection.label, lang, site.locales)}</span> : null}
              <h1 className="mc-page-title">{title}</h1>
            </div>
            {!entry ? (
              <span className="mc-progress" role="status">
                <span className="mc-spinner" aria-hidden="true" /> {t('forms.loading')}
              </span>
            ) : (
              <div>
                {formRows(collection, site.locales).map((row) => {
                  if (row.type === 'shared') {
                    const def = fieldDef(collections, { collection: collection.key, path: row.field.path });
                    if (!def) return null;
                    return (
                      <div key={row.key} className="mc-form-row" style={{ paddingBottom: 24 }}>
                        <FieldEditor fieldRef={{ collection: collection.key, id: current.id, path: row.field.path }} def={def} locale={null} />
                      </div>
                    );
                  }
                  const locales = site.locales.filter((l) => row.fields[l]);
                  const rowLabel = labelFor(row.first.label, lang, site.locales) || prettyPath(row.first.path, site.locales);
                  return (
                    <div key={row.key} className="mc-form-row" style={{ paddingBottom: 24 }}>
                      {multi ? <span className="mc-label">{rowLabel}</span> : null}
                      <div className="mc-cols" style={{ ['--cols' as string]: String(Math.min(3, locales.length)) }}>
                        {locales.map((l) => {
                          const f = row.fields[l]!;
                          const def = fieldDef(collections, { collection: collection.key, path: f.path });
                          if (!def) return null;
                          return (
                            <FieldEditor
                              key={f.path}
                              fieldRef={{ collection: collection.key, id: current.id, path: f.path }}
                              def={def}
                              locale={multi ? l : null}
                              label={multi ? `${rowLabel}` : undefined}
                              hideLabel={multi}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
