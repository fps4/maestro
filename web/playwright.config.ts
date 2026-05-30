import { defineConfig, devices } from '@playwright/test';

// One end-to-end **smoke** for the artefacts panel (US-0033). It boots a tiny stub of the read API
// (e2e/stub-api.mjs) and the Next.js app pointed at it, then asserts the panel renders a task's
// stored artefacts in a real browser. Heavier coverage lives in the Vitest component tests; this
// proves the page wiring (server fetch → render) holds end to end.
const STUB_PORT = 8811;
const WEB_PORT = 3035;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node e2e/stub-api.mjs ${STUB_PORT}`,
      url: `http://127.0.0.1:${STUB_PORT}/api/products`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `next dev -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        MAESTRO_API_URL: `http://127.0.0.1:${STUB_PORT}`,
        MAESTRO_DEV_IDENTITY: 'arch@example.com',
        MAESTRO_ENV: 'development',
      },
    },
  ],
});
