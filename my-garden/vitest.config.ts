import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // e2e/ holds Playwright specs (playwright.config.ts runs those) — they
    // use @playwright/test's own test()/expect(), which vitest can't run.
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
});
