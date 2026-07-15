import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { IntakeLine, IntakeRecord } from './useIntakeLines'

export interface IntakeHistoryFilters {
  from: string // YYYY-MM-DD inclusive
  to: string // YYYY-MM-DD inclusive
  typeId: string // '' = all
  ownerId: string // '' = all
  seriya: string // text match, '' = all
}

// Read-only history of storage_intake (Ombor Hisobotlar, task step 4). Rows
// are shaped as `IntakeLine & { intake }` so the Step 3 full-story detail
// component (IntakeDetailView) is reused verbatim for row-expand — no second
// detail view.
//
// Date range + seriya are pushed server-side (storage_intake has its own
// confirmed_at timestamp, so this bounds both fetch and render); tur/owner
// live on joined rows and are filtered client-side after enrichment. The
// join is done the same parallel-fetch + map way as useIntakeLines rather
// than a deep PostgREST embed, for the same readability reason.
type Row = IntakeLine & { intake: IntakeRecord }

export function useIntakeHistory(filters: IntakeHistoryFilters) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const { from, to, typeId, ownerId, seriya } = filters

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        // Upper bound exclusive: next day at 00:00, so the whole `to` day is
        // included. (Compared against confirmed_at as UTC midnight — a small
        // TZ simplification, fine for this history view.)
        const toExclusive = new Date(to)
        toExclusive.setDate(toExclusive.getDate() + 1)
        const toExclusiveStr = toExclusive.toISOString().slice(0, 10)

        let q = supabase
          .from('storage_intake')
          .select('serial, actual_qty, pile_photo, komment, barcode1, status, confirmed_at, moisture_pct, so2_mg_kg')
          .gte('confirmed_at', from)
          .lt('confirmed_at', toExclusiveStr)
          .order('confirmed_at', { ascending: false })
          .limit(200)
        if (seriya.trim()) q = q.ilike('serial', `%${seriya.trim()}%`)

        const { data: intakes } = await q
        const serials = (intakes ?? []).map((i) => i.serial)
        if (serials.length === 0) {
          if (!cancelled) setRows([])
          return
        }

        const { data: kLines } = await supabase
          .from('kirim_lines')
          .select('serial, order_id, type_id, declared_qty')
          .in('serial', serials)

        const orderIds = [...new Set((kLines ?? []).map((l) => l.order_id))]
        const [{ data: orders }, { data: weighings }] = await Promise.all([
          supabase
            .from('kirim_orders')
            .select('order_id, order_date, plate, driver, owner_id, status')
            .in('order_id', orderIds),
          supabase
            .from('gate_weighings')
            .select('order_id, gruzheny_kg, pustoy_kg, net_kg, completed_at')
            .eq('dir', 'kirim')
            .in('order_id', orderIds),
        ])

        const lineBySerial = new Map((kLines ?? []).map((l) => [l.serial, l]))
        const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
        const weighingByOrder = new Map((weighings ?? []).map((w) => [w.order_id, w]))

        const enriched: Row[] = (intakes ?? [])
          .map((intake): Row | null => {
            const line = lineBySerial.get(intake.serial)
            if (!line) return null
            const order = orderById.get(line.order_id)
            if (!order) return null
            const weighing = weighingByOrder.get(line.order_id) ?? null

            return {
              serial: intake.serial,
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
              intake,
            }
          })
          .filter((r): r is Row => r !== null)
          .filter((r) => (typeId ? r.type_id === typeId : true))
          .filter((r) => (ownerId ? r.owner_id === ownerId : true))

        if (!cancelled) setRows(enriched)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [from, to, typeId, ownerId, seriya])

  return { rows, loading }
}
