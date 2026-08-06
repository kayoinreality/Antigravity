import { defineConfig, devices } from '@playwright/test'

/**
 * CHROMIUM_PATH lets a machine that already has a Chromium point at it instead
 * of downloading one — CI images often ship a build whose revision does not
 * match this Playwright version, and the mismatch is a hard failure rather
 * than a fallback. On a normal dev machine `npx playwright install` covers it
 * and the variable stays unset.
 */
const executablePath = process.env.CHROMIUM_PATH

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
