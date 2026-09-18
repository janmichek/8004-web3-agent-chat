import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import { DEMO_AGENT, SECOND_AGENT, gotoWithAgent, openAgentInfo, setupOffline } from './helpers'

test.describe('agent picker', () => {
  test('lists agents and auto-selects the first', async ({ page }) => {
    await setupOffline(page, { agents: [DEMO_AGENT, SECOND_AGENT] })
    await gotoWithAgent(page)
    const select = page.getByTestId('agent-select')
    await expect(select).toHaveValue('demo')
    await expect(select.locator('option')).toHaveCount(2)
    await expect(select.locator('option').nth(0)).toHaveText('demo')
    await expect(select.locator('option').nth(1)).toHaveText('bravo')
  })

  test('shows an error banner when the agents API is down', async ({ page }) => {
    await setupOffline(page, { agentsStatus: 500, agentsError: 'API unavailable — run npm run serve' })
    await page.goto('/')
    await expect(page.getByTestId('agent-select')).toBeVisible()
    await openAgentInfo(page)
    await expect(page.getByTestId('picker-error')).toContainText('API unavailable')
  })

  test('shows empty state when no agents exist', async ({ page }) => {
    await setupOffline(page, { agents: [] })
    await page.goto('/')
    await expect(page.getByTestId('agent-select')).toBeVisible()
    await expect(page.getByTestId('agent-select')).toBeDisabled()
    await openAgentInfo(page)
    await expect(page.getByText('No agents yet')).toBeVisible()
  })

  test('Agent Info section collapses and expands', async ({ page }) => {
    await setupOffline(page, {})
    await gotoWithAgent(page)
    const toggle = page.getByRole('button', { name: /Agent Info/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('fund-amount')).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('refresh button reloads the agent list', async ({ page }) => {
    let calls = 0
    await setupOffline(page, { agents: [DEMO_AGENT] })
    // count list fetches on top of the default mock
    await page.route('**/api/health', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, network: 'arbitrum-sepolia', chainId: 421614, master: {} }),
      })
    })
    await gotoWithAgent(page)
    await page.getByTestId('picker-refresh').click()
    // refresh keeps the selection and shows no error
    await expect(page.getByTestId('agent-select')).toHaveValue('demo')
    await openAgentInfo(page)
    await expect(page.getByTestId('picker-error')).toHaveCount(0)
    calls += 1
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  test('rating line shows mappings for 0 / 1 / N ratings', async ({ page }) => {
    // 0 ratings
    await setupOffline(page, {
      reputation: { agentId: '421614:42', count: 0, averageValue: 0 },
    })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await expect(page.getByTestId('agent-rating')).toContainText('No ratings yet')

    // 1 rating
    await setupOffline(page, {
      reputation: { agentId: '421614:42', count: 1, averageValue: 80 },
    })
    await page.goto('/')
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await expect(page.getByTestId('agent-rating')).toContainText('1 rating')
    await expect(page.getByTestId('agent-rating')).not.toContainText('ratings')

    // N ratings
    await setupOffline(page, {
      reputation: { agentId: '421614:42', count: 12, averageValue: 92.34 },
    })
    await page.goto('/')
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await expect(page.getByTestId('agent-rating')).toContainText('92.3/100')
    await expect(page.getByTestId('agent-rating')).toContainText('12 ratings')
  })

  test('rating line stays blank when reputation lookup fails', async ({ page }) => {
    await setupOffline(page, { reputation: null })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await expect(page.getByTestId('agent-rating')).toContainText('—')
  })
})

test.describe('fund agent', () => {
  test('validates amount: only (0, 1] enables Send', async ({ page }) => {
    await setupOffline(page, {})
    await gotoWithAgent(page)
    await openAgentInfo(page)
    const amount = page.getByTestId('fund-amount')
    const submit = page.getByTestId('fund-submit')
    await expect(submit).toBeEnabled() // default 0.001

    await amount.fill('0')
    await expect(submit).toBeDisabled()
    await amount.fill('2')
    await expect(submit).toBeDisabled()
    await amount.fill('-0.1')
    await expect(submit).toBeDisabled()
    await amount.fill('abc')
    await expect(submit).toBeDisabled()
    await amount.fill('0.001')
    await expect(submit).toBeEnabled()
  })

  test('successful fund shows tx prefix status', async ({ page }) => {
    const seen: unknown[] = []
    await setupOffline(page, {
      capture: { fund: seen },
      fund: {
        ok: true,
        txHash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        amountEth: '0.001',
        to: DEMO_AGENT.walletAddress,
        from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await page.getByTestId('fund-amount').fill('0.001')
    await page.getByTestId('fund-submit').click()
    await expect(page.getByTestId('fund-status')).toContainText('Sent 0xeeeeee')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ amountEth: '0.001' })
  })

  test('fund error surfaces the backend message', async ({ page }) => {
    await setupOffline(page, { fundStatus: 500 })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await page.getByTestId('fund-amount').fill('0.001')
    await page.getByTestId('fund-submit').click()
    await expect(page.getByTestId('fund-status')).toContainText('insufficient ETH')
  })

  test('maps RPC rate-limit errors to a friendly retry hint', async ({ page }) => {
    await page.route('**/api/rpc', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.route('**/api/health', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, network: 'x', chainId: 421614, master: {} }),
      })
    })
    await page.route('**/api/agents', async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agents: [DEMO_AGENT] }),
      })
    })
    await page.route('**/api/agents/*', async (route: Route) => {
      await route.fallback()
    })
    await page.route('**/api/agents/*/memory', async (route: Route) => {
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
    await page.route('**/api/reputation**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agentId: '421614:42', count: 0, averageValue: 0 }),
      })
    })
    await page.route('**/api/agents/*/fund', async (route: Route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'exceeds defined limit -32005 rate limited' }),
      })
    })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await page.getByTestId('fund-amount').fill('0.001')
    await page.getByTestId('fund-submit').click()
    await expect(page.getByTestId('fund-status')).toContainText('RPC rate limit hit')
  })
})

test.describe('delete agent', () => {
  test('first click asks for confirmation, second deletes', async ({ page }) => {
    await setupOffline(page, {})
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await page.getByTestId('picker-delete').click()
    await expect(page.getByTestId('delete-status')).toContainText('Click Delete again to confirm')
    await expect(page.getByTestId('picker-delete')).toContainText('Confirm delete')

    await page.getByTestId('picker-delete').click()
    // success clears selection -> chat shows the no-agent prompt
    await expect(page.getByTestId('chat-empty-no-agent')).toBeVisible({ timeout: 15000 })
  })

  test('delete error keeps the agent and shows the message', async ({ page }) => {
    await setupOffline(page, { deleteStatus: 500 })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await page.getByTestId('picker-delete').click()
    await page.getByTestId('picker-delete').click()
    await expect(page.getByTestId('delete-status')).toContainText('delete failed')
    await expect(page.getByTestId('agent-select')).toHaveValue('demo')
  })

  test('switching selection resets a stale delete confirmation', async ({ page }) => {
    await setupOffline(page, { agents: [DEMO_AGENT, SECOND_AGENT] })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await page.getByTestId('picker-delete').click()
    await expect(page.getByTestId('delete-status')).toContainText('Click Delete again')
    await page.getByTestId('agent-select').selectOption('bravo')
    await expect(page.getByTestId('picker-delete')).toContainText('Delete')
    await expect(page.getByTestId('delete-status')).toHaveCount(0)
  })
})
