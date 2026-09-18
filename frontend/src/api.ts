export type AgentSummary = {
  name: string
  description: string
  walletAddress?: string
  walletChainId: number
  agentId?: string
  agentURI?: string
  owners?: string[]
  operators?: string[]
  actions: string[]
  tools: string[]
  active: boolean
}

export type ReputationSummary = {
  count: number
  averageValue: number
  scanUrl?: string
}

export type FeedbackResult = {
  ok: boolean
  txHash: string
  agentId: string
  value: number
  rater: string
  reputation: ReputationSummary
  scanUrl: string
  feedbackURI?: string
}

export type ChatEvent =
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; content: string }
  | { type: 'message'; content: string }

export type ChatResponse = {
  reply: string
  events: ChatEvent[]
}

export type CatalogAction = {
  name: string
  description: string
  toolNames: string[]
  skillName: string
}

export type CatalogTool = {
  name: string
  description: string
}

export type CatalogResponse = {
  network: string
  networkName: string
  chainId: number
  master: { address?: string; balanceEth?: string }
  actions: CatalogAction[]
  tools: CatalogTool[]
}

export type CreateAgentRequest = {
  name: string
  actions?: string[]
  tools?: string[]
  fundEth?: string
  skipRegister?: boolean
}

export type CreateAgentStep = {
  step: string
  ok: boolean
  detail?: string
}

export type CreateAgentResponse = {
  ok: boolean
  agent: AgentSummary
  balanceEth: string
  fundTxHash?: string
  steps: CreateAgentStep[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  // Read as text first: backends/proxies can return non-JSON bodies
  // (plain-text 404s, proxy errors, empty responses). Parsing those with
  // res.json() throws a cryptic "unexpected non-whitespace character
  // after JSON data" instead of the real error.
  const text = await res.text()
  let data: { error?: string } | null = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Request failed (${res.status}): ${text.slice(0, 160) || res.statusText}`)
    }
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`)
  }
  return data as T
}

export function fetchAgents() {
  return request<{ agents: AgentSummary[] }>('/api/agents')
}

export function fetchHealth() {
  return request<{
    ok: boolean
    network: string
    chainId: number
    master?: { address?: string; balanceEth?: string }
  }>('/api/health')
}

export function fetchCatalog() {
  return request<CatalogResponse>('/api/catalog')
}

export function createAgent(body: CreateAgentRequest) {
  return request<CreateAgentResponse>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteAgent(name: string) {
  return request<{ ok: boolean; name: string }>(`/api/agents/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

export function chatWithAgent(name: string, message: string) {
  return request<ChatResponse>(`/api/agents/${encodeURIComponent(name)}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

export function fundAgent(name: string, amountEth: string) {
  return request<{
    ok: boolean
    txHash: string
    amountEth: string
    to: string
    from: string
  }>(`/api/agents/${encodeURIComponent(name)}/fund`, {
    method: 'POST',
    body: JSON.stringify({ amountEth }),
  })
}

export function submitFeedback(
  agentName: string,
  body: { agentId?: string; value: number; tag?: string; endpoint?: string; comment?: string },
) {
  return request<FeedbackResult>(`/api/agents/${encodeURIComponent(agentName)}/feedback`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function fetchReputation(agentId: string, tag?: string) {
  const q = tag ? `?tag=${encodeURIComponent(tag)}` : ''
  return request<ReputationSummary & { agentId: string }>(
    `/api/reputation/${encodeURIComponent(agentId)}${q}`,
  )
}

export type MemoryMessage = {
  role: 'user' | 'assistant' | 'tool' | 'system' | 'unknown'
  content: string
  name?: string
  toolCalls?: { name: string; args: unknown }[]
  id?: string
  ts?: string
}

export type MemorySession = {
  id: string
  index: number
  startedAt: string
  endedAt: string
  messageCount: number
  humanCount: number
  assistantCount: number
  toolCount: number
  title: string
  preview: string
  messages: MemoryMessage[]
  txHashes: string[]
  recipients: string[]
  summary: string
}

export type MemorySummary = {
  agent: string
  exists: boolean
  empty: boolean
  threads: string[]
  checkpointCount: number
  firstActive: string | null
  lastActive: string | null
  stats: {
    totalMessages: number
    humanCount: number
    aiCount: number
    toolCount: number
    toolCallsByName: Record<string, number>
    uniqueRecipients: string[]
    txHashes: string[]
    totalEthSent: string
  }
  summary: string
  preview: MemoryMessage[]
  recentTxHashes: string[]
  sessions: MemorySession[]
}

export function fetchMemory(agentName: string) {
  return request<MemorySummary>(`/api/agents/${encodeURIComponent(agentName)}/memory`)
}

/** Detect a mined/success tx hash in agent tool output (not an Error: line). */
export function extractSuccessfulTxHash(content: string): string | null {
  if (/^\s*Error:/i.test(content) || /\bError:/i.test(content.split('\n')[0] ?? '')) return null
  const m = content.match(/\b(0x[a-fA-F0-9]{64})\b/)
  return m?.[1] ?? null
}

export function scanUrlForAgent(agentId: string, chainId: number, tab?: string): string {
  const parts = agentId.split(':')
  const tokenId = parts[parts.length - 1] || agentId
  const slug = chainId === 42161 ? 'arbitrum-one' : 'arbitrum-sepolia'
  const base = `https://testnet.8004scan.io/agents/${slug}/${tokenId}`
  return tab ? `${base}?tab=${tab}` : base
}

export function txScanUrl(txHash: string, chainId: number): string {
  const base = chainId === 42161 ? 'https://arbiscan.io' : 'https://sepolia.arbiscan.io'
  return `${base}/tx/${txHash}`
}
