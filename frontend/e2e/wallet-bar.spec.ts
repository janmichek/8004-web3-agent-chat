import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { setupOffline } from './helpers'

const WALLET_ADDRESS = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'

/**
 * Install a minimal EIP-1193 provider so wagmi's injected connector can
 * "connect" without MetaMask. Chain id defaults to Arbitrum Sepolia.
 */
async function installMockWallet(page: Page, opts: { chainId?: string; accounts?: string[] } = {}) {
  const chainId = opts.chainId ?? '0x66eee'
  const accounts = opts.accounts ?? [WALLET_ADDRESS]
  await page.addInitScript(
    ({ chainId, accounts }) => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
      ;(window as unknown as { ethereum: unknown }).ethereum = {
        request: async ({ method }: { method: string }) => {
          switch (method) {
            case 'eth_accounts':
            case 'eth_requestAccounts':
              return accounts
            case 'eth_chainId':
              return chainId
            case 'wallet_switchEthereumChain':
              return null
            case 'wallet_addEthereumChain':
              return null
            default:
              return null
          }
        },
        on(event: string, cb: (...args: unknown[]) => void) {
          ;(listeners[event] ??= []).push(cb)
        },
        removeListener(event: string, cb: (...args: unknown[]) => void) {
          listeners[event] = (listeners[event] ?? []).filter((l) => l !== cb)
        },
        emit(event: string, ...args: unknown[]) {
          for (const cb of listeners[event] ?? []) cb(...args)
        },
      }
    },
    { chainId, accounts },
  )
}

test.describe('wallet bar (mocked injected wallet)', () => {
  test('disconnected state shows the connect CTA and no address', async ({ page }) => {
    await setupOffline(page)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible()
    await expect(page.locator('header .addr')).toHaveCount(0)
    await expect(page.locator('header .balance')).toHaveCount(0)
  })

  test('connects via injected wallet and shows address, chain and balance', async ({ page }) => {
    await installMockWallet(page)
    await setupOffline(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Connect wallet' }).click()
    await expect(page.locator('header .addr')).toHaveText('0xAb58…eC9B')
    await expect(page.locator('header .chip')).toContainText('Arb Sepolia')
    await expect(page.locator('header .balance')).toContainText('10.000 ETH')
  })

  test('warns and offers to switch when the wallet is on the wrong chain', async ({ page }) => {
    await installMockWallet(page, { chainId: '0x1' })
    await setupOffline(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Connect wallet' }).click()
    const chip = page.locator('header .chip')
    await expect(chip).toContainText('Switch · Chain 1')
    await expect(chip).toHaveClass(/warn/)
    await chip.click()
    // switch falls back to wagmi switchChain against the mocked /api/rpc proxy
    await expect(page.locator('header .chip')).toContainText(/Arb Sepolia|Switching/)
  })

  test('disconnect returns to the connect CTA', async ({ page }) => {
    await installMockWallet(page)
    await setupOffline(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Connect wallet' }).click()
    await expect(page.locator('header .addr')).toBeVisible()
    await page.getByRole('button', { name: 'Disconnect' }).click()
    await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible()
    await expect(page.locator('header .addr')).toHaveCount(0)
  })
})
