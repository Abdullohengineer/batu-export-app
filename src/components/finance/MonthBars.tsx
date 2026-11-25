import { useEffect, useId, useRef, useState } from 'react'

// Monthly chart for Moliyaviy ko'rsatkichlar (decisions 0252, 0256). Plain
// SVG (the app has no chart library). One zero baseline, one y-scale.
//   variant 'line'    dual line with gradient areas, hollow points, a dashed
//                     guide + tooltip card at the active month (Overview)
//   variant 'bars'    grouped bars with a top→bottom gradient; months other
//                     than the selected one at 60% (CategoryDetail, Overview tabs)
//   variant 'stacked' stacked bars (expense types)
// Hover / tap a month column to read it. Colours are the finance accent
// tokens, passed by the caller in the brief's fixed order. A legend is shown
// for ≥ 2 series, values are always written out (readout or tooltip), and a
// screen-reader table mirrors the chart.

export interface BarSeries {
  label: string
  /** CSS colour, normally a finance accent var */
  color: string
  /** bars below zero in this colour (sof foyda: negative = critical) */
  negativeColor?: string
  values: (number | null)[]
}

interface Props {
  title: string
  months: string[]
  monthLabels: string[]
  series: BarSeries[]
  variant?: 'line' | 'bars' | 'stacked'
  format: (v: number) => string
  selectedIndex: number
  /** small value under each month label (CategoryDetail) */
  showValuesUnderLabels?: boolean
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
  if (y1 < y0) return `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${y0}Z`
  const bottom = top + h
  return `M${x},${y0}V${bottom - r}Q${x},${bottom} ${x + r},${bottom}H${x + w - r}Q${x + w},${bottom} ${x + w},${bottom - r}V${y0}Z`
}

export function MonthBars({ title, months, monthLabels, series, variant = 'bars', format, selectedIndex, showValuesUnderLabels = false }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
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

  const stacked = variant === 'stacked'
  const line = variant === 'line'
  const H = line ? 230 : 210
  const padL = 46
  const padR = line ? 12 : 4
  const padB = showValuesUnderLabels ? 38 : 24
  const padT = line ? 14 : 8
  const plotW = width - padL - padR
  const plotH = H - padB - padT

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
  const cxOf = (i: number) => padL + (line ? (months.length === 1 ? plotW / 2 : (plotW * i) / (months.length - 1)) : band * i + band / 2)
  const groupW = Math.min(band * 0.62, stacked ? 40 : 26 * series.length + 4 * (series.length - 1))
  const barW = stacked ? groupW : (groupW - 4 * (series.length - 1)) / series.length
  const shown = active ?? selectedIndex
  // narrow (phone) charts: 3-letter month names so neighbouring labels don't collide
  const xLabel = (i: number) => (plotW / months.length < 64 ? monthLabels[i].slice(0, monthLabels[i].startsWith('Iy') ? 4 : 3) : monthLabels[i])

  // line geometry
  const pts = (s: BarSeries) => s.values.map((v, i) => (v === null ? null : ([cxOf(i), y(v)] as const)))
  const linePath = (s: BarSeries) =>
    pts(s)
      .map((p, i, arr) => (p ? `${i === 0 || !arr[i - 1] ? 'M' : 'L'}${p[0]},${p[1]}` : ''))
      .join('')
  const areaPath = (s: BarSeries) => {
    const ps = pts(s).filter(Boolean) as (readonly [number, number])[]
    if (ps.length < 2) return ''
    return `M${ps[0][0]},${y(0)}${ps.map((p) => `L${p[0]},${p[1]}`).join('')}L${ps[ps.length - 1][0]},${y(0)}Z`
  }
  const tipX = cxOf(shown)
  const tipW = 132
  const tipLeft = Math.min(Math.max(tipX - tipW / 2, padL), width - padR - tipW)

  return (
    <div>
      {!line && (
        <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]" aria-live="polite">
          <span className="font-medium text-[var(--text-primary)]">{monthLabels[shown]}:</span>
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1">
              {series.length > 1 && <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />}
              {series.length > 1 && `${s.label} `}
              <span className="tabular-nums text-[var(--text-primary)]">{s.values[shown] === null ? '—' : format(s.values[shown]!)}</span>
            </span>
          ))}
        </div>
      )}
      <div ref={ref} className="relative w-full">
        <svg width={width} height={H} role="img" aria-label={title} className="block select-none">
          <defs>
            {series.map((s, k) => (
              <linearGradient key={k} id={`${uid}-g${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={line ? 0.3 : 1} />
                <stop offset="100%" stopColor={s.color} stopOpacity={line ? 0 : 0.4} />
              </linearGradient>
            ))}
            {series.map((s, k) =>
              s.negativeColor ? (
                <linearGradient key={`n${k}`} id={`${uid}-n${k}`} x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor={s.negativeColor} stopOpacity={1} />
                  <stop offset="100%" stopColor={s.negativeColor} stopOpacity={0.4} />
                </linearGradient>
              ) : null,
            )}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? 'var(--border-strong)' : 'var(--border)'}
                strokeWidth={1}
                strokeDasharray={t === 0 ? undefined : '2 4'}
              />
              <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-secondary)">
                {format(t)}
              </text>
            </g>
          ))}

          {!line &&
            months.map((m, i) => {
              const cx = cxOf(i)
              const x0 = cx - groupW / 2
              let pos = 0
              let neg = 0
              const dim = i !== shown
              return (
                <g key={m} opacity={dim ? 0.6 : 1} style={{ transition: 'opacity 120ms' }}>
                  {series.map((s, k) => {
                    const v = s.values[i]
                    if (v === null || v === 0) return null
                    let d: string
                    if (stacked) {
                      const base = v >= 0 ? pos : neg
                      const end = base + v
                      if (v >= 0) pos = end
                      else neg = end
                      const y0 = y(base) + (base === 0 ? 0 : v >= 0 ? -1 : 1)
                      const y1 = y(end) + (v >= 0 ? 1 : -1)
                      const isEnd = series.slice(k + 1).every((o) => !o.values[i] || Math.sign(o.values[i]!) !== Math.sign(v))
                      d = isEnd ? barPath(x0, barW, y0, y(end)) : `M${x0},${y0}H${x0 + barW}V${y1}H${x0}Z`
                    } else {
                      d = barPath(x0 + k * (barW + 4), barW, y(0), y(v))
                    }
                    return <path key={s.label} d={d} fill={`url(#${uid}-${v < 0 && s.negativeColor ? 'n' : 'g'}${k})`} />
                  })}
                </g>
              )
            })}

          {line && (
            <>
              {series.map((s, k) => (
                <path key={`a${k}`} d={areaPath(s)} fill={`url(#${uid}-g${k})`} />
              ))}
              <line x1={tipX} x2={tipX} y1={padT} y2={y(bottom)} stroke="var(--border-strong)" strokeWidth={1.5} strokeDasharray="4 4" />
              {series.map((s, k) => (
                <path key={`l${k}`} d={linePath(s)} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {series.map((s, k) =>
                pts(s).map((p, i) =>
                  p ? (
                    i === shown ? (
                      <circle key={`p${k}-${i}`} cx={p[0]} cy={p[1]} r={6} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                    ) : (
                      <circle key={`p${k}-${i}`} cx={p[0]} cy={p[1]} r={4} fill="var(--surface)" stroke={s.color} strokeWidth={2} />
                    )
                  ) : null,
                ),
              )}
            </>
          )}

          {months.map((m, i) => (
            <g key={`x${m}`}>
              <text
                x={cxOf(i)}
                y={H - (showValuesUnderLabels ? 22 : 6)}
                textAnchor={line && i === 0 ? 'start' : line && i === months.length - 1 ? 'end' : 'middle'}
                fontSize={11}
                fontWeight={i === selectedIndex ? 700 : 400}
                fill={i === selectedIndex ? 'var(--text-primary)' : 'var(--text-secondary)'}
              >
                {xLabel(i)}
              </text>
              {showValuesUnderLabels && (
                <text x={cxOf(i)} y={H - 7} textAnchor="middle" fontSize={10} fontWeight={i === selectedIndex ? 700 : 400} fill={i === selectedIndex ? 'var(--text-primary)' : 'var(--text-secondary)'}>
                  {series[0].values[i] === null ? '' : format(series[0].values[i]!)}
                </text>
              )}
              <rect
                x={line ? cxOf(i) - plotW / Math.max(1, months.length - 1) / 2 : padL + band * i}
                y={0}
                width={line ? plotW / Math.max(1, months.length - 1) : band}
                height={H}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onClick={() => setActive(i)}
              />
            </g>
          ))}
        </svg>
        {line && (
          <div
            aria-live="polite"
            className="pointer-events-none absolute rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-elev)] px-3 py-2 text-[11px] leading-5 shadow-lg"
            style={{ left: tipLeft, top: 0, width: tipW }}
          >
            <div className="font-semibold text-[var(--text-primary)]">{monthLabels[shown]}</div>
            {series.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                  <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums text-[var(--text-primary)]">{s.values[shown] === null ? '—' : format(s.values[shown]!)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
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
