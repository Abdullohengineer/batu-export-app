import { supabase } from './supabase'
import { activeCycleNo } from './rewash'

export interface ActiveCycleInfo {
  cycle: number
  previousCycleVoidedKg: number
}

// §5.5.4/§5.5.5 (SPEC.md v1.9) — shared by useMoykaSerials.ts and
// useMoykaOutput.ts so both derive the SAME active-cycle number per serial
// from the SAME query, never two independent computations that could
// silently disagree (§8: "one derived truth, all consumers" — the same
// reasoning the hard gate's currentCycleLabStatus already follows,
// labVerdict.ts). rewash.ts's activeCycleNo() itself stays pure and
// dependency-free; this is the I/O + combination layer around it.
export async function fetchActiveCycles(serials: string[]): Promise<Map<string, ActiveCycleInfo>> {
  const result = new Map<string, ActiveCycleInfo>()
  if (serials.length === 0) return result

  const [{ data: pallets }, { data: calibres }] = await Promise.all([
    supabase.from('finished_pallets').select('serial, wash_cycle, calibre_id, weight_kg, status').in('serial', serials),
    supabase.from('calibres').select('id, is_numberless'),
  ])
  const numberlessCalibres = new Set((calibres ?? []).filter((c) => c.is_numberless).map((c) => c.id))

  // Voided, non-Konditirskiy pallet weight per (serial, cycle) — a re-wash
  // cycle's input (§5.5.4: "the total kg of voided calibre pallets becomes
  // the re-wash quantity"). Konditirskiy is excluded from re-send by design
  // (§2.13, unchanged).
  const voidedKgBySerialCycle = new Map<string, number>()
  for (const p of pallets ?? []) {
    if (p.status !== 'bekor_qilindi') continue
    if (numberlessCalibres.has(p.calibre_id)) continue
    const key = `${p.serial}:${p.wash_cycle}`
    voidedKgBySerialCycle.set(key, (voidedKgBySerialCycle.get(key) ?? 0) + p.weight_kg)
  }
  const voidedCyclesBySerial = new Map<string, number[]>()
  for (const key of voidedKgBySerialCycle.keys()) {
    const [serial, cycleStr] = key.split(':')
    const list = voidedCyclesBySerial.get(serial) ?? []
    list.push(Number(cycleStr))
    voidedCyclesBySerial.set(serial, list)
  }

  for (const serial of serials) {
    const cycle = activeCycleNo(voidedCyclesBySerial.get(serial) ?? [])
    const previousCycleVoidedKg = cycle > 1 ? (voidedKgBySerialCycle.get(`${serial}:${cycle - 1}`) ?? 0) : 0
    result.set(serial, { cycle, previousCycleVoidedKg })
  }
  return result
}
