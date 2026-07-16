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

// §5.2 Moyka Window 2 = §5.3 Tayyor Window 1: a serial that has been sent
// to Moyka and hasn't been manually finished (Tugallash) yet — independent
// of received/sent quantities entirely (see DECISIONS.md "Manual-only
// finishing"). Finishing is ALWAYS a deliberate operator action now (no
// auto-complete), so a serial stays visible here for the operator to judge,
// regardless of whether it's under, at, or over its sent amount — that
// judgment is what Tugallash is for, not a quantity threshold.
//
// This replaces the short-lived isProcessing(totalSent, totalReceived)
// predicate (totalSent - totalReceived > 0), which excluded an over-received
// serial from view the instant received passed sent — the opposite of what
// manual-only finishing requires (an over-received serial must stay visible
// and finishable until the operator says so). isProcessing existed to solve
// a DIFFERENT problem (a final cycle silently hiding newly-arrived material
// after AUTO-finalization); removing auto-finalization removes the specific
// trigger for that problem, so the simpler "not yet finished" rule is
// correct again. wash_cycles.status='final' still governs graduation to
// §5.3 Window 2 (Tugallangan) — same field, same meaning, just no longer
// also gated behind a quantity comparison for Window 1/2 visibility.
export function isAwaitingTugallash(sent: number, finalized: boolean): boolean {
  return sent > 0 && !finalized
}
