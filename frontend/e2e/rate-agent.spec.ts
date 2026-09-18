import { test, expect } from '@playwright/test'
import { DEMO_AGENT, gotoWithAgent, sendChat, setupOffline } from './helpers'

const TX = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function chatWithTool(tool: string, content: string = TX) {
  return {
    reply: 'did it',
    events: [
      { type: 'tool_call', name: tool, args: {} },
      { type: 'tool_result', content },
      { type: 'message', content: 'did it' },
    ],
  }
}

test.describe('rate agent (mocked feedback)', () => {
  test('star buttons update the value label', async ({ page }) => {
    await setupOffline(page, { chat: chatWithTool('send_eth') })
    await gotoWithAgent(page)
    await sendChat(page, 'send')
    const rate = page.getByTestId('rate-agent')
    await expect(rate).toBeVisible()
    await expect(rate).toContainText('100/100')
    await rate.getByRole('button', { name: /3 stars/ }).click()
    await expect(rate).toContainText('60/100')
    await rate.getByRole('button', { name: /1 star / }).click()
    await expect(rate).toContainText('20/100')
    await rate.getByRole('button', { name: /5 stars/ }).click()
    await expect(rate).toContainText('100/100')
  })

  test('submits rating + comment and shows scan links', async ({ page }) => {
    const seen: unknown[] = []
    await setupOffline(page, {
      chat: chatWithTool('send_eth'),
      capture: { feedback: seen },
      feedback: {
        ok: true,
        txHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        agentId: '421614:42',
        value: 100,
        rater: '0x9999',
        reputation: { count: 3, averageValue: 90 },
        scanUrl: 'https://testnet.8004scan.io/agents/arbitrum-sepolia/42',
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'send')
    await page.getByTestId('rate-comment').fill('Fast, smooth transfer')
    await page.getByTestId('rate-submit').click()
    await expect(page.getByTestId('rate-scan-link')).toBeVisible({ timeout: 15000 })
    const links = page.getByTestId('rate-scan-link').locator('a')
    await expect(links.nth(0)).toHaveAttribute('href', /sepolia\.arbiscan\.io\/tx\/0xddd/)
    await expect(links.nth(1)).toHaveAttribute('href', /8004scan\.io\/agents\/arbitrum-sepolia\/42\?tab=feedback/)
    await expect(page.getByTestId('rate-submit')).toBeDisabled()
    await expect(page.getByTestId('rate-submit')).toContainText('Rated')

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      agentId: '421614:42',
      value: 100,
      tag: 'transfer', // send_eth maps to transfer context
      comment: 'Fast, smooth transfer',
    })
    expect((seen[0] as { endpoint: string }).endpoint).toMatch(/#send_eth$/)
  })

  test('tag context follows the tool used (balance / contract-abi / execution)', async ({ page }) => {
    for (const [tool, tag] of [
      ['get_token_balance', 'balance'],
      ['fetch_contract_abi', 'contract-abi'],
      ['call_contract', 'contract-call'],
      ['unknown_tool_xyz', 'execution'],
    ] as const) {
      const seen: unknown[] = []
      await setupOffline(page, { chat: chatWithTool(tool), capture: { feedback: seen } })
      await page.goto('/')
      await page.getByTestId('agent-select').waitFor({ state: 'visible' })
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="agent-select"]') as HTMLSelectElement | null
        return !!el && el.value !== ''
      })
      await sendChat(page, `use ${tool}`)
      await expect(page.getByTestId('rate-agent')).toBeVisible({ timeout: 15000 })
      await page.getByTestId('rate-submit').click()
      await expect(page.getByTestId('rate-scan-link')).toBeVisible({ timeout: 15000 })
      expect(seen[0]).toMatchObject({ tag })
    }
  })

  test('feedback API error shows rate-error and keeps submit enabled', async ({ page }) => {
    await setupOffline(page, { chat: chatWithTool('send_eth'), feedbackStatus: 500 })
    await gotoWithAgent(page)
    await sendChat(page, 'send')
    await page.getByTestId('rate-submit').click()
    await expect(page.getByTestId('rate-error')).toContainText('RATER_PRIVATE_KEY')
    await expect(page.getByTestId('rate-submit')).toBeEnabled()
    await expect(page.getByTestId('rate-scan-link')).toHaveCount(0)
  })

  test('operator wallet is blocked like an owner wallet', async ({ page }) => {
    const operator = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    await page.addInitScript((addr) => {
      ;(window as unknown as { __E2E_CONNECTED_ADDRESS?: string }).__E2E_CONNECTED_ADDRESS = addr
    }, operator)
    await setupOffline(page, {
      agents: [{ ...DEMO_AGENT, owners: [], operators: [operator] }],
      chat: chatWithTool('send_eth'),
    })
    await gotoWithAgent(page)
    await sendChat(page, 'send')
    await expect(page.getByTestId('rate-agent')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('rate-disabled')).toBeVisible()
    await expect(page.getByTestId('rate-submit')).toBeDisabled()
    await expect(page.getByTestId('rate-comment')).toBeDisabled()
  })

  test('shows existing reputation summary before rating', async ({ page }) => {
    await setupOffline(page, {
      chat: chatWithTool('send_eth'),
      reputation: { agentId: '421614:42', count: 5, averageValue: 84 },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'send')
    await expect(page.getByTestId('rate-agent')).toContainText('84.0/100')
    await expect(page.getByTestId('rate-agent')).toContainText('5 ratings')
  })

  test('shows fallback text when reputation lookup fails', async ({ page }) => {
    await setupOffline(page, { chat: chatWithTool('send_eth'), reputation: null })
    await gotoWithAgent(page)
    await sendChat(page, 'send')
    await expect(page.getByTestId('rate-agent')).toContainText('No reputation found')
  })

  test('submitting a second tool result appends a second rate card', async ({ page }) => {
    await setupOffline(page, { chat: chatWithTool('send_eth') })
    await gotoWithAgent(page)
    await sendChat(page, 'one')
    await expect(page.getByTestId('rate-agent')).toHaveCount(1)
    await sendChat(page, 'two')
    await expect(page.getByTestId('rate-agent')).toHaveCount(2)
  })
})
