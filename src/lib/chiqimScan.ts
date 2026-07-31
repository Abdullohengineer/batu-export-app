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
  // Raw dispatch (2026-07-31): a line is either finished (calibre_id set)
  // or raw (raw_serial set, calibre_id null) — mirrors chiqim_lines' own
  // DB constraint. resolveScan's candidate matching (`l.calibre_id ===
  // pallet.calibre_id`) stays correct unchanged: a raw line's calibre_id is
  // null, which never equals a real pallet's calibre_id, so raw lines are
  // naturally never a scan candidate — no branch needed there.
  calibre_id: string | null
  raw_serial: string | null
  qty_kg: number
}

export type ScanResult =
  | { ok: true; lineId: string }
  | { ok: false; reason: 'duplicate' | 'not_found' | 'not_in_stock' | 'not_lab_passed' | 'claimed' | 'not_reserved' }

// Given a scanned pallet's already-known facts (looked up by the caller —
// this function does no I/O), decides whether it can be added to this
// request's scan list and which line it belongs to.
//
// §3.1/§5.4 CHIQIM Option B (pallet-level reservation, 2026-07-26/27): a
// scanned pallet's line comes from its OWN reservation when one exists —
// reservation is authoritative for any line Menejer actually used the
// picker on (rejects a valid-but-unlisted pallet outright, even if its
// type/calibre would otherwise match — requirement 3).
//
// 🚩 Real gap found live, not hypothetical: a line can legitimately have
// ZERO reservations — the picker offered nothing at request-creation time
// (stock ordered ahead of production, or targeting a re-wash cycle not
// yet finished). Making reservation unconditionally mandatory would leave
// that line permanently unscannable — nothing could ever match a line with
// no reservations, even once matching stock actually shows up later. So a
// zero-reservation line falls back to Option A's original type/calibre
// matching (largest remaining gap) — but ONLY a zero-reservation line; a
// line that has reservations never falls back, even for pallets it didn't
// reserve, since reservation, once used, is exclusive.
export function resolveScan(input: {
  barcode2: string
  alreadyScannedBarcodes: string[]
  pallet: { type_id: string; calibre_id: string; status: string } | null
  labPassed: boolean
  alreadyClaimed: boolean
  reservedLineIdByBarcode: Record<string, string>
  lines: ChiqimLineLike[]
  scannedTotalsByLineId: Record<string, number>
}): ScanResult {
  if (input.alreadyScannedBarcodes.includes(input.barcode2)) return { ok: false, reason: 'duplicate' }
  if (!input.pallet) return { ok: false, reason: 'not_found' }
  if (input.pallet.status !== 'in_stock') return { ok: false, reason: 'not_in_stock' }
  // §5.5.3/§8 hard gate (v1.9): a pallet's parent serial must have a passing
  // verdict ('o_tdi') on its current wash cycle — untested or re-wash-
  // flagged stock is refused here the same way Menejer's feasibility
  // checker (useAvailableFinishedStock) never offers it in the first place,
  // via the same shared currentCycleLabStatus helper.
  if (!input.labPassed) return { ok: false, reason: 'not_lab_passed' }
  // Real enforcement point for the overcommit gap flagged in the prior
  // prompt: relies on dispatch_manifest.barcode2's UNIQUE constraint (the
  // caller re-checks this, and the DB constraint itself is the actual
  // guarantee at finish time) rather than inventing a reservation system.
  if (input.alreadyClaimed) return { ok: false, reason: 'claimed' }

  const reservedLineId = input.reservedLineIdByBarcode[input.barcode2]
  if (reservedLineId) return { ok: true, lineId: reservedLineId }

  const linesWithReservations = new Set(Object.values(input.reservedLineIdByBarcode))
  const candidates = input.lines.filter(
    (l) =>
      l.type_id === input.pallet!.type_id &&
      l.calibre_id === input.pallet!.calibre_id &&
      !linesWithReservations.has(l.id),
  )
  if (candidates.length === 0) return { ok: false, reason: 'not_reserved' }

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
