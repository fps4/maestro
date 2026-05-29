import Link from 'next/link';
import type { Metadata } from 'next';
import { IdentitySwitcher } from '@/components/identity-switcher';
import './globals.css';

export const metadata: Metadata = {
  title: 'maestro — reviewer',
  description: 'Read specs, discuss, and decide gates (ADR-0015).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b">
          <div className="container mx-auto flex items-center justify-between px-6 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              maestro
            </Link>
            <IdentitySwitcher />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
