// e2e/drag-plant.spec.ts
// Regression test for a real bug this session: a plant marker visually
// followed the drag, then appeared to "snap back" — actually caused by the
// fan-out clustering re-arranging its *display* position, not the drag
// itself failing. The only way to really catch that class of bug is to
// reload afterward and confirm the position that comes back from the
// database (not just what's on screen right after the drop) matches where
// it was actually dropped.

import { test, expect, type Page } from '@playwright/test';
import { login, clickEmptyYardSpot, deletePlantIfPresent } from './helpers';

async function getMarkerPosition(page: Page, name: string) {
  return page.evaluate((plantName) => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.startsWith(`${plantName} —`),
    );
    if (!btn) return null;
    let el: HTMLElement | null = btn.parentElement;
    while (el && !el.style.left) el = el.parentElement;
    return el ? { left: el.style.left, top: el.style.top } : null;
  }, name);
}

test('dragging a plant persists its new position after reload', async ({ page }) => {
  const plantName = `E2E Drag Plant ${Date.now()}`;

  try {
    await login(page);
    await clickEmptyYardSpot(page);
    await page.getByPlaceholder('e.g., Tomato Plant').fill(plantName);
    await page.getByRole('button', { name: 'Add Plant', exact: true }).click();

    const marker = page.getByRole('button', { name: new RegExp(`^${plantName} —`) });
    await expect(marker).toBeVisible({ timeout: 10_000 });

    const before = await getMarkerPosition(page, plantName);
    expect(before).not.toBeNull();

    const box = await marker.boundingBox();
    if (!box) throw new Error('Marker has no bounding box');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Drag well away from the starting corner — real mouse events, not a
    // synthetic CDP injection, so this exercises the same pointer-capture
    // path a real user's drag does.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 250, startY + 150, { steps: 15 });
    const savedResponse = page.waitForResponse(
      (res) => res.url().includes('/rest/v1/plants') && res.request().method() === 'PATCH',
      { timeout: 10_000 },
    );
    await page.mouse.up();
    // The drop is shown optimistically before the save round-trip finishes —
    // without waiting for the real PATCH to resolve, a reload right after
    // can race ahead of it and read back the pre-drag location instead.
    await savedResponse;

    const afterDrop = await getMarkerPosition(page, plantName);
    expect(afterDrop).not.toBeNull();
    expect(afterDrop!.left).not.toBe(before!.left);

    // The real regression check: reload from scratch and confirm the saved
    // location (not just the optimistic on-screen one) matches the drop.
    await page.reload();
    await expect(marker).toBeVisible({ timeout: 10_000 });
    const afterReload = await getMarkerPosition(page, plantName);
    expect(afterReload).not.toBeNull();
    expect(afterReload!.left).toBe(afterDrop!.left);
    expect(afterReload!.top).toBe(afterDrop!.top);
  } finally {
    await deletePlantIfPresent(page, plantName);
  }
});
