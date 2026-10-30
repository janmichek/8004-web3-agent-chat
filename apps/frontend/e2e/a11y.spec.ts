import { test, expect } from '@playwright/test'
import { gotoWithAgent, setupOffline } from './helpers'

test.describe('accessibility & document basics', () => {
  test('document has lang, title and favicon', async ({ page }) => {
    await setupOffline(page)
    await page.goto('/')
    await expect(page).toHaveTitle(/web3Agent/i)
    await expect(page.locator('html')).toHaveAttribute('lang', /en/)
    await expect(page.locator('link[rel="icon"]')).toHaveCount(1)
  })

  test('chat thread is a polite live region log', async ({ page }) => {
    await setupOffline(page)
    await gotoWithAgent(page)
    const thread = page.getByTestId('chat-thread')
    await expect(thread).toHaveAttribute('role', 'log')
    await expect(thread).toHaveAttribute('aria-live', 'polite')
  })

  test('all buttons have accessible names', async ({ page }) => {
    await setupOffline(page)
    await gotoWithAgent(page)
    const buttons = page.locator('button')
    const count = await buttons.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const name = await buttons.nth(i).evaluate((el) => {
        const label = el.getAttribute('aria-label')
        if (label) return label
        return (el.textContent ?? '').trim()
      })
      expect(name, `button #${i} has no accessible name`).not.toBe('')
    }
  })

  test('select element has a programmatic label', async ({ page }) => {
    await setupOffline(page)
    await gotoWithAgent(page)
    // The select is labelled via aria-label only (no visible <label> element).
    await expect(page.getByTestId('agent-select')).toHaveAttribute('aria-label', 'Select agent')
  })

  test('images have alt text', async ({ page }) => {
    await setupOffline(page)
    await page.goto('/')
    const images = page.locator('img')
    const count = await images.count()
    for (let i = 0; i < count; i++) {
      await expect(images.nth(i)).toHaveAttribute('alt', /.+/)
    }
  })
})
