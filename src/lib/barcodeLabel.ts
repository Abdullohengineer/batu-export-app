import JsBarcode from 'jsbarcode'

// Renders Barcode #1/#2 (SPEC §2.2, §5.1, §5.3) as real, scannable Code128
// label PNGs for the Detonger P1 thermal printer via WePrint (PHASE0.md
// Part E). Generic composer + one thin wrapper per barcode kind.
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

// Renders Code128 bars to their own offscreen canvas (no built-in text — we
// draw the human-readable line ourselves so we control layout). Picks the
// LARGEST integer module width whose natural barcode fits within maxW, so the
// composite never has to scale the bars down (nearest-neighbour downscaling
// destroys thin Code128 bars and makes them unscannable — the reason a naive
// fit-by-drawImage broke Barcode #2 decoding). Short codes (#1 serial) keep
// the ideal 4px/2-native-dot module; longer codes (#2 PLT-…) step down to
// whatever fits, still rendered crisply at native size.
function renderBars(value: string, maxW: number): HTMLCanvasElement {
  const ideal = 2 * SCALE // 4px = 2 native dots = 0.25mm
  for (let mw = ideal; mw >= 1; mw--) {
    const c = document.createElement('canvas')
    JsBarcode(c, value, {
      format: 'CODE128',
      displayValue: false,
      width: mw,
      height: 62 * SCALE,
      margin: 0, // our own quiet zones on the composite canvas
    })
    if (c.width <= maxW || mw === 1) return c
  }
  // unreachable, but satisfies the type checker
  return document.createElement('canvas')
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

// Generic 50×30mm label: Code128 bars for `code`, the human-readable `code`
// text large under the bars (auto-shrunk to fit), then small `fields` lines.
// Reused by both Barcode #1 (Step 3) and #2 (this step).
function renderLabel(code: string, fields: string[]): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  const pad = 8 * SCALE
  const quietZone = 10 * SCALE
  const maxTextW = CANVAS_W - 2 * pad

  // 1) Bars — module width already chosen so the natural barcode fits the
  //    quiet zones; drawn 1:1 (no rescale) to keep the bars crisp/scannable.
  const maxBarsW = CANVAS_W - 2 * quietZone
  const bars = renderBars(code, maxBarsW)
  const barsX = (CANVAS_W - bars.width) / 2
  const barsY = pad
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bars, barsX, barsY)
  ctx.imageSmoothingEnabled = true

  // 2) Human-readable code, large, under the bars (auto-shrunk to fit width).
  let y = barsY + bars.height + 4 * SCALE
  const codeFont = fitFont(ctx, code, 30 * SCALE, 'bold', maxTextW)
  ctx.font = `bold ${codeFont}px monospace`
  ctx.fillText(code, CANVAS_W / 2, y)
  y += codeFont + 6 * SCALE

  // 3) Small fields, one per line. Larger-over-more: ellipsize, don't shrink.
  const smallFont = 16 * SCALE
  ctx.font = `${smallFont}px sans-serif`
  const lineH = smallFont + 3 * SCALE
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

// --- Barcode #1 (raw serial, §2.2/§5.1). Value == the serial. ---
export interface Barcode1LabelData {
  serial: string
  type: string // Tur
  owner: string // Buyurtmachi
  weightKg: number // Og'irlik
  date: string // Sana
}

export function renderBarcode1Label(data: Barcode1LabelData): Promise<Blob> {
  return renderLabel(data.serial, [
    data.type,
    data.owner,
    `${data.weightKg.toLocaleString()} kg`,
    data.date,
  ])
}

// --- Barcode #2 (physical pallet, §2.2/§5.3). Value == the sticker ID. ---
// §2.2 encodes: sticker ID + parent seriya + turi + kalibr + og'irlik + egasi.
// NOTE: the sticker ID (PLT-<serial>-<calibre>-<seq>) is longer than a serial,
// so renderBars steps its module width down to fit 50×30mm natively (denser
// but crisp/scannable — verified by decode). At very large per-serial+calibre
// pallet counts the seq could grow the code further; flagged in DECISIONS.
export interface Barcode2LabelData {
  barcode2: string // sticker ID, PLT-<serial>-<calibre>-<seq>
  serial: string // parent seriya
  type: string // Tur
  calibre: string // Kalibr label (e.g. "Kalibr 4" / "Konditirskiy")
  weightKg: number // Og'irlik
  owner: string // Egasi / Buyurtmachi
}

export function renderBarcode2Label(data: Barcode2LabelData): Promise<Blob> {
  return renderLabel(data.barcode2, [
    data.serial,
    `${data.type} · ${data.calibre}`,
    `${data.weightKg.toLocaleString()} kg`,
    data.owner,
  ])
}
