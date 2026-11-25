// Donut for "Xarajatlar tarkibi" (decision 0256). Plain SVG, one <circle>
// per slice using stroke-dasharray with pathLength=100, rotated −90° so the
// first slice starts at 12 o'clock. A 1-unit gap separates slices. The
// caller groups small categories into "Boshqa" so there are at most 5.

export interface DonutSlice {
  key: string
  value: number
  color: string
}

export function Donut({ slices, size = 200, stroke = 32, centerLabel, centerValue }: { slices: DonutSlice[]; size?: number; stroke?: number; centerLabel: string; centerValue: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const r = (size - stroke) / 2
  const gap = slices.length > 1 ? 0.6 : 0
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel} ${centerValue}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total > 0 &&
          slices.map((s) => {
            const pct = (s.value / total) * 100
            const dash = Math.max(0, pct - gap)
            const el = (
              <circle
                key={s.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                pathLength={100}
                strokeDasharray={`${dash} ${100 - dash}`}
                strokeDashoffset={-offset}
              />
            )
            offset += pct
            return el
          })}
      </g>
      <text x="50%" y="46%" textAnchor="middle" fontSize={11} letterSpacing="0.8" fill="var(--text-secondary)">
        {centerLabel}
      </text>
      <text x="50%" y="58%" textAnchor="middle" fontSize={22} fontWeight={600} fill="var(--text-primary)">
        {centerValue}
      </text>
    </svg>
  )
}
