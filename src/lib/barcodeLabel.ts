import JsBarcode from 'jsbarcode'

// Renders Barcode #1 (SPEC §2.2, §5.1) as a real, scannable Code128 label
// PNG for the Detonger P1 thermal printer via WePrint (PHASE0.md Part E).
//
// LABEL SIZE IS HARDCODED to 50×30mm — the stock pre-loaded in the printer.
// TODO(config): rolls range 20–55mm; label size should become a configurable
// setting (Administration, §6.4) once a second stock size is actually used.
// Do not hardcode new sizes elsewhere — read from here.
const LABEL_MM = { w: 50, h: 30 }

// Detonger P1 is a 203dpi thermal printer. 203 dots / 25.4mm = 7.992 dots/mm,
// so the native label grid is round(50 × 7.992) × round(30 × 7.992) =
// 400 × 240 dots (1 device dot per pixel at scale 1).
const DPI = 203
const DOTS_PER_MM = DPI / 25.4
const NATIVE_W = Math.round(LABEL_MM.w * DOTS_PER_MM) // 400
const NATIVE_H = Math.round(LABEL_MM.h * DOTS_PER_MM) // 240

// Supersample by an INTEGER factor so WePrint downsamples back to the 400×240
// native grid cleanly (no fractional resampling that would misalign barcode
// modules and hurt scannability). 2× → 800×480 export; better text/edge
// quality than rendering at native 400×240 directly.
const SCALE = 2
const CANVAS_W = NATIVE_W * SCALE // 800
const CANVAS_H = NATIVE_H * SCALE // 480

export interface Barcode1LabelData {
  serial: string // the stored barcode1 value == the serial (§2.2 / Step 3)
  type: string // Tur
  owner: string // Buyurtmachi
  weightKg: number // Og'irlik — storage actual_qty for this serial
  date: string // Sana
}

// Renders the Code128 bars to their own offscreen canvas (no built-in text —
// we draw the human-readable serial ourselves so we control layout).
function renderBars(value: string): HTMLCanvasElement {
  const barCanvas = document.createElement('canvas')
  JsBarcode(barCanvas, value, {
    format: 'CODE128',
    displayValue: false,
    // Module (narrowest bar) width in px. At 2× supersample this is 4px →
    // 2 native dots → 0.25mm, comfortably above the ~0.19mm Code128 minimum
    // for reliable scanning on a 203dpi head.
    width: 2 * SCALE,
    height: 70 * SCALE,
    margin: 0, // we place our own quiet zones on the composite canvas
  })
  return barCanvas
}

export function renderBarcode1Label(data: Barcode1LabelData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'

  const pad = 8 * SCALE
  const quietZone = 10 * SCALE // horizontal white margin around the bars

  // 1) Barcode bars — centered, scaled to fit within the quiet zones without
  //    exceeding the available width (only ever scaled DOWN, keeping the
  //    supersampled source crisp).
  const bars = renderBars(data.serial)
  const maxBarsW = CANVAS_W - 2 * quietZone
  const barsScale = Math.min(1, maxBarsW / bars.width)
  const drawnBarsW = bars.width * barsScale
  const drawnBarsH = bars.height * barsScale
  const barsX = (CANVAS_W - drawnBarsW) / 2
  const barsY = pad
  ctx.imageSmoothingEnabled = false // keep bar edges hard
  ctx.drawImage(bars, barsX, barsY, drawnBarsW, drawnBarsH)
  ctx.imageSmoothingEnabled = true

  // 2) Human-readable serial, large, directly under the bars (barcode convention).
  let y = barsY + drawnBarsH + 4 * SCALE
  const serialFont = 30 * SCALE
  ctx.font = `bold ${serialFont}px monospace`
  ctx.textBaseline = 'top'
  ctx.fillText(data.serial, CANVAS_W / 2, y)
  y += serialFont + 6 * SCALE

  // 3) Four small fields, one per line, in the required order and nothing
  //    else: Tur · Buyurtmachi · Og'irlik · Sana. NO calibre (§2.2 / task).
  //    Larger-over-more: if a line is too wide it's ellipsized rather than
  //    shrunk, so text stays legible at 203dpi.
  const smallFont = 17 * SCALE
  ctx.font = `${smallFont}px sans-serif`
  const lineH = smallFont + 3 * SCALE
  const maxTextW = CANVAS_W - 2 * pad
  const fields = [data.type, data.owner, `${data.weightKg.toLocaleString()} kg`, data.date]
  for (const field of fields) {
    ctx.fillText(ellipsize(ctx, field, maxTextW), CANVAS_W / 2, y)
    y += lineH
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Label PNG generation failed'))),
      'image/png',
    )
  })
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t}…`
}
