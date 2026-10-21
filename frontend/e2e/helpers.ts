import { expect, type Page, type Route } from '@playwright/test'
import { decodeFunctionData, encodeFunctionResult } from 'viem'

export const DEMO_AGENT = {
  name: 'demo',
  description: 'Demo agent',
  walletAddress: '0x1111111111111111111111111111111111111111',
  walletChainId: 421614,
  agentId: '421614:42',
  agentURI: 'ipfs://QmTest123',
  owners: ['0x2222222222222222222222222222222222222222'],
  operators: ['0x1111111111111111111111111111111111111111'],
  actions: ['transfer-eth'],
  tools: ['send_eth', 'get_token_balance'],
  active: true,
}

export const SECOND_AGENT = {
  name: 'bravo',
  description: 'Second agent',
  walletAddress: '0x3333333333333333333333333333333333333333',
  walletChainId: 421614,
  agentId: '421614:77',
  agentURI: 'ipfs://QmBravo456',
  owners: [],
  operators: [],
  actions: [],
  tools: ['get_token_balance'],
  active: true,
}

export const MOCK_CATALOG = {
  network: 'arbitrum-sepolia',
  networkName: 'Arbitrum Sepolia',
  chainId: 421614,
  master: {
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    balanceEth: '1.234',
  },
  networks: [
    { network: 'arbitrum-sepolia', name: 'Arbitrum Sepolia', chainId: 421614, masterBalanceEth: '1.234' },
    { network: 'ethereum-sepolia', name: 'Ethereum Sepolia', chainId: 11155111, masterBalanceEth: '0.5' },
  ],
  actions: [
    {
      name: 'transfer-eth',
      description: 'Transfer ETH on Arbitrum with balance checks and safety confirmations',
      toolNames: ['send_eth', 'get_token_balance'],
      skillName: 'transfer-eth',
    },
    {
      name: 'ens-name',
      description: 'Resolve ENS names, look up primary names, register .eth names, and set the agent wallet primary ENS name',
      toolNames: ['resolve_ens', 'lookup_ens', 'register_ens', 'set_primary_ens'],
      skillName: 'ens-name',
    },
  ],
  tools: [
    { name: 'send_eth', description: 'Send ETH from the agent wallet to a destination address' },
    { name: 'get_token_balance', description: 'Check ETH or ERC-20 token balance of a wallet address' },
    { name: 'fetch_contract_abi', description: "Fetch a verified contract's ABI from the block explorer (experimental)" },
    { name: 'call_contract', description: 'Call any function on a verified contract (experimental)' },
    { name: 'resolve_ens', description: 'Resolve an ENS name to an address' },
    { name: 'lookup_ens', description: 'Look up the primary ENS name for a wallet address' },
    { name: 'set_primary_ens', description: "Set the agent wallet's primary ENS name" },
    { name: 'register_ens', description: 'Register a .eth name for the agent wallet' },
  ],
}

export const EMPTY_MEMORY = {
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
}

export function sessionMemory() {
  const now = new Date().toISOString()
  return {
    agent: 'demo',
    exists: true,
    empty: false,
    threads: ['demo'],
    checkpointCount: 2,
    firstActive: now,
    lastActive: now,
    stats: {
      totalMessages: 6,
      humanCount: 2,
      aiCount: 2,
      toolCount: 2,
      toolCallsByName: { send_eth: 1, get_token_balance: 1 },
      uniqueRecipients: ['0x1111111111111111111111111111111111111111'],
      txHashes: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      totalEthSent: '0.0001',
    },
    summary: 'sent eth',
    preview: [],
    recentTxHashes: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    sessions: [
      {
        id: 'sess-1',
        index: 0,
        startedAt: now,
        endedAt: now,
        messageCount: 3,
        humanCount: 1,
        assistantCount: 1,
        toolCount: 1,
        title: 'first chat',
        preview: 'hello world preview',
        messages: [
          { role: 'user', content: 'hello memory' },
          { role: 'assistant', content: 'hi there', toolCalls: [{ name: 'get_token_balance', args: {} }] },
          { role: 'tool', content: 'Balance: 1.0 ETH' },
        ],
        txHashes: [],
        recipients: [],
        summary: '',
      },
    ],
  }
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

const MOCK_BALANCE = '0x8ac7230489e80000' // 10 ETH (0x8ac7... = 10e18 wei)
const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11'
const AGGREGATE3_ABI = [
  {
    name: 'aggregate3',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'allowFailure', type: 'bool' },
          { name: 'callData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'tuple[]',
        components: [
          { name: 'success', type: 'bool' },
          { name: 'returnData', type: 'bytes' },
        ],
      },
    ],
  },
] as const

/** Answer a Multicall3 aggregate3 batch with a plausible balance for every subcall. */
function multicallResult(data: `0x${string}`): string {
  const { args } = decodeFunctionData({ abi: AGGREGATE3_ABI, data })
  const results = args[0].map(() => ({
    success: true,
    returnData: ('0x' + MOCK_BALANCE.slice(2).padStart(64, '0')) as `0x${string}`,
  }))
  return encodeFunctionResult({ abi: AGGREGATE3_ABI, functionName: 'aggregate3', result: results })
}

/** Stub JSON-RPC so wagmi useBalance never hits a real RPC. */
export async function mockRpc(page: Page) {
  await page.route('**/api/rpc**', async (route) => {
    let text = ''
    try {
      text = route.request().postData() ?? ''
    } catch {
      text = ''
    }
    const idMatch = text.match(/"id"\s*:\s*(\d+)/)
    const id = idMatch ? Number(idMatch[1]) : 1
    let result = MOCK_BALANCE
    if (text.includes('eth_chainId')) result = '0x66eee' // 421614
    if (text.includes('eth_blockNumber')) result = '0x1'
    if (text.includes('eth_call')) {
      try {
        const body = JSON.parse(text)
        const call = Array.isArray(body) ? body[0] : body
        const to: string | undefined = call?.params?.[0]?.to
        const data: string | undefined = call?.params?.[0]?.data
        if (to?.toLowerCase() === MULTICALL3 && data?.startsWith('0x82ad56cb')) {
          result = multicallResult(data as `0x${string}`)
        } else {
          result = '0x'
        }
      } catch {
        result = '0x'
      }
    }
    await json(route, 200, { jsonrpc: '2.0', id, result })
  })
}

export type SetupOfflineOptions = {
  agents?: unknown[]
  agentsStatus?: number
  agentsError?: string
  health?: unknown
  catalog?: unknown
  catalogStatus?: number
  memory?: unknown
  memoryStatus?: number
  reputation?: unknown // null => 500 failure
  chat?: unknown
  feedback?: unknown
  feedbackStatus?: number
  fund?: unknown
  fundStatus?: number
  create?: unknown
  createStatus?: number
  deleteResponse?: unknown
  deleteStatus?: number
  capture?: {
    feedback?: unknown[]
    fund?: unknown[]
    create?: unknown[]
    chat?: unknown[]
  }
}

/**
 * Fully offline backend mock. Call BEFORE page.goto('/').
 * Covers every endpoint the Vue app touches so no real :8787 is needed.
 */
export async function setupOffline(page: Page, opts: SetupOfflineOptions = {}) {
  // Rating needs a connected wallet; default to a non-owner one and stub the wallet send.
  await page.addInitScript(() => {
    const w = window as unknown as { __E2E_CONNECTED_ADDRESS?: string; __E2E_SEND_TX?: () => string }
    w.__E2E_CONNECTED_ADDRESS ??= '0x9999999999999999999999999999999999999999'
    w.__E2E_SEND_TX = () => '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  })
  // Mutable copy so DELETE actually removes the agent from subsequent list fetches.
  const agents = [...((opts.agents ?? [DEMO_AGENT]) as { name: string }[])]
  const health = opts.health ?? {
    ok: true,
    network: 'arbitrum-sepolia',
    chainId: 421614,
    master: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', balanceEth: '1.234' },
  }
  const catalog = opts.catalog ?? MOCK_CATALOG
  const memory = opts.memory ?? EMPTY_MEMORY
  // NB: `??` would swallow an explicit `null` (used to force a 500). Check undefined instead.
  const reputation = opts.reputation === undefined ? { agentId: '421614:42', count: 0, averageValue: 0 } : opts.reputation

  await mockRpc(page)

  await page.route('**/api/health**', async (route) => {
    await json(route, 200, health)
  })

  await page.route('**/api/catalog', async (route) => {
    if ((opts.catalogStatus ?? 200) !== 200) {
      await json(route, opts.catalogStatus ?? 500, { error: 'catalog boom' })
      return
    }
    await json(route, 200, catalog)
  })

  // List + create share the exact /api/agents path — branch on method.
  await page.route('**/api/agents', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      try {
        opts.capture?.create?.push(JSON.parse(route.request().postData() ?? '{}'))
      } catch {
        /* ignore */
      }
      if ((opts.createStatus ?? 201) >= 400) {
        await json(route, opts.createStatus ?? 400, { error: 'Agent "demo" already exists' })
        return
      }
      const created = (opts.create as { agent?: { name: string } } | undefined)?.agent as
        | { name: string }
        | undefined
      const response = opts.create ?? {
        ok: true,
        agent: DEMO_AGENT,
        balanceEth: '0.002',
        fundTxHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      }
      // Keep the list in sync so the picker can select the new agent after creation.
      const newAgent = created ?? (response as { agent?: { name: string } }).agent
      if (newAgent && !agents.some((a) => a.name === newAgent.name)) {
        agents.push(newAgent as { name: string })
      }
      await json(route, opts.createStatus ?? 201, response)
      return
    }
    if ((opts.agentsStatus ?? 200) !== 200) {
      await json(route, opts.agentsStatus ?? 500, { error: opts.agentsError ?? 'boom' })
      return
    }
    await json(route, 200, { agents })
  })

  // Single agent fetch + delete: /api/agents/:name (no further segments)
  await page.route('**/api/agents/*', async (route) => {
    const rawUrl = route.request().url()
    const url = new URL(rawUrl, 'http://127.0.0.1')
    const pathname = url.pathname // /api/agents/<name>[/<action>]
    const parts = pathname.split('/').filter(Boolean) // ['api','agents',name,action?]
    const method = route.request().method()
    // Only handle exactly /api/agents/:name here; sub-actions have their own routes.
    if (parts.length === 3) {
      if (method === 'DELETE') {
        if (typeof opts.deleteResponse === 'function') {
          await (opts.deleteResponse as (r: Route) => Promise<void>)(route)
          return
        }
        if ((opts.deleteStatus ?? 200) >= 400) {
          await json(route, opts.deleteStatus ?? 500, { error: 'delete failed' })
          return
        }
        const deletedName = parts[2]
        const idx = agents.findIndex((a) => a.name === deletedName)
        if (idx >= 0) agents.splice(idx, 1)
        await json(route, 200, (opts.deleteResponse as unknown) ?? { ok: true, name: deletedName })
        return
      }
      if (method === 'GET') {
        const found = (agents as { name: string }[]).find((a) => a.name === parts[2])
        if (!found) {
          await json(route, 404, { error: 'Agent not found' })
          return
        }
        await json(route, 200, { agent: found })
        return
      }
    }
    // Not ours — let a more specific route handle it. Abort this handler.
    await route.fallback()
  })

  await page.route('**/api/agents/*/memory', async (route) => {
    if ((opts.memoryStatus ?? 200) !== 200) {
      await json(route, opts.memoryStatus ?? 500, { error: 'memory boom' })
      return
    }
    const body = typeof memory === 'function' ? (memory as () => unknown)() : memory
    await json(route, 200, body)
  })

  await page.route('**/api/reputation**', async (route) => {
    if (reputation === null) {
      await json(route, 500, { error: 'reputation lookup failed' })
      return
    }
    await json(route, 200, reputation)
  })

  await page.route('**/api/agents/*/chat', async (route) => {
    try {
      opts.capture?.chat?.push(JSON.parse(route.request().postData() ?? '{}'))
    } catch {
      /* ignore */
    }
    if (typeof opts.chat === 'function') {
      await (opts.chat as (r: Route) => Promise<void>)(route)
      return
    }
    await json(route, 200, opts.chat ?? { reply: 'mock reply', events: [{ type: 'message', content: 'mock reply' }] })
  })

  await page.route('**/api/agents/*/feedback/prepare', async (route) => {
    try {
      opts.capture?.feedback?.push(JSON.parse(route.request().postData() ?? '{}'))
    } catch {
      /* ignore */
    }
    if ((opts.feedbackStatus ?? 200) >= 400) {
      await json(route, opts.feedbackStatus ?? 500, { error: 'feedback prepare failed' })
      return
    }
    await json(route, 200, opts.feedback ?? {
      ok: true,
      to: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
      data: '0x',
      chainId: 421614,
      agentId: '421614:42',
      value: 100,
      scanUrl: 'https://testnet.8004scan.io/agents/arbitrum-sepolia/42',
    })
  })

  await page.route('**/api/agents/*/fund', async (route) => {
    try {
      opts.capture?.fund?.push(JSON.parse(route.request().postData() ?? '{}'))
    } catch {
      /* ignore */
    }
    if (typeof opts.fund === 'function') {
      await (opts.fund as (r: Route) => Promise<void>)(route)
      return
    }
    if ((opts.fundStatus ?? 200) >= 400) {
      await json(route, opts.fundStatus ?? 500, { error: 'Master wallet has insufficient ETH.' })
      return
    }
    await json(route, 200, (opts.fund as unknown) ?? {
      ok: true,
      txHash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      amountEth: '0.001',
      to: DEMO_AGENT.walletAddress,
      from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
  })
}

/** Open the agent sidebar. On narrow screens it sits behind the Agent button. */
export async function openAgentPanel(page: Page) {
  const toggle = page.getByTestId('agent-panel-toggle')
  if (!(await toggle.isVisible())) return
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.locator('#agent-panel').waitFor({ state: 'visible' })
}

/** Close the agent drawer. No-op when the sidebar is docked beside the chat. */
export async function closeAgentPanel(page: Page) {
  const toggle = page.getByTestId('agent-panel-toggle')
  if (!(await toggle.isVisible())) return
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
}

/** Wait for the app to finish initial agent load. */
export async function gotoWithAgent(page: Page, name = 'demo') {
  await page.goto('/')
  const select = page.getByTestId('agent-select')
  await select.waitFor({ state: 'attached' })
  // agents list loaded (may be empty string when no agents)
  await page.waitForFunction(
    (expected) => {
      const el = document.querySelector('[data-testid="agent-select"]') as HTMLElement | null
      if (!el) return false
      if (expected === '') return true
      return (el.getAttribute('data-value') ?? '') !== ''
    },
    name,
    { timeout: 15000 },
  )
  // The picker emits the selection to App on the next tick; wait for the chat
  // column to leave its no-agent state so later fills aren't wiped by the swap.
  if (name) await expect(page.getByTestId('chat-empty-no-agent')).toHaveCount(0)
}

/** Open the advanced agent select and pick an agent by name. */
export async function selectAgent(page: Page, name: string) {
  await openAgentPanel(page)
  const trigger = page.getByTestId('agent-select')
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await page.getByTestId('agent-search').fill(name)
  await page.getByTestId(`agent-option-${name}`).click()
  await expect(trigger).toHaveAttribute('data-value', name)
  await expect(page.getByTestId('chat-empty-no-agent')).toHaveCount(0)
}

/** Expand the collapsed "Agent Info" section in the picker. */
export async function openAgentInfo(page: Page) {
  await openAgentPanel(page)
  const toggle = page.getByRole('button', { name: /Agent Info/ })
  await toggle.waitFor({ state: 'visible' })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

/** Expand the collapsed "Fund Agent" section in the picker. */
export async function openFundAgent(page: Page) {
  await openAgentPanel(page)
  const toggle = page.getByRole('button', { name: /Fund Agent/ })
  await toggle.waitFor({ state: 'visible' })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

/** Expand "Chat Stats" section. */
export async function openChatStats(page: Page) {
  await openAgentPanel(page)
  const toggle = page.getByRole('button', { name: /Chat Stats/ })
  await toggle.waitFor({ state: 'visible' })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

/** Open the Conversations drawer (AgentMemory lives inside v-show). */
export async function openConversations(page: Page) {
  const btn = page.getByRole('button', { name: /Conversations/ })
  const expanded = await btn.getAttribute('aria-expanded')
  if (expanded !== 'true') await btn.click()
  await page.getByTestId('agent-memory').waitFor({ state: 'visible' })
}

/** Open the Create-agent dialog from the last option in the agent select. */
export async function openCreateDialog(page: Page) {
  await openAgentPanel(page)
  const trigger = page.getByTestId('agent-select')
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await page.getByTestId('agent-create-option').click()
  await page.getByTestId('create-dialog').waitFor({ state: 'visible' })
}

/** Send a chat message and wait for the first agent bubble. */
export async function sendChat(page: Page, text: string) {
  await closeAgentPanel(page)
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}
