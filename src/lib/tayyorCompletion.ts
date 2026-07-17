// §5.3 Tayyor Mahsulot completion math — pure, dependency-free (see
// DECISIONS.md "Tayyor Mahsulot completion", "Manual-only finishing" and
// SPEC.md §5.3).
//
// Jarayonda (in-process) floors at 0 — it is never a negative number. An
// overage (received > sent) surfaces separately as Ortiqcha, non-blocking,
// same display philosophy as Kam chiqdi (§5.1). Finishing itself is manual
// only, via Tugallash — there is deliberately no "cycle complete" predicate
// here anymore (see DECISIONS.md "Manual-only finishing": the old
// isCycleComplete/auto-finalize path is retired, not hidden).

export function jarayonda(sent: number, received: number): number {
  return Math.max(0, sent - received)
}

export function ortiqcha(sent: number, received: number): number {
  return Math.max(0, received - sent)
}

// Final yield-loss locked at Tugallash (manual, always). Floored at 0 — an
// overage is Ortiqcha, never a negative "loss".
export function computeFinalLossPct(sent: number, received: number): number {
  if (sent <= 0) return 0
  return Math.max(0, Math.round(((sent - received) / sent) * 1000) / 10)
}

// §5.3 Window 2 (Tugallangan) badge — Ortiqcha always wins over a loss
// reading: exact-match and overage both lock final_loss_pct at 0 (floored),
// so excess > 0 is the only thing that tells them apart. A real shortfall
// (excess = 0, lossPct > 0) reports its positive loss %.
export type CompletionBadge = { kind: 'ortiqcha'; excessKg: number } | { kind: 'loss'; pct: number }

export function completionBadge(lossPct: number, excess: number): CompletionBadge {
  if (excess > 0) return { kind: 'ortiqcha', excessKg: excess }
  return { kind: 'loss', pct: lossPct }
}

// §5.3 Tugallash soft warning (DECISIONS "Manual-only finishing") — NEVER
// blocks; states which specific reason(s) apply so the operator can decide.
// Two independent reasons, either or both may fire:
// - raw remainder still sitting in storage (caller computes remainderKg via
//   hasRawRemainder — kept out of this dependency-free module, same reason
//   completionBadge takes excess/lossPct pre-computed rather than importing
//   stageMembership.ts).
// - the loss about to be locked exceeds 10%. A gain (received > sent) never
//   warns: computeFinalLossPct floors at 0, which is never > 10.
// Returns which reasons apply, not display text — the component owns the
// Uzbek copy, same convention as completionBadge's {kind, ...} shape.
export type TugallashWarningReason = 'remainder' | 'loss'

export function tugallashWarnings(remainderKg: number, lossPct: number): TugallashWarningReason[] {
  const reasons: TugallashWarningReason[] = []
  if (remainderKg > 0) reasons.push('remainder')
  if (lossPct > 10) reasons.push('loss')
  return reasons
}
