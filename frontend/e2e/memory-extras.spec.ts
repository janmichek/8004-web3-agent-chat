import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import { DEMO_AGENT, SECOND_AGENT, gotoWithAgent, openConversations, setupOffline } from './helpers'
import type { SetupOfflineOptions } from './helpers'

function multiSessionMemory(): SetupOfflineOptions['memory'] {
  const now = Date.now()
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
  return () => ({
    agent: 'demo',
    exists: true,
    empty: false,
    threads: ['demo'],
    checkpointCount: 4,
    firstActive: iso(3 * 86_400_000),
    lastActive: iso(0),
    stats: {
      totalMessages: 10,
      humanCount: 4,
      aiCount: 4,
      toolCount: 2,
      toolCallsByName: {},
      uniqueRecipients: [],
      txHashes: [],
      totalEthSent: '0',
    },
    summary: '',
    preview: [],
    recentTxHashes: [],
    sessions: [
      {
        id: 'sess-a',
        index: 0,
        startedAt: iso(0),
        endedAt: iso(0),
        messageCount: 2,
        humanCount: 1,
        assistantCount: 1,
        toolCount: 0,
        title: 'newest chat',
        preview: 'newest session preview',
        messages: [
          { role: 'user', content: 'newest question' },
          { role: 'assistant', content: 'newest answer' },
        ],
        txHashes: [],
        recipients: [],
        summary: '',
      },
      {
        id: 'sess-b',
        index: 1,
        startedAt: iso(5 * 3_600_000),
        endedAt: iso(5 * 3_600_000 - 60_000),
        messageCount: 2,
        humanCount: 1,
        assistantCount: 1,
        toolCount: 0,
        title: 'older chat',
        preview: 'older session preview',
        messages: [{ role: 'user', content: 'older question' }, { role: 'assistant', content: 'older answer' }],
        txHashes: [],
        recipients: [],
        summary: '',
      },
    ],
  })
}

test.describe('agent memory extras', () => {
  test('lists multiple sessions with previews and relative times', async ({ page }) => {
    await setupOffline(page, { memory: multiSessionMemory() })
    await gotoWithAgent(page)
    await openConversations(page)
    const cards = page.locator('[data-testid="agent-memory"] .session-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('newest session preview')
    await expect(cards.nth(0)).toContainText('just now')
    await expect(cards.nth(1)).toContainText('older session preview')
    await expect(cards.nth(1)).toContainText('5h ago')
  })

  test('recalling moves the selection highlight between sessions', async ({ page }) => {
    await setupOffline(page, { memory: multiSessionMemory() })
    await gotoWithAgent(page)
    await openConversations(page)
    const cards = page.locator('[data-testid="agent-memory"] .session-card')
    await cards.nth(0).click()
    await expect(page.getByTestId('chat-bubble-user').first()).toContainText('newest question')
    await expect(cards.nth(0)).toHaveAttribute('aria-selected', 'true')
    await cards.nth(1).click()
    await expect(page.getByTestId('chat-bubble-user').last()).toContainText('older question')
    await expect(cards.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(cards.nth(0)).toHaveAttribute('aria-selected', 'false')
  })

  test('memory reloads after a chat exchange', async ({ page }) => {
    let loads = 0
    await setupOffline(page, {
      memory: () => {
        loads++
        // AgentStats + AgentMemory both fetch on load, so allow 2 initial empty loads.
        const empty = loads <= 2
        return {
          agent: 'demo',
          exists: true,
          empty,
          threads: empty ? [] : ['demo'],
          checkpointCount: empty ? 0 : 1,
          firstActive: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          stats: {
            totalMessages: 2,
            humanCount: 1,
            aiCount: 1,
            toolCount: 0,
            toolCallsByName: {},
            uniqueRecipients: [],
            txHashes: [],
            totalEthSent: '0',
          },
          summary: '',
          preview: [],
          recentTxHashes: [],
          sessions: [],
        }
      },
      chat: { reply: 'hi!', events: [{ type: 'message', content: 'hi!' }] },
    })
    await gotoWithAgent(page)
    await openConversations(page)
    await expect(page.locator('[data-testid="agent-memory"] .empty-title')).toContainText('No history yet')
    await page.getByTestId('chat-input').fill('persist this')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-bubble-agent')).toContainText('hi!')
    await expect
      .poll(() => loads, { timeout: 10_000 })
      .toBeGreaterThan(2)
  })

  test('memory shows a hint when no sessions exist despite history', async ({ page }) => {
    await setupOffline(page, {
      memory: () => {
        const now = new Date().toISOString()
        return {
          agent: 'demo',
          exists: true,
          empty: false,
          threads: ['demo'],
          checkpointCount: 1,
          firstActive: now,
          lastActive: now,
          stats: {
            totalMessages: 0,
            humanCount: 0,
            aiCount: 0,
            toolCount: 0,
            toolCallsByName: {},
            uniqueRecipients: [],
            txHashes: [],
            totalEthSent: '0',
          },
          summary: '',
          preview: [],
          recentTxHashes: [],
          sessions: [],
        }
      },
    })
    await gotoWithAgent(page)
    await openConversations(page)
    await expect(page.locator('[data-testid="agent-memory"]')).toContainText('No sessions detected.')
  })

  test('memory section updates when switching agents', async ({ page }) => {
    const requests: string[] = []
    await setupOffline(page, {
      agents: [DEMO_AGENT, SECOND_AGENT],
      memory: () => DEMO_AGENT,
      chat: { reply: 'ok', events: [{ type: 'message', content: 'ok' }] },
    })
    // Second agent's memory returns an error so we can tell whose load fired.
    await page.route('**/api/agents/bravo/memory', async (route: Route) => {
      requests.push('bravo')
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'no' }) })
    })
    await page.route('**/api/agents/demo/memory', async (route: Route) => {
      requests.push('demo')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agent: 'demo',
          exists: true,
          empty: true,
          threads: [],
          checkpointCount: 0,
          firstActive: null,
          lastActive: null,
          stats: {
            totalMessages: 0,
            humanCount: 0,
            aiCount: 0,
            toolCount: 0,
            toolCallsByName: {},
            uniqueRecipients: [],
            txHashes: [],
            totalEthSent: '0',
          },
          summary: '',
          preview: [],
          recentTxHashes: [],
          sessions: [],
        }),
      })
    })
    await gotoWithAgent(page)
    await openConversations(page)
    await page.getByTestId('agent-select').selectOption('bravo')
    await expect(page.locator('[data-testid="agent-memory"]')).toContainText('no', { ignoreCase: true })
    expect(requests).toContain('bravo')
  })
})
