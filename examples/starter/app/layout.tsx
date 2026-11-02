import type { ReactNode } from 'react';

export const metadata = { title: 'Mosto CMS starter' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', color: '#1b1b1b', background: '#fbfaf7' }}>
        {children}
      </body>
    </html>
  );
}
