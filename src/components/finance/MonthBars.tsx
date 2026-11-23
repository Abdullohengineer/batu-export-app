import { useEffect, useRef, useState } from 'react'

// Monthly bar chart for Moliyaviy ko'rsatkichlar (decision 0252). Plain SVG
// (the app has no chart library). Grouped or stacked bars over months, one
// zero baseline (negative values go below it), thin bars with a 4px rounded
// data end, 2px surface gaps, recessive grid. Hover / tap a month to read its
// values in the readout line; the selected period is highlighted. Identity
// is never colour alone: legend for ≥ 2 series + values in the readout, and a
// screen-reader table. Palette: the dataviz reference categorical slots 1–4,
// validated light + dark (validate_palette.js, 2026-11-23).

const SLOT_FILL = [
  'fill-[#2a78d6] dark:fill-[#3987e5]',
  'fill-[#eb6834] dark:fill-[#d95926]',
  'fill-[#1baf7a] dark:fill-[#199e70]',
  'fill-[#eda100] dark:fill-[#c98500]',
]
const SLOT_BG = ['bg-[#2a78d6] dark:bg-[#3987e5]', 'bg-[#eb6834] dark:bg-[#d95926]', 'bg-[#1baf7a] dark:bg-[#199e70]', 'bg-[#eda100] dark:bg-[#c98500]']

export interface BarSeries {
  label: string
  /** categorical slot 0–3, fixed per entity (never by rank) */
  slot: number
  values: (number | null)[]
}

interface Props {
  title: string
  months: string[]
  monthLabels: string[]
  series: BarSeries[]
  stacked?: boolean
  format: (v: number) => string
  selectedIndex: number
}

function niceStep(range: number): number {
  const raw = range / 4
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag
}

/** Rect with a 4px radius on the data end only (top for positive, bottom for negative). */
function barPath(x: number, w: number, y0: number, y1: number): string {
  const top = Math.min(y0, y1)
  const h = Math.abs(y1 - y0)
  if (h < 0.5) return ''
  const r = Math.min(4, w / 2, h)
  if (y1 < y0) {
    // positive: rounded top
    return `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`
  }
  const bottom = top + h
  return `M${x},${y0}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + w - r}Q${x + w},${bottom} ${x + w},${bottom - r}V${y0}Z`
}

export function MonthBars({ title, months, monthLabels, series, stacked = false, format, selectedIndex }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = 200
  const padL = 44
  const padB = 22
  const padT = 8
  const plotW = width - padL - 4
  const plotH = H - padB - padT

  // value domain, always including 0
  let lo = 0
  let hi = 0
  months.forEach((_, i) => {
    if (stacked) {
      let pos = 0
      let neg = 0
      for (const s of series) {
        const v = s.values[i] ?? 0
        if (v >= 0) pos += v
        else neg += v
      }
      hi = Math.max(hi, pos)
      lo = Math.min(lo, neg)
    } else {
      for (const s of series) {
        const v = s.values[i]
        if (v === null) continue
        hi = Math.max(hi, v)
        lo = Math.min(lo, v)
      }
    }
  })
  if (hi === lo) hi = lo + 1
  const step = niceStep(hi - lo)
  const top = Math.ceil(hi / step) * step
  const bottom = Math.floor(lo / step) * step
  const y = (v: number) => padT + ((top - v) / (top - bottom)) * plotH
  const ticks: number[] = []
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(t)

  const band = plotW / months.length
  const groupW = Math.min(band * 0.64, stacked ? 36 : 22 * series.length + 2 * (series.length - 1))
  const barW = stacked ? groupW : (groupW - 2 * (series.length - 1)) / series.length
  const shown = active ?? selectedIndex

  return (
    <div>
      <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300" aria-live="polite">
        <span className="font-medium text-slate-900 dark:text-slate-100">{monthLabels[shown]}:</span>
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            {series.length > 1 && <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-sm ${SLOT_BG[s.slot]}`} />}
            {series.length > 1 && `${s.label} `}
            <span className="tabular-nums text-slate-900 dark:text-slate-100">{s.values[shown] === null ? '—' : format(s.values[shown]!)}</span>
          </span>
        ))}
      </div>
      <div ref={ref} className="w-full">
        <svg width={width} height={H} role="img" aria-label={title} className="block select-none">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - 4} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-slate-400 dark:stroke-slate-500' : 'stroke-slate-200 dark:stroke-slate-800'} strokeWidth={1} />
              <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px] dark:fill-slate-400">
                {format(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = padL + band * i + band / 2
            const x0 = cx - groupW / 2
            let pos = 0
            let neg = 0
            const isOn = i === shown
            return (
              <g key={m}>
                {i === selectedIndex && <rect x={padL + band * i + 2} y={padT} width={band - 4} height={plotH} rx={4} className="fill-slate-100 dark:fill-slate-800/60" />}
                {series.map((s, k) => {
                  const v = s.values[i]
                  if (v === null || v === 0) return null
                  let d: string
                  if (stacked) {
                    const base = v >= 0 ? pos : neg
                    const end = base + v
                    if (v >= 0) pos = end
                    else neg = end
                    // 2px surface gap between stacked segments
                    const y0 = y(base) + (base === 0 ? 0 : v >= 0 ? -1 : 1)
                    const y1 = y(end) + (v >= 0 ? 1 : -1)
                    const isEnd = series.slice(k + 1).every((o) => !o.values[i] || Math.sign(o.values[i]!) !== Math.sign(v))
                    d = isEnd ? barPath(x0, barW, y0, y(end)) : `M${x0},${y0}H${x0 + barW}V${y1}H${x0}Z`
                  } else {
                    d = barPath(x0 + k * (barW + 2), barW, y(0), y(v))
                  }
                  return <path key={s.label} d={d} className={`${SLOT_FILL[s.slot]} ${isOn ? '' : 'opacity-80'}`} />
                })}
                <text x={cx} y={H - 6} textAnchor="middle" className={`text-[11px] ${isOn ? 'fill-slate-900 font-medium dark:fill-slate-100' : 'fill-slate-500 dark:fill-slate-400'}`}>
                  {monthLabels[i]}
                </text>
                {/* hit target: the whole month column */}
                <rect
                  x={padL + band * i}
                  y={0}
                  width={band}
                  height={H}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onClick={() => setActive(i)}
                />
              </g>
            )
          })}
        </svg>
      </div>
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1">
              <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-sm ${SLOT_BG[s.slot]}`} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Oy</th>
            {series.map((s) => (
              <th key={s.label}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => (
            <tr key={m}>
              <th>{monthLabels[i]}</th>
              {series.map((s) => (
                <td key={s.label}>{s.values[i] === null ? '—' : format(s.values[i]!)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
