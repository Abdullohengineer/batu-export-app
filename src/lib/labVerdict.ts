import { supabase } from './supabase'

export type LabGateStatus = 'passed' | 'failed' | 'untested'

// §5.5.3/§8 hard gate (SPEC.md v1.9): a serial's CURRENT wash cycle — the
// highest cycle_no with a wash_cycles row, which only exists once Tugallash
// has run (§5.3) — must carry a lab_results verdict='o_tdi' for its
// finished pallets to count as available. No wash_cycles row at all means
// Tugallash hasn't happened yet; a wash_cycles row with no matching
// lab_results row means Tugallash happened but Laborator hasn't tested it
// yet. Both read as 'untested', not 'passed' — absence of a verdict must
// never default to available.
//
// Shared by useAvailableFinishedStock.ts (bulk, Menejer's feasibility
// checker) and OmborChiqimTab.tsx's scan-time check (single serial) so the
// two consumers can never disagree — "one derived truth, all consumers"
// (SPEC.md v1.9 §8), the same reasoning every other derived-balance rule in
// this app already follows (CLAUDE.md "derive, don't store").
export async function currentCycleLabStatus(serials: string[]): Promise<Map<string, LabGateStatus>> {
  const uniqueSerials = [...new Set(serials)]
  const statusBySerial = new Map<string, LabGateStatus>()
  if (uniqueSerials.length === 0) return statusBySerial

  const { data: cycles } = await supabase.from('wash_cycles').select('id, serial, cycle_no').in('serial', uniqueSerials)

  const currentCycleBySerial = new Map<string, { id: string; cycle_no: number }>()
  for (const c of cycles ?? []) {
    const existing = currentCycleBySerial.get(c.serial)
    if (!existing || c.cycle_no > existing.cycle_no) currentCycleBySerial.set(c.serial, c)
  }

  const cycleIds = [...currentCycleBySerial.values()].map((c) => c.id)
  const { data: results } = cycleIds.length
    ? await supabase.from('lab_results').select('wash_cycle_id, verdict').eq('scope', 'chiqim').in('wash_cycle_id', cycleIds)
    : { data: [] as { wash_cycle_id: string; verdict: string | null }[] }
  const verdictByCycleId = new Map((results ?? []).map((r) => [r.wash_cycle_id, r.verdict]))

  for (const serial of uniqueSerials) {
    const cycle = currentCycleBySerial.get(serial)
    if (!cycle) {
      statusBySerial.set(serial, 'untested')
      continue
    }
    const verdict = verdictByCycleId.get(cycle.id)
    statusBySerial.set(serial, verdict === 'o_tdi' ? 'passed' : verdict === 'qayta_yuvish' ? 'failed' : 'untested')
  }
  return statusBySerial
}
