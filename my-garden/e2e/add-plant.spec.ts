import { test, expect } from '@playwright/test';
import { login, clickEmptyYardSpot, deletePlantIfPresent } from './helpers';

test('adding a plant saves it and shows it on the yard', async ({ page }) => {
  const plantName = `E2E Test Plant ${Date.now()}`;

  try {
    await login(page);
    await clickEmptyYardSpot(page);

    await expect(page.getByRole('heading', { name: 'Add Plant' })).toBeVisible();
    await page.getByPlaceholder('e.g., Tomato Plant').fill(plantName);
    await page.getByRole('button', { name: 'Add Plant', exact: true }).click();

    // The modal closes and the new marker appears once the save round-trips.
    const marker = page.getByRole('button', { name: new RegExp(`^${plantName} —`) });
    await expect(marker).toBeVisible({ timeout: 10_000 });
  } finally {
    // Always attempt cleanup, even on assertion failure — an orphaned test
    // plant breaks the *next* run, not just this one.
    await deletePlantIfPresent(page, plantName);
  }
});
