// §5.3 Tayyor Mahsulot completion math — pure, dependency-free (see
// DECISIONS.md "Tayyor Mahsulot completion" and SPEC.md §5.3).
//
// No fixed tolerance: a cycle is complete the moment cumulative received
// reaches or exceeds sent. Jarayonda (in-process) floors at 0 — it is never
// a negative number. An overage (received > sent) surfaces separately as
// Ortiqcha, non-blocking, same display philosophy as Kam chiqdi (§5.1).

export function jarayonda(sent: number, received: number): number {
  return Math.max(0, sent - received)
}

export function ortiqcha(sent: number, received: number): number {
  return Math.max(0, received - sent)
}

export function isCycleComplete(sent: number, received: number): boolean {
  return sent > 0 && received >= sent
}

// Final yield-loss locked at Tugallash (manual or auto-triggered). Floored
// at 0 — an overage is Ortiqcha, never a negative "loss".
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
