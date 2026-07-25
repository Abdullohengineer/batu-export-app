// Client-side photo compression (SPEC §2.9): longest edge ~1600px, JPEG ~0.7.
// "Target <~300KB" is the spec's own approximate framing, not a guarantee —
// a single-pass compress at fixed size/quality, not an iterative search.
// The DECODE step ahead of that resize/encode is the part that's proven
// unreliable on real devices (see decodeWithFallbacks below) and gets three
// independent paths plus retries; the resize/encode step itself is
// untouched by any of that.

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

// 2026-07-25 "Photo compression retry" investigation: real phone camera
// captures can be 4000-8000px on the longest edge — decoded to raw pixels
// that's 100+ MB for a single image, before any resizing happens. That
// decode step is what DECISIONS.md's "Qorovul photo upload silent failure"
// caught throwing `InvalidStateError` on certain real-device photos, and
// what still intermittently fails even with the <img> fallback below in
// place. The leading hypothesis, unconfirmed without a device (none
// available this session) but consistent with the reported symptom: memory
// pressure during that full-resolution decode, not a hard per-file
// rejection — a hard rejection would not start succeeding on a bare retry
// of the identical file, which is what "needs two or three attempts"
// describes. LARGE_FILE_BYTES is a coarse, zero-cost proxy for "this is
// probably a full-resolution camera capture, not an already-small image" —
// file SIZE isn't pixel DIMENSIONS, but a >2MB JPEG virtually always is a
// real capture, and checking it costs nothing (no decode needed), unlike
// checking actual pixel dimensions which would require the very decode
// step this exists to make safer.
const LARGE_FILE_BYTES = 2 * 1024 * 1024
const DECODE_RESIZE_BOUND = 2400 // generously above MAX_DIMENSION — a decode-time safety net, not the final size

// Path 1 (unchanged happy path, now decode-time-bounded for large files).
// `resizeHeight` alone, never `resizeWidth` *and* `resizeHeight` together:
// per spec, createImageBitmap only preserves aspect ratio when exactly one
// resize dimension is given — passing both stretches the image to fit
// that exact box whenever the source ratio doesn't already match it,
// which would ship a visibly distorted audit-trail photo. Height, not
// width: these are gate/intake/lab photos taken holding the phone
// normally (portrait), where height is already the longer edge, so this
// directly bounds the true longest edge; for a landscape photo it still
// shrinks both dimensions together, just not to an exact bound. Skipped
// below LARGE_FILE_BYTES so a smaller image is never upscaled by the hint.
async function decodeViaBitmap(file: File): Promise<DecodedSource> {
  const options: ImageBitmapOptions | undefined =
    file.size > LARGE_FILE_BYTES ? { resizeHeight: DECODE_RESIZE_BOUND, resizeQuality: 'medium' } : undefined
  const bitmap = await createImageBitmap(file, options)
  return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() }
}

// Path 2 — confirmed live on a real device (docs/DECISIONS.md "Qorovul
// photo upload silent failure") that createImageBitmap throws
// `InvalidStateError: the source image could not be decoded` on certain
// real-phone photos. An <img> element goes through the browser's ordinary
// image pipeline instead of createImageBitmap's own decoder, and decodes
// some files the latter rejects. img.decode() is the async equivalent of
// the old onload/onerror pair — it resolves only once the image is
// actually decoded and safe to draw, not just fetched.
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

// Path 3 (new) — same <img>/decode() pipeline as path 2, but loaded via a
// base64 data: URI (FileReader) instead of a blob: URL. A genuinely
// different loading mechanism, not just a repeat of path 2: if path 2's
// failure is specific to how a given WebView resolves/streams a blob: URL
// rather than the image codec itself, a data: URI sidesteps that by
// handing the browser the complete file inline instead of a reference to
// fetch. No object URL to revoke — data: URIs aren't a registered
// resource — so cleanup is a no-op.
async function decodeViaDataUri(file: File): Promise<DecodedSource> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, cleanup: () => {} }
}

const RETRY_ROUNDS = 3
const RETRY_DELAY_MS = 400

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Requirement: "only surface the error when genuinely unrecoverable."
// Tries all three decode paths in order; if every path fails, waits
// briefly and repeats the whole sequence, up to RETRY_ROUNDS times. The
// wait-and-repeat (not just the three paths once) is specifically for the
// transient-failure symptom this task describes — a photo that succeeds
// after the user manually reselects the same file two or three times —
// so that self-resolving automatically instead of costing a manual
// reselect per attempt. Logs each failed path (not just the final one)
// so a still-unrecoverable case on a real device shows exactly which
// paths were tried and why each one failed, not just the last error.
async function decodeWithFallbacks(file: File): Promise<DecodedSource> {
  const paths: Array<[string, (file: File) => Promise<DecodedSource>]> = [
    ['createImageBitmap', decodeViaBitmap],
    ['<img> + blob URL', decodeViaImageElement],
    ['<img> + data URI', decodeViaDataUri],
  ]
  let lastError: unknown

  for (let round = 1; round <= RETRY_ROUNDS; round++) {
    if (round > 1) await delay(RETRY_DELAY_MS)
    for (const [name, decode] of paths) {
      try {
        return await decode(file)
      } catch (err) {
        lastError = err
        console.warn(`[imageCompress] ${name} failed (round ${round}/${RETRY_ROUNDS}):`, err)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Image could not be decoded')
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const originalSize = file.size

  const decoded = await decodeWithFallbacks(file)

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
