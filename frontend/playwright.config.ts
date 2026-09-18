import { defineConfig, devices } from '@playwright/test'

const FRONTEND = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'
const ONCHAIN = process.env.PLAYWRIGHT_ONCHAIN === '1'
const CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Offline (mocked) specs run in parallel; on-chain specs must stay serial.
  fullyParallel: true,
  workers: ONCHAIN ? 1 : undefined,
  retries: CI ? 2 : 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: FRONTEND,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  // Auto-start Vite when it isn't already running (`--reuse` keeps `npm run dev` workflows fast).
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: FRONTEND,
    reuseExistingServer: !CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
