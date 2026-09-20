import { test, expect, type Page } from '@playwright/test'
import { DEMO_AGENT, gotoWithAgent, openCreateDialog, setupOffline } from './helpers'

async function toConfigure(page: import('@playwright/test').Page) {
  await openCreateDialog(page)
  await page.getByTestId('create-name-input').fill('my-agent')
  await page.getByTestId('create-name-continue').click()
  await expect(page.getByTestId('create-action-transfer-eth')).toBeVisible()
}

test.describe('create agent wizard', () => {
  test('shows environment + validates agent name', async ({ page }) => {
    await setupOffline(page, {})
    await gotoWithAgent(page)
    await openCreateDialog(page)
    // env from catalog
    await expect(page.getByTestId('create-dialog')).toContainText('Arbitrum Sepolia')
    await expect(page.getByTestId('create-dialog')).toContainText('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

    const input = page.getByTestId('create-name-input')
    const next = page.getByTestId('create-name-continue')
    await expect(next).toBeDisabled() // empty
    await input.fill('-bad start')
    await expect(next).toBeDisabled()
    await input.fill('a'.repeat(64))
    await expect(next).toBeDisabled()
    await input.fill('good-name_1.x')
    await expect(next).toBeEnabled()
    // Enter key advances too
    await input.press('Enter')
    await expect(page.getByTestId('create-action-transfer-eth')).toBeVisible()
  })

  test('shows a banner when catalog fails to load', async ({ page }) => {
    await setupOffline(page, { catalogStatus: 500 })
    await gotoWithAgent(page)
    await openCreateDialog(page)
    await expect(page.getByTestId('create-load-error')).toContainText('catalog boom')
  })

  test('transfer-eth action is mutually exclusive with its tools', async ({ page }) => {
    await setupOffline(page, {})
    await gotoWithAgent(page)
    await toConfigure(page)

    const actionBox = page.getByTestId('create-action-transfer-eth')
    const sendBox = page.getByTestId('create-tool-send_eth')
    const balBox = page.getByTestId('create-tool-get_token_balance')
    const actionLabel = page.locator('label', { has: actionBox })

    // pick both standalone tools -> action goes pale
    await sendBox.check()
    await balBox.check()
    await expect(actionLabel).toHaveClass(/pale/)

    // picking the action deselects the standalone tools
    await actionBox.check()
    await expect(sendBox).not.toBeChecked()
    await expect(balBox).not.toBeChecked()

    // picking a constituent tool deselects the action again
    await sendBox.check()
    await expect(actionBox).not.toBeChecked()
    await expect(actionLabel).toHaveClass(/pale/)
  })

  test('completes the wizard and opens chat for the new agent', async ({ page }) => {
    const created: unknown[] = []
    const newAgent = { ...DEMO_AGENT, name: 'fresh-agent' }
    await setupOffline(page, {
      capture: { create: created },
      create: {
        ok: true,
        agent: newAgent,
        balanceEth: '0.002',
        steps: [
          { step: 'wallet', ok: true },
          { step: 'fund', ok: true },
          { step: 'config', ok: true },
          { step: 'register', ok: true, detail: '42' },
        ],
      },
    })
    await gotoWithAgent(page)
    await toConfigure(page)
    await page.getByTestId('create-action-transfer-eth').check()
    await page.getByRole('button', { name: 'Next →' }).last().click() // configure -> oasf
    await expect(page.getByTestId('create-oasf-domain-6')).toBeVisible()
    await page.getByTestId('create-dialog').getByRole('button', { name: 'Create agent' }).click()
    await expect(page.getByText('Agent created')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('create-dialog')).toContainText('fresh-agent')
    await expect(page.getByTestId('create-dialog')).toContainText('wallet')
    // funding now lives on the done step
    await expect(page.getByTestId('create-fund-panel')).toBeVisible()
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ name: 'my-agent' })
    expect(created[0]).toMatchObject({
      services: [
        { name: 'web', endpoint: 'https://example.com' },
        { name: 'email', endpoint: 'e@mail.fun' },
      ],
    })

    await page.getByRole('button', { name: 'Open chat' }).click()
    await expect(page.getByTestId('create-dialog')).toHaveCount(0)
    // wizard selected the new agent in the picker
    await expect(page.getByTestId('agent-select')).toHaveValue('fresh-agent', { timeout: 15000 })
  })

  test('post-creation fund amount validation gates funding', async ({ page }) => {
    const newAgent = { ...DEMO_AGENT, name: 'fresh-agent' }
    await setupOffline(page, {
      create: {
        ok: true,
        agent: newAgent,
        balanceEth: '0',
        steps: [
          { step: 'wallet', ok: true },
          { step: 'config', ok: true },
          { step: 'register', ok: true, detail: '42' },
        ],
      },
    })
    await gotoWithAgent(page)
    await toConfigure(page)
    await page.getByRole('button', { name: 'Next →' }).last().click()
    await page.getByTestId('create-dialog').getByRole('button', { name: 'Create agent' }).click()
    await expect(page.getByText('Agent created')).toBeVisible({ timeout: 15000 })
    const fundInput = page.getByTestId('create-fund-amount')
    const masterBtn = page.getByTestId('create-fund-master')
    const walletBtn = page.getByTestId('create-fund-wallet')
    await expect(masterBtn).toBeEnabled()
    await expect(walletBtn).toBeEnabled()
    await fundInput.fill('99')
    await expect(masterBtn).toBeDisabled()
    await expect(walletBtn).toBeDisabled()
    await fundInput.fill('-1')
    await expect(masterBtn).toBeDisabled()
    await fundInput.fill('abc')
    await expect(masterBtn).toBeDisabled()
    await fundInput.fill('0')
    await expect(masterBtn).toBeDisabled() // 0 = nothing to fund
    await fundInput.fill('0.001')
    await expect(masterBtn).toBeEnabled()
  })

  test('post-creation master-wallet funding shows tx status', async ({ page }) => {
    const newAgent = { ...DEMO_AGENT, name: 'fresh-agent' }
    const funded: unknown[] = []
    await setupOffline(page, {
      capture: { fund: funded },
      create: {
        ok: true,
        agent: newAgent,
        balanceEth: '0',
        steps: [
          { step: 'wallet', ok: true },
          { step: 'config', ok: true },
          { step: 'register', ok: true, detail: '42' },
        ],
      },
      fund: {
        ok: true,
        txHash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        amountEth: '0.001',
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    })
    await gotoWithAgent(page)
    await toConfigure(page)
    await page.getByRole('button', { name: 'Next →' }).last().click()
    await page.getByTestId('create-dialog').getByRole('button', { name: 'Create agent' }).click()
    await expect(page.getByText('Agent created')).toBeVisible({ timeout: 15000 })
    await page.getByTestId('create-fund-amount').fill('0.001')
    await page.getByTestId('create-fund-master').click()
    await expect(page.getByTestId('create-fund-status')).toContainText('0xeeeeee')
    expect(funded).toHaveLength(1)
  })

  test('creation failure shows error screen with Back + Retry', async ({ page }) => {
    await setupOffline(page, { createStatus: 409 })
    await gotoWithAgent(page)
    await toConfigure(page)
    await page.getByRole('button', { name: 'Next →' }).last().click()
    await page.getByTestId('create-dialog').getByRole('button', { name: 'Create agent' }).click()
    await expect(page.getByText('Creation failed')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('create-dialog')).toContainText('already exists')
    // Back returns to the OASF step
    await page.getByRole('button', { name: '← Back' }).click()
    await expect(page.getByTestId('create-oasf-domain-6')).toBeVisible()
  })

  test('Back buttons navigate configure <-> oasf <-> env', async ({ page }) => {
    await setupOffline(page, {})
    await gotoWithAgent(page)
    await toConfigure(page)
    await page.getByRole('button', { name: 'Next →' }).last().click()
    await expect(page.getByTestId('create-oasf-domain-6')).toBeVisible()
    await page.getByRole('button', { name: '← Back' }).click()
    await expect(page.getByTestId('create-action-transfer-eth')).toBeVisible()
    await page.getByRole('button', { name: '← Back' }).click()
    await expect(page.getByTestId('create-name-input')).toBeVisible()
  })

  test('step 1 sends prefilled web/email services with creation', async ({ page }) => {
    const created: unknown[] = []
    await setupOffline(page, { capture: { create: created } })
    await gotoWithAgent(page)
    await openCreateDialog(page)
    await expect(page.getByTestId('create-web-endpoint')).toHaveValue('https://example.com')
    await expect(page.getByTestId('create-email-endpoint')).toHaveValue('e@mail.fun')
    await page.getByTestId('create-name-input').fill('my-agent')
    await page.getByTestId('create-name-continue').click()
    await expect(page.getByTestId('create-action-transfer-eth')).toBeVisible()
    await page.getByRole('button', { name: 'Next →' }).last().click()
    await page.getByTestId('create-dialog').getByRole('button', { name: 'Create agent' }).click()
    await expect(page.getByText('Agent created')).toBeVisible({ timeout: 15000 })
    expect(created[0]).toMatchObject({
      services: [
        { name: 'web', endpoint: 'https://example.com' },
        { name: 'email', endpoint: 'e@mail.fun' },
      ],
    })
  })
})

test.describe('create agent — step 1 image & description', () => {
  function randomCid(): string {
    return `bafkrei${Math.random().toString(36).slice(2, 14)}`
  }

  /** Mock POST /api/upload/image (not covered by setupOffline) → ipfs://<cid>. */
  async function mockUploadImage(
    page: Page,
    cid: string,
    opts: { delayMs?: number; seen?: { value: boolean } } = {},
  ) {
    await page.route('**/api/upload/image', async (route) => {
      if (opts.seen) opts.seen.value = true
      expect(route.request().method()).toBe('POST')
      expect(route.request().headers()['content-type']).toContain('multipart/form-data')
      // The upload happens at creation time (creating phase), after the wizard steps.
      if (opts.delayMs) await new Promise((resolve) => setTimeout(resolve, opts.delayMs))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, imageUri: `ipfs://${cid}` }),
      })
    })
  }

  test('uploads image via file picker and sends description + imageUri with creation', async ({ page }) => {
    const cid = randomCid()
    const created: unknown[] = []
    await setupOffline(page, { capture: { create: created } })
    await mockUploadImage(page, cid, { delayMs: 300 })
    await gotoWithAgent(page)
    await openCreateDialog(page)

    await page.getByTestId('create-name-input').fill('e2e-agent')
    await page.getByTestId('create-description-input').fill('A helpful e2e agent')

    // Services are prefilled in step 1
    await expect(page.getByTestId('create-web-endpoint')).toHaveValue('https://example.com')
    await expect(page.getByTestId('create-email-endpoint')).toHaveValue('e@mail.fun')

    await page
      .getByTestId('create-image-input')
      .setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
      })

    // Picking an image only stages it locally — the upload happens at creation time.
    await expect(page.getByTestId('create-image-ready')).toContainText('uploads when you create')
    await expect(page.getByTestId('create-image-preview')).toContainText('avatar.png')

    // Continue is not gated on the staged image
    const next = page.getByTestId('create-name-continue')
    await expect(next).toBeEnabled()
    await next.click()
    await expect(page.getByTestId('create-action-transfer-eth')).toBeVisible()

    // Walk to the last step and submit
    const dialog = page.getByTestId('create-dialog')
    await dialog.getByRole('button', { name: 'Next →' }).click()
    await dialog.getByRole('button', { name: 'Create agent' }).click()

    await expect(page.getByText('Agent created')).toBeVisible({ timeout: 15_000 })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      name: 'e2e-agent',
      description: 'A helpful e2e agent',
      imageUri: `ipfs://${cid}`,
      services: [
        { name: 'web', endpoint: 'https://example.com' },
        { name: 'email', endpoint: 'e@mail.fun' },
      ],
    })
  })

  test('uploads image via drag & drop', async ({ page }) => {
    const cid = randomCid()
    const seen = { value: false }
    await setupOffline(page, {})
    await mockUploadImage(page, cid, { seen })
    await gotoWithAgent(page)
    await openCreateDialog(page)

    // Synthesize a real drop with a File in the DataTransfer
    await page.evaluate(() => {
      const dropzone = document.querySelector('[data-testid="create-image-dropzone"]')!
      const dt = new DataTransfer()
      dt.items.add(new File(['png-bytes'], 'dropped.png', { type: 'image/png' }))
      dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })

    await expect(page.getByTestId('create-image-ready')).toContainText('uploads when you create')
    expect(seen.value).toBe(false)
    await expect(page.getByTestId('create-image-preview')).toContainText('dropped.png')
  })

  test('rejects unsupported file types without uploading', async ({ page }) => {
    const seen = { value: false }
    await setupOffline(page, {})
    await mockUploadImage(page, 'bafkreinever', { seen })
    await gotoWithAgent(page)
    await openCreateDialog(page)

    await page
      .getByTestId('create-image-input')
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })

    await expect(page.getByTestId('create-image-error')).toContainText('Unsupported image type')
    expect(seen.value).toBe(false)
  })

  test('image and description stay optional', async ({ page }) => {
    const created: unknown[] = []
    await setupOffline(page, { capture: { create: created } })
    await gotoWithAgent(page)
    await openCreateDialog(page)

    await page.getByTestId('create-name-input').fill('e2e-agent')
    await page.getByTestId('create-name-continue').click()
    const dialog = page.getByTestId('create-dialog')
    await dialog.getByRole('button', { name: 'Next →' }).click()
    await dialog.getByRole('button', { name: 'Create agent' }).click()

    await expect(page.getByText('Agent created')).toBeVisible({ timeout: 15_000 })
    expect(created).toHaveLength(1)
    expect(created[0]).not.toHaveProperty('description')
    expect(created[0]).not.toHaveProperty('imageUri')
  })
})
