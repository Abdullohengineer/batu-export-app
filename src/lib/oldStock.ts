// Opening stock (Stage 2, see DECISIONS.md "Opening stock") — the one
// place the "Eski zaxira 2025-2026" label is spelled out. Every screen that
// displays an old-stock row's date (qoldig'i, the passport) must show this
// instead of the row's real anchor/order date: that date is the seed's
// backdated anchor (2025-01-01), not a real arrival, and showing it as a
// plain date would imply the opposite (per the explicit instruction this
// label exists to satisfy — "nothing should imply this material arrived on
// the seed date"). One shared helper so the wording can't drift screen to
// screen.
export const OLD_STOCK_DATE_LABEL = 'Eski zaxira 2025-2026'

export function formatStockDate(isOldStock: boolean, date: string | null): string {
  if (isOldStock) return OLD_STOCK_DATE_LABEL
  return date ?? '—'
}
