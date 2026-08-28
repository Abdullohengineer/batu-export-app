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

// §5.2 Moyka Window 2 = §5.3 Tayyor Window 1 (section mirroring): a serial
// with a positive live in-Moyka balance (sent, not yet fully returned as
// output). Replaces isAwaitingTugallash (see DECISIONS.md "Moyka loss
// becomes live; remove Tugallash") now that there is no manual finish
// event — membership is purely the live balance, same jarayonda(sent,
// received) > 0 both windows already compute for their own stats.
export function isInMoyka(sent: number, received: number): boolean {
  return sent - received > 0
}
