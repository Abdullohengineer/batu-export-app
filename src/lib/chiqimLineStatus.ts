// §5.4 FIFO dispatch (2026-08-28): split out of the now-deleted chiqimScan.ts
// (the Option B scan-to-load machinery it lived alongside is gone — see
// DECISIONS.md "CHIQIM quantity-based dispatch: FIFO cascade, consumption
// table"). Still generic across every CHIQIM line kind — raw/old_raw/old_kn
// draws and finished/old_washed's own loaded-kg entry all report progress
// against a declared target the same way. Kept dependency-free (no
// `supabase` import) so `node --test` can exercise it directly, same
// reasoning chiqimScan.ts's own header used to state.

export interface ChiqimLineLike {
  id: string
  type_id: string
  calibre_id: string | null
  line_kind: 'finished' | 'raw' | 'old_washed' | 'old_kn' | 'old_raw'
  qty_kg: number | null
}

export type LineStatus = 'shortfall' | 'exact' | 'overage'

export function lineStatus(targetKg: number, scannedKg: number): LineStatus {
  if (scannedKg === targetKg) return 'exact'
  return scannedKg > targetKg ? 'overage' : 'shortfall'
}

// §5.4/§3.1 "never blocks": the finish click always proceeds — this just
// reports which lines fell short so the confirm step can show it, non-
// blocking, same philosophy as Kam chiqdi/Tugallash's warnings. A raw line
// with no Menejer estimate (qty_kg null, 2026-08-01 pool rework — see
// DECISIONS.md "Raw dispatch serial pool") has no target to fall short
// of, so it's excluded outright rather than treated as a 0 kg target.
export function shortfallLines(
  lines: ChiqimLineLike[],
  scannedTotalsByLineId: Record<string, number>,
): { line: ChiqimLineLike; missingKg: number }[] {
  return lines
    .filter((line): line is ChiqimLineLike & { qty_kg: number } => line.qty_kg !== null)
    .map((line) => ({ line, missingKg: line.qty_kg - (scannedTotalsByLineId[line.id] ?? 0) }))
    .filter((x) => x.missingKg > 0)
}
