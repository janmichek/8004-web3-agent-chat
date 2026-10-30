import { ref, useTemplateRef } from 'vue'
import { uploadImage } from '@/shared/api'

// Optional agent image (step 1): chosen via file picker or drag & drop,
// kept locally for preview and uploaded to IPFS at creation time,
// just before the agent metadata is pinned.
export function useAgentImage() {
  const imageFile = ref<File | null>(null)
  const imagePreviewUrl = ref('')
  const imageUri = ref('')
  const imageStatus = ref<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const imageError = ref('')
  const dragging = ref(false)
  // Bound to the `ref="fileInput"` input in the consuming component's template.
  const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

  const ACCEPTED_IMAGE_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ]

  function pickImage() {
    fileInput.value?.click()
  }

  function onFileChosen(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) selectImage(file)
  }

  function onDrop(event: DragEvent) {
    dragging.value = false
    const file = event.dataTransfer?.files?.[0]
    if (file) selectImage(file)
  }

  function selectImage(file: File) {
    imageError.value = ''
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      imageStatus.value = 'error'
      imageError.value = 'Unsupported image type — use PNG, JPEG, GIF, WebP or SVG'
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      imageStatus.value = 'error'
      imageError.value = 'Image is too large — max 5 MB'
      return
    }
    if (imagePreviewUrl.value) URL.revokeObjectURL(imagePreviewUrl.value)
    imageFile.value = file
    imagePreviewUrl.value = URL.createObjectURL(file)
    imageUri.value = ''
    imageStatus.value = 'idle'
  }

  function removeImage() {
    if (imagePreviewUrl.value) URL.revokeObjectURL(imagePreviewUrl.value)
    imageFile.value = null
    imagePreviewUrl.value = ''
    imageUri.value = ''
    imageStatus.value = 'idle'
    imageError.value = ''
  }

  /** Upload the picked image once; returns its URI (or undefined when none was picked). */
  async function uploadSelectedImage(): Promise<string | undefined> {
    let uri = imageUri.value || undefined
    if (imageFile.value && !uri) {
      imageStatus.value = 'uploading'
      try {
        const res = await uploadImage(imageFile.value)
        imageUri.value = res.imageUri
        uri = res.imageUri
        imageStatus.value = 'done'
      } catch (err) {
        imageStatus.value = 'error'
        imageError.value = err instanceof Error ? err.message : 'Image upload failed'
        throw err
      }
    }
    return uri
  }

  return {
    imageFile,
    imagePreviewUrl,
    imageStatus,
    imageError,
    dragging,
    pickImage,
    onFileChosen,
    onDrop,
    removeImage,
    uploadSelectedImage,
  }
}
