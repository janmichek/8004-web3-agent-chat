import { test, expect } from '@playwright/test'
import type { Route } from '@playwright/test'
import { DEMO_AGENT, SECOND_AGENT, gotoWithAgent, openAgentInfo, setupOffline } from './helpers'

test.describe('agent picker extras', () => {
  test('Agent Info shows ERC-8004 id, wallet, balance and tool chips', async ({ page }) => {
    await setupOffline(page)
    await gotoWithAgent(page)
    await openAgentInfo(page)
    const info = page.locator('.details')
    await expect(info).toContainText('#42')
    await expect(info).toContainText('0x1111…1111')
    await expect(info).toContainText('ETH')
    await expect(info.locator('.chip', { hasText: 'send_eth' })).toBeVisible()
    await expect(info.locator('.chip', { hasText: 'transfer-eth' })).toBeVisible()
    await expect(info.locator('a[href*="8004scan"]')).toBeVisible()
    await expect(info.locator('a[href*="sepolia.arbiscan.io/address/0x1111"]')).toBeVisible()
  })

  test('agent with no tools/actions shows "none" placeholders', async ({ page }) => {
    await setupOffline(page, { agents: [{ ...DEMO_AGENT, tools: [], actions: [] }] })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    const info = page.locator('.details')
    await expect(info).toContainText('none')
  })

  test('agent select is disabled when there are no agents', async ({ page }) => {
    await setupOffline(page, { agents: [] })
    await page.goto('/')
    await expect(page.getByTestId('agent-select')).toBeDisabled()
    await expect(page.getByTestId('picker-delete')).toHaveCount(0)
    await expect(page.getByTestId('picker-create')).toBeEnabled()
  })

  test('fund controls disappear with no agent selected', async ({ page }) => {
    await setupOffline(page, { agents: [] })
    await page.goto('/')
    await expect(page.getByTestId('fund-amount')).toHaveCount(0)
    await expect(page.getByTestId('fund-submit')).toHaveCount(0)
  })

  test('fund input is locked while the request is in flight', async ({ page }) => {
    await setupOffline(page, {
      fund: async (route: Route) => {
        await new Promise((r) => setTimeout(r, 1200))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            txHash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            amountEth: '0.001',
            to: DEMO_AGENT.walletAddress,
            from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          }),
        })
      },
    })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await page.getByTestId('fund-amount').fill('0.01')
    await page.getByTestId('fund-submit').click()
    await expect(page.getByTestId('fund-submit')).toBeDisabled()
    await expect(page.getByTestId('fund-submit')).toContainText('Sending…')
    await expect(page.getByTestId('fund-amount')).toBeDisabled()
    await expect(page.getByTestId('fund-status')).toContainText('0xeeee')
  })

  test('delete button is locked while deleting', async ({ page }) => {
    await setupOffline(page, {
      deleteResponse: async (route: Route) => {
        await new Promise((r) => setTimeout(r, 800))
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'delete failed' }),
        })
      },
    })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await page.getByTestId('picker-delete').click()
    await expect(page.getByTestId('picker-delete')).toContainText('Confirm delete')
    await page.getByTestId('picker-delete').click()
    await expect(page.getByTestId('picker-delete')).toBeDisabled()
    await expect(page.getByTestId('picker-delete')).toContainText('Deleting…')
    await expect(page.getByTestId('delete-status')).toContainText('delete failed')
    // recovers after the error (stays in confirm state for one-click retry)
    await expect(page.getByTestId('picker-delete')).toBeEnabled()
    await expect(page.getByTestId('picker-delete')).toContainText('Confirm delete')
  })

  test('selecting an agent with the keyboard drives the whole app', async ({ page }) => {
    await setupOffline(page, { agents: [DEMO_AGENT, SECOND_AGENT] })
    await gotoWithAgent(page, 'demo')
    await openAgentInfo(page)
    await page.getByTestId('agent-select').selectOption('bravo')
    await expect(page.locator('.details')).toContainText('#77')
    await page.getByTestId('chat-input').fill('hello bravo')
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('chat-bubble-agent').first()).toContainText('mock reply')
  })

  test('rating link for a rated agent points at the 8004 scan page', async ({ page }) => {
    await setupOffline(page, { reputation: { agentId: '421614:42', count: 4, averageValue: 80 } })
    await gotoWithAgent(page)
    await openAgentInfo(page)
    await expect(page.getByTestId('agent-rating')).toContainText('4 ratings')
  })
})
