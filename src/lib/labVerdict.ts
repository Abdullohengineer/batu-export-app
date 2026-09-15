import { supabase } from './supabase'
import { currentWashBySerial } from './currentWash'

export type LabGateStatus = 'passed' | 'failed' | 'untested'

// Hard gate (SPEC.md; Laborator v2, 2026-07-28 — see DECISIONS.md "Lab moves
// inside Moyka, wash-cycle concept removed"): a serial's lab check must
// carry a CURRENT (latest) verdict='o_tdi' for its output to be available —
// for CHIQIM dispatch (useAvailableFinishedStock.ts, chiqimScan.ts) and,
// since this change, for Barcode #2 assignment itself
// (OmborTayyorTab.tsx) — the hard gate moved to packing, not just dispatch.
// No wash_cycles row at all means the serial hasn't been sent to Moyka yet;
// a wash_cycles row with no matching lab_results row means it's sent but
// Laborator hasn't tested it yet. Both read as 'untested', not 'passed' —
// absence of a verdict must never default to available.
//
// AMENDED 2026-09-15 (multi-wash support, see docs/decisions/0191):
// wash_cycles is one row per WASH of a serial now, not one row per
// serial — a serial can have a closed wash 1 and an open wash 2 at once.
// lab_results.wash_cycle_id is still many-to-one against a single wash's
// id — a reject followed by a re-test is a NEW lab_results row against
// the SAME wash_cycle_id, never a second wash_cycles row. "Current" is
// the OPEN wash (closed_at is null) if one exists — there is at most one,
// by the DB's own partial unique index — else the most recently opened
// one (max wash_no), for a fully-settled serial with nothing open.
// Picking "whichever wash_cycles row the query happened to return last"
// (the pre-multi-wash shape) was silently arbitrary the moment a second
// row could exist at all — this bug shipped before it had a chance to
// show up, caught while doing the multi-wash migration, not from a live
// incident.
//
// Shared by useAvailableFinishedStock.ts (bulk, Menejer's feasibility
// checker), OmborChiqimTab.tsx's scan-time check (single serial), and
// OmborTayyorTab.tsx's packing gate, so none of the three can ever disagree
// — "one derived truth, all consumers" (SPEC.md §8, CLAUDE.md "derive,
// don't store").
export async function currentLabStatus(serials: string[]): Promise<Map<string, LabGateStatus>> {
  const uniqueSerials = [...new Set(serials)]
  const statusBySerial = new Map<string, LabGateStatus>()
  if (uniqueSerials.length === 0) return statusBySerial

  const { data: cycles } = await supabase
    .from('wash_cycles')
    .select('id, serial, wash_no, closed_at')
    .in('serial', uniqueSerials)

  const currentCycleBySerial = currentWashBySerial(cycles ?? [])
  const cycleIdBySerial = new Map([...currentCycleBySerial].map(([serial, c]) => [serial, c.id]))

  const cycleIds = [...cycleIdBySerial.values()]
  const { data: results } = cycleIds.length
    ? await supabase
        .from('lab_results')
        .select('wash_cycle_id, verdict, created_at')
        .eq('scope', 'chiqim')
        .in('wash_cycle_id', cycleIds)
        .order('created_at', { ascending: false })
    : { data: [] as { wash_cycle_id: string; verdict: string | null; created_at: string }[] }

  // Latest row per wash_cycle_id wins — results are already ordered newest
  // first, so the first match kept per id is the current verdict, without
  // needing a window function for what's normally a handful of rows.
  const latestVerdictByCycleId = new Map<string, string | null>()
  for (const r of results ?? []) {
    if (!latestVerdictByCycleId.has(r.wash_cycle_id)) latestVerdictByCycleId.set(r.wash_cycle_id, r.verdict)
  }

  for (const serial of uniqueSerials) {
    const cycleId = cycleIdBySerial.get(serial)
    if (!cycleId) {
      statusBySerial.set(serial, 'untested')
      continue
    }
    const verdict = latestVerdictByCycleId.get(cycleId)
    statusBySerial.set(serial, verdict === 'o_tdi' ? 'passed' : verdict === 'qayta_yuvish' ? 'failed' : 'untested')
  }
  return statusBySerial
}
