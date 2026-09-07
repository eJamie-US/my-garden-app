// playwright.config.ts
// Runs against the real dev server + real Supabase backend, authenticated
// as the dedicated e2e-test@my-garden-app.test account (see
// .env.test.local — gitignored, never your real garden). Deliberately not
// mocked: this app has already shipped real bugs (RLS obstacle leaks,
// clustering overlap, section-zoom distortion) that only a real backend
// round-trip would catch.

import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.test.local' });

export default defineConfig({
  testDir: './e2e',
  // fullyParallel only controls tests *within* one file — different spec
  // files still run in separate workers by default. This suite shares one
  // real account/yard across every test, so true parallelism means two
  // tests' plants can land in the same fan-out cluster and shift each
  // other's display position (caught exactly this way once already).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
