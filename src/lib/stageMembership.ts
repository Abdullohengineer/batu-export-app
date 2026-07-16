// Section mirroring (SPEC.md §5 intro; DECISIONS.md "Section mirroring /
// derived stage membership"): a section's Window N is the SAME underlying
// set as the next section's Window N-1. These two predicates ARE that
// shared definition — both sides of each boundary call the same function,
// not two independently-written copies of the same rule.

// §5.1 KIRIM Window 2 = §5.2 Moyka Window 1: a confirmed serial that still
// has raw material sitting in storage, not yet sent to Moyka.
export function hasRawRemainder(actualQty: number, sent: number): boolean {
  return actualQty - sent > 0
}

// §5.2 Moyka Window 2 = §5.3 Tayyor Window 1: a serial with unreceived sent
// material — total_sent > total_received, serial-level (ignores wash_cycle
// number and wash_cycles.status entirely; see DECISIONS.md "Serial-level
// in-process visibility"). wash_cycles.status='final' still governs
// graduation to §5.3 Window 2 (Tugallangan) — that's a separate, unchanged
// concern. A serial can legitimately be in-process here AND already have a
// final cycle-1 row (more was sent after that cycle closed) — both are true
// at once, and both windows should say so.
export function isProcessing(totalSent: number, totalReceived: number): boolean {
  return totalSent - totalReceived > 0
}
