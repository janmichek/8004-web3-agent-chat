import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import { DEMO_AGENT, SECOND_AGENT, gotoWithAgent, sendChat, setupOffline } from './helpers'

test.describe('chat composer + thread', () => {
  test('shows no-agent empty state when no agents exist', async ({ page }) => {
    await setupOffline(page, { agents: [] })
    await page.goto('/')
    await expect(page.getByTestId('agent-select')).toBeVisible()
    await expect(page.getByTestId('chat-empty-no-agent')).toBeVisible()
    await expect(page.getByTestId('chat-empty-no-agent')).toContainText('Select an agent')
    await expect(page.getByTestId('chat-input')).toBeDisabled()
    await expect(page.getByTestId('chat-send')).toBeDisabled()
  })

  test('shows prompt empty state once an agent is selected', async ({ page }) => {
    await setupOffline(page, {})
    await gotoWithAgent(page)
    await expect(page.getByTestId('chat-empty')).toBeVisible()
    await expect(page.getByTestId('chat-empty')).toContainText('balances')
    await expect(page.getByTestId('chat-input')).toBeEnabled()
  })

  test('sends a message and renders user + agent bubbles', async ({ page }) => {
    await setupOffline(page, {
      chat: { reply: 'hello back', events: [{ type: 'message', content: 'hello back' }] },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'hello agent')
    await expect(page.getByTestId('chat-bubble-user').first()).toContainText('hello agent')
    await expect(page.getByTestId('chat-bubble-agent').first()).toContainText('hello back')
    // composer cleared after send
    await expect(page.getByTestId('chat-input')).toHaveValue('')
  })

  test('renders tool_call and tool_result events in the thread', async ({ page }) => {
    await setupOffline(page, {
      chat: {
        reply: 'done',
        events: [
          { type: 'tool_call', name: 'get_token_balance', args: { address: '0xabc' } },
          { type: 'tool_result', content: 'Balance: 1.0 ETH' },
          { type: 'message', content: 'done' },
        ],
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'what is my balance?')
    const events = page.getByTestId('chat-event')
    await expect(events.first()).toBeVisible()
    await expect(events.nth(0)).toContainText('get_token_balance')
    await expect(events.nth(1)).toContainText('Balance: 1.0 ETH')
    await expect(page.getByTestId('chat-bubble-agent').first()).toContainText('done')
  })

  test('shows rate UI after a successful tool result', async ({ page }) => {
    const tx = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    await setupOffline(page, {
      chat: {
        reply: 'sent',
        events: [
          { type: 'tool_call', name: 'send_eth', args: { to: '0x1', amount: '0.1' } },
          { type: 'tool_result', content: tx },
          { type: 'message', content: 'sent!' },
        ],
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'send eth')
    await expect(page.getByTestId('rate-agent')).toBeVisible()
  })

  test('does NOT show rate UI for a pure message reply', async ({ page }) => {
    await setupOffline(page, {
      chat: { reply: 'just chatting', events: [{ type: 'message', content: 'just chatting' }] },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'hi')
    await expect(page.getByTestId('chat-bubble-agent').first()).toBeVisible()
    await expect(page.getByTestId('rate-agent')).toHaveCount(0)
  })

  test('does NOT show rate UI for feedback-only tool calls', async ({ page }) => {
    await setupOffline(page, {
      chat: {
        reply: 'rated',
        events: [
          { type: 'tool_call', name: 'give_feedback', args: { value: 100 } },
          { type: 'tool_result', content: 'ok' },
          { type: 'message', content: 'rated' },
        ],
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'rate this')
    await expect(page.getByTestId('chat-bubble-agent').first()).toBeVisible()
    await expect(page.getByTestId('rate-agent')).toHaveCount(0)
  })

  test('does NOT show rate UI when tool result is an error', async ({ page }) => {
    await setupOffline(page, {
      chat: {
        reply: 'failed',
        events: [
          { type: 'tool_call', name: 'send_eth', args: {} },
          { type: 'tool_result', content: 'Error: insufficient funds' },
          { type: 'message', content: 'failed' },
        ],
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'send')
    await expect(page.getByTestId('chat-bubble-agent').first()).toBeVisible()
    await expect(page.getByTestId('rate-agent')).toHaveCount(0)
  })

  test('shows an error bubble when chat API fails', async ({ page }) => {
    await setupOffline(page, {
      chat: async (route: Route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'LLM exploded' }),
        })
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'boom please')
    await expect(page.getByTestId('chat-bubble-error').first()).toContainText('LLM exploded')
    await expect(page.getByTestId('rate-agent')).toHaveCount(0)
  })

  test('shows non-JSON/proxy failure as an error bubble', async ({ page }) => {
    await setupOffline(page, {
      chat: async (route: Route) => {
        await route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway proxy' })
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'hi')
    await expect(page.getByTestId('chat-bubble-error').first()).toContainText('502')
  })

  test('disables send for empty input and while busy', async ({ page }) => {
    await setupOffline(page, {
      chat: async (route: Route) => {
        await new Promise((r) => setTimeout(r, 800))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ reply: 'slow', events: [{ type: 'message', content: 'slow' }] }),
        })
      },
    })
    await gotoWithAgent(page)
    // empty (and whitespace-only) keeps Send disabled
    await expect(page.getByTestId('chat-send')).toBeDisabled()
    await page.getByTestId('chat-input').fill('   ')
    await expect(page.getByTestId('chat-send')).toBeDisabled()

    await page.getByTestId('chat-input').fill('go slow')
    await expect(page.getByTestId('chat-send')).toBeEnabled()
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-busy')).toBeVisible()
    await expect(page.getByTestId('chat-send')).toBeDisabled()
    await expect(page.getByTestId('chat-bubble-agent').first()).toContainText('slow', { timeout: 15000 })
    await expect(page.getByTestId('chat-busy')).toHaveCount(0)
  })

  test('Enter sends, Shift+Enter does not', async ({ page }) => {
    await setupOffline(page, {
      chat: { reply: 'ok', events: [{ type: 'message', content: 'ok' }] },
    })
    await gotoWithAgent(page)
    await page.getByTestId('chat-input').fill('enter test')
    await page.getByTestId('chat-input').press('Enter')
    await expect(page.getByTestId('chat-bubble-user').first()).toContainText('enter test')

    await page.getByTestId('chat-input').fill('shift enter')
    await page.getByTestId('chat-input').press('Shift+Enter')
    // still in the composer, no new user bubble
    await expect(page.getByTestId('chat-input')).toHaveValue(/shift enter/)
    await expect(page.getByTestId('chat-bubble-user')).toHaveCount(1)
  })

  test('switching agents clears the thread', async ({ page }) => {
    await setupOffline(page, {
      agents: [DEMO_AGENT, SECOND_AGENT],
      chat: { reply: 'ok', events: [{ type: 'message', content: 'ok' }] },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'first message')
    await expect(page.getByTestId('chat-bubble-user')).toHaveCount(1)
    // wait for the reply so the in-flight request can't repopulate the thread after switching
    await expect(page.getByTestId('chat-bubble-agent')).toContainText('ok')
    await page.getByTestId('agent-select').selectOption('bravo')
    await expect(page.getByTestId('chat-empty')).toBeVisible()
    await expect(page.getByTestId('chat-bubble-user')).toHaveCount(0)
  })

  test('renders markdown links with target=_blank and strips scripts', async ({ page }) => {
    await setupOffline(page, {
      chat: {
        reply: 'x',
        events: [
          {
            type: 'message',
            content: '**bold** and [ex](https://example.com) <script>alert(1)</script>',
          },
        ],
      },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'md please')
    const bubble = page.getByTestId('chat-bubble-agent').first()
    await expect(bubble).toContainText('bold')
    await expect(bubble.locator('strong')).toHaveCount(1)
    const link = bubble.locator('a', { hasText: 'ex' })
    await expect(link).toHaveAttribute('href', 'https://example.com')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(bubble.locator('script')).toHaveCount(0)
  })

  test('sends the typed message body to the chat endpoint', async ({ page }) => {
    const seen: unknown[] = []
    await setupOffline(page, {
      capture: { chat: seen },
      chat: { reply: 'ok', events: [{ type: 'message', content: 'ok' }] },
    })
    await gotoWithAgent(page)
    await sendChat(page, 'exact payload 123')
    await expect(page.getByTestId('chat-bubble-agent').first()).toBeVisible()
    expect(seen.length).toBe(1)
    expect(seen[0]).toMatchObject({ message: 'exact payload 123' })
  })
})
