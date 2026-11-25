// Dark finance theme helpers (decision 0256): palette order and small pure
// helpers shared by the finance components. Colours are the CSS tokens set
// under [data-theme="dark-finance"] in src/index.css.

/** Slice / bar / icon colours, in the brief's order: expense, income, utility, warning, then greys. */
export const FIN_PALETTE = ['var(--accent-expense)', 'var(--accent-income)', 'var(--accent-warning)', 'var(--accent-critical)', 'var(--text-muted)', 'var(--border-strong)']

/** A stable palette colour for an id (category icons in entry rows). */
export function colorFor(id: string | null | undefined): string {
  if (!id) return FIN_PALETTE[4]
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return FIN_PALETTE[h % 4]
}

/** Two-letter initials for a 28px row icon. */
export function initials(name: string): string {
  const w = name.replace(/["«»“”'`]/g, '').trim().split(/\s+/).filter((x) => /\p{L}/u.test(x))
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || '—'
}

/** Semantic colour for a signed number: negative pink, positive teal, zero/neutral primary. */
export function signClass(v: number | null | undefined): string {
  if (v == null || v === 0) return 'text-[var(--text-primary)]'
  return v < 0 ? 'text-[var(--accent-critical)]' : 'text-[var(--accent-income)]'
}
