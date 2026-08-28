// §5.3 Tayyor Mahsulot in-process math — pure, dependency-free (see
// SPEC.md §5.3).
//
// Jarayonda (in-process) floors at 0 — it is never a negative number. An
// overage (received > sent) surfaces separately as Ortiqcha, non-blocking,
// same display philosophy as Kam chiqdi (§5.1).
//
// Tugallash and its locked final_loss_pct are removed (see DECISIONS.md
// "Moyka loss becomes live"): loss is now computed live, signed, and
// unconditionally in SQL (client_serial_loss_kg / yield_rows.loss_kg /
// get_serial_passport's cycles[].lossKg) — there is no TS-side equivalent
// any more, and no manual close event to warn about.

export function jarayonda(sent: number, received: number): number {
  return Math.max(0, sent - received)
}

export function ortiqcha(sent: number, received: number): number {
  return Math.max(0, received - sent)
}
