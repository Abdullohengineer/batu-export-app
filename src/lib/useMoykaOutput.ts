import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { jarayonda, ortiqcha } from './tayyorCompletion'

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

// §5.3 data: serials in Moyka awaiting output — sent to Moyka (Step 5) and
// NOT yet finalized (no wash_cycles row with status='final' for cycle 1).
// All totals DERIVED (CLAUDE.md "derive, don't store"): sent from
// moyka_sends, received from finished_pallets. wash_cycle = 1 throughout
// (re-wash §2.13 is a later step and doesn't exist yet).
export function useMoykaOutput() {
  const [serials, setSerials] = useState<OutputSerial[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: sends }, { data: pallets }, { data: cycles }] = await Promise.all([
        supabase.from('moyka_sends').select('serial, qty_kg'),
        supabase.from('finished_pallets').select('barcode2, serial, calibre_id, weight_kg, received_date, status'),
        supabase.from('wash_cycles').select('serial, cycle_no, status'),
      ])

      // Sent totals per serial (only serials that have been sent appear).
      const sentBySerial = new Map<string, number>()
      for (const s of sends ?? []) sentBySerial.set(s.serial, (sentBySerial.get(s.serial) ?? 0) + s.qty_kg)

      const serialList = [...sentBySerial.keys()]
      const finalized = new Set(
        (cycles ?? []).filter((c) => c.cycle_no === 1 && c.status === 'final').map((c) => c.serial),
      )
      const activeSerials = serialList.filter((s) => !finalized.has(s))
      if (activeSerials.length === 0) {
        setSerials([])
        return
      }

      const { data: kLines } = await supabase
        .from('kirim_lines')
        .select('serial, order_id, type_id')
        .in('serial', activeSerials)
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

      const combined: OutputSerial[] = activeSerials
        .map((serial): OutputSerial | null => {
          const line = lineBySerial.get(serial)
          if (!line) return null
          const order = orderById.get(line.order_id)
          if (!order) return null
          const serialPallets = palletsBySerial.get(serial) ?? []
          const sent = sentBySerial.get(serial) ?? 0
          const received = serialPallets.reduce((sum, p) => sum + p.weight_kg, 0)
          return {
            serial,
            type_id: line.type_id,
            category_id: categoryByType.get(line.type_id) ?? '',
            owner_id: order.owner_id,
            sent,
            received,
            inProcess: jarayonda(sent, received),
            excess: ortiqcha(sent, received),
            pallets: serialPallets,
          }
        })
        .filter((s): s is OutputSerial => s !== null)

      setSerials(combined)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { serials, loading, refresh }
}
