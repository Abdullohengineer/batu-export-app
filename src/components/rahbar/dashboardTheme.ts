// Shared amber/sky/emerald/purple/stone/slate tokens for the Rahbar
// dashboard's hero tiles and Omborda-hozir bars, originally local to
// RahbarHome.tsx. Pulled out (2026-09-16) alongside HeroTiles/
// OmborHozirSection so a future consumer of those components (the client
// Панель mirror) reads the exact same hex values -- never redefines its own
// copy that could drift.
//
// Amber/emerald/red are already load-bearing tokens.ts tones (xom / ok /
// departed). Purple and the muted pool-stock tone aren't in tokens.ts (no
// existing "Konditirskiy" or "pool stock" status concept there) so they're
// named here, once, rather than scattered ad hoc classes.
export const C = {
  raw: '#d97706', // amber-600
  rawBg: '#fef3c7', // amber-100
  moyka: '#0369a1', // sky-700 -- in-process, between raw and finished
  moykaBg: '#e0f2fe', // sky-100
  calibre: '#059669', // emerald-600
  calibreBg: '#d1fae5', // emerald-100
  kn: '#9333ea', // purple-600
  knBg: '#f3e8ff', // purple-100
  oldKn: '#78716c', // stone-500 -- deliberately muted/separate, "pool stock"
  oldKnBg: '#e7e5e4', // stone-200
  departed: '#dc2626', // red-600 -- material that left the factory
  loss: '#334155', // slate-700 -- lost in washing, not departed: black, not red
  lossBg: '#e2e8f0',
}

export function fmt(v: number): string {
  return Math.round(v).toLocaleString()
}
