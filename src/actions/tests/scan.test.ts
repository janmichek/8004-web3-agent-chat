import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getScanAgentFeedbacksTool,
  getScanAgentTool,
  searchAgentsTool,
} from '../tools/scan.tool.js'

let fetchMock: ReturnType<typeof vi.fn>

const reply = (text: string, status = 200) => ({ ok: status < 400, status, text: async () => text })

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('SCAN_API_KEY', 'k3y')
  vi.stubEnv('SCAN_API_BASE', 'https://scan.test/api')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('scan tools', () => {
  it('refuses to call the API without SCAN_API_KEY', async () => {
    vi.stubEnv('SCAN_API_KEY', '')
    const out = await getScanAgentTool.invoke({ agentId: '421614:1' })
    expect(out).toMatch(/SCAN_API_KEY environment variable is not set/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('search_agents builds the query string and sends all auth header variants', async () => {
    fetchMock.mockResolvedValue(reply('{"items":[]}'))
    const out = await searchAgentsTool.invoke({
      query: 'defi yield',
      chain_id: '421614',
      limit: 5,
      search_type: 'semantic',
    })
    expect(out).toBe('{"items":[]}')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      'https://scan.test/api/agents?query=defi+yield&chain_id=421614&limit=5&search_type=semantic',
    )
    expect(init.headers).toMatchObject({
      'X-Access-Token': 'k3y',
      'X-API-Key': 'k3y',
      Authorization: 'Bearer k3y',
    })
  })

  it('search_agents omits optional params', async () => {
    fetchMock.mockResolvedValue(reply('ok'))
    await searchAgentsTool.invoke({ query: 'x' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://scan.test/api/agents?query=x')
  })

  it('get_agent url-encodes the agent id', async () => {
    fetchMock.mockResolvedValue(reply('{}'))
    await getScanAgentTool.invoke({ agentId: '421614:204' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://scan.test/api/agents/421614%3A204')
  })

  it('get_agent_feedbacks adds the limit only when given', async () => {
    fetchMock.mockResolvedValue(reply('[]'))
    await getScanAgentFeedbacksTool.invoke({ agentId: '1:2', limit: 3 })
    await getScanAgentFeedbacksTool.invoke({ agentId: '1:2' })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://scan.test/api/agents/1%3A2/feedbacks?limit=3')
    expect(fetchMock.mock.calls[1]![0]).toBe('https://scan.test/api/agents/1%3A2/feedbacks')
  })

  it('truncates very long responses', async () => {
    fetchMock.mockResolvedValue(reply('x'.repeat(5000)))
    const out = (await getScanAgentTool.invoke({ agentId: '1:2' })) as string
    expect(out.endsWith('\n...[truncated]')).toBe(true)
    expect(out.length).toBe(4000 + '\n...[truncated]'.length)
  })

  it('returns an error string for non-2xx responses', async () => {
    fetchMock.mockResolvedValue(reply('not found', 404))
    expect(await getScanAgentTool.invoke({ agentId: '1:2' })).toBe('Error: 8004scan 404 not found')
  })

  it('returns an error string when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    expect(await getScanAgentTool.invoke({ agentId: '1:2' })).toBe('Error: ECONNRESET')
  })

  it('defaults to the testnet API base', async () => {
    vi.stubEnv('SCAN_API_BASE', '')
    fetchMock.mockResolvedValue(reply('{}'))
    await getScanAgentTool.invoke({ agentId: '1:2' })
    expect(fetchMock.mock.calls[0]![0]).toMatch(
      /^https:\/\/testnet\.8004scan\.io\/api\/v1\/agents\//,
    )
  })
})
