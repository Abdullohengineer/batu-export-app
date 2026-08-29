// Partiya raqami (per-type arrival batch number) badge -- SPEC.md §2.17 (see
// DECISIONS.md "Partiya raqami"). Renders next to a serial everywhere one is
// shown; reuses the design system's 'pending' tone (amber) for the same
// reason OmborChiqimTab's oldStockBadge does -- toneStyles.ts's own header
// comment: "Colors are NAMED, not invented." Amber keeps this visually
// distinct from SerialChip's slate/blue serial styling.
//
// Renders nothing (not "0", not "1") when partiyaNo is null -- opening
// stock and internal-reprocess rows never got a number because they didn't
// arrive on a truck (CLAUDE.md origin-filtering rule).
//
// Type-prefix format (2026-08-29, Prompt 9, see DECISIONS.md same date):
// "P{n}-{prefix}" -- a bare "P12" told you nothing about WHICH product's
// 12th arrival without opening the record; the one-letter (two for Qand
// qizil) prefix makes that glanceable. `TYPE_PREFIX` is the one place this
// mapping lives -- deliberately NOT re-derived or duplicated per call site.
// Keyed by product_types.name exactly as it reads live (confirmed via
// direct query before writing this: Subxon, Isfara, Natural, Qand, "Qand
// qizil" -- lowercase "qizil", not "Qand Qizil"). QQ is two letters on
// purpose -- clarity over single-letter consistency, per explicit
// instruction, rather than colliding with Qand's own "Q".
const TYPE_PREFIX: Record<string, string> = {
  Subxon: 'S',
  Isfara: 'I',
  Natural: 'N',
  Qand: 'Q',
  'Qand qizil': 'QQ',
}

// `typeName` is a required prop, not optional -- every call site must now
// resolve and pass it (TypeScript enforces this at every one of the ~30
// render sites), so a site that's missed shows up as a compile error
// instead of silently rendering an unprefixed/wrong badge. Still typed
// nullable at runtime (a resolver mid-fetch, or a genuinely typeless
// row) -- that case hits the same unmapped fallback below, not a crash.
export function PartiyaBadge({
  partiyaNo,
  typeName,
}: {
  partiyaNo: number | null | undefined
  typeName: string | null | undefined
}) {
  if (partiyaNo == null) return null
  let prefix = typeName ? TYPE_PREFIX[typeName] : undefined
  if (!prefix) {
    // Visible, not silent (explicit requirement): an unmapped or missing
    // type name still renders a badge -- P{n}-? -- rather than disappearing
    // or throwing, but logs so the gap gets noticed and the mapping fixed.
    console.warn(`PartiyaBadge: unmapped product type "${typeName}" for P${partiyaNo} — falling back to "?"`)
    prefix = '?'
  }
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-400">
      P{partiyaNo}-{prefix}
    </span>
  )
}
