import QRCode from 'qrcode'

// Renders Barcode #1/#2 (SPEC §2.2, §5.1, §5.3) as real, scannable QR label
// PNGs. Generic composer + one thin wrapper per barcode kind.
//
// 🔒 Switched from CODE_128 to QR (DECISIONS.md "Barcode format: CODE_128 ->
// QR") — printed 1D bars at 40x30mm stayed too dense to resolve with a phone
// camera even after a dedicated quiet-zone/module-width pass; QR fits the
// same data in a small square with built-in error correction and reads at
// any angle. `jsbarcode` is removed from package.json entirely — this was
// its only remaining call site alongside Barcode1Display.tsx/
// Barcode2Display.tsx's own on-screen renders (both switched too).
//
// This is a PREVIEW only as of the P1 native plugin integration — the native
// Android build prints via P1PrinterPlugin.java drawing directly with LPAPI
// (startJob/draw2DQRCode/drawText/commitJob), not this rasterised PNG. The
// two layouts are maintained separately and can drift (see DECISIONS.md);
// this one is still what the web build's share/download fallback uses, and
// what renders on screen everywhere.
//
// LABEL SIZE IS HARDCODED to 40×30mm, matching the printer's actual stock.
// TODO(config): rolls range 20–55mm; label size should become a configurable
// setting (Administration, §6.4) once a second stock size is actually used.
// Do not hardcode new sizes elsewhere — read from here.
const LABEL_MM = { w: 40, h: 30 }

// Detonger P1 is a 203dpi thermal printer. 203 dots / 25.4mm = 7.992 dots/mm,
// so the native label grid is round(40 × 7.992) × round(30 × 7.992) =
// 320 × 240 dots (1 device dot per pixel at scale 1).
const DPI = 203
const DOTS_PER_MM = DPI / 25.4
const NATIVE_W = Math.round(LABEL_MM.w * DOTS_PER_MM) // 320
const NATIVE_H = Math.round(LABEL_MM.h * DOTS_PER_MM) // 240

// Supersample by an INTEGER factor so WePrint downsamples back to the 320×240
// native grid cleanly (no fractional resampling that would misalign barcode
// modules and hurt scannability). 2× → 640×480 export; better text/edge
// quality than rendering at native 320×240 directly.
const SCALE = 2
const CANVAS_W = NATIVE_W * SCALE // 640
const CANVAS_H = NATIVE_H * SCALE // 480

// Renders a QR symbol to its own offscreen canvas, fixed square size (16mm —
// QR_SIZE_PX below, up from 10mm in the 2026-07-26 layout redesign: "bigger
// QR" was the explicit ask, matching P1PrinterPlugin.java's own 16mm),
// matching the target the native plugin uses. Unlike the old 1D
// `renderBars`, no shrink-to-fit loop or separate outer-quiet-zone budget is
// needed: `qrcode` picks whatever version/module-count the content needs
// automatically at a fixed pixel footprint (a longer value makes modules
// smaller, never makes the whole symbol wider), and `margin` is the QR's own
// standard 4-module quiet zone (ISO/IEC 18004) baked into that fixed
// footprint — the "step module width down to preserve a reserved margin"
// problem was 1D-specific. Centering a 256px QR in this file's 640px-wide
// canvas (renderLabel below) already leaves generous margin from the
// label's own cut edge with no extra bookkeeping required.
const QR_SIZE_PX = 256 // 16mm at this file's SCALE/DPI — see renderLabel's own math
async function renderQr(value: string): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  await QRCode.toCanvas(canvas, value, {
    width: QR_SIZE_PX,
    margin: 4,
    errorCorrectionLevel: 'Q', // warehouse label, not a phone screen — tolerate wear/dirt
  })
  return canvas
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, basePx: number, weight: string, maxW: number) {
  let size = basePx
  ctx.font = `${weight} ${size}px monospace`
  while (size > 10 && ctx.measureText(text).width > maxW) {
    size -= 2
    ctx.font = `${weight} ${size}px monospace`
  }
  return size
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t}…`
}

// Generic 40×30mm label: a QR encoding `encodedValue`, the human-readable
// `displayValue` text large under it (auto-shrunk to fit — usually the same
// as encodedValue, but Barcode #2 encodes a shortened form while still
// displaying the full PLT-... id, see renderBarcode2Label), then small
// `fields` lines. Reused by both Barcode #1 (Step 3) and #2 (this step).
async function renderLabel(encodedValue: string, displayValue: string, fields: string[]): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const pad = 8 * SCALE
  const maxTextW = CANVAS_W - 2 * pad

  // 1) QR — dominant element (QR_SIZE_PX, the label's functional core),
  //    drawn 1:1 (no rescale, keeps modules crisp), centered horizontally.
  const qr = await renderQr(encodedValue)
  const qrX = (CANVAS_W - qr.width) / 2
  const qrY = pad
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(qr, qrX, qrY)
  ctx.imageSmoothingEnabled = true

  // 2) Human-readable text, large, left-aligned under the QR (auto-shrunk
  //    to fit width) — matches P1PrinterPlugin.java's left-aligned text
  //    (2026-07-26 redesign switched this from centered to left, so native
  //    print and web preview read the same way).
  let y = qrY + qr.height + 6 * SCALE
  const codeFont = fitFont(ctx, displayValue, 22 * SCALE, 'bold', maxTextW)
  ctx.font = `bold ${codeFont}px monospace`
  ctx.fillText(displayValue, pad, y)
  y += codeFont + 6 * SCALE

  // 3) Small fields, one per line, left-aligned. Larger-over-more:
  //    ellipsize, don't shrink.
  const smallFont = 16 * SCALE
  ctx.font = `${smallFont}px sans-serif`
  const lineH = smallFont + 3 * SCALE
  for (const field of fields) {
    ctx.fillText(ellipsize(ctx, field, maxTextW), pad, y)
    y += lineH
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Label PNG generation failed'))),
      'image/png',
    )
  })
}

// --- Barcode #1 (raw serial, §2.2/§5.1). Value == the serial. ---
export interface Barcode1LabelData {
  serial: string
  type: string // Tur
  owner: string // Buyurtmachi
  weightKg: number // Og'irlik
  date: string // Sana
}

export function renderBarcode1Label(data: Barcode1LabelData): Promise<Blob> {
  return renderLabel(data.serial, data.serial, [
    `${data.type} · ${data.weightKg.toLocaleString()} kg`,
    data.owner,
    data.date,
  ])
}

// --- Barcode #2 (physical pallet, §2.2/§5.3). Value == the sticker ID. ---
// §2.2 encodes: sticker ID + parent seriya + turi + kalibr + og'irlik + egasi.
export interface Barcode2LabelData {
  barcode2: string // sticker ID, PLT-<serial>-<calibre>-<seq>
  serial: string // parent seriya
  type: string // Tur
  calibre: string // Kalibr label (e.g. "Kalibr 4" / "Konditirskiy")
  weightKg: number // Og'irlik
  owner: string // Egasi / Buyurtmachi
}

// Shared with Barcode2Display.tsx's own on-screen QR render (a second,
// separate rendering path — see that file) so the "PLT-" strip has exactly
// one definition. Matches P1PrinterPlugin.java's drawAndCommit exactly, and
// OmborChiqimTab.processBarcode's re-prepend on scan — kept from the
// CODE_128 density fix even though QR doesn't need it for legibility,
// specifically so preview and print agree on ONE encoded value (this task's
// own requirement) rather than reintroducing the drift that existed before
// this pass. "PLT-" is a fixed literal on every barcode2 ever minted
// (FinishedReceiptForm.tsx's sole mint point), so stripping it is
// unambiguous and lossless.
export function stripBarcode2Prefix(barcode2: string): string {
  return barcode2.startsWith('PLT-') ? barcode2.slice(4) : barcode2
}

// calibre is "Kalibr N" or "Konditirskiy" (Sozlamalar-managed master data,
// calibres.label — see useCalibres.ts) — abbreviate for the printed
// label/preview only; the full label is unchanged everywhere else in the
// app (reports, dropdowns, etc). Shared with Barcode2Display.tsx's own
// on-screen summary row for the same reason stripBarcode2Prefix is: one
// definition, so every place calibre appears on a label-adjacent surface
// agrees. Keep in sync with P1PrinterPlugin.java's abbreviateCalibre.
export function abbreviateCalibre(label: string): string {
  if (label === 'Konditirskiy') return 'KN'
  const match = label.match(/^Kalibr (\d+)$/)
  return match ? `K${match[1]}` : label
}

// Displayed text is always the full barcode2, unchanged — only the encoded
// QR value drops the prefix (stripBarcode2Prefix above). The parent serial
// is dropped from the printed fields entirely (2026-07-26 redesign) — it
// stays inside the encoded QR value above for lookups, unchanged.
export function renderBarcode2Label(data: Barcode2LabelData): Promise<Blob> {
  return renderLabel(stripBarcode2Prefix(data.barcode2), data.barcode2, [
    `${data.type} · ${abbreviateCalibre(data.calibre)} · ${data.weightKg.toLocaleString()} kg`,
    data.owner,
  ])
}
