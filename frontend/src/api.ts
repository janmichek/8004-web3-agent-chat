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
  endpoints?: { type: string; value: string }[]
  services?: CreateAgentService[]
  oasfDomains?: string[]
  oasfSkills?: string[]
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

export type CreateAgentService = {
  name: string
  endpoint: string
}

export type CreateAgentRequest = {
  name: string
  description?: string
  imageUri?: string
  actions?: string[]
  tools?: string[]
  oasfDomains?: string[]
  oasfSkills?: string[]
  fundEth?: string
  skipRegister?: boolean
  active?: boolean
  services?: CreateAgentService[]
  mcpEndpoint?: string
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
  ephemeral?: boolean
  privateKey?: string
  privateKeyEnvVar?: string
  /** Full agent config — present in ephemeral mode so the browser can back it up. */
  config?: Record<string, unknown>
  ephemeralWarning?: string
}

/** Browser-held backup of an ephemeral agent (config + private key). */
export type AgentBackup = {
  config: Record<string, unknown>
  privateKey: string
  savedAt: string
}

const BACKUP_KEY = 'web3agent:backups:v1'

function readBackups(): Record<string, AgentBackup> {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, AgentBackup>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Persist an ephemeral agent's config + key so cold instances can be healed. */
export function saveAgentBackup(name: string, config: Record<string, unknown>, privateKey: string) {
  try {
    const all = readBackups()
    all[name] = { config, privateKey, savedAt: new Date().toISOString() }
    localStorage.setItem(BACKUP_KEY, JSON.stringify(all))
  } catch {
    /* storage full or unavailable — backup is best-effort */
  }
}

export function loadAgentBackup(name: string): AgentBackup | null {
  return readBackups()[name] ?? null
}

export function deleteAgentBackup(name: string) {
  try {
    const all = readBackups()
    delete all[name]
    localStorage.setItem(BACKUP_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

async function restoreAgent(name: string): Promise<boolean> {
  const backup = loadAgentBackup(name)
  if (!backup) return false
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(name)}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: backup.config, privateKey: backup.privateKey }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function request<T>(path: string, init?: RequestInit, retryRestore = true): Promise<T> {
  // Merge headers via the Headers API: spreading init.headers into an
  // object literal silently drops Headers instances and mangles arrays.
  const headers = new Headers(init?.headers)
  // Only default to JSON for string bodies — FormData needs the browser's
  // multipart Content-Type (with boundary) and must stay untouched.
  if (!headers.has('Content-Type') && typeof init?.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(path, { ...init, headers })
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
    // Cold serverless instance forgot this agent but the browser holds a
    // backup (ephemeral mode): heal the instance, then retry once.
    // Skipped for the restore endpoint itself to avoid recursion.
    const agentMatch = path.match(/^\/api\/agents\/([^/]+)\/.+/)
    if (retryRestore && res.status === 404 && agentMatch && !path.endsWith('/restore')) {
      const agentName = decodeURIComponent(agentMatch[1] ?? '')
      if (agentName && (await restoreAgent(agentName))) {
        return request<T>(path, init, false)
      }
    }
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

export type UploadImageResponse = {
  ok: boolean
  imageUri: string
}

/** Upload an agent image (multipart) — backend pins it to IPFS. */
export function uploadImage(file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<UploadImageResponse>('/api/upload/image', {
    method: 'POST',
    body: form,
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
