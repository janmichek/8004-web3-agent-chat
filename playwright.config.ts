import { defineConfig, devices } from '@playwright/test'

const FRONTEND = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173'
const ONCHAIN = process.env.PLAYWRIGHT_ONCHAIN === '1'
const CI = !!process.env.CI

const FULL_MATRIX = process.env.PLAYWRIGHT_MATRIX === 'all' || CI

export default defineConfig({
  testDir: './frontend/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Offline (mocked) specs run in parallel; on-chain specs must stay serial.
  fullyParallel: true,
  workers: ONCHAIN ? 1 : CI ? 2 : undefined,
  retries: CI ? 2 : 1,
  // Skip @onchain specs unless explicitly opted in — they spend gas / hit testnet.
  grepInvert: ONCHAIN ? undefined : /@onchain/,
  reporter: process.env.CI ? [['github'], ['list'], ['blob']] : [['list'], ['html', { open: 'never' }]],
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
    command: 'npx vite frontend --port 5173 --strictPort',
    url: FRONTEND,
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  // Fast locally (chromium only); full matrix in CI or with PLAYWRIGHT_MATRIX=all.
  // Local full run: PLAYWRIGHT_MATRIX=all npx playwright test
  projects: FULL_MATRIX
    ? [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
      ]
    : [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
