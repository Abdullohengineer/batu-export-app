// Multi-wash support (2026-09-15, see docs/decisions/0191): a serial can
// now have several wash_cycles rows (one per wash of a portion of it), at
// most one of them open (closed_at is null — enforced by the DB's own
// partial unique index). "The current wash" for a serial is that open row
// if one exists; otherwise the most recently opened one (highest wash_no)
// — a fully-settled serial with nothing open still needs a definite answer
// for "which wash's lab verdict/closedAt applies right now."
//
// One shared picker so every consumer (labVerdict.ts, useMoykaOutput.ts,
// useMoykaSerials.ts) resolves the same row the same way — "one derived
// truth, all consumers" (SPEC.md §8, CLAUDE.md "derive, don't store"),
// same reasoning currentLabStatus's own header comment already states for
// its narrower case.

export interface WashRow {
  serial: string
  wash_no: number
  closed_at: string | null
}

/** Groups rows by serial, keeping only the current wash (open, else highest wash_no) per serial. */
export function currentWashBySerial<T extends WashRow>(rows: T[]): Map<string, T> {
  const bySerial = new Map<string, T>()
  for (const row of rows) {
    const existing = bySerial.get(row.serial)
    if (!existing) {
      bySerial.set(row.serial, row)
      continue
    }
    const existingIsOpen = existing.closed_at === null
    if (existingIsOpen) continue // an open row always wins outright, nothing can replace it
    const rowIsOpen = row.closed_at === null
    if (rowIsOpen || row.wash_no > existing.wash_no) bySerial.set(row.serial, row)
  }
  return bySerial
}
