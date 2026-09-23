import { test, expect } from '@playwright/test'
import { gotoWithAgent, openCreateDialog, setupOffline } from './helpers'

/**
 * Hardening for the staged image upload path (CreateAgent.submitCreate uploads
 * at creation time). Previously only the happy path + client-side type
 * rejection were covered — a 500/400/aborted upload left phase/error
 * assertions untested.
 */

async function stageImageAndSubmit(page: import('@playwright/test').Page, name: string) {
  await openCreateDialog(page)
  await page.getByTestId('create-name-input').fill(name)
  await page
    .getByTestId('create-image-input')
    .setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    })
  await expect(page.getByTestId('create-image-ready')).toContainText('uploads when you create')
  await page.getByTestId('create-name-continue').click()
  await expect(page.getByTestId('create-action-transfer-eth')).toBeVisible()
  const dialog = page.getByTestId('create-dialog')
  await dialog.getByRole('button', { name: 'Next →' }).click()
  await dialog.getByRole('button', { name: 'Create agent' }).click()
}

test.describe('create agent — image upload failures', () => {
  test('500 from IPFS backend shows Creation failed and sends no create request', async ({
    page,
  }) => {
    const created: unknown[] = []
    await setupOffline(page, { capture: { create: created } })
    await page.route('**/api/upload/image', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Pinata upload failed (500): boom' }),
      })
    })
    await gotoWithAgent(page)
    await stageImageAndSubmit(page, 'upload-500-agent')

    await expect(page.getByText('Creation failed')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('create-dialog')).toContainText(/boom|500/)
    // Upload happens before POST /api/agents — the agent must NOT be created.
    expect(created).toHaveLength(0)
    // Back returns to the OASF step so the user can retry without losing input.
    await page.getByRole('button', { name: '← Back' }).click()
    await expect(page.getByTestId('create-oasf-domain-6')).toBeVisible()
  })

  test('400 oversize image surfaces the backend message', async ({ page }) => {
    const created: unknown[] = []
    await setupOffline(page, { capture: { create: created } })
    await page.route('**/api/upload/image', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Image is too large (max 5 MB)' }),
      })
    })
    await gotoWithAgent(page)
    await stageImageAndSubmit(page, 'upload-400-agent')

    await expect(page.getByText('Creation failed')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('create-dialog')).toContainText('max 5 MB')
    expect(created).toHaveLength(0)
  })

  test('aborted upload can be recovered with Retry', async ({ page }) => {
    const created: unknown[] = []
    await setupOffline(page, { capture: { create: created } })
    let attempts = 0
    await page.route('**/api/upload/image', async (route) => {
      attempts += 1
      if (attempts === 1) {
        await route.abort('failed')
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, imageUri: 'ipfs://bafkreiretryok' }),
      })
    })
    await gotoWithAgent(page)
    await stageImageAndSubmit(page, 'upload-retry-agent')

    await expect(page.getByText('Creation failed')).toBeVisible({ timeout: 15_000 })
    expect(attempts).toBe(1)
    // Retry re-uploads (attempt 2 succeeds) and completes creation.
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Agent created')).toBeVisible({ timeout: 15_000 })
    expect(attempts).toBe(2)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ imageUri: 'ipfs://bafkreiretryok' })
  })
})
