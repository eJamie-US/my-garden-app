import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('logs in and lands on the yard view', async ({ page }) => {
  await login(page);
  await expect(page.getByAltText('Garden yard')).toBeVisible();
  await expect(page.getByText('Due today')).toBeVisible();
});
