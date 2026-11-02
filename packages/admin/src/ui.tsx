import { useEffect, useId, useState, type ReactNode } from 'react';

import { AdminError } from './client.js';
import { useUi } from './context.js';
import type { MessageKey, Translate } from './i18n.js';

export const POWERED_BY_URL = 'https://mosto.studio/?utm_source=mosto-cms&utm_medium=admin';

export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
      <span className="mc-spinner" aria-hidden="true" />
      {label ? <span className="mc-muted">{label}</span> : null}
    </span>
  );
}

/** A readable sentence for any failure, in the admin's language. */
export function errorText(err: unknown, t: Translate): string {
  if (err instanceof AdminError) {
    const key = `error.${err.code}` as MessageKey;
    return t(key, { detail: err.message });
  }
  return t('error.internal');
}

export function Notice({ tone = 'warn', children, actions }: { tone?: 'warn' | 'error'; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`mc-notice${tone === 'error' ? ' mc-notice-error' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {actions ? <div className="mc-row">{actions}</div> : null}
    </div>
  );
}

export function PoweredBy() {
  const { t } = useUi();
  return (
    <a className="mc-powered" href={POWERED_BY_URL} target="_blank" rel="noopener">
      {t('poweredBy')}
    </a>
  );
}

export function Toasts({ items }: { items: Array<{ id: number; text: string }> }) {
  return (
    <div className="mc-toast-zone" aria-live="polite" aria-atomic="false">
      {items.map((i) => (
        <div key={i.id} className="mc-toast">
          {i.text}
        </div>
      ))}
    </div>
  );
}

export function useToasts(): [Array<{ id: number; text: string }>, (text: string) => void] {
  const [items, setItems] = useState<Array<{ id: number; text: string }>>([]);
  const push = (text: string) => {
    const id = Date.now() + Math.random();
    setItems([{ id, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  };
  return [items, push];
}

/** True on touch-first devices (phones, tablets). */
export function useTouch(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia('(pointer: coarse)');
    setTouch(q.matches);
    const on = () => setTouch(q.matches);
    q.addEventListener?.('change', on);
    return () => q.removeEventListener?.('change', on);
  }, []);
  return touch;
}

export function useStableId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}
