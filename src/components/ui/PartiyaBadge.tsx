// Partiya raqami (per-type arrival batch number) badge -- SPEC.md new
// subsection (see DECISIONS.md "Partiya raqami"). Renders next to a serial
// everywhere one is shown; reuses the design system's 'pending' tone
// (amber) for the same reason OmborChiqimTab's oldStockBadge does --
// toneStyles.ts's own header comment: "Colors are NAMED, not invented."
// Amber keeps this visually distinct from SerialChip's slate/blue serial
// styling, per the task's own "distinct color" requirement.
//
// Renders nothing (not "0", not "1") when partiyaNo is null -- opening
// stock and internal-reprocess rows never got a number because they
// didn't arrive on a truck (CLAUDE.md origin-filtering rule).
export function PartiyaBadge({ partiyaNo }: { partiyaNo: number | null | undefined }) {
  if (partiyaNo == null) return null
  return (
    <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-400">
      P{partiyaNo}
    </span>
  )
}
