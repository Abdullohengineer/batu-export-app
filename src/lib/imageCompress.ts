// Client-side photo compression (SPEC §2.9): longest edge ~1600px, JPEG ~0.7.
// "Target <~300KB" is the spec's own approximate framing, not a guarantee —
// a single-pass compress at fixed size/quality, not an iterative search.

export interface CompressedImage {
  blob: Blob
  originalSize: number
  compressedSize: number
}

const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.7

export async function compressImage(file: File): Promise<CompressedImage> {
  const originalSize = file.size
  const bitmap = await createImageBitmap(file)

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Image compression failed'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })

  return { blob, originalSize, compressedSize: blob.size }
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`
}
