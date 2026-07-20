import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { sortByDateDesc } from './sortByDate'
import { cycleInputKg } from './rewash'
import { fetchActiveCycles } from './activeCycles'
import { fetchEffectiveQty, type EffectiveQtyInfo } from './effectiveQty'
import type { QtyVariance, WeightAuthorityBasis } from './weightAuthority'

export interface MoykaSend {
  id: string
  sent_date: string
  qty_kg: number
  wash_cycle: number
}

export interface MoykaSerial {
  serial: string
  type_id: string
  owner_id: string
  order_date: string
  plate: string
  actual_qty: number // measured raw received at storage (§5.1) — original intake, cycle 1 only
  activeCycle: number // §5.5.4/§5.5.5: 1 unless a prior cycle was voided into a re-wash
  isRewash: boolean // activeCycle > 1 — this row's numbers describe a re-wash cycle, not the original intake
  cycleInputKg: number // this cycle's input: effective_qty (§2.15) for cycle 1, previous cycle's voided kg for cycle 2+
  provisional: boolean // §2.15.2: cycle 1 only — true while gate stage 2 hasn't completed ("tarozi kutilmoqda")
  effectiveQtyBasis: WeightAuthorityBasis | null // null for cycle 2+ (re-wash input isn't a weight-authority figure)
  truckVariance: QtyVariance | null // §5.1 amend: gate net vs the order's declared total, cycle 1 only
  provisionalVarianceFlag: boolean // §2.15.2 edge case: sent while provisional, later landed materially different
  sent: number // Σ moyka_sends.qty_kg for the ACTIVE cycle only — derived, not stored (§2.15)
  available: number // max(0, cycleInputKg − sent) — floored: a serial can be over-consumed relative to a
  // just-arrived, lower gate net (see DECISIONS.md "Weight authority & effective quantity"); never shown negative.
  sends: MoykaSend[] // full per-send history, every cycle, chronological — for the detail view
}

// §5.2 data: serials received into storage that have raw material to send to
// Moyka. Available balance is DERIVED (cycle input − Σ sends for that
// cycle), never stored — same "store events, derive numbers" reason
// wash_cycles has no sent_qty and storage_intake has no sent_to_moyka_qty
// column.
//
// §5.5.4/§5.5.5 re-wash (Step 8 prompt 2, split 2d): a serial's ACTIVE cycle
// is derived from which of its earlier cycles have been voided
// (rewash.ts's activeCycleNo) — never a stored counter. Sent/available are
// scoped to that cycle only; a re-wash serial's "available to send" is the
// weight voided out of its previous cycle's non-Konditirskiy pallets, not
// the original actual_qty (which cycle 1 already fully consumed).
export function useMoykaSerials() {
  const [serials, setSerials] = useState<MoykaSerial[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: intakes }, { data: sends }] = await Promise.all([
        supabase.from('storage_intake').select('serial, actual_qty'),
        supabase.from('moyka_sends').select('id, serial, sent_date, qty_kg, wash_cycle'),
      ])

      const serialList = (intakes ?? []).map((i) => i.serial)
      if (serialList.length === 0) {
        setSerials([])
        return
      }

      // §5.1's own "Kam chiqdi" threshold, reused as the §2.15.2 materiality
      // bar rather than inventing a new one (see DECISIONS.md "Weight
      // authority & effective quantity").
      const { data: limitRow } = await supabase.from('settings_limits').select('value').eq('key', 'kam_chiqdi_pct').maybeSingle()
      const materialVariancePct = limitRow?.value ?? 5

      // Enrich each received serial with its line/order context.
      // 🔒 Redundant-fetch collapse (see effectiveQty.ts's own comment):
      // intakes/sends were already fetched above for this same refresh —
      // pass them straight through instead of making fetchEffectiveQty
      // re-fetch both tables again, unfiltered, a second time.
      const [{ data: kLines }, activeCycles, effectiveQtyBySerial] = await Promise.all([
        supabase.from('kirim_lines').select('serial, order_id, type_id').in('serial', serialList),
        fetchActiveCycles(serialList),
        fetchEffectiveQty(serialList, materialVariancePct, { intakes: intakes ?? [], sends: sends ?? [] }),
      ])
      const orderIds = [...new Set((kLines ?? []).map((l) => l.order_id))]
      const { data: orders } = await supabase
        .from('kirim_orders')
        .select('order_id, order_date, plate, owner_id')
        .in('order_id', orderIds)

      const lineBySerial = new Map((kLines ?? []).map((l) => [l.serial, l]))
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))

      const sendsBySerial = new Map<string, MoykaSend[]>()
      for (const s of sends ?? []) {
        const list = sendsBySerial.get(s.serial) ?? []
        list.push({ id: s.id, sent_date: s.sent_date, qty_kg: s.qty_kg, wash_cycle: s.wash_cycle })
        sendsBySerial.set(s.serial, list)
      }

      const combined: MoykaSerial[] = (intakes ?? [])
        .map((intake): MoykaSerial | null => {
          const line = lineBySerial.get(intake.serial)
          if (!line) return null
          const order = orderById.get(line.order_id)
          if (!order) return null

          const serialSends = (sendsBySerial.get(intake.serial) ?? []).sort((a, b) =>
            a.sent_date.localeCompare(b.sent_date),
          )
          const { cycle, previousCycleVoidedKg } = activeCycles.get(intake.serial) ?? { cycle: 1, previousCycleVoidedKg: 0 }
          // §2.15: cycle 1's input is the derived effective_qty, not the raw
          // intake figure — cycleInputKg itself is untouched (still pure,
          // still "cycle 1 → its actualQty arg"), only WHICH figure that arg
          // carries has changed. Cycle 2+ keeps using the previous cycle's
          // voided kg, exactly as before (Step 8 behaviour, unchanged).
          const eq: EffectiveQtyInfo | undefined = effectiveQtyBySerial.get(intake.serial)
          const cycle1Value = eq?.value ?? intake.actual_qty
          const input = cycleInputKg(cycle, cycle1Value, previousCycleVoidedKg)
          const sentThisCycle = serialSends.filter((s) => s.wash_cycle === cycle).reduce((sum, s) => sum + s.qty_kg, 0)

          return {
            serial: intake.serial,
            type_id: line.type_id,
            owner_id: order.owner_id,
            order_date: order.order_date,
            plate: order.plate,
            actual_qty: intake.actual_qty,
            activeCycle: cycle,
            isRewash: cycle > 1,
            cycleInputKg: input,
            provisional: cycle === 1 ? (eq?.provisional ?? false) : false,
            effectiveQtyBasis: cycle === 1 ? (eq?.basis ?? null) : null,
            truckVariance: cycle === 1 ? (eq?.truckVariance ?? null) : null,
            provisionalVarianceFlag: cycle === 1 ? (eq?.provisionalVarianceFlag ?? false) : false,
            sent: sentThisCycle,
            available: Math.max(0, input - sentThisCycle),
            sends: serialSends,
          }
        })
        .filter((s): s is MoykaSerial => s !== null)

      // Universal sort rule (DECISIONS "Universal sort rule", SPEC.md §5
      // intro): every stage list sorts newest-first, by order_date here —
      // the batch's own arrival date, meaningful whether or not it's been
      // sent yet. Sorted once at the hook so §5.2 Window 1 ("Yuborish
      // uchun", filtered from this same array) inherits it automatically.
      setSerials(sortByDateDesc(combined, (s) => s.order_date))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { serials, loading, refresh }
}
