import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'maestro — reviewer',
  description: 'Read specs, discuss, and decide gates (ADR-0015).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
