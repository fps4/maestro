import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Component-test harness for the workspace webapp (US-0033). jsdom + Testing Library; the Next.js
// server pieces (route handlers, server components that fetch) are exercised by the Playwright smoke,
// not here — Vitest covers the pure render/interaction logic of client components.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['components/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
});
