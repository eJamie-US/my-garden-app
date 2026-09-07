// e2e/helpers.ts
// Shared login for the dedicated e2e-test@my-garden-app.test account (see
// .env.test.local). Logs in fresh each test rather than reusing a saved
// session — this suite is small enough that the extra few seconds per
// test is worth the simplicity/robustness over managing storageState
// against Supabase's own localStorage-based session.

import type { Page } from '@playwright/test';

export async function login(page: Page): Promise<void> {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set — check .env.test.local');
  }

  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log In' }).click();

  // Lands on the yard view once authenticated — "Due today" is the first
  // thing rendered below the banner regardless of which yard/plants exist.
  await page.getByText('Due today').waitFor({ state: 'visible', timeout: 15_000 });
}

/** Clicks an empty patch of the yard photo, away from any existing marker
 *  clusters, to start the Add Plant flow without landing on another plant. */
export async function clickEmptyYardSpot(page: Page): Promise<void> {
  const yardImage = page.getByAltText('Garden yard');
  await yardImage.waitFor({ state: 'visible' });
  const box = await yardImage.boundingBox();
  if (!box) throw new Error('Yard image has no bounding box');
  // Near the top-left corner, away from the default obstacle/plant layout.
  await page.mouse.click(box.x + box.width * 0.08, box.y + box.height * 0.08);
}

/** Best-effort delete by name — call from a test's `finally` block so a
 *  failed assertion still cleans up, instead of leaving an orphaned plant
 *  that then breaks the *next* run (clickEmptyYardSpot's fixed coordinate
 *  hits the leftover marker and opens the "choose a plant" picker instead
 *  of Add Plant — this exact failure mode happened once already). Never
 *  throws: a cleanup failure shouldn't mask the test's real failure. */
export async function deletePlantIfPresent(page: Page, plantName: string): Promise<void> {
  try {
    const marker = page.getByRole('button', { name: new RegExp(`^${plantName} —`) });
    // .count() is an immediate, non-waiting check — unlike isVisible(),
    // which doesn't actually accept a timeout option, so passing one threw
    // and was silently swallowed by the catch below, making this whole
    // function a silent no-op even when there was something to delete.
    if ((await marker.count()) === 0) return;
    await marker.first().click({ timeout: 3_000 });
    await page.getByRole('button', { name: 'Delete plant' }).click({ timeout: 3_000 });
    await page.getByRole('button', { name: 'Delete', exact: true }).click({ timeout: 3_000 });
    // The delete is async (a real Supabase round-trip) — without waiting
    // for the marker to actually disappear, this function returns (and the
    // test, and its browser context) before the request finishes, so the
    // click "succeeds" but the row never actually gets deleted.
    await marker.first().waitFor({ state: 'detached', timeout: 5_000 });
  } catch (err) {
    console.error(`Cleanup: could not delete "${plantName}" — may need manual removal.`, err);
  }
}
