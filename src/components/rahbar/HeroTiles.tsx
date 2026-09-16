import { fmt } from './dashboardTheme'

// Generic stat-tile grid, extracted from RahbarHome.tsx (2026-09-16) so the
// client Панель mirror can render its own (possibly different-length,
// different-labelled) tile set through the same component instead of a
// forked copy -- see docs/decisions/ "HeroTiles/OmborHozirSection
// extraction". Deliberately holds no palette/tone logic of its own: each
// caller resolves its own label/value/color per tile (RahbarHome keeps its
// existing tone->{bg,fg} lookup locally), so this component never has to
// guess at a caller's color scheme or copy.
export interface HeroTileConfig {
  key: string
  label: string
  value: number
  unit?: string
  caption: string
  bg: string
  fg: string
}

export interface HeroTilesProps {
  tiles: HeroTileConfig[]
  className?: string
}

function Tile({ label, value, unit, caption, bg, fg }: Omit<HeroTileConfig, 'key'>) {
  return (
    <div className="rounded-xl p-4" style={{ background: bg }}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-75" style={{ color: fg }}>
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-extrabold tabular-nums" style={{ color: fg }}>
        {fmt(value)}
        {unit && <span className="ml-1 text-sm font-semibold opacity-60">{unit}</span>}
      </div>
      <div className="mt-1.5 text-xs opacity-70" style={{ color: fg }}>
        {caption}
      </div>
    </div>
  )
}

export function HeroTiles({ tiles, className }: HeroTilesProps) {
  return (
    <div className={className ?? 'grid grid-cols-2 gap-3 lg:grid-cols-6'}>
      {tiles.map((t) => (
        <Tile key={t.key} label={t.label} value={t.value} unit={t.unit} caption={t.caption} bg={t.bg} fg={t.fg} />
      ))}
    </div>
  )
}
