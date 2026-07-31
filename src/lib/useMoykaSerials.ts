import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { sortByDateDesc } from './sortByDate'
import { fetchEffectiveQty, type EffectiveQtyInfo } from './effectiveQty'
import type { QtyVariance, WeightAuthorityBasis } from './weightAuthority'

export interface MoykaSend {
  id: string
  sent_date: string
  qty_kg: number
}

// Raw dispatch (2026-07-31) — a client collecting raw material directly,
// the second exit from a serial's raw balance alongside moyka_sends. Shaped
// like MoykaSend for the same reason: one row per real loading event,
// summed by the caller, never re-derived.
export interface RawDispatchEvent {
  id: string
  loaded_at: string
  weight_kg: number
  box_mass_kg: number
  net_kg: number
}

export interface MoykaSerial {
  serial: string
  type_id: string
  owner_id: string
  order_date: string
  plate: string
  actual_qty: number // measured raw received at storage (§5.1)
  inputKg: number // §2.16 effective_qty -- the serial's raw input to Moyka. Was "cycleInputKg"
  // before wash cycles were removed (2026-07-28, Laborator v2) -- there is no cycle to scope it to anymore.
  provisional: boolean // §2.15.2: true while gate stage 2 hasn't completed ("tarozi kutilmoqda")
  effectiveQtyBasis: WeightAuthorityBasis | null
  truckVariance: QtyVariance | null // §5.1 amend: gate net vs the order's declared total
  provisionalVarianceFlag: boolean // §2.15.2 edge case: sent while provisional, later landed materially different
  sent: number // Σ moyka_sends.qty_kg for the serial -- derived, not stored (§2.15)
  rawDispatched: number // Σ raw_dispatch_lines.net_kg for the serial -- the second exit (raw dispatch build)
  available: number // max(0, inputKg − sent − rawDispatched) — floored: a serial can be over-consumed
  // relative to a just-arrived, lower gate net (see DECISIONS.md "Weight authority & effective quantity");
  // never shown negative. Generalized (raw dispatch build) to subtract BOTH exits, not moyka_sends alone --
  // the single figure every consumer (Moyka send screen, CHIQIM raw picker, later Rezka) reads.
  sends: MoykaSend[] // full per-send history, chronological — for the detail view
  rawDispatches: RawDispatchEvent[] // full per-raw-dispatch history, chronological — for the detail view
}

// §5.2 data: serials received into storage that have raw material to send to
// Moyka. Available balance is DERIVED (input − Σ sends − Σ raw dispatches),
// never stored — same "store events, derive numbers" reason wash_cycles has
// no sent_qty and storage_intake has no sent_to_moyka_qty column.
//
// Wash-cycle re-send tracking removed (2026-07-28, Laborator v2 — see
// DECISIONS.md "Lab moves inside Moyka, wash-cycle concept removed"):
// re-washing now happens invisibly inside Moyka, so there is no second cycle
// for this hook to scope sends/input against — every send for a serial
// belongs to the same single balance, for the serial's whole life.
//
// Raw dispatch (2026-07-31, see DECISIONS.md "Raw dispatch") generalized
// this hook's own `available` to a second exit — built once here so the
// Moyka send screen and the new CHIQIM raw picker (ChiqimForm.tsx) can never
// compute two different numbers for the same serial's raw balance.
export function useMoykaSerials() {
  const [serials, setSerials] = useState<MoykaSerial[]>([])
  const [loading, setLoading] = useState(true)
  // 🔒 See useMoykaOutput.ts's identical guard for the full explanation --
  // refresh is exposed for mutation handlers to call too, so a per-effect
  // `cancelled` closure can't cover every call site; a monotonic request id
  // ensures only the most-recently-started call ever commits state.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const [{ data: intakes }, { data: sends }, { data: rawDispatches }] = await Promise.all([
        supabase.from('storage_intake').select('serial, actual_qty, box_mass_kg'),
        supabase.from('moyka_sends').select('id, serial, sent_date, qty_kg'),
        supabase.from('raw_dispatch_lines').select('id, serial, loaded_at, weight_kg, box_mass_kg, net_kg'),
      ])

      const serialList = (intakes ?? []).map((i) => i.serial)
      if (serialList.length === 0) {
        if (requestIdRef.current === requestId) setSerials([])
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
      const [{ data: kLines }, effectiveQtyBySerial] = await Promise.all([
        supabase.from('kirim_lines').select('serial, order_id, type_id').in('serial', serialList),
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
        list.push({ id: s.id, sent_date: s.sent_date, qty_kg: s.qty_kg })
        sendsBySerial.set(s.serial, list)
      }

      const rawDispatchesBySerial = new Map<string, RawDispatchEvent[]>()
      for (const r of rawDispatches ?? []) {
        const list = rawDispatchesBySerial.get(r.serial) ?? []
        list.push({ id: r.id, loaded_at: r.loaded_at, weight_kg: r.weight_kg, box_mass_kg: r.box_mass_kg, net_kg: r.net_kg })
        rawDispatchesBySerial.set(r.serial, list)
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
          const serialRawDispatches = (rawDispatchesBySerial.get(intake.serial) ?? []).sort((a, b) =>
            a.loaded_at.localeCompare(b.loaded_at),
          )
          const eq: EffectiveQtyInfo | undefined = effectiveQtyBySerial.get(intake.serial)
          const input = eq?.value ?? intake.actual_qty
          const sentTotal = serialSends.reduce((sum, s) => sum + s.qty_kg, 0)
          const rawDispatchedTotal = serialRawDispatches.reduce((sum, r) => sum + r.net_kg, 0)

          return {
            serial: intake.serial,
            type_id: line.type_id,
            owner_id: order.owner_id,
            order_date: order.order_date,
            plate: order.plate,
            actual_qty: intake.actual_qty,
            inputKg: input,
            provisional: eq?.provisional ?? false,
            effectiveQtyBasis: eq?.basis ?? null,
            truckVariance: eq?.truckVariance ?? null,
            provisionalVarianceFlag: eq?.provisionalVarianceFlag ?? false,
            sent: sentTotal,
            rawDispatched: rawDispatchedTotal,
            available: Math.max(0, input - sentTotal - rawDispatchedTotal),
            sends: serialSends,
            rawDispatches: serialRawDispatches,
          }
        })
        .filter((s): s is MoykaSerial => s !== null)

      // Universal sort rule (DECISIONS "Universal sort rule", SPEC.md §5
      // intro): every stage list sorts newest-first, by order_date here —
      // the batch's own arrival date, meaningful whether or not it's been
      // sent yet. Sorted once at the hook so §5.2 Window 1 ("Yuborish
      // uchun", filtered from this same array) inherits it automatically.
      if (requestIdRef.current !== requestId) return
      setSerials(sortByDateDesc(combined, (s) => s.order_date))
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { serials, loading, refresh }
}
