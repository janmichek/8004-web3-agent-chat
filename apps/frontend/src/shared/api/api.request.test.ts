import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chatWithAgent,
  createAgent,
  deleteAgent,
  fetchAgents,
  fetchCatalog,
  fetchMemory,
  fetchReputation,
  fundAgent,
  prepareFeedback,
  saveAgentBackup,
  uploadImage,
} from './api'

type Reply = { status?: number; body?: unknown; text?: string }

const fetchMock = vi.fn()
const storage = new Map<string, string>()

/** Queue one fetch response; `body` is JSON-encoded, `text` is sent verbatim. */
function respond({ status = 200, body, text }: Reply) {
  const raw = text ?? (body === undefined ? '' : JSON.stringify(body))
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Status Text',
    text: async () => raw,
  })
}

function lastCall(n = 0) {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit & { headers: Headers }]
  return { url, init }
}

beforeEach(() => {
  fetchMock.mockReset()
  storage.clear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('request plumbing', () => {
  it('returns parsed JSON on success', async () => {
    respond({ body: { agents: [{ name: 'a' }] } })
    expect(await fetchAgents()).toEqual({ agents: [{ name: 'a' }] })
    expect(lastCall().url).toBe('/api/agents')
  })

  it('defaults to JSON content-type for string bodies only', async () => {
    respond({ body: { ok: true } })
    await createAgent({ name: 'bot', owner: '0x1' })
    const { init } = lastCall()
    expect(init.method).toBe('POST')
    expect(init.headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'bot', owner: '0x1' })
  })

  it('leaves multipart uploads without a content-type so the browser adds the boundary', async () => {
    respond({ body: { ok: true, imageUri: 'ipfs://x' } })
    const file = new Blob(['x'], { type: 'image/png' }) as File
    await uploadImage(file)
    const { init } = lastCall()
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.headers.has('Content-Type')).toBe(false)
  })

  it('treats an empty 200 body as null data', async () => {
    respond({ text: '' })
    expect(await fetchCatalog()).toBeNull()
  })

  it('reports non-JSON bodies with the status and a snippet', async () => {
    respond({ status: 502, text: '<html>Bad gateway</html>' })
    await expect(fetchAgents()).rejects.toThrow('Request failed (502): <html>Bad gateway</html>')
  })

  it('prefers the backend error message on failure', async () => {
    respond({ status: 400, body: { error: 'name taken' } })
    await expect(createAgent({ name: 'x', owner: '0x1' })).rejects.toThrow('name taken')
  })

  it('falls back to a generic status message', async () => {
    respond({ status: 500, body: {} })
    await expect(fetchAgents()).rejects.toThrow('Request failed (500)')
  })
})

describe('endpoint wrappers', () => {
  it('url-encodes agent names', async () => {
    respond({ body: { ok: true } })
    await deleteAgent('my bot/1')
    const { url, init } = lastCall()
    expect(url).toBe('/api/agents/my%20bot%2F1')
    expect(init.method).toBe('DELETE')
  })

  it('posts chat messages and fund requests', async () => {
    respond({ body: { reply: 'hi', events: [] } })
    await chatWithAgent('bot', 'hello')
    expect(lastCall().url).toBe('/api/agents/bot/chat')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ message: 'hello' })

    respond({ body: { ok: true } })
    await fundAgent('bot', '0.01')
    expect(lastCall(1).url).toBe('/api/agents/bot/fund')
    expect(JSON.parse(lastCall(1).init.body as string)).toEqual({ amountEth: '0.01' })
  })

  it('prepares feedback for the named agent', async () => {
    respond({ body: { ok: true } })
    await prepareFeedback('bot', { value: 90, clientAddress: '0xabc' })
    expect(lastCall().url).toBe('/api/agents/bot/feedback/prepare')
  })

  it('adds the tag filter to reputation lookups only when given', async () => {
    respond({ body: { count: 0 } })
    respond({ body: { count: 0 } })
    await fetchReputation('421614:1')
    await fetchReputation('421614:1', 'a b')
    expect(lastCall().url).toBe('/api/reputation/421614%3A1')
    expect(lastCall(1).url).toBe('/api/reputation/421614%3A1?tag=a%20b')
  })

  it('fetches memory by agent name', async () => {
    respond({ body: { agent: 'bot' } })
    await fetchMemory('bot')
    expect(lastCall().url).toBe('/api/agents/bot/memory')
  })
})

describe('cold-instance restore', () => {
  const backup = () => saveAgentBackup('bot', { name: 'bot' }, '0xkey')

  it('restores from the browser backup on 404 then retries once', async () => {
    backup()
    respond({ status: 404, body: { error: 'Agent not found' } })
    respond({ body: { ok: true } }) // restore
    respond({ body: { reply: 'hi', events: [] } }) // retry
    expect(await chatWithAgent('bot', 'yo')).toEqual({ reply: 'hi', events: [] })
    expect(lastCall(1).url).toBe('/api/agents/bot/restore')
    expect(JSON.parse(lastCall(1).init.body as string)).toEqual({
      config: { name: 'bot' },
      privateKey: '0xkey',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry when there is no backup', async () => {
    respond({ status: 404, body: { error: 'Agent not found' } })
    await expect(chatWithAgent('bot', 'yo')).rejects.toThrow('Agent not found')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces the original error when restore fails', async () => {
    backup()
    respond({ status: 404, body: { error: 'Agent not found' } })
    respond({ status: 500, body: {} }) // restore fails
    await expect(chatWithAgent('bot', 'yo')).rejects.toThrow('Agent not found')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('survives a network error during restore', async () => {
    backup()
    respond({ status: 404, body: { error: 'Agent not found' } })
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(chatWithAgent('bot', 'yo')).rejects.toThrow('Agent not found')
  })

  it('only retries once even if the retry 404s again', async () => {
    backup()
    respond({ status: 404, body: { error: 'gone' } })
    respond({ body: { ok: true } })
    respond({ status: 404, body: { error: 'still gone' } })
    await expect(chatWithAgent('bot', 'yo')).rejects.toThrow('still gone')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
