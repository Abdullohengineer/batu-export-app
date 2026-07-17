// §5.4 Ombor CHIQIM scan-to-load — pure, dependency-free decision logic
// (see DECISIONS.md "Step 7 prompt 2: Ombor scan-load"). The component only
// wires this to Supabase I/O (pallet lookup, dispatch_manifest check) and
// React state; every actual decision lives here so it's directly testable,
// matching tayyorCompletion.ts/chiqimFeasibility.ts's convention.
//
// Deliberately dependency-free (no `supabase` import, unlike
// useOmborChiqimRequests.ts): `src/lib/supabase.ts` reads `import.meta.env`
// and throws immediately outside a Vite runtime, which would crash any
// plain `node --test` file that imports it transitively. Keeping every
// testable decision here (including the W2 sort, below) is what lets the
// test suite exercise this logic at all without a browser/Vite harness.

import { sortByDateDesc } from './sortByDate.ts'

export interface ChiqimLineLike {
  id: string
  type_id: string
  calibre_id: string
  qty_kg: number
}

export type ScanResult =
  | { ok: true; lineId: string }
  | { ok: false; reason: 'duplicate' | 'not_found' | 'not_in_stock' | 'claimed' | 'no_matching_line' }

// Given a scanned pallet's already-known facts (looked up by the caller —
// this function does no I/O), decides whether it can be added to this
// request's scan list and which line it belongs to.
//
// 🔒 Totals are per line, not per whole request (§5.4: "target lines with
// progress bars" — confirmed from SPEC.md, not assumed). When a request has
// more than one line for the same type+calibre (the request form doesn't
// forbid it), the pallet fills whichever matching line has the largest
// remaining gap — falls back to the first match once every matching line is
// already at/over its own target.
export function resolveScan(input: {
  barcode2: string
  alreadyScannedBarcodes: string[]
  pallet: { type_id: string; calibre_id: string; status: string } | null
  alreadyClaimed: boolean
  lines: ChiqimLineLike[]
  scannedTotalsByLineId: Record<string, number>
}): ScanResult {
  if (input.alreadyScannedBarcodes.includes(input.barcode2)) return { ok: false, reason: 'duplicate' }
  if (!input.pallet) return { ok: false, reason: 'not_found' }
  if (input.pallet.status !== 'in_stock') return { ok: false, reason: 'not_in_stock' }
  // Real enforcement point for the overcommit gap flagged in the prior
  // prompt: relies on dispatch_manifest.barcode2's UNIQUE constraint (the
  // caller re-checks this, and the DB constraint itself is the actual
  // guarantee at finish time) rather than inventing a reservation system.
  if (input.alreadyClaimed) return { ok: false, reason: 'claimed' }

  const candidates = input.lines.filter(
    (l) => l.type_id === input.pallet!.type_id && l.calibre_id === input.pallet!.calibre_id,
  )
  if (candidates.length === 0) return { ok: false, reason: 'no_matching_line' }

  const best = candidates
    .map((l) => ({ line: l, gap: l.qty_kg - (input.scannedTotalsByLineId[l.id] ?? 0) }))
    .sort((a, b) => b.gap - a.gap)[0]
  return { ok: true, lineId: best.line.id }
}

export type LineStatus = 'shortfall' | 'exact' | 'overage'

export function lineStatus(targetKg: number, scannedKg: number): LineStatus {
  if (scannedKg === targetKg) return 'exact'
  return scannedKg > targetKg ? 'overage' : 'shortfall'
}

// §5.4/§3.1 "never blocks": the finish click always proceeds — this just
// reports which lines fell short so the confirm step can show it, non-
// blocking, same philosophy as Kam chiqdi/Tugallash's warnings.
export function shortfallLines(
  lines: ChiqimLineLike[],
  scannedTotalsByLineId: Record<string, number>,
): { line: ChiqimLineLike; missingKg: number }[] {
  return lines
    .map((line) => ({ line, missingKg: line.qty_kg - (scannedTotalsByLineId[line.id] ?? 0) }))
    .filter((x) => x.missingKg > 0)
}

// Ombor's own W2 sorts newest-first by its own finish signal
// (`ombor_finished_at`, per the CHIQIM per-role finalization invariant),
// not by request_date/created_at or any other role's timestamp.
export function sortFinishedByOmborFinish<T extends { ombor_finished_at: string | null }>(requests: T[]): T[] {
  return sortByDateDesc(requests, (r) => r.ombor_finished_at)
}
