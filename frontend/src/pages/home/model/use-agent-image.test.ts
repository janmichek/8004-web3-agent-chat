import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const api = vi.hoisted(() => ({ uploadImage: vi.fn() }))
vi.mock('@/shared/api', () => api)
vi.mock('vue', async (orig) => ({
  ...(await orig<typeof import('vue')>()),
  useTemplateRef: () => ref(null),
}))

import { useAgentImage } from './use-agent-image'

const createObjectURL = vi.fn(() => 'blob:preview')
const revokeObjectURL = vi.fn()

const png = (size = 10) => ({ type: 'image/png', size, name: 'a.png' }) as File

beforeEach(() => {
  vi.resetAllMocks()
  createObjectURL.mockReturnValue('blob:preview')
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
})
afterEach(() => vi.unstubAllGlobals())

function choose(img: ReturnType<typeof useAgentImage>, file: File) {
  const input = { files: [file], value: 'x' }
  img.onFileChosen({ target: input } as unknown as Event)
  return input
}

describe('image selection', () => {
  it('accepts a supported file, previews it and resets the input', () => {
    const img = useAgentImage()
    const input = choose(img, png())
    expect(img.imageFile.value?.name).toBe('a.png')
    expect(img.imagePreviewUrl.value).toBe('blob:preview')
    expect(img.imageStatus.value).toBe('idle')
    expect(input.value).toBe('')
  })

  it('rejects unsupported types', () => {
    const img = useAgentImage()
    choose(img, { type: 'text/plain', size: 1, name: 'a.txt' } as File)
    expect(img.imageStatus.value).toBe('error')
    expect(img.imageError.value).toMatch(/Unsupported image type/)
    expect(img.imageFile.value).toBeNull()
  })

  it('rejects files over 5 MB', () => {
    const img = useAgentImage()
    choose(img, png(5 * 1024 * 1024 + 1))
    expect(img.imageError.value).toMatch(/max 5 MB/)
  })

  it('handles drag & drop and clears the dragging flag', () => {
    const img = useAgentImage()
    img.dragging.value = true
    img.onDrop({ dataTransfer: { files: [png()] } } as unknown as DragEvent)
    expect(img.dragging.value).toBe(false)
    expect(img.imageFile.value).not.toBeNull()
  })

  it('revokes the previous preview when replacing or removing', () => {
    const img = useAgentImage()
    choose(img, png())
    choose(img, png())
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    img.removeImage()
    expect(img.imageFile.value).toBeNull()
    expect(img.imagePreviewUrl.value).toBe('')
    expect(img.imageError.value).toBe('')
  })
})

describe('uploadSelectedImage', () => {
  it('returns undefined when nothing was picked', async () => {
    expect(await useAgentImage().uploadSelectedImage()).toBeUndefined()
    expect(api.uploadImage).not.toHaveBeenCalled()
  })

  it('uploads once and reuses the uri', async () => {
    api.uploadImage.mockResolvedValue({ imageUri: 'ipfs://cid' })
    const img = useAgentImage()
    choose(img, png())
    expect(await img.uploadSelectedImage()).toBe('ipfs://cid')
    expect(img.imageStatus.value).toBe('done')
    expect(await img.uploadSelectedImage()).toBe('ipfs://cid')
    expect(api.uploadImage).toHaveBeenCalledTimes(1)
  })

  it('records the error and rethrows on failure', async () => {
    api.uploadImage.mockRejectedValue(new Error('pinata down'))
    const img = useAgentImage()
    choose(img, png())
    await expect(img.uploadSelectedImage()).rejects.toThrow('pinata down')
    expect(img.imageStatus.value).toBe('error')
    expect(img.imageError.value).toBe('pinata down')
  })
})
