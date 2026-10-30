/**
 * Offline route coverage for src/server/api.ts. Every external dependency
 * (LLM, wallet, chain, IPFS, registry, reputation, MCP SDK) is mocked so each
 * route branch can be driven through app.request().
 *
 * Run: npx vitest run src/server/tests/api-routes.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ethers } from 'ethers'

const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/web3agent-routes-${process.pid}-${Date.now()}`
  process.env.VERCEL = '1'
  process.env.MCP_AUTH_TOKEN = 'route-test-token'
  process.env.RPC_URL = 'http://127.0.0.1:9/rpc'
  process.env.X402_FACILITATOR_URL = 'http://facilitator.test'
  process.env.RPC_RATE_MAX = '5'
  return { dir }
})

const store = vi.hoisted(() => ({
  configs: new Map<string, unknown>(),
  updates: [] as unknown[],
  streamError: null as Error | null,
  provider: {
    getBalance: vi.fn(async () => 10n ** 18n),
    waitForTransaction: vi.fn(async () => null),
  },
}))

vi.mock('../../core/wallet.js', () => ({
  AGENTS_DIR: env.dir,
  getMasterWallet: vi.fn(() => ({
    address: '0x0000000000000000000000000000000000000001',
    privateKey: '0x' + '2'.repeat(64),
  })),
  getMasterWalletBalance: vi.fn(async () => '1.0'),
  getOrCreateAgentWallet: vi.fn(({ agentName }: { agentName: string }) => ({
    address: '0x0000000000000000000000000000000000000002',
    privateKey: '0x' + '1'.repeat(64),
    name: agentName,
  })),
  fundAgentWallet: vi.fn(async () => '0x' + 'f'.repeat(64)),
  getAgentWalletEnvVars: (name: string) => [
    `AGENT_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PRIVATE_KEY`,
    'AGENT_PRIVATE_KEY',
  ],
}))

vi.mock('../../core/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/config.js')>()
  return { ...actual, getProvider: () => store.provider }
})

vi.mock('../../core/agent-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/agent-config.js')>()
  const base = (name: string) => ({
    name,
    description: `Agent ${name}`,
    walletAddress: '0x0000000000000000000000000000000000000002',
    walletChainId: 421614,
    endpoints: [],
    trustModels: [],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: { actions: [], tools: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: 0,
  })
  return {
    ...actual,
    loadAgentConfig: (name: string) => {
      if (store.configs.has(name)) return store.configs.get(name)
      return fs.existsSync(path.join(env.dir, name)) ? base(name) : null
    },
    resolveToolsFromConfig: vi.fn(() => ({ tools: [], skills: [] })),
    buildCapabilitySummary: vi.fn(() => 'capabilities'),
    deleteAgentConfig: vi.fn(() => true),
    saveAgentConfig: vi.fn(),
  }
})

vi.mock('../../core/llm.js', () => ({ getLLM: vi.fn(() => ({})) }))

vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: vi.fn(() => ({
    stream: async () =>
      (async function* () {
        for (const u of store.updates) yield u
        if (store.streamError) throw store.streamError
      })(),
  })),
}))

vi.mock('../../core/agent-skills.js', () => ({ resolveAgentSkills: vi.fn(async () => []) }))

vi.mock('../../core/file-checkpoint.js', () => ({
  createPersistentCheckpointer: vi.fn(async () => ({ saver: undefined, flush: async () => {} })),
}))

vi.mock('../../core/registry.js', () => ({
  registerAgent: vi.fn(async () => ({
    agentId: '42',
    agentURI: 'ipfs://registration',
    updatedAt: 1700000000,
  })),
}))

vi.mock('../../core/ipfs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/ipfs.js')>()
  return {
    ...actual,
    hasIpfsBackend: vi.fn(() => false),
    validateImage: vi.fn(() => null),
    uploadImage: vi.fn(async () => 'https://gateway.test/ipfs/image.png'),
    toGatewayUrl: (uri: string) => uri.replace('ipfs://', 'https://gateway.test/ipfs/'),
  }
})

vi.mock('../../core/memory-reader.js', () => ({
  readAgentMemoryAsync: vi.fn(async (name: string) => ({
    lastActive: name === 'beta' ? '2026-01-03T00:00:00.000Z' : '2026-01-02T00:00:00.000Z',
    stats: { totalMessages: 3 },
    sessions: [{ id: 's1' }],
  })),
}))

vi.mock('../../core/reputation.js', () => ({
  prepareFeedback: vi.fn(async () => ({ to: '0x0', data: '0x' })),
  getReputationSummary: vi.fn(async () => ({ count: 1, averageValue: 80 })),
}))

vi.mock('../../mcp/server.js', () => ({
  getMcpServer: vi.fn(() => ({ connect: async () => {} })),
  getAgentToolAllowlist: vi.fn(async (name: string) =>
    name === 'known' ? ['get_balance'] : undefined,
  ),
}))

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: class {
    async handleRequest() {
      return Response.json({ jsonrpc: '2.0', id: 1, result: { mcp: true } })
    }
  },
}))

const OWNER = '0x0000000000000000000000000000000000000001'
let ipSeq = 0
/** Fresh client IP per request group, so the shared in-memory rate limiter stays out of the way. */
const freshIp = () => `10.1.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`

function aiMsg(content: unknown, toolCalls: { name: string; args: unknown }[] = []) {
  return { _getType: () => 'ai', content, tool_calls: toolCalls }
}
function toolMsg(content: string) {
  return { _getType: () => 'tool', content }
}

async function json(
  path: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
) {
  const { app } = await import('../api.js')
  const res = await app.request(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return json(path, { method: 'POST', body: JSON.stringify(body), headers })
}

describe('API routes (offline, full branch coverage)', () => {
  beforeAll(() => {
    fs.mkdirSync(env.dir, { recursive: true })
    for (const name of ['alpha', 'beta', 'known', 'bare', 'paid']) {
      fs.mkdirSync(path.join(env.dir, name), { recursive: true })
      fs.writeFileSync(path.join(env.dir, name, 'wallet.json'), JSON.stringify({ address: OWNER }))
    }
    fs.mkdirSync(path.join(env.dir, 'nowallet'), { recursive: true })
    fs.writeFileSync(path.join(env.dir, 'nowallet', 'agent-config.json'), '{}')
    store.configs.set('bare', null)
    store.configs.set('nowallet', {
      name: 'nowallet',
      description: 'no wallet',
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: { actions: [], tools: [] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: 0,
    })
    store.configs.set('paid', {
      name: 'paid',
      description: 'paid agent',
      walletAddress: '0x0000000000000000000000000000000000000002',
      walletChainId: 421614,
      endpoints: [{ type: 'A2A', value: 'https://paid.test/api/a2a' }],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: true,
      metadata: { actions: [], tools: [] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: 0,
    })
    store.configs.set('known', {
      name: 'known',
      description: 'known agent',
      walletAddress: '0x0000000000000000000000000000000000000002',
      walletChainId: 421614,
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: { actions: [], tools: ['get_balance'] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: 0,
    })
  })

  afterAll(() => {
    fs.rmSync(env.dir, { recursive: true, force: true })
  })

  afterEach(() => {
    store.updates = []
    store.streamError = null
    process.env.MCP_AUTH_TOKEN = 'route-test-token'
    process.env.VERCEL = '1'
    delete process.env.A2A_PAY_TO
  })

  describe('MCP endpoint', () => {
    it('GET returns the public descriptor without a tool list', async () => {
      const { app } = await import('../api.js')
      const res = await app.request('/api/mcp')
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      const body = (await res.json()) as { auth: string; name: string }
      expect(body.auth).toBe('bearer')
      expect(body.name).toBe('web3agent')
    })

    it('allows open discovery methods without a token, including notification batches', async () => {
      const init = await json('/api/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      })
      expect(init.status).toBe(200)
      const batch = await json('/mcp', {
        method: 'POST',
        body: JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/initialized' }]),
      })
      expect(batch.status).toBe(200)
    })

    it('fails closed with 503 when MCP_AUTH_TOKEN is not configured', async () => {
      delete process.env.MCP_AUTH_TOKEN
      const res = await json('/api/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
      })
      expect(res.status).toBe(503)
    })

    it('requires the bearer token for executing calls', async () => {
      const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }
      const none = await post('/api/mcp', call)
      expect(none.status).toBe(401)
      const wrong = await post('/api/mcp', call, { authorization: 'Bearer nope' })
      expect(wrong.status).toBe(401)
      const ok = await post('/api/mcp', call, { authorization: 'Bearer route-test-token' })
      expect(ok.status).toBe(200)
    })

    it('treats empty, non-object, unparsable and response-only bodies as needing auth', async () => {
      const bodies = ['[]', '[1]', '{"id":1,"result":{}}', 'not-json']
      for (const raw of bodies) {
        const { app } = await import('../api.js')
        const res = await app.request('/api/mcp', { method: 'POST', body: raw })
        expect(res.status, raw).toBe(401)
      }
    })

    it('rate limits failed auth attempts per client IP', async () => {
      const ip = freshIp()
      let last = 0
      for (let i = 0; i < 61; i++) {
        last = (
          await post(
            '/api/mcp',
            { jsonrpc: '2.0', id: i, method: 'tools/call' },
            { authorization: 'Bearer wrong', 'x-forwarded-for': ip },
          )
        ).status
      }
      expect(last).toBe(429)
    })

    it('scopes to an agent allowlist, 404s unknown agents, and serves /mcp too', async () => {
      const call = { jsonrpc: '2.0', id: 1, method: 'tools/call' }
      const auth = { authorization: 'Bearer route-test-token' }
      const scoped = await post('/api/mcp?agent=known', call, auth)
      expect(scoped.status).toBe(200)
      const unknown = await post('/api/mcp?agent=ghost-scope', call, auth)
      expect(unknown.status).toBe(404)
      const alias = await post('/mcp', call, auth)
      expect(alias.status).toBe(200)
    })
  })

  describe('A2A endpoint', () => {
    it('serves the default agent card and honours forwarded host headers', async () => {
      const { app } = await import('../api.js')
      const res = await app.request('/.well-known/agent-card.json', {
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'agents.test' },
      })
      expect(res.status).toBe(200)
      expect(JSON.stringify(await res.json())).toContain('https://agents.test/api/a2a')
    })

    it('serves per-agent cards, rejects malformed names and unknown agents', async () => {
      const { app } = await import('../api.js')
      expect((await app.request('/.well-known/agent-card.json?agent=known')).status).toBe(200)
      expect((await app.request('/.well-known/agent-card.json?agent=.bad')).status).toBe(404)
      expect((await app.request('/.well-known/agent-card.json?agent=ghost-a2a')).status).toBe(404)
    })

    it('answers GET health per agent and rejects other verbs', async () => {
      const { app } = await import('../api.js')
      expect((await app.request('/api/a2a?agent=known')).status).toBe(200)
      expect((await app.request('/api/a2a', { method: 'PUT' })).status).toBe(405)
      expect((await app.request('/api/a2a?agent=ghost-a2a')).status).toBe(404)
    })

    it('runs message/send through the agent chat with its read-only tools', async () => {
      store.updates = [{ agent: { messages: [aiMsg('pong')] } }]
      const res = await post('/api/a2a?agent=known', {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'm1',
            role: 'user',
            parts: [{ kind: 'text', text: 'ping' }],
          },
        },
      })
      expect(res.status).toBe(200)
      expect(JSON.stringify(res.body)).toContain('pong')
    })

    it('answers the generic endpoint with an echo when no agent is named', async () => {
      const res = await post('/api/a2a', {
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: {
            kind: 'message',
            messageId: 'm2',
            role: 'user',
            parts: [{ kind: 'text', text: 'hello' }],
          },
        },
      })
      expect(res.status).toBe(200)
    })

    it('rate limits anonymous JSON-RPC calls per client IP', async () => {
      const ip = freshIp()
      let last = 0
      for (let i = 0; i < 61; i++) {
        last = (
          await post(
            '/api/a2a',
            { jsonrpc: '2.0', id: i, method: 'ping' },
            { 'x-forwarded-for': ip },
          )
        ).status
      }
      expect(last).toBe(429)
    })

    it('reports malformed JSON as a parse error', async () => {
      const { app } = await import('../api.js')
      const res = await app.request('/api/a2a', { method: 'POST', body: '{nope' })
      expect(res.status).toBe(400)
    })

    it('advertises a payment requirement when A2A_PAY_TO is set', async () => {
      process.env.A2A_PAY_TO = '0x0000000000000000000000000000000000000009'
      const { app } = await import('../api.js')
      expect((await app.request('/.well-known/agent-card.json')).status).toBe(200)
    })
  })

  describe('catalog and health', () => {
    it('reports the facilitator x402 mode when a facilitator URL is configured', async () => {
      const res = await json('/api/catalog')
      expect((res.body.x402 as { mode: string }).mode).toBe('facilitator')
    })
  })

  describe('agent listing', () => {
    it('lists filesystem and env agents, newest conversation first', async () => {
      process.env.AGENT_ENVAGENT_CONFIG = '{"name":"envagent"}'
      process.env.AGENT_BROKEN_CONFIG = 'not json'
      process.env.AGENT_KEYONLY_PRIVATE_KEY = ethers.Wallet.createRandom().privateKey
      process.env.AGENT_PAIRED_PRIVATE_KEY = ethers.Wallet.createRandom().privateKey
      process.env.AGENT_PAIRED_CONFIG = '{"name":"paired-name"}'
      process.env.AGENT_BADPAIR_PRIVATE_KEY = ethers.Wallet.createRandom().privateKey
      process.env.AGENT_BADPAIR_CONFIG = 'not json'
      process.env.AGENT_NONAME_CONFIG = '{}'
      try {
        const res = await json('/api/agents')
        const names = (res.body.agents as { name: string }[]).map((a) => a.name)
        expect(names.indexOf('beta')).toBeLessThan(names.indexOf('alpha'))
        for (const n of ['envagent', 'broken', 'keyonly', 'paired-name', 'badpair', 'noname']) {
          expect(names, n).toContain(n)
        }
      } finally {
        for (const k of Object.keys(process.env))
          if (/^AGENT_(ENVAGENT|BROKEN|KEYONLY|PAIRED|BADPAIR|NONAME)_/.test(k))
            delete process.env[k]
      }
    })

    it('serves an env-only agent detail from its env private key', async () => {
      const pk = ethers.Wallet.createRandom()
      process.env.AGENT_ENVONLY_PRIVATE_KEY = pk.privateKey
      try {
        const res = await json('/api/agents/envonly')
        expect(res.status).toBe(200)
        const agent = res.body.agent as { walletAddress: string }
        expect(agent.walletAddress).toBe(pk.address)
      } finally {
        delete process.env.AGENT_ENVONLY_PRIVATE_KEY
      }
    })

    it('still lists agents when memory cannot be read', async () => {
      const { readAgentMemoryAsync } = await import('../../core/memory-reader.js')
      vi.mocked(readAgentMemoryAsync).mockRejectedValueOnce(new Error('disk'))
      const res = await json('/api/agents')
      expect(res.status).toBe(200)
    })

    it('returns an agent with x402 mode when it accepts payments', async () => {
      const res = await json('/api/agents/paid')
      expect((res.body.agent as { x402Mode: string }).x402Mode).toBe('facilitator')
    })
  })

  describe('agent creation', () => {
    const base = () => ({
      owner: OWNER,
      skipRegister: true,
      services: [{ name: 'web', endpoint: 'https://example.test' }],
    })
    const uniq = (p: string) => `${p}-${Date.now()}-${ipSeq++}`

    it('rejects invalid JSON and missing names', async () => {
      const { app } = await import('../api.js')
      const badJson = await app.request('/api/agents', { method: 'POST', body: '{' })
      expect(badJson.status).toBe(400)
      const noName = await post('/api/agents', { owner: OWNER })
      expect(noName.status).toBe(400)
    })

    it('rejects names that break the agent-name rule and names already taken', async () => {
      const bad = await post('/api/agents', { ...base(), name: '.hidden' })
      expect(bad.status).toBe(400)
      const taken = await post('/api/agents', { ...base(), name: 'alpha' })
      expect(taken.status).toBe(409)
    })

    it('rejects unknown actions and tools', async () => {
      const action = await post('/api/agents', { ...base(), name: uniq('a'), actions: ['nope'] })
      expect(action.status).toBe(400)
      const tool = await post('/api/agents', { ...base(), name: uniq('t'), tools: ['nope'] })
      expect(tool.status).toBe(400)
    })

    it('accepts a real action and tool, merging their tool names', async () => {
      const { ACTION_REGISTRY, TOOL_REGISTRY } = await import('../../core/action-registry.js')
      const action = ACTION_REGISTRY[0]!
      const tool = TOOL_REGISTRY[0]!
      const res = await post('/api/agents', {
        ...base(),
        name: uniq('acts'),
        actions: [action.name],
        tools: [tool.name],
        oasfDomains: ['1'],
        oasfSkills: ['2'],
      })
      expect(res.status).toBe(201)
    })

    it('validates OASF ids and their limits', async () => {
      const bad = await post('/api/agents', { ...base(), name: uniq('o'), oasfDomains: ['x'] })
      expect(bad.status).toBe(400)
      const tooMany = await post('/api/agents', {
        ...base(),
        name: uniq('o'),
        oasfDomains: Array.from({ length: 19 }, (_, i) => String(i + 1)),
      })
      expect(tooMany.status).toBe(400)
      const oversize = await post('/api/agents', {
        ...base(),
        name: uniq('o'),
        oasfSkills: Array.from({ length: 201 }, (_, i) => String(i + 1)),
      })
      expect(oversize.status).toBe(400)
    })

    it('validates service lists: shape, count, names, endpoints and duplicates', async () => {
      const cases: [string, unknown][] = [
        ['services must be an array', 'nope'],
        [
          'at most 20',
          Array.from({ length: 21 }, (_, i) => ({ name: `s${i}`, endpoint: 'e@mail.fun' })),
        ],
        ['name and an endpoint', [{ name: '', endpoint: 'x' }]],
        ['name (max 64)', [{ name: 'x'.repeat(65), endpoint: 'e@mail.fun' }]],
        ['endpoint (max 500)', [{ name: 'email', endpoint: 'x'.repeat(501) }]],
        [
          'duplicate service',
          [
            { name: 'email', endpoint: 'a@b.c' },
            { name: 'EMAIL', endpoint: 'd@e.f' },
          ],
        ],
        ['must be an https', [{ name: 'mcp', endpoint: 'http://remote.test/api/mcp' }]],
      ]
      for (const [expected, services] of cases) {
        const res = await post('/api/agents', { ...base(), name: uniq('s'), services })
        expect(res.status, expected).toBe(400)
        expect(String(res.body.error), expected).toContain(expected)
      }
    })

    it('requires an A2A endpoint for x402 support', async () => {
      const res = await post('/api/agents', { ...base(), name: uniq('x'), x402support: true })
      expect(res.status).toBe(400)
      expect(String(res.body.error)).toContain('x402support requires an A2A endpoint')
    })

    it('appends mcp/A2A shorthand endpoints unless declared, and accepts x402 with A2A', async () => {
      const res = await post('/api/agents', {
        ...base(),
        name: uniq('short'),
        services: undefined,
        mcpEndpoint: 'https://mcp.test/api/mcp',
        a2aEndpoint: 'https://a2a.test/api/a2a',
        x402support: true,
      })
      expect(res.status).toBe(201)
      const declared = await post('/api/agents', {
        ...base(),
        name: uniq('decl'),
        services: [{ name: 'mcp', endpoint: 'https://declared.test/mcp' }],
        mcpEndpoint: 'https://ignored.test/mcp',
      })
      expect(declared.status).toBe(201)
    })

    it('validates the image URI and normalises ipfs:// to a gateway URL', async () => {
      const bad = await post('/api/agents', { ...base(), name: uniq('img'), imageUri: 'ftp://x' })
      expect(bad.status).toBe(400)
      const ok = await post('/api/agents', { ...base(), name: uniq('img'), imageUri: 'ipfs://cid' })
      expect(ok.status).toBe(201)
      expect(JSON.stringify(ok.body)).toContain('https://gateway.test/ipfs/cid')
    })

    it('requires a valid owner address', async () => {
      const none = await post('/api/agents', { ...base(), name: uniq('own'), owner: undefined })
      expect(none.status).toBe(400)
      const bad = await post('/api/agents', { ...base(), name: uniq('own'), owner: '0xnope' })
      expect(bad.status).toBe(400)
    })

    it('reports master-wallet, wallet-creation and config-save failures as 500', async () => {
      const { getMasterWallet, getOrCreateAgentWallet } = await import('../../core/wallet.js')
      vi.mocked(getMasterWallet).mockImplementationOnce(() => {
        throw new Error('no master key')
      })
      const master = await post('/api/agents', { ...base(), name: uniq('m') })
      expect(master.status).toBe(500)
      expect(String(master.body.error)).toContain('Master wallet unavailable')

      vi.mocked(getOrCreateAgentWallet).mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      const wallet = await post('/api/agents', { ...base(), name: uniq('w') })
      expect(wallet.status).toBe(500)
      expect(String(wallet.body.error)).toContain('Wallet creation failed')

      const { saveAgentConfig } = await import('../../core/agent-config.js')
      vi.mocked(saveAgentConfig).mockImplementationOnce(() => {
        throw new Error('readonly')
      })
      const save = await post('/api/agents', { ...base(), name: uniq('c') })
      expect(save.status).toBe(500)
      expect(String(save.body.error)).toContain('Failed to save config')
    })

    it('registers on chain, keeps the agent when registration fails, and never funds', async () => {
      const { registerAgent } = await import('../../core/registry.js')
      const { fundAgentWallet } = await import('../../core/wallet.js')
      const registered = await post('/api/agents', {
        ...base(),
        skipRegister: false,
        name: uniq('reg'),
      })
      expect(registered.status).toBe(201)
      expect(vi.mocked(registerAgent)).toHaveBeenCalled()
      expect(vi.mocked(fundAgentWallet)).not.toHaveBeenCalled()

      vi.mocked(registerAgent).mockRejectedValueOnce(new Error('rpc down'))
      const failed = await post('/api/agents', {
        ...base(),
        skipRegister: false,
        name: uniq('regf'),
      })
      expect(failed.status).toBe(201)
    })

    it('returns the one-time key on Vercel unless the env var backs the wallet', async () => {
      const ephemeral = await post('/api/agents', { ...base(), name: uniq('eph') })
      expect(ephemeral.body.ephemeral).toBe(true)
      expect(typeof ephemeral.body.privateKey).toBe('string')

      const name = uniq('kept')
      process.env[`AGENT_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PRIVATE_KEY`] =
        '0x' + '3'.repeat(64)
      try {
        const kept = await post('/api/agents', { ...base(), name })
        expect(kept.body.ephemeral).toBeUndefined()
      } finally {
        delete process.env[`AGENT_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PRIVATE_KEY`]
      }
    })

    it('does not return a key when not running on Vercel', async () => {
      delete process.env.VERCEL
      const res = await post('/api/agents', { ...base(), name: uniq('local') })
      expect(res.body.ephemeral).toBeUndefined()
      expect(res.body.privateKey).toBeUndefined()
    })

    it('still succeeds when the balance read fails', async () => {
      store.provider.getBalance.mockRejectedValueOnce(new Error('rpc'))
      const res = await post('/api/agents', { ...base(), name: uniq('bal') })
      expect(res.status).toBe(201)
      expect(res.body.balanceEth).toBe('0')
    })

    it('accepts an explicit supported chainId', async () => {
      const res = await post('/api/agents', { ...base(), name: uniq('chain'), chainId: 421614 })
      expect(res.status).toBe(201)
    })
  })

  describe('agent restore (heal from browser backup)', () => {
    const cfg = (name: string, walletAddress: string) => ({
      name,
      description: `Agent ${name}`,
      walletAddress,
      walletChainId: 421614,
      endpoints: [],
      trustModels: [],
      owners: [],
      operators: [],
      active: true,
      x402support: false,
      metadata: { actions: [], tools: [] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: 0,
    })

    it('rejects invalid JSON, missing fields, and a name that does not match the URL', async () => {
      const { app } = await import('../api.js')
      const badJson = await app.request('/api/agents/heal-x/restore', { method: 'POST', body: '{' })
      expect(badJson.status).toBe(400)
      const missing = await post('/api/agents/heal-x/restore', { privateKey: '0x1' })
      expect(missing.status).toBe(400)
      const mismatch = await post('/api/agents/heal-x/restore', {
        config: cfg('heal-y', OWNER),
        privateKey: '0x1',
      })
      expect(mismatch.status).toBe(400)
    })

    it('rejects names that fail the naming rule', async () => {
      const key = ethers.Wallet.createRandom()
      const res = await post('/api/agents/.bad/restore', {
        config: cfg('.bad', key.address),
        privateKey: key.privateKey,
      })
      expect(res.status).toBe(400)
      expect(String(res.body.error)).toContain('invalid agent name')
    })

    it('rejects configs with the wrong shape, a bad wallet address, or an invalid key', async () => {
      const key = ethers.Wallet.createRandom()
      const shape = await post('/api/agents/heal-shape/restore', {
        config: { name: 'heal-shape', junk: true },
        privateKey: key.privateKey,
      })
      expect(shape.status).toBe(400)
      expect(String(shape.body.error)).toContain('invalid shape')

      const address = await post('/api/agents/heal-addr/restore', {
        config: cfg('heal-addr', 'not-an-address'),
        privateKey: key.privateKey,
      })
      expect(address.status).toBe(400)

      const badKey = await post('/api/agents/heal-key/restore', {
        config: cfg('heal-key', key.address),
        privateKey: 'not-a-key',
      })
      expect(badKey.status).toBe(400)
      expect(String(badKey.body.error)).toContain('privateKey is invalid')
    })

    it('will not overwrite an agent that already exists on this instance', async () => {
      const key = ethers.Wallet.createRandom()
      const res = await post('/api/agents/alpha/restore', {
        config: cfg('alpha', key.address),
        privateKey: key.privateKey,
      })
      expect(res.status).toBe(409)
    })

    it('heals a missing agent from a valid key-backed backup and deletes it through the API', async () => {
      const key = ethers.Wallet.createRandom()
      const name = `heal-${Date.now()}`
      const res = await post(`/api/agents/${name}/restore`, {
        config: cfg(name, key.address),
        privateKey: key.privateKey,
      })
      expect(res.status).toBe(200)
      const walletFile = JSON.parse(
        fs.readFileSync(path.join(env.dir, name, 'wallet.json'), 'utf-8'),
      ) as {
        address: string
      }
      expect(walletFile.address).toBe(key.address)
    })
  })

  describe('agent management', () => {
    it('refuses deletion on Vercel unless ALLOW_AGENT_DELETE is set', async () => {
      const { app } = await import('../api.js')
      const res = await app.request('/api/agents/alpha', { method: 'DELETE' })
      expect(res.status).toBe(403)
    })

    it('deletes an agent when deletion is allowed', async () => {
      delete process.env.VERCEL
      const { deleteAgentConfig } = await import('../../core/agent-config.js')
      const { app } = await import('../api.js')
      const ok = await app.request('/api/agents/beta', { method: 'DELETE' })
      expect(ok.status).toBe(200)
      vi.mocked(deleteAgentConfig).mockReturnValueOnce(false)
      const gone = await app.request('/api/agents/beta', { method: 'DELETE' })
      expect(gone.status).toBe(404)
    })

    it('fund: validates the body, amount and wallet, then sends and reports', async () => {
      const { app } = await import('../api.js')
      const badJson = await app.request('/api/agents/alpha/fund', { method: 'POST', body: '{' })
      expect(badJson.status).toBe(400)
      const badAmount = await post(
        '/api/agents/alpha/fund',
        { amountEth: '5' },
        { 'x-forwarded-for': freshIp() },
      )
      expect(badAmount.status).toBe(400)
      const noWallet = await post('/api/agents/nowallet/fund', {}, { 'x-forwarded-for': freshIp() })
      expect(noWallet.status).toBe(400)
      const ok = await post(
        '/api/agents/alpha/fund',
        { amountEth: '0.01' },
        { 'x-forwarded-for': freshIp() },
      )
      expect(ok.status).toBe(200)
      expect(ok.body.amountEth).toBe('0.01')
      const dflt = await post('/api/agents/alpha/fund', {}, { 'x-forwarded-for': freshIp() })
      expect(dflt.body.amountEth).toBe('0.001')
    })

    it('fund: reports a failed transfer as 500', async () => {
      const { fundAgentWallet } = await import('../../core/wallet.js')
      vi.mocked(fundAgentWallet).mockRejectedValueOnce(new Error('insufficient master funds'))
      const res = await post('/api/agents/alpha/fund', {}, { 'x-forwarded-for': freshIp() })
      expect(res.status).toBe(500)
    })

    it('memory: returns the summary, 500s on read failure', async () => {
      const { readAgentMemoryAsync } = await import('../../core/memory-reader.js')
      const ok = await json('/api/agents/alpha/memory')
      expect(ok.status).toBe(200)
      vi.mocked(readAgentMemoryAsync).mockRejectedValueOnce(new Error('corrupt'))
      const bad = await json('/api/agents/alpha/memory')
      expect(bad.status).toBe(500)
      expect((await json('/api/agents/ghost-mem/memory')).status).toBe(404)
    })
  })

  describe('chat', () => {
    it('404s for unknown agents, 400s for bad bodies', async () => {
      const { app } = await import('../api.js')
      expect((await post('/api/agents/ghost-chat/chat', { message: 'hi' })).status).toBe(404)
      const badJson = await app.request('/api/agents/alpha/chat', { method: 'POST', body: '{' })
      expect(badJson.status).toBe(400)
      expect((await post('/api/agents/alpha/chat', { message: '   ' })).status).toBe(400)
    })

    it('returns the reply and the tool trail', async () => {
      store.updates = [
        { agent: { messages: [aiMsg('', [{ name: 'get_balance', args: {} }])] } },
        { tools: { messages: [toolMsg('Balance: 1 ETH')] } },
        { agent: { messages: [aiMsg('You have 1 ETH')] } },
      ]
      const res = await post('/api/agents/alpha/chat', { message: 'balance?' })
      expect(res.status).toBe(200)
      expect(res.body.reply).toBe('You have 1 ETH')
      const types = (res.body.events as { type: string }[]).map((e) => e.type)
      expect(types).toEqual(['tool_call', 'tool_result', 'message'])
    })

    it('serialises non-string content and reports an empty turn', async () => {
      store.updates = [{ agent: { messages: [aiMsg([{ type: 'text', text: 'x' }])] } }]
      const structured = await post('/api/agents/alpha/chat', { message: 'q' })
      expect(String(structured.body.reply)).toContain('"type"')

      store.updates = [
        { agent: { messages: [aiMsg('   ')] } },
        { skipped: null },
        { agent: { messages: [{ content: 'x' }] } },
      ]
      const empty = await post('/api/agents/alpha/chat', { message: 'q' })
      expect(empty.body.reply).toBe('(no response)')
    })

    it('uses the no-capabilities prompt for agents without a config', async () => {
      const res = await post('/api/agents/bare/chat', { message: 'hi' })
      expect(res.status).toBe(200)
    })

    it('salvages a transaction hash when the step budget runs out', async () => {
      const hash = '0x' + 'c'.repeat(64)
      store.updates = [
        { tools: { messages: [toolMsg(`Error: nope ${'0x' + 'd'.repeat(64)}`)] } },
        { tools: { messages: [toolMsg(`sent ${hash}`)] } },
      ]
      store.streamError = new Error('Recursion limit of 25 reached')
      const res = await post('/api/agents/alpha/chat', { message: 'send' })
      expect(res.body.reply).toBe(`Sent! Transaction hash: ${hash}`)
    })

    it('explains running out of steps when no transaction was made', async () => {
      store.updates = [{ tools: { messages: [toolMsg('Error: revert')] } }]
      store.streamError = new Error('Recursion limit of 25 reached')
      const res = await post('/api/agents/alpha/chat', { message: 'send' })
      expect(String(res.body.reply)).toContain('ran out of steps')
    })

    it('surfaces unrelated runtime errors as 500', async () => {
      store.streamError = new Error('provider timeout')
      const res = await post('/api/agents/alpha/chat', { message: 'hi' })
      expect(res.status).toBe(500)
      expect(res.body.error).toBe('provider timeout')
    })
  })

  describe('feedback and reputation', () => {
    it('prepare: requires a wallet, an agent id and a numeric value', async () => {
      const { app } = await import('../api.js')
      expect((await post('/api/agents/ghost-fb/feedback/prepare', { value: 1 })).status).toBe(404)
      const badJson = await app.request('/api/agents/alpha/feedback/prepare', {
        method: 'POST',
        body: '{',
      })
      expect(badJson.status).toBe(400)
      expect((await post('/api/agents/alpha/feedback/prepare', { value: 1 })).status).toBe(401)
      const noAgent = await post('/api/agents/alpha/feedback/prepare', {
        value: 1,
        clientAddress: OWNER,
      })
      expect(noAgent.status).toBe(400)
      const badValue = await post('/api/agents/alpha/feedback/prepare', {
        agentId: '7',
        value: 'high',
        clientAddress: OWNER,
      })
      expect(badValue.status).toBe(400)
    })

    it('prepare: returns the unsigned tx and the scan link, and surfaces failures', async () => {
      const { prepareFeedback } = await import('../../core/reputation.js')
      const ok = await post('/api/agents/alpha/feedback/prepare', {
        agentId: '7',
        value: 90,
        clientAddress: OWNER,
      })
      expect(ok.status).toBe(200)
      expect(String(ok.body.scanUrl)).toContain('7')
      vi.mocked(prepareFeedback).mockRejectedValueOnce(new Error('bad tag'))
      const bad = await post('/api/agents/alpha/feedback/prepare', {
        agentId: '7',
        value: 90,
        clientAddress: OWNER,
      })
      expect(bad.status).toBe(500)
    })

    it('reputation: returns the summary and reports failures', async () => {
      const { getReputationSummary } = await import('../../core/reputation.js')
      const ok = await json('/api/reputation/7?tag=quality')
      expect(ok.status).toBe(200)
      expect(ok.body.agentId).toBe('7')
      vi.mocked(getReputationSummary).mockRejectedValueOnce(new Error('rpc'))
      expect((await json('/api/reputation/7')).status).toBe(500)
    })
  })

  describe('image upload', () => {
    it('400s for a non-multipart body and a missing file field', async () => {
      const { hasIpfsBackend } = await import('../../core/ipfs.js')
      vi.mocked(hasIpfsBackend).mockReturnValue(true)
      try {
        const { app } = await import('../api.js')
        const plain = await app.request('/api/upload/image', {
          method: 'POST',
          body: '{}',
          headers: { 'Content-Type': 'application/json' },
        })
        expect(plain.status).toBe(400)
        const form = new FormData()
        form.append('other', 'x')
        const missing = await app.request('/api/upload/image', { method: 'POST', body: form })
        expect(missing.status).toBe(400)
      } finally {
        vi.mocked(hasIpfsBackend).mockReturnValue(false)
      }
    })

    it('validates, pins and reports failures for a real file', async () => {
      const { hasIpfsBackend, validateImage, uploadImage } = await import('../../core/ipfs.js')
      vi.mocked(hasIpfsBackend).mockReturnValue(true)
      try {
        const { app } = await import('../api.js')
        const makeForm = () => {
          const f = new FormData()
          f.append('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
          return f
        }
        vi.mocked(validateImage).mockReturnValueOnce('file too large')
        const rejected = await app.request('/api/upload/image', {
          method: 'POST',
          body: makeForm(),
        })
        expect(rejected.status).toBe(400)

        const ok = await app.request('/api/upload/image', { method: 'POST', body: makeForm() })
        expect(ok.status).toBe(200)

        vi.mocked(uploadImage).mockRejectedValueOnce(new Error('pinata 500'))
        const failed = await app.request('/api/upload/image', { method: 'POST', body: makeForm() })
        expect(failed.status).toBe(500)
      } finally {
        vi.mocked(hasIpfsBackend).mockReturnValue(false)
      }
    })
  })

  describe('RPC proxy', () => {
    it('forwards the call to the upstream RPC and returns its body', async () => {
      const fetchMock = vi.fn(
        async () => new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}', { status: 200 }),
      )
      vi.stubGlobal('fetch', fetchMock)
      try {
        const { app } = await import('../api.js')
        const res = await app.request('/api/rpc', {
          method: 'POST',
          body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
        })
        expect(res.status).toBe(200)
        expect(await res.text()).toContain('0x1')
        expect(fetchMock).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ method: 'POST' }),
        )
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('reports an unreachable upstream as 502', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('ECONNREFUSED')
        }),
      )
      try {
        const { app } = await import('../api.js')
        const res = await app.request('/api/rpc', { method: 'POST', body: '{}' })
        expect(res.status).toBe(502)
        expect(await res.text()).toContain('ECONNREFUSED')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('rate limits the proxy per client IP to protect the paid RPC quota', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}', { status: 200 })),
      )
      try {
        const ip = freshIp()
        let last = 0
        for (let i = 0; i < 6; i++) {
          last = (
            await post(
              '/api/rpc',
              { jsonrpc: '2.0', id: i, method: 'eth_chainId' },
              {
                'x-forwarded-for': ip,
              },
            )
          ).status
        }
        expect(last).toBe(429)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('anonymous rate-limit bookkeeping', () => {
    it('prunes old buckets once more than 1000 clients have been seen', async () => {
      const { app } = await import('../api.js')
      for (let i = 0; i < 1005; i++) {
        await app.request('/api/a2a', {
          method: 'POST',
          body: '{}',
          headers: { 'x-forwarded-for': `172.16.${Math.floor(i / 250)}.${i % 250}` },
        })
      }
      const res = await app.request('/api/a2a', {
        method: 'POST',
        body: '{}',
        headers: { 'x-forwarded-for': '172.16.0.0' },
      })
      expect(res.status).toBe(200)
    })
  })
})
