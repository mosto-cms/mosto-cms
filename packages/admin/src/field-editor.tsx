/**
 * One editor per field kind: text, multiline, url, image, video, list and
 * imageList (a gallery). Edits go to the shared drafts at once, so the page
 * preview follows every keystroke.
 */
import { useRef, useState, type ChangeEvent } from 'react';

import type { ResolvedField } from '@mosto-cms/core';

import { useStore, useUi } from './context.js';
import { checkValue, isMediaKind, labelFor, type FieldRef, type FieldValue } from './model.js';
import { errorText, useStableId } from './ui.js';

type Props = {
  fieldRef: FieldRef;
  def: ResolvedField;
  /** Locale tag shown next to the label (side-by-side locales). */
  locale?: string | null;
  /** Override the label (forms mode shows the row label once). */
  label?: string;
  hideLabel?: boolean;
  autoFocus?: boolean;
};

function asString(v: FieldValue | null): string {
  return typeof v === 'string' ? v : '';
}
function asList(v: FieldValue | null): string[] {
  return Array.isArray(v) ? v : [];
}

export function FieldEditor({ fieldRef, def, locale, label, hideLabel, autoFocus }: Props) {
  const store = useStore();
  const { t, lang } = useUi();
  const id = useStableId('mc-f');
  const value = store.valueOf(fieldRef);
  const dirty = Boolean(store.draftOf(fieldRef));
  const shown = label ?? labelFor(def.label, lang, store.site.locales);
  const desc = def.description ? labelFor(def.description, lang, store.site.locales) : '';
  const problem = dirty && value !== null ? checkValue(def, value) : null;
  const problemText = problem ? t(`field.${problem.code}` as 'field.required', { limit: problem.limit ?? '' }) : '';
  const set = (v: FieldValue) => store.edit(fieldRef, def, v);
  const describedBy = [desc ? `${id}-d` : '', problem ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined;

  const head = (
    <div className="mc-field-head">
      <label className="mc-label" htmlFor={isMediaKind(def.kind) || def.kind === 'list' ? undefined : id} id={`${id}-l`}>
        {locale ? (
          <>
            <span className="mc-locale" aria-hidden="true">
              {locale.toUpperCase()}
            </span>{' '}
          </>
        ) : null}
        <span className={hideLabel ? 'mc-sr' : undefined}>{shown}</span>
        {locale ? <span className="mc-sr"> ({locale})</span> : null}
      </label>
      {dirty ? <span className="mc-dirty">{t('field.unsaved')}</span> : null}
    </div>
  );

  let control;
  if (def.kind === 'text' || def.kind === 'url' || def.kind === 'multiline') {
    const text = asString(value);
    const count = [...text].length;
    const common = {
      id,
      value: text,
      'aria-invalid': problem ? true : undefined,
      'aria-describedby': describedBy,
      autoFocus,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(e.target.value),
    } as const;
    control = (
      <>
        {def.kind === 'multiline' ? (
          <textarea className="mc-textarea" rows={Math.min(10, Math.max(3, text.split('\n').length + 1))} {...common} />
        ) : (
          <input className="mc-input" type={def.kind === 'url' ? 'url' : 'text'} inputMode={def.kind === 'url' ? 'url' : undefined} {...common} />
        )}
        {def.maxLength && count >= def.maxLength * 0.7 ? (
          <span className={`mc-count${count > def.maxLength ? ' mc-count-over' : ''}`} aria-live="polite">
            {t('field.characters', { count, max: def.maxLength })}
          </span>
        ) : null}
      </>
    );
  } else if (def.kind === 'image' || def.kind === 'video') {
    control = <MediaControl fieldRef={fieldRef} def={def} value={asString(value)} onChange={set} labelId={`${id}-l`} />;
  } else if (def.kind === 'list') {
    control = <ListControl def={def} items={asList(value)} onChange={set} labelId={`${id}-l`} />;
  } else {
    control = <GalleryControl fieldRef={fieldRef} def={def} items={asList(value)} onChange={set} labelId={`${id}-l`} />;
  }

  return (
    <div className="mc-field" role="group" aria-labelledby={`${id}-l`}>
      {head}
      {desc ? (
        <p className="mc-desc" id={`${id}-d`}>
          {desc}
        </p>
      ) : null}
      {control}
      {problem ? (
        <p className="mc-field-error" id={`${id}-e`}>
          {problemText}
        </p>
      ) : null}
      {dirty ? (
        <div>
          <button type="button" className="mc-btn mc-btn-quiet mc-btn-small" onClick={() => store.revertDraft(fieldRef)}>
            {t('field.revert')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function useUpload(fieldRef: FieldRef, def: ResolvedField) {
  const store = useStore();
  const { t } = useUi();
  const [stage, setStage] = useState<'idle' | 'compressing' | 'uploading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const accept = (def.accept ?? store.site.media.accept).filter((m) => (def.kind === 'video' ? m.startsWith('video/') : m.startsWith('image/'))).join(',');

  async function run(file: File): Promise<string | null> {
    setError(null);
    try {
      const path = await store.upload(file, fieldRef, def, setStage);
      store.toast(t('media.uploaded'));
      return path;
    } catch (err) {
      setError(err instanceof Error && err.name === 'UploadCheck' ? err.message : errorText(err, t));
      return null;
    } finally {
      setStage('idle');
    }
  }

  function pick(onPath: (path: string) => void) {
    const el = input.current;
    if (!el) return;
    el.onchange = async () => {
      const file = el.files?.[0];
      el.value = '';
      if (!file) return;
      const path = await run(file);
      if (path) onPath(path);
    };
    el.click();
  }

  const status =
    stage === 'idle' ? null : (
      <span className="mc-progress" role="status">
        <span className="mc-spinner" aria-hidden="true" /> {stage === 'compressing' ? t('media.compressing') : t('media.uploading')}
      </span>
    );
  const hidden = <input ref={input} type="file" accept={accept} hidden tabIndex={-1} aria-hidden="true" />;
  return { pick, busy: stage !== 'idle', status, error, hidden };
}

function Preview({ kind, src, alt }: { kind: 'image' | 'video'; src: string; alt: string }) {
  const { t } = useUi();
  if (!src) return <div className="mc-thumb mc-thumb-empty">{t('media.noPreview')}</div>;
  if (kind === 'video') return <video className="mc-thumb" src={src} muted playsInline controls preload="metadata" aria-label={alt} />;
  return <img className="mc-thumb" src={src} alt={alt} />;
}

function MediaControl({ fieldRef, def, value, onChange, labelId }: { fieldRef: FieldRef; def: ResolvedField; value: string; onChange: (v: string) => void; labelId: string }) {
  const { t } = useUi();
  const up = useUpload(fieldRef, def);
  const kind = def.kind === 'video' ? 'video' : 'image';
  const id = useStableId('mc-m');
  return (
    <div className="mc-media">
      <Preview kind={kind} src={value} alt="" />
      <div className="mc-row">
        <button type="button" className="mc-btn" onClick={() => up.pick(onChange)} disabled={up.busy} aria-describedby={labelId}>
          {kind === 'video' ? t('media.replaceVideo') : t('media.replaceImage')}
        </button>
        {up.status}
      </div>
      {up.error ? (
        <p className="mc-field-error" role="alert">
          {up.error}
        </p>
      ) : null}
      <details className="mc-details">
        <summary>{t('media.link')}</summary>
        <input id={id} className="mc-input" style={{ marginTop: 8 }} type="text" value={value} aria-label={t('media.link')} onChange={(e) => onChange(e.target.value)} />
      </details>
      {up.hidden}
    </div>
  );
}

function move<T>(xs: T[], from: number, to: number): T[] {
  const out = [...xs];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x as T);
  return out;
}

function ListControl({ def, items, onChange, labelId }: { def: ResolvedField; items: string[]; onChange: (v: string[]) => void; labelId: string }) {
  const { t } = useUi();
  const full = def.maxItems != null && items.length >= def.maxItems;
  return (
    <div className="mc-media">
      <ul className="mc-list" aria-labelledby={labelId}>
        {items.map((item, i) => (
          <li key={i} className="mc-list-item">
            <input className="mc-input" value={item} aria-label={t('field.item', { n: i + 1 })} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="mc-icon-btn" aria-label={`${t('field.moveUp')}: ${t('field.item', { n: i + 1 })}`} disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))}>
              ↑
            </button>
            <button type="button" className="mc-icon-btn" aria-label={`${t('field.moveDown')}: ${t('field.item', { n: i + 1 })}`} disabled={i === items.length - 1} onClick={() => onChange(move(items, i, i + 1))}>
              ↓
            </button>
            <button type="button" className="mc-icon-btn" aria-label={`${t('field.removeItem')}: ${t('field.item', { n: i + 1 })}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" className="mc-btn mc-btn-small" disabled={full} onClick={() => onChange([...items, ''])}>
          + {t('field.addItem')}
        </button>
      </div>
    </div>
  );
}

function GalleryControl({ fieldRef, def, items, onChange, labelId }: { fieldRef: FieldRef; def: ResolvedField; items: string[]; onChange: (v: string[]) => void; labelId: string }) {
  const { t } = useUi();
  const up = useUpload(fieldRef, def);
  const full = def.maxItems != null && items.length >= def.maxItems;
  return (
    <div className="mc-media">
      <ul className="mc-gallery" aria-labelledby={labelId}>
        {items.map((src, i) => {
          const name = t('field.photo', { n: i + 1 });
          return (
            <li key={`${i}-${src}`} className="mc-gallery-item">
              <Preview kind="image" src={src} alt={name} />
              <div className="mc-row" style={{ gap: 4 }}>
                <button type="button" className="mc-icon-btn" aria-label={`${t('media.replaceImage')}: ${name}`} disabled={up.busy} onClick={() => up.pick((p) => onChange(items.map((x, j) => (j === i ? p : x))))}>
                  ⤒
                </button>
                <button type="button" className="mc-icon-btn" aria-label={`${t('field.moveUp')}: ${name}`} disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))}>
                  ←
                </button>
                <button type="button" className="mc-icon-btn" aria-label={`${t('field.moveDown')}: ${name}`} disabled={i === items.length - 1} onClick={() => onChange(move(items, i, i + 1))}>
                  →
                </button>
                <button type="button" className="mc-icon-btn" aria-label={`${t('field.removeItem')}: ${name}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mc-row">
        <button type="button" className="mc-btn" disabled={full || up.busy} onClick={() => up.pick((p) => onChange([...items, p]))}>
          + {t('media.addPhoto')}
        </button>
        {up.status}
      </div>
      {up.error ? (
        <p className="mc-field-error" role="alert">
          {up.error}
        </p>
      ) : null}
      {up.hidden}
    </div>
  );
}
