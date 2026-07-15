import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface IntakeRecord {
  actual_qty: number
  pile_photo: string | null
  komment: string | null
  barcode1: string | null
  status: string
  confirmed_at: string
  moisture_pct: number | null
  so2_mg_kg: number | null
}

export interface IntakeLine {
  serial: string
  type_id: string
  declared_qty: number
  order_id: string
  order_date: string
  plate: string
  driver: string
  owner_id: string
  order_status: string
  gruzheny_kg: number | null
  pustoy_kg: number | null
  net_kg: number | null
  gate_completed_at: string | null
  intake: IntakeRecord | null
}

// Storage §1 (SPEC §5.1): a trip is visible the moment the manager submits
// it, but only ACCEPTABLE once gate stage 1 exists (gruzheny_kg set) — it
// does not wait for stage 2 / net weight. One row per serial (line), since
// a serial is single-type by construction (§2.1) and lines on the same
// trip can be accepted independently.
export function useIntakeLines() {
  const [lines, setLines] = useState<IntakeLine[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: orders }, { data: kLines }, { data: weighings }, { data: intakes }] = await Promise.all([
        supabase
          .from('kirim_orders')
          .select('order_id, order_date, plate, driver, owner_id, status')
          .order('created_at', { ascending: false }),
        supabase.from('kirim_lines').select('serial, order_id, type_id, declared_qty'),
        supabase
          .from('gate_weighings')
          .select('order_id, gruzheny_kg, pustoy_kg, net_kg, completed_at')
          .eq('dir', 'kirim'),
        supabase
          .from('storage_intake')
          .select('serial, actual_qty, pile_photo, komment, barcode1, status, confirmed_at, moisture_pct, so2_mg_kg'),
      ])

      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
      const weighingByOrder = new Map((weighings ?? []).map((w) => [w.order_id, w]))
      const intakeBySerial = new Map((intakes ?? []).map((i) => [i.serial, i]))

      const combined: IntakeLine[] = (kLines ?? [])
        .map((line): IntakeLine | null => {
          const order = orderById.get(line.order_id)
          if (!order) return null
          const weighing = weighingByOrder.get(line.order_id) ?? null

          return {
            serial: line.serial,
            type_id: line.type_id,
            declared_qty: line.declared_qty,
            order_id: order.order_id,
            order_date: order.order_date,
            plate: order.plate,
            driver: order.driver,
            owner_id: order.owner_id,
            order_status: order.status,
            gruzheny_kg: weighing?.gruzheny_kg ?? null,
            pustoy_kg: weighing?.pustoy_kg ?? null,
            net_kg: weighing?.net_kg ?? null,
            gate_completed_at: weighing?.completed_at ?? null,
            intake: intakeBySerial.get(line.serial) ?? null,
          }
        })
        .filter((l): l is IntakeLine => l !== null)

      setLines(combined)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { lines, loading, refresh }
}
