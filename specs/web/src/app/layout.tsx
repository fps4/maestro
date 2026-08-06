import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'mstr-specs',
  description:
    'A governed specification service — specifications, standards, and the bindings that connect them.',
};

/**
 * The document, and nothing else.
 *
 * No header, no rail, no chrome of any kind. Those live inside `(app)/layout.tsx`, which awaits a
 * session before it returns anything — so a visitor without one never receives markup containing
 * them. There is nothing to hide and nothing to flash.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
