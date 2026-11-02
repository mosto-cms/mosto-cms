import type { ReactNode } from 'react';

import { MostoOverlay } from '@mosto-cms/next/overlay';

export const metadata = { title: 'Trattoria Starter' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', color: '#1b1b1b', background: '#fbfaf7' }}>
        {children}
        {/* Click-to-edit inside /admin; does nothing for visitors. */}
        <MostoOverlay />
      </body>
    </html>
  );
}
