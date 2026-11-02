/**
 * The `/admin` mount: the Mosto CMS editing interface (`@mosto-cms/admin`),
 * rendered on the site itself.
 *
 *   // app/admin/[[...admin]]/page.tsx
 *   import { createAdminPage, adminMetadata } from '@mosto-cms/next/admin';
 *   import { cms } from '@/mosto-cms.config';
 *   export const metadata = adminMetadata;
 *   export const dynamic = 'force-dynamic';
 *   export default createAdminPage(cms);
 *
 * The server reads the session cookie and passes only the signed-in editor
 * (or nobody) to the client; the schema and content are fetched by the
 * interface through `/api/mosto-cms`, after sign-in.
 */
import { cookies } from 'next/headers';
import type { ReactElement } from 'react';

import { MostoAdmin } from '@mosto-cms/admin';
import { SESSION_COOKIE_DEV, SESSION_COOKIE_SECURE, type Session } from '@mosto-cms/auth';

import type { AdminOptions, MostoCmsSite } from './site.js';

export const adminMetadata = {
  title: 'Mosto CMS',
  robots: { index: false, follow: false },
  referrer: 'same-origin',
};

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function siteName(site: MostoCmsSite): string {
  try {
    return site.getSchema().site?.name ?? '';
  } catch {
    return '';
  }
}

export function createAdminPage(site: MostoCmsSite, overrides: AdminOptions = {}) {
  const options: AdminOptions = { ...site.admin, ...overrides };
  return async function MostoCmsAdminPage(props: PageProps): Promise<ReactElement> {
    const params = (props.searchParams ? await props.searchParams : {}) ?? {};
    const store = await cookies();
    const token = store.get(SESSION_COOKIE_SECURE)?.value ?? store.get(SESSION_COOKIE_DEV)?.value ?? null;

    let session: Session | null;
    try {
      session = site.editorAuth().getSessionFromToken(token);
    } catch (err) {
      // Missing or short MOSTO_CMS_SECRET: a message for the developer, no form.
      const message = err instanceof Error ? err.message : String(err);
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f2ece0', color: '#1a1714', font: '15px/1.55 system-ui, sans-serif', padding: 24 }}>
          <div style={{ maxWidth: 480, background: '#faf7f1', border: '1px solid #e3dbcc', borderRadius: 12, padding: 32 }}>
            <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 500, fontSize: 26, margin: '0 0 8px' }}>Mosto CMS is not configured yet</h1>
            <p style={{ margin: 0, color: '#665e53' }}>{message}</p>
          </div>
        </main>
      );
    }

    const error = typeof params.error === 'string' && (params.error === 'invalid' || params.error === 'locked') ? params.error : null;
    return (
      <MostoAdmin
        apiPath={site.apiPath}
        adminPath={site.adminPath}
        siteName={siteName(site)}
        editor={session ? { email: session.email, name: session.name } : null}
        loginError={error}
        {...(options.pages ? { pages: options.pages } : {})}
        {...(options.poweredBy === false ? { poweredBy: false } : {})}
        {...(options.language ? { language: options.language } : {})}
      />
    );
  };
}
