import type { Page, Route } from '@playwright/test'
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
  actions: [
    {
      name: 'transfer-eth',
      description: 'Transfer ETH on Arbitrum with balance checks and safety confirmations',
      toolNames: ['send_eth', 'get_token_balance'],
      skillName: 'transfer-eth',
    },
  ],
  tools: [
    { name: 'send_eth', description: 'Send ETH from the agent wallet to a destination address' },
    { name: 'get_token_balance', description: 'Check ETH or ERC-20 token balance of a wallet address' },
    { name: 'fetch_contract_abi', description: "Fetch a verified contract's ABI from the block explorer (experimental)" },
    { name: 'call_contract', description: 'Call any function on a verified contract (experimental)' },
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
  await page.route('**/api/rpc', async (route) => {
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

  await page.route('**/api/health', async (route) => {
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
        steps: [
          { step: 'wallet', ok: true, detail: DEMO_AGENT.walletAddress },
          { step: 'fund', ok: true, detail: 'tx 0xcc' },
          { step: 'config', ok: true },
          { step: 'register', ok: true, detail: '42' },
        ],
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

  await page.route('**/api/agents/*/feedback', async (route) => {
    try {
      opts.capture?.feedback?.push(JSON.parse(route.request().postData() ?? '{}'))
    } catch {
      /* ignore */
    }
    if ((opts.feedbackStatus ?? 200) >= 400) {
      await json(route, opts.feedbackStatus ?? 500, { error: 'feedback failed: RATER_PRIVATE_KEY missing' })
      return
    }
    await json(route, 200, opts.feedback ?? {
      ok: true,
      txHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      agentId: '421614:42',
      value: 100,
      rater: '0x9999999999999999999999999999999999999999',
      reputation: { count: 1, averageValue: 100 },
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

/** Wait for the app to finish initial agent load. */
export async function gotoWithAgent(page: Page, name = 'demo') {
  await page.goto('/')
  const select = page.getByTestId('agent-select')
  await select.waitFor({ state: 'visible' })
  // agents list loaded (may be empty string when no agents)
  await page.waitForFunction(
    (expected) => {
      const el = document.querySelector('[data-testid="agent-select"]') as HTMLSelectElement | null
      if (!el) return false
      if (expected === '') return true
      return el.value !== '' || el.options.length > 1
    },
    name,
    { timeout: 15000 },
  )
}

/** Expand the collapsed "Agent Info" section in the picker. */
export async function openAgentInfo(page: Page) {
  const toggle = page.getByRole('button', { name: /Agent Info/ })
  if ((await toggle.count()) === 0) return
  const expanded = await toggle.getAttribute('aria-expanded')
  if (expanded !== 'true') await toggle.click()
}

/** Expand "Chat Stats" section. */
export async function openChatStats(page: Page) {
  const toggle = page.getByRole('button', { name: /Chat Stats/ })
  if ((await toggle.count()) === 0) return
  const expanded = await toggle.getAttribute('aria-expanded')
  if (expanded !== 'true') await toggle.click()
}

/** Open the Conversations drawer (AgentMemory lives inside v-show). */
export async function openConversations(page: Page) {
  const btn = page.getByRole('button', { name: /Conversations/ })
  const expanded = await btn.getAttribute('aria-expanded')
  if (expanded !== 'true') await btn.click()
  await page.getByTestId('agent-memory').waitFor({ state: 'visible' })
}

/** Open the Create-agent dialog. */
export async function openCreateDialog(page: Page) {
  await page.getByTestId('picker-create').click()
  await page.getByTestId('create-dialog').waitFor({ state: 'visible' })
}

/** Send a chat message and wait for the first agent bubble. */
export async function sendChat(page: Page, text: string) {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}
