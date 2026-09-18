import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import {
  EMPTY_MEMORY,
  gotoWithAgent,
  openChatStats,
  openConversations,
  sessionMemory,
  setupOffline,
} from './helpers'

test.describe('agent memory (conversations)', () => {
  test('shows empty state when the agent has no history', async ({ page }) => {
    await setupOffline(page, { memory: EMPTY_MEMORY })
    await gotoWithAgent(page)
    await openConversations(page)
    await expect(page.getByTestId('agent-memory')).toContainText('No history yet')
    await expect(page.getByTestId('agent-memory')).toContainText('memory.json')
  })

  test('lists sessions and recalls one into the chat thread', async ({ page }) => {
    await setupOffline(page, { memory: sessionMemory() })
    await gotoWithAgent(page)
    await openConversations(page)
    const card = page.locator('.session-card').first()
    await expect(card).toContainText('hello world preview')
    await card.click()
    // recalled messages render as chat bubbles + tool events
    await expect(page.getByTestId('chat-bubble-user').first()).toContainText('hello memory')
    await expect(page.getByTestId('chat-bubble-agent').first()).toContainText('hi there')
    await expect(page.getByTestId('chat-event').first()).toContainText('get_token_balance')
    await expect(card).toHaveClass(/selected/)
  })

  test('+ New chat clears the recalled thread', async ({ page }) => {
    await setupOffline(page, { memory: sessionMemory() })
    await gotoWithAgent(page)
    await openConversations(page)
    await page.locator('.session-card').first().click()
    await expect(page.getByTestId('chat-bubble-user')).toHaveCount(1)
    await page.getByRole('button', { name: '+ New chat' }).click()
    await expect(page.getByTestId('chat-bubble-user')).toHaveCount(0)
    await expect(page.getByTestId('chat-empty')).toBeVisible()
  })

  test('memory API error shows a banner, not a crash', async ({ page }) => {
    await setupOffline(page, { memoryStatus: 500 })
    await gotoWithAgent(page)
    await openConversations(page)
    await expect(page.getByTestId('agent-memory')).toContainText('memory boom')
  })

  test('shows a hint when no agent is selected', async ({ page }) => {
    await setupOffline(page, { agents: [] })
    await page.goto('/')
    await openConversations(page)
    await expect(page.getByTestId('agent-memory')).toContainText('Select an agent')
  })
})

test.describe('agent stats', () => {
  test('shows empty state for a fresh agent', async ({ page }) => {
    await setupOffline(page, { memory: EMPTY_MEMORY })
    await gotoWithAgent(page)
    await openChatStats(page)
    await expect(page.getByTestId('agent-stats')).toContainText('No history yet')
  })

  test('renders messages / sessions / ETH / tools / recipients / txs', async ({ page }) => {
    await setupOffline(page, { memory: sessionMemory() })
    await gotoWithAgent(page)
    await openChatStats(page)
    const stats = page.getByTestId('agent-stats')
    await expect(stats).toContainText('Messages')
    await expect(stats).toContainText('6')
    await expect(stats).toContainText('Sessions')
    await expect(stats).toContainText('send_eth')
    await expect(stats).toContainText('×1')
    await expect(stats).toContainText('Recipients (1)')
    await expect(stats).toContainText('Recent txs (1)')
    const recipient = stats.locator('a[href*="/address/0x1111"]').first()
    await expect(recipient).toHaveAttribute('href', /sepolia\.arbiscan\.io\/address\/0x/)
    const tx = stats.locator('a[href*="/tx/0xaaaa"]').first()
    await expect(tx).toHaveAttribute('href', /sepolia\.arbiscan\.io\/tx\/0xaaa/)
  })

  test('Chat Stats section collapses and expands', async ({ page }) => {
    await setupOffline(page, {})
    await gotoWithAgent(page)
    const toggle = page.getByRole('button', { name: /Chat Stats/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('agent-stats')).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('stats error shows a banner', async ({ page }) => {
    await setupOffline(page, { memoryStatus: 500 })
    await gotoWithAgent(page)
    await openChatStats(page)
    await expect(page.getByTestId('agent-stats')).toContainText('memory boom')
  })

  test('refreshing after a chat updates stats', async ({ page }) => {
    let calls = 0
    await setupOffline(page, {
      memory: EMPTY_MEMORY,
      chat: { reply: 'ok', events: [{ type: 'message', content: 'ok' }] },
    })
    await gotoWithAgent(page)
    await openChatStats(page)
    await expect(page.getByTestId('agent-stats')).toContainText('No history yet')
    // next memory fetch returns a session (simulates checkpoint written by chat)
    await page.route('**/api/agents/*/memory', async (route: Route) => {
      calls += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sessionMemory()),
      })
    })
    await page.getByTestId('chat-input').fill('make history')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-bubble-agent').first()).toBeVisible()
    // picker refresh re-triggers stats load via refreshKey
    await page.getByTestId('picker-refresh').click()
    await expect(page.getByTestId('agent-stats')).toContainText('Messages', { timeout: 15000 })
    expect(calls).toBeGreaterThan(0)
  })
})
