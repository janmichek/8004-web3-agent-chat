/**
 * API-level E2E: wallet-gated feedback + reputation endpoints (no gas spent;
 * feedback is only prepared, never signed server-side).
 *
 * Requires:
 *   RUN_E2E=1 RPC_URL=... NETWORK=arbitrum-sepolia
 *   E2E_AGENT_NAME=<agent to rate, default abcd-agent>
 *
 * Run: RUN_E2E=1 npx vitest run src/server/tests/feedback-api.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest'

const RUN_E2E = process.env.RUN_E2E === '1'
const WALLET = '0x000000000000000000000000000000000000dEaD'

describe.runIf(RUN_E2E)('feedback API e2e (testnet)', () => {
  beforeAll(() => {
    // Prevent api.ts from starting an HTTP listener on import.
    process.env.VERCEL = '1'
  })

  const post = async (path: string, body: unknown) => {
    const { app } = await import('../api.js')
    return app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  const agent = () => encodeURIComponent(process.env.E2E_AGENT_NAME || 'abcd-agent')

  it('no server-signed feedback route: only the connected wallet can rate', async () => {
    const res = await post(`/api/agents/${agent()}/feedback`, { agentId: '421614:204', value: 85 })
    expect(res.status).toBe(404)
  })

  it('prepare requires a connected wallet address', async () => {
    const none = await post(`/api/agents/${agent()}/feedback/prepare`, {
      agentId: '421614:204',
      value: 85,
    })
    expect(none.status).toBe(401)

    const bad = await post(`/api/agents/${agent()}/feedback/prepare`, {
      agentId: '421614:204',
      value: 85,
      clientAddress: 'not-an-address',
    })
    expect(bad.status).toBe(401)
  })

  it('prepare validates input without spending gas', async () => {
    const badValue = await post(`/api/agents/${agent()}/feedback/prepare`, {
      agentId: '421614:204',
      value: 'high',
      clientAddress: WALLET,
    })
    expect(badValue.status).toBe(400)
  })

  it('GET /api/reputation/:agentId returns a summary', async () => {
    const { app } = await import('../api.js')
    const res = await app.request(`/api/reputation/${encodeURIComponent('421614:204')}`)
    const body = (await res.json()) as Record<string, unknown>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body.agentId).toBe('421614:204')
  }, 60_000)
})
