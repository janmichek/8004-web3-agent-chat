import { test, expect } from '@playwright/test'

/**
 * Chat rate UI after a successful tool tx + real on-chain feedback via RATER_PRIVATE_KEY.
 *
 * Prerequisites: API on :8787 (with RATER_PRIVATE_KEY + RPC), Vite on :5173.
 * Chat is mocked so we don't depend on the LLM; feedback hits testnet for real.
 */
test.describe('chat reputation after successful tx', () => {
  test('shows rate UI after success tx and submits feedback with 8004scan link', async ({
    page,
  }) => {
    const fakeTx =
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

    await page.route('**/api/agents/*/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'Sent dust successfully.',
          events: [
            {
              type: 'tool_call',
              name: 'send_eth',
              args: { to: '0x1111111111111111111111111111111111111111', amount: '0.0001' },
            },
            { type: 'tool_result', content: fakeTx },
            { type: 'message', content: `Transfer complete. Tx: ${fakeTx}` },
          ],
        }),
      })
    })

    await page.goto('/')
    await expect(page.getByTestId('agent-select')).toBeVisible()
    await expect(page.getByTestId('agent-select')).not.toHaveValue('')

    await page.getByTestId('chat-input').fill('Send 0.0001 ETH to 0x1111…')
    await page.getByTestId('chat-send').click()

    await expect(page.getByTestId('rate-agent')).toBeVisible({ timeout: 20_000 })

    // Not connected as owner → submit enabled (signed server-side by RATER_PRIVATE_KEY)
    await expect(page.getByTestId('rate-submit')).toBeEnabled()
    await expect(page.getByTestId('rate-disabled')).toHaveCount(0)

    await page.getByTestId('rate-submit').click()

    // Fail fast on API error instead of waiting the full tx timeout
    await Promise.race([
      expect(page.getByTestId('rate-scan-link')).toBeVisible({ timeout: 120_000 }),
      expect(page.getByTestId('rate-error'))
        .toBeVisible({ timeout: 120_000 })
        .then(async () => {
          throw new Error(await page.getByTestId('rate-error').innerText())
        }),
    ])
    const scan = page.getByTestId('rate-scan-link').locator('a')
    await expect(scan.first()).toBeVisible()
    const hrefs = await scan.allInnerTexts()
    void hrefs
    const href = await scan.nth(1).getAttribute('href')
    expect(href).toMatch(/8004scan\.io\/agents\/arbitrum-sepolia\/\d+\?tab=feedback/)
    const txHref = await scan.first().getAttribute('href')
    expect(txHref).toMatch(/arbiscan\.io\/tx\/0x/)
    await expect(page.getByTestId('rate-submit')).toBeDisabled()
    await expect(page.getByTestId('rate-submit')).toContainText('Rated')
  })

  test('disables rate UI when connected wallet is owner', async ({ page }) => {
    const fakeTx =
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const owner = '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed'

    await page.addInitScript((addr) => {
      ;(window as unknown as { __E2E_CONNECTED_ADDRESS?: string }).__E2E_CONNECTED_ADDRESS = addr
    }, owner)

    await page.route('**/api/agents', async (route) => {
      const res = await route.fetch()
      const json = await res.json()
      const agents = (json.agents || []).map((a: Record<string, unknown>) => ({
        ...a,
        owners: [owner],
        operators: [],
      }))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agents }),
      })
    })

    await page.route('**/api/agents/*/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          reply: 'ok',
          events: [
            { type: 'tool_result', content: fakeTx },
            { type: 'message', content: 'done' },
          ],
        }),
      })
    })

    await page.goto('/')
    await page.getByTestId('chat-input').fill('ping')
    await page.getByTestId('chat-send').click()

    await expect(page.getByTestId('rate-agent')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('rate-disabled')).toBeVisible()
    await expect(page.getByTestId('rate-submit')).toBeDisabled()
  })
})
