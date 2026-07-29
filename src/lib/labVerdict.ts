import { supabase } from './supabase'

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
// wash_cycles is now exactly one row per serial (never one per cycle), but
// lab_results.wash_cycle_id is still many-to-one against it — a reject
// followed by a re-test is a NEW lab_results row against the SAME
// wash_cycle_id, never a second wash_cycles row. "Current" is always the
// LATEST such row by created_at.
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

  const { data: cycles } = await supabase.from('wash_cycles').select('id, serial').in('serial', uniqueSerials)
  const cycleIdBySerial = new Map((cycles ?? []).map((c) => [c.serial, c.id]))

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
