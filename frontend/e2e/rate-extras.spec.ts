import { test, expect } from '@playwright/test'
import { gotoWithAgent, sendChat, setupOffline } from './helpers'

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

test.describe('rate agent extras', () => {
  test('comment is capped at 280 characters and sent trimmed', async ({ page }) => {
    const seen: unknown[] = []
    await setupOffline(page, { chat: chatWithTool('send_eth'), capture: { feedback: seen } })
    await gotoWithAgent(page)
    await sendChat(page, 'go')
    const comment = page.getByTestId('rate-comment')
    await expect(comment).toBeVisible()
    await expect(comment).toHaveAttribute('maxlength', '280')
    await comment.fill('   trimmed review   ')
    await page.getByTestId('rate-submit').click()
    await expect(page.getByTestId('rate-scan-link')).toBeVisible()
    expect(seen[0]).toMatchObject({ comment: 'trimmed review' })
  })

  test('empty comment falls back to the starred tag', async ({ page }) => {
    const seen: unknown[] = []
    await setupOffline(page, { chat: chatWithTool('send_eth'), capture: { feedback: seen } })
    await gotoWithAgent(page)
    await sendChat(page, 'go')
    await page.getByTestId('rate-submit').click()
    await expect(page.getByTestId('rate-scan-link')).toBeVisible()
    expect(seen[0]).toMatchObject({ tag: 'transfer' })
    // empty comment is omitted (sent as undefined), not as an empty string
    expect((seen[0] as { comment?: string }).comment).toBeUndefined()
  })

  test('balance tool result tags the rating as balance', async ({ page }) => {
    const seen: unknown[] = []
    await setupOffline(page, { chat: chatWithTool('get_token_balance', 'Balance: 2.0 ETH'), capture: { feedback: seen } })
    await gotoWithAgent(page)
    await sendChat(page, 'balance?')
    await expect(page.getByTestId('rate-agent')).toBeVisible()
    await page.getByTestId('rate-submit').click()
    await expect(page.getByTestId('rate-scan-link')).toBeVisible()
    expect(seen[0]).toMatchObject({ tag: 'balance' })
  })

  test('rating updates the reputation summary shown after submit', async ({ page }) => {
    await setupOffline(page, {
      chat: chatWithTool('send_eth'),
      feedback: {
        ok: true,
        txHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        agentId: '421614:42',
        value: 60,
        rater: '0x9999999999999999999999999999999999999999',
        reputation: { count: 5, averageValue: 72 },
        scanUrl: 'https://testnet.8004scan.io/agents/arbitrum-sepolia/42',
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'go')
    await page.getByRole('button', { name: /3 stars/ }).click()
    await page.getByTestId('rate-submit').click()
    await expect(page.getByTestId('rate-scan-link')).toBeVisible()
    await expect(page.getByTestId('rate-agent')).toContainText('72.0/100')
    await expect(page.getByTestId('rate-agent')).toContainText('5 ratings')
  })

  test('rating submit is idempotent: double click sends once', async ({ page }) => {
    const seen: unknown[] = []
    await setupOffline(page, { chat: chatWithTool('send_eth'), capture: { feedback: seen } })
    await gotoWithAgent(page)
    await sendChat(page, 'go')
    await page.getByTestId('rate-submit').click()
    await page.getByTestId('rate-submit').click({ force: true }).catch(() => {})
    await expect(page.getByTestId('rate-scan-link')).toBeVisible()
    expect(seen).toHaveLength(1)
  })
})
