import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasIpfsBackend,
  toGatewayUrl,
  uploadImage,
  uploadJson,
  validateImage,
  type IpfsImage,
} from '../ipfs.js'

const image: IpfsImage = { data: Buffer.from('png'), mimeType: 'image/png', fileName: 'a.png' }

function reply(body: unknown, init: { ok?: boolean; status?: number; text?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => init.text ?? JSON.stringify(body),
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('PINATA_JWT', '')
  vi.stubEnv('IPFS_NODE_URL', '')
  vi.stubEnv('PINATA_GATEWAY_URL', 'https://gw.test/ipfs/')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('toGatewayUrl', () => {
  it('rewrites ipfs:// uris onto the configured gateway (trailing slash trimmed)', () => {
    expect(toGatewayUrl('ipfs://bafy123')).toBe('https://gw.test/ipfs/bafy123')
    expect(toGatewayUrl('  IPFS://bafy123 ')).toBe('https://gw.test/ipfs/bafy123')
  })

  it('leaves http(s) urls alone', () => {
    expect(toGatewayUrl(' https://x.test/a.png ')).toBe('https://x.test/a.png')
  })

  it('falls back to the default gateway', () => {
    vi.stubEnv('PINATA_GATEWAY_URL', '')
    expect(toGatewayUrl('ipfs://c')).toMatch(/^https:\/\/.+\/ipfs\/c$/)
  })
})

describe('hasIpfsBackend', () => {
  it('is false with no config and true with either backend', () => {
    expect(hasIpfsBackend()).toBe(false)
    vi.stubEnv('PINATA_JWT', 'jwt')
    expect(hasIpfsBackend()).toBe(true)
    vi.stubEnv('PINATA_JWT', '')
    vi.stubEnv('IPFS_NODE_URL', 'http://node')
    expect(hasIpfsBackend()).toBe(true)
  })
})

describe('validateImage', () => {
  it('accepts supported images', () => {
    expect(validateImage('a.png', 'image/png', 100)).toBeNull()
  })
  it('rejects bad type, size and missing name', () => {
    expect(validateImage('a.txt', 'text/plain', 1)).toMatch(/Unsupported image type/)
    expect(validateImage('a.png', 'image/png', 5 * 1024 * 1024 + 1)).toMatch(/too large/)
    expect(validateImage('  ', 'image/png', 1)).toMatch(/file name is required/)
  })
})

describe('uploadImage', () => {
  it('throws without a backend', async () => {
    await expect(uploadImage(image)).rejects.toThrow(/No IPFS backend configured/)
  })

  it('uploads to Pinata (public) and returns a gateway url', async () => {
    vi.stubEnv('PINATA_JWT', 'jwt')
    fetchMock.mockResolvedValue(reply({ data: { cid: 'bafyimg' } }))
    expect(await uploadImage(image)).toBe('https://gw.test/ipfs/bafyimg')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('pinata.cloud')
    expect(init.headers.Authorization).toBe('Bearer jwt')
    expect((init.body as FormData).get('network')).toBe('public')
  })

  it('accepts a top-level cid in the Pinata response', async () => {
    vi.stubEnv('PINATA_JWT', 'jwt')
    fetchMock.mockResolvedValue(reply({ cid: 'bafytop' }))
    expect(await uploadImage(image)).toBe('https://gw.test/ipfs/bafytop')
  })

  it('surfaces Pinata errors and missing cids', async () => {
    vi.stubEnv('PINATA_JWT', 'jwt')
    fetchMock.mockResolvedValueOnce(reply({}, { ok: false, status: 401, text: 'nope' }))
    await expect(uploadImage(image)).rejects.toThrow('Pinata upload failed (401): nope')
    fetchMock.mockResolvedValueOnce(reply({}))
    await expect(uploadImage(image)).rejects.toThrow(/did not contain a CID/)
  })

  it('uploads to a local IPFS node and parses the first NDJSON line', async () => {
    vi.stubEnv('IPFS_NODE_URL', 'http://node:5001/')
    fetchMock.mockResolvedValue(reply({}, { text: '{"Hash":"QmFirst"}\n{"Hash":"QmSecond"}\n' }))
    expect(await uploadImage(image)).toBe('https://gw.test/ipfs/QmFirst')
    expect(fetchMock.mock.calls[0]![0]).toBe('http://node:5001/api/v0/add?pin=true')
  })

  it('surfaces IPFS node errors and missing hashes', async () => {
    vi.stubEnv('IPFS_NODE_URL', 'http://node')
    fetchMock.mockResolvedValueOnce(reply({}, { ok: false, status: 500, text: 'down' }))
    await expect(uploadImage(image)).rejects.toThrow('IPFS node upload failed (500): down')
    fetchMock.mockResolvedValueOnce(reply({}, { text: '{}' }))
    await expect(uploadImage(image)).rejects.toThrow(/did not contain a Hash/)
  })
})

describe('uploadJson', () => {
  it('throws without a backend', async () => {
    await expect(uploadJson({ a: 1 })).rejects.toThrow(/No IPFS backend configured/)
  })

  it('returns the bare CID from Pinata', async () => {
    vi.stubEnv('PINATA_JWT', 'jwt')
    fetchMock.mockResolvedValue(reply({ data: { cid: 'bafyjson' } }))
    expect(await uploadJson({ a: 1 }, 'x.json')).toBe('bafyjson')
    const form = fetchMock.mock.calls[0]![1].body as FormData
    expect((form.get('file') as File).name).toBe('x.json')
  })

  it('surfaces Pinata JSON errors', async () => {
    vi.stubEnv('PINATA_JWT', 'jwt')
    fetchMock.mockResolvedValueOnce(reply({}, { ok: false, status: 429, text: 'slow' }))
    await expect(uploadJson({})).rejects.toThrow('Pinata JSON upload failed (429): slow')
    fetchMock.mockResolvedValueOnce(reply({}))
    await expect(uploadJson({})).rejects.toThrow(/did not contain a CID/)
  })

  it('returns the Hash from a local node and surfaces its errors', async () => {
    vi.stubEnv('IPFS_NODE_URL', 'http://node')
    fetchMock.mockResolvedValueOnce(reply({}, { text: '{"Hash":"QmJson"}' }))
    expect(await uploadJson({ a: 1 })).toBe('QmJson')
    fetchMock.mockResolvedValueOnce(reply({}, { ok: false, status: 502, text: 'bad' }))
    await expect(uploadJson({})).rejects.toThrow('IPFS node JSON upload failed (502): bad')
    fetchMock.mockResolvedValueOnce(reply({}, { text: '{}' }))
    await expect(uploadJson({})).rejects.toThrow(/did not contain a Hash/)
  })
})
