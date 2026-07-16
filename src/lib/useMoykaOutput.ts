import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { jarayonda, ortiqcha } from './tayyorCompletion'
import { sortByDateDesc } from './sortByDate'

export { computeFinalLossPct, isCycleComplete } from './tayyorCompletion'

export interface FinishedPallet {
  barcode2: string
  calibre_id: string
  weight_kg: number
  received_date: string
}

export interface OutputSerial {
  serial: string
  type_id: string
  category_id: string
  owner_id: string
  sent: number // Yuborilgan — Σ moyka_sends.qty_kg (derived)
  received: number // Qabul qilingan — Σ finished_pallets.weight_kg, non-void (derived)
  inProcess: number // Jarayonda — max(0, sent − received); never negative (see DECISIONS)
  excess: number // Ortiqcha — max(0, received − sent); non-blocking overage flag
  pallets: FinishedPallet[]
}

// §5.3 Window 2 (Tugallangan): a serial whose cycle 1 has a wash_cycles row
// with status='final' — auto-completed (received ≥ sent) or manually closed
// via Tugallash. lossPct is the LOCKED figure from wash_cycles.final_loss_pct
// (source of truth once finalized, not recomputed) — sent/received/excess
// stay derived like the active list, for display and for the Ortiqcha badge.
export interface CompletedCycle {
  serial: string
  type_id: string
  owner_id: string
  sent: number
  received: number
  lossPct: number // locked wash_cycles.final_loss_pct, floored at 0 (see tayyorCompletion.ts)
  excess: number // Ortiqcha — max(0, received − sent); picks the badge treatment
  pallets: FinishedPallet[]
  lastReceivedDate: string | null // max finished_pallets.received_date — wash_cycles has no
  // finalized_at timestamp (see DECISIONS "Tayyor Mahsulot completion"), so the last receipt
  // date is the closest real signal for "when this cycle was completed"; used to sort
  // Window 2 newest-first (DECISIONS "History list ordering").
}

// §5.3 data: serials sent to Moyka (Step 5) split into two windows — active
// (no final cycle-1 row yet) and completed (Tugallangan: a final row exists,
// auto or manual). All totals DERIVED (CLAUDE.md "derive, don't store")
// except the locked final_loss_pct itself: sent from moyka_sends, received
// from finished_pallets. wash_cycle = 1 throughout (re-wash §2.13 is a later
// step and doesn't exist yet).
export function useMoykaOutput() {
  const [serials, setSerials] = useState<OutputSerial[]>([])
  const [completed, setCompleted] = useState<CompletedCycle[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: sends }, { data: pallets }, { data: cycles }] = await Promise.all([
        supabase.from('moyka_sends').select('serial, qty_kg'),
        supabase.from('finished_pallets').select('barcode2, serial, calibre_id, weight_kg, received_date, status'),
        supabase.from('wash_cycles').select('serial, cycle_no, status, final_loss_pct'),
      ])

      // Sent totals per serial (only serials that have been sent appear).
      const sentBySerial = new Map<string, number>()
      for (const s of sends ?? []) sentBySerial.set(s.serial, (sentBySerial.get(s.serial) ?? 0) + s.qty_kg)

      const serialList = [...sentBySerial.keys()]
      const finalCycles = (cycles ?? []).filter((c) => c.cycle_no === 1 && c.status === 'final')
      const lossPctBySerial = new Map(finalCycles.map((c) => [c.serial, c.final_loss_pct ?? 0]))
      const finalizedSerials = new Set(finalCycles.map((c) => c.serial))
      const activeSerials = serialList.filter((s) => !finalizedSerials.has(s))
      const completedSerials = serialList.filter((s) => finalizedSerials.has(s))

      // Only bail early if there is truly nothing sent yet — NOT just when
      // activeSerials is empty, which would silently drop Window 2 (the bug
      // this fixes: every serial could be finalized and Tugallangan would
      // still render empty).
      if (serialList.length === 0) {
        setSerials([])
        setCompleted([])
        return
      }

      const { data: kLines } = await supabase
        .from('kirim_lines')
        .select('serial, order_id, type_id')
        .in('serial', serialList)
      const orderIds = [...new Set((kLines ?? []).map((l) => l.order_id))]
      const [{ data: orders }, { data: types }] = await Promise.all([
        supabase.from('kirim_orders').select('order_id, owner_id').in('order_id', orderIds),
        supabase.from('product_types').select('id, category_id'),
      ])

      const lineBySerial = new Map((kLines ?? []).map((l) => [l.serial, l]))
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
      const categoryByType = new Map((types ?? []).map((t) => [t.id, t.category_id]))
      const palletsBySerial = new Map<string, FinishedPallet[]>()
      for (const p of pallets ?? []) {
        if (p.status === 'bekor_qilindi') continue // voided pallets don't count (re-wash, future)
        const list = palletsBySerial.get(p.serial) ?? []
        list.push({ barcode2: p.barcode2, calibre_id: p.calibre_id, weight_kg: p.weight_kg, received_date: p.received_date })
        palletsBySerial.set(p.serial, list)
      }

      // Shared join/derivation for both windows — avoids fetching or
      // computing sent/received/pallets twice for the same serial shape.
      function baseRow(serial: string) {
        const line = lineBySerial.get(serial)
        if (!line) return null
        const order = orderById.get(line.order_id)
        if (!order) return null
        const serialPallets = palletsBySerial.get(serial) ?? []
        const sent = sentBySerial.get(serial) ?? 0
        const received = serialPallets.reduce((sum, p) => sum + p.weight_kg, 0)
        return { serial, type_id: line.type_id, owner_id: order.owner_id, sent, received, pallets: serialPallets }
      }

      const combined: OutputSerial[] = activeSerials
        .map((serial): OutputSerial | null => {
          const base = baseRow(serial)
          if (!base) return null
          return {
            ...base,
            category_id: categoryByType.get(base.type_id) ?? '',
            inProcess: jarayonda(base.sent, base.received),
            excess: ortiqcha(base.sent, base.received),
          }
        })
        .filter((s): s is OutputSerial => s !== null)

      const completedRows: CompletedCycle[] = completedSerials
        .map((serial): CompletedCycle | null => {
          const base = baseRow(serial)
          if (!base) return null
          const lastReceivedDate = base.pallets.reduce<string | null>(
            (max, p) => (!max || p.received_date > max ? p.received_date : max),
            null,
          )
          return {
            ...base,
            lossPct: lossPctBySerial.get(serial) ?? 0,
            excess: ortiqcha(base.sent, base.received),
            lastReceivedDate,
          }
        })
        .filter((c): c is CompletedCycle => c !== null)

      setSerials(combined)
      setCompleted(sortByDateDesc(completedRows, (c) => c.lastReceivedDate))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { serials, completed, loading, refresh }
}
