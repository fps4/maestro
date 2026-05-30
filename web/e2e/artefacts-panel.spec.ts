import { expect, test } from '@playwright/test';

// Smoke (US-0033): the task page renders the artefacts panel from the read API's stored_artefacts,
// and the "View" link resolves through the workspace artefact route → the (stubbed) presigned URL.
// Backed by e2e/stub-api.mjs (see playwright.config.ts). Proves the server-fetch → render wiring and
// the identity-forwarding redirect end to end, in a real browser.

test('artefacts panel lists a task artefact and View resolves through the redirect route', async ({
  page,
}) => {
  await page.goto('/products/maestro/tasks/task-smoke-1');

  // The panel and its one artefact render.
  await expect(page.getByText('Artefacts', { exact: true })).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: 'pr-diff.patch' });
  await expect(item).toBeVisible();
  await expect(item.getByText('PR diff')).toBeVisible();
  await expect(item.getByText(/2\.0 KB/)).toBeVisible();

  // The View link points at the workspace route (not the raw /api/... href), and following it lands
  // on the (stubbed) presigned content after the server-side identity-forwarding 302.
  const view = item.getByRole('link', { name: 'View' });
  await expect(view).toHaveAttribute('href', '/products/maestro/artifacts/tasks/task-smoke-1/pr-diff.patch');

  await view.click();
  await expect(page.locator('body')).toContainText('fake presigned artefact body');
});
