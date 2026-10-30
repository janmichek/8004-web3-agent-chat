import { test, expect } from '@playwright/test'
import { setupOffline } from './helpers'

test.describe('wallet bar (Web3Auth sign-in)', () => {
  test('disconnected state shows the sign-in CTA and no address', async ({ page }) => {
    await setupOffline(page)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('header .addr')).toHaveCount(0)
    await expect(page.locator('header .balance')).toHaveCount(0)
  })

  test('sign-in CTA is enabled and clickable when disconnected', async ({ page }) => {
    await setupOffline(page)
    await page.goto('/')
    const btn = page.getByRole('button', { name: /Sign in|Preparing/ })
    // Wait for Web3Auth modal init (needs absolute https rpcTarget).
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled({ timeout: 30_000 })
    // Opens Web3Auth modal (third-party); we only assert the click is accepted.
    await btn.click()
    await expect(btn).toBeVisible()
  })
})
