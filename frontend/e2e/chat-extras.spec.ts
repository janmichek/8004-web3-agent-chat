import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import { gotoWithAgent, sendChat, setupOffline, DEMO_AGENT } from './helpers'

test.describe('chat extras', () => {
  test('shows the busy indicator and locks the composer while the reply is pending', async ({ page }) => {
    await setupOffline(page, {
      chat: async (route: Route) => {
        await new Promise((r) => setTimeout(r, 1500))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ reply: 'slow reply', events: [{ type: 'message', content: 'slow reply' }] }),
        })
      },
    })
    await gotoWithAgent(page)
    await page.getByTestId('chat-input').fill('are you slow?')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-busy')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeDisabled()
    await expect(page.getByTestId('chat-send')).toBeDisabled()
    await expect(page.getByTestId('chat-bubble-agent').last()).toContainText('slow reply')
    await expect(page.getByTestId('chat-busy')).toBeHidden()
    await expect(page.getByTestId('chat-input')).toBeEnabled()
  })

  test('falls back to reply text when events contain no message', async ({ page }) => {
    await setupOffline(page, { chat: { reply: 'plain fallback reply', events: [] } })
    await gotoWithAgent(page)
    await sendChat(page, 'hello')
    await expect(page.getByTestId('chat-bubble-agent').first()).toContainText('plain fallback reply')
  })

  test('renders a multi-event exchange in order', async ({ page }) => {
    await setupOffline(page, {
      chat: {
        reply: 'all done',
        events: [
          { type: 'tool_call', name: 'get_token_balance', args: { address: DEMO_AGENT.walletAddress } },
          { type: 'tool_result', content: 'Balance: 1.0 ETH' },
          { type: 'tool_call', name: 'send_eth', args: { to: '0xabc', amount: '0.01' } },
          { type: 'tool_result', content: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
          { type: 'message', content: 'all done' },
        ],
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'check then send')
    await expect(page.getByTestId('chat-bubble-agent').first()).toContainText('all done')
    const events = page.getByTestId('chat-event')
    await expect(events).toHaveCount(4)
    await expect(events.nth(0)).toContainText('get_token_balance')
    await expect(events.nth(1)).toContainText('Balance: 1.0 ETH')
    await expect(events.nth(2)).toContainText('send_eth')
    await expect(events.nth(3)).toContainText('0xaaaa')
  })

  test('composer is disabled with a hint while no agent is selected', async ({ page }) => {
    await setupOffline(page, { agents: [] })
    await page.goto('/')
    await expect(page.getByTestId('chat-empty-no-agent')).toBeVisible()
    await expect(page.getByTestId('chat-input')).toBeDisabled()
    await expect(page.getByTestId('chat-input')).toHaveAttribute('placeholder', 'Select an agent first…')
    await expect(page.getByTestId('chat-send')).toBeDisabled()
  })

  test('call_contract tools tag the rating as contract-call', async ({ page }) => {
    const seen: unknown[] = []
    await setupOffline(page, {
      chat: {
        reply: 'called',
        events: [
          { type: 'tool_call', name: 'call_contract', args: {} },
          { type: 'tool_result', content: 'ok' },
          { type: 'message', content: 'called' },
        ],
      },
      capture: { feedback: seen },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'call it')
    await expect(page.getByTestId('rate-agent')).toBeVisible()
    await page.getByTestId('rate-submit').click()
    await expect(page.getByTestId('rate-scan-link')).toBeVisible()
    expect(seen[0]).toMatchObject({ tag: 'contract-call' })
  })

  test('unknown tools fall back to the execution tag', async ({ page }) => {
    const seen: unknown[] = []
    await setupOffline(page, {
      chat: {
        reply: 'mystery',
        events: [
          { type: 'tool_call', name: 'some_future_tool', args: {} },
          { type: 'tool_result', content: 'ok' },
          { type: 'message', content: 'mystery' },
        ],
      },
      capture: { feedback: seen },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'go')
    await expect(page.getByTestId('rate-agent')).toBeVisible()
    await page.getByTestId('rate-submit').click()
    await expect(page.getByTestId('rate-scan-link')).toBeVisible()
    expect(seen[0]).toMatchObject({ tag: 'execution' })
  })

  test('agent bubble renders bold, code and lists as sanitized markdown', async ({ page }) => {
    await setupOffline(page, {
      chat: {
        reply: '**Bold** and `code`\n\n- one\n- two',
        events: [{ type: 'message', content: '**Bold** and `code`\n\n- one\n- two' }],
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'fancy reply please')
    const bubble = page.getByTestId('chat-bubble-agent').first()
    await expect(bubble.locator('strong')).toHaveText('Bold')
    await expect(bubble.locator('code')).toHaveText('code')
    await expect(bubble.locator('li')).toHaveText(['one', 'two'])
    await expect(bubble.locator('script')).toHaveCount(0)
  })

  test('thread auto-scrolls so the latest bubble is visible', async ({ page }) => {
    await setupOffline(page, {
      chat: { reply: 'tail reply', events: [{ type: 'message', content: 'tail reply' }] },
    })
    await gotoWithAgent(page)
    for (let i = 0; i < 6; i++) await sendChat(page, `message number ${i}`)
    const last = page.getByTestId('chat-bubble-agent').last()
    await expect(last).toContainText('tail reply')
    await expect(last).toBeInViewport()
  })
})
