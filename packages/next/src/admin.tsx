/**
 * The `/admin` mount. In this release it is the sign-in page and a status
 * page; the editing interface (visual mode, forms, history) comes with
 * `@mosto-cms/admin`, mounted at the same place.
 *
 *   // app/admin/[[...admin]]/page.tsx
 *   import { createAdminPage, adminMetadata } from '@mosto-cms/next/admin';
 *   import { cms } from '@/mosto-cms.config';
 *   export const metadata = adminMetadata;
 *   export const dynamic = 'force-dynamic';
 *   export default createAdminPage(cms);
 *
 * Plain HTML forms, no client JavaScript: sign-in and sign-out post to the
 * route handler, which answers with a redirect.
 */
import { cookies } from 'next/headers';
import type { CSSProperties, ReactElement } from 'react';

import { labelText } from '@mosto-cms/core';
import { SESSION_COOKIE_DEV, SESSION_COOKIE_SECURE, type Session } from '@mosto-cms/auth';

import type { MostoCmsSite } from './site.js';

export const adminMetadata = {
  title: 'Mosto CMS',
  robots: { index: false, follow: false },
};

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ERRORS: Record<string, string> = {
  invalid: 'Wrong email or password.',
  locked: 'Too many failed attempts. Try again in a few minutes.',
};

const s: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f6f6f4', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#111', margin: 0 },
  card: { width: 'min(420px, calc(100vw - 32px))', background: '#fff', border: '1px solid #e4e4e0', borderRadius: 12, padding: 28, boxSizing: 'border-box' },
  h1: { fontSize: 18, fontWeight: 600, margin: '0 0 4px' },
  muted: { color: '#666', fontSize: 14, margin: '0 0 20px', lineHeight: 1.5 },
  label: { display: 'block', fontSize: 13, fontWeight: 500, margin: '14px 0 6px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', fontSize: 15, border: '1px solid #d4d4cf', borderRadius: 8 },
  button: { marginTop: 20, width: '100%', padding: '11px 12px', fontSize: 15, fontWeight: 600, color: '#fff', background: '#111', border: 0, borderRadius: 8, cursor: 'pointer' },
  secondary: { marginTop: 20, padding: '9px 12px', fontSize: 14, color: '#111', background: '#fff', border: '1px solid #d4d4cf', borderRadius: 8, cursor: 'pointer' },
  error: { background: '#fdecec', color: '#8a1c1c', fontSize: 14, padding: '10px 12px', borderRadius: 8, margin: '0 0 8px' },
  list: { margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: 14 },
  item: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #efefeb' },
};

export function createAdminPage(site: MostoCmsSite) {
  return async function MostoCmsAdminPage(props: PageProps): Promise<ReactElement> {
    const params = (props.searchParams ? await props.searchParams : {}) ?? {};
    const store = await cookies();
    const token = store.get(SESSION_COOKIE_SECURE)?.value ?? store.get(SESSION_COOKIE_DEV)?.value ?? null;

    let session: Session | null = null;
    let configError: string | null = null;
    try {
      session = site.editorAuth().getSessionFromToken(token);
    } catch (err) {
      configError = err instanceof Error ? err.message : String(err);
    }

    if (configError) {
      return (
        <main style={s.page}>
          <div style={s.card}>
            <h1 style={s.h1}>Mosto CMS is not configured yet</h1>
            <p style={s.muted}>{configError}</p>
          </div>
        </main>
      );
    }

    if (!session) {
      const error = typeof params.error === 'string' ? ERRORS[params.error] : undefined;
      return (
        <main style={s.page}>
          <form method="post" action={`${site.apiPath}/login`} style={s.card}>
            <h1 style={s.h1}>Sign in</h1>
            <p style={s.muted}>Edit the content of this site.</p>
            {error ? <p role="alert" style={s.error}>{error}</p> : null}
            <input type="hidden" name="next" value={site.adminPath} />
            <input type="hidden" name="back" value={site.adminPath} />
            <label style={s.label} htmlFor="mosto-email">Email</label>
            <input style={s.input} id="mosto-email" name="email" type="email" autoComplete="username" required />
            <label style={s.label} htmlFor="mosto-password">Password</label>
            <input style={s.input} id="mosto-password" name="password" type="password" autoComplete="current-password" required />
            <button style={s.button} type="submit">Sign in</button>
          </form>
        </main>
      );
    }

    let collections: Array<{ key: string; label: string; fields: number }> = [];
    try {
      collections = site.getSchema().collections.map((c) => ({ key: c.key, label: labelText(c.label), fields: c.fields.length }));
    } catch (err) {
      configError = err instanceof Error ? err.message : String(err);
    }

    return (
      <main style={s.page}>
        <div style={s.card}>
          <h1 style={s.h1}>Signed in as {session.name}</h1>
          <p style={s.muted}>
            {session.email}. The editing interface is not part of this release yet; the content
            endpoint <code>{site.apiPath}</code> is ready.
          </p>
          {configError ? <p role="alert" style={s.error}>{configError}</p> : null}
          <ul style={s.list} aria-label="Editable collections">
            {collections.map((c) => (
              <li key={c.key} style={s.item}>
                <span>{c.label}</span>
                <span style={{ color: '#666' }}>{c.fields} fields</span>
              </li>
            ))}
          </ul>
          <form method="post" action={`${site.apiPath}/logout`}>
            <input type="hidden" name="next" value={site.adminPath} />
            <button style={s.secondary} type="submit">Sign out</button>
          </form>
        </div>
      </main>
    );
  };
}
