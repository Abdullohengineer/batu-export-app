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

interface DecodedSource {
  source: CanvasImageSource
  width: number
  height: number
  cleanup: () => void
}

async function decodeViaBitmap(file: File): Promise<DecodedSource> {
  const bitmap = await createImageBitmap(file)
  return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() }
}

// Fallback decode path — confirmed live on a real device (see docs/
// DECISIONS.md "Qorovul photo upload silent failure") that createImageBitmap
// throws `InvalidStateError: the source image could not be decoded` on
// certain real-phone photos. An <img> element goes through the browser's
// ordinary image pipeline instead of createImageBitmap's own decoder, and
// decodes some files the latter rejects. img.decode() is the async
// equivalent of the old onload/onerror pair — it resolves only once the
// image is actually decoded and safe to draw, not just fetched.
async function decodeViaImageElement(file: File): Promise<DecodedSource> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) }
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const originalSize = file.size

  let decoded: DecodedSource
  try {
    decoded = await decodeViaBitmap(file)
  } catch {
    decoded = await decodeViaImageElement(file)
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(decoded.width, decoded.height))
  const width = Math.round(decoded.width * scale)
  const height = Math.round(decoded.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(decoded.source, 0, 0, width, height)
  decoded.cleanup()

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
