// §5.5.4/§5.5.5 re-wash cycle math (SPEC.md v1.9) — pure, dependency-free
// (see DECISIONS.md "Step 8 prompt 2, split 2d"). Nothing here does I/O;
// callers pass in already-fetched facts, matching the convention every
// other pure decision module in this app already uses (tayyorCompletion.ts,
// chiqimScan.ts, chiqimFeasibility.ts).

// A serial's ACTIVE cycle number is DERIVED, never stored as its own
// counter (CLAUDE.md "derive, don't store"): 1 if the serial has never been
// voided into a re-wash, otherwise (highest voided cycle_no) + 1. Each
// re-wash always voids exactly the cycle immediately before the new one, so
// this is monotonic and needs no separate column to track.
export function activeCycleNo(voidedCycleNos: number[]): number {
  if (voidedCycleNos.length === 0) return 1
  return Math.max(...voidedCycleNos) + 1
}

// Cycle 1's input is always the original raw intake
// (storage_intake.actual_qty). A re-wash cycle's input is the weight voided
// out of the PREVIOUS cycle's non-Konditirskiy pallets — itself derived
// (§5.5.4: "the total kg of voided calibre pallets becomes the re-wash
// quantity"), never stored as its own figure either.
export function cycleInputKg(cycleNo: number, actualQty: number, previousCycleVoidedKg: number): number {
  return cycleNo === 1 ? actualQty : previousCycleVoidedKg
}
