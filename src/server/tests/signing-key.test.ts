import { describe, it, expect, afterEach } from 'vitest'
import { serializeTurn, withSigningKey } from '../signing-key.js'

const KEY_A = '0x' + 'a'.repeat(64)
const KEY_B = '0x' + 'b'.repeat(64)

describe('withSigningKey', () => {
  afterEach(() => {
    delete process.env.AGENT_PRIVATE_KEY
  })

  it('exposes the key to the callback and restores the previous value afterwards', async () => {
    process.env.AGENT_PRIVATE_KEY = KEY_B
    const seen = await withSigningKey(KEY_A, async () => process.env.AGENT_PRIVATE_KEY)
    expect(seen).toBe(KEY_A)
    expect(process.env.AGENT_PRIVATE_KEY).toBe(KEY_B)
  })

  it('removes the variable when none was set before', async () => {
    await withSigningKey(KEY_A, async () => undefined)
    expect(process.env.AGENT_PRIVATE_KEY).toBeUndefined()
  })

  it('restores the environment even when the callback throws', async () => {
    await expect(
      withSigningKey(KEY_A, async () => {
        throw new Error('tool failed')
      }),
    ).rejects.toThrow('tool failed')
    expect(process.env.AGENT_PRIVATE_KEY).toBeUndefined()
  })

  it('never lets two turns interleave, so each tool sees its own agent key', async () => {
    const observed: string[] = []
    const turn = (key: string) =>
      withSigningKey(key, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        observed.push(process.env.AGENT_PRIVATE_KEY ?? '')
        await new Promise((resolve) => setTimeout(resolve, 5))
        observed.push(process.env.AGENT_PRIVATE_KEY ?? '')
      })
    await Promise.all([turn(KEY_A), turn(KEY_B)])
    expect(observed).toEqual([KEY_A, KEY_A, KEY_B, KEY_B])
  })

  it('keeps the queue alive after a failed turn', async () => {
    await withSigningKey(KEY_A, async () => {
      throw new Error('boom')
    }).catch(() => undefined)
    const after = await withSigningKey(KEY_B, async () => process.env.AGENT_PRIVATE_KEY)
    expect(after).toBe(KEY_B)
  })

  it('resolves a thunk key inside the queue, after the prior turn has restored the variable', async () => {
    process.env.AGENT_PRIVATE_KEY = KEY_B
    await withSigningKey(KEY_A, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
    const observed: string[] = []
    await withSigningKey(
      () => {
        observed.push(process.env.AGENT_PRIVATE_KEY ?? '')
        return KEY_A
      },
      async () => undefined,
    )
    expect(observed).toEqual([KEY_B])
  })
})

describe('serializeTurn', () => {
  it('runs turns strictly sequentially', async () => {
    const order: string[] = []
    const turn = (n: string) =>
      serializeTurn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 3))
        order.push(n)
      })
    await Promise.all([turn('a'), turn('b')])
    expect(order).toEqual(['a', 'b'])
  })

  it('keeps the queue alive when a turn rejects', async () => {
    await serializeTurn(async () => {
      throw new Error('boom')
    }).catch(() => undefined)
    await expect(serializeTurn(async () => 'ok')).resolves.toBe('ok')
  })
})
