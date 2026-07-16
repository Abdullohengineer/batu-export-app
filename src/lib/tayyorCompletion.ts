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
