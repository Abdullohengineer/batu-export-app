import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

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
  actual_qty: number // measured raw received at storage (§5.1)
  sent: number // Σ moyka_sends.qty_kg — derived, not stored (§2.15)
  available: number // actual_qty − sent ("qoladi" after all sends so far)
  sends: MoykaSend[] // per-send history, chronological
  lastSentDate: string | null // most recent sends[].sent_date — used to sort the "To'liq
  // yuborilgan" completed window newest-first (DECISIONS "History list ordering"); this
  // hook's own array order is left as-is since it also serves the active "Yuborish uchun"
  // window, which isn't a completed/history list.
}

// §5.2 data: serials received into storage that have raw material to send to
// Moyka. Available balance is DERIVED (actual_qty − Σ sends), never stored —
// same "store events, derive numbers" reason wash_cycles has no sent_qty and
// storage_intake has no sent_to_moyka_qty column. All sends are wash_cycle 1
// this step (re-wash §2.13 is a later step and doesn't exist yet).
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

      // Enrich each received serial with its line/order context.
      const { data: kLines } = await supabase
        .from('kirim_lines')
        .select('serial, order_id, type_id')
        .in('serial', serialList)
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
          const sent = serialSends.reduce((sum, s) => sum + s.qty_kg, 0)

          return {
            serial: intake.serial,
            type_id: line.type_id,
            owner_id: order.owner_id,
            order_date: order.order_date,
            plate: order.plate,
            actual_qty: intake.actual_qty,
            sent,
            available: intake.actual_qty - sent,
            sends: serialSends,
            lastSentDate: serialSends.length > 0 ? serialSends[serialSends.length - 1].sent_date : null,
          }
        })
        .filter((s): s is MoykaSerial => s !== null)

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
