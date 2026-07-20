import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { sortByDateDesc } from './sortByDate'

// §5.5.2 Laborator KIRIM (descriptive check). W1 is a FIFO arrival queue —
// exempt from the universal newest-first sort (SPEC.md §5 intro named
// invariant), same exemption class as gate/receiving queues.

export interface AwaitingLine {
  serial: string
  type_id: string
  owner_id: string
  plate: string
  order_date: string
  declared_qty: number
  actual_qty: number
  confirmed_at: string // storage_intake.confirmed_at — FIFO sort key
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
}

export interface LabResultRow {
  id: string
  parent_serial: string
  sample_date: string
  moisture_pct: number
  so2_mg_kg: number | null
  sample_photo: string | null
  note: string | null
  status: 'moisture_in' | 'complete'
  created_at: string
  // Carried through for display — same fields as AwaitingLine, minus the
  // FIFO timestamp which no longer matters once sampled.
  type_id: string
  owner_id: string
  plate: string
  declared_qty: number
  actual_qty: number
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
}

export function useLaboratorKirim() {
  const [awaiting, setAwaiting] = useState<AwaitingLine[]>([])
  const [sulfurPending, setSulfurPending] = useState<LabResultRow[]>([])
  const [finished, setFinished] = useState<LabResultRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: lines }, { data: intakes }, { data: results }] = await Promise.all([
        supabase
          .from('kirim_lines')
          .select('serial, order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg'),
        supabase.from('storage_intake').select('serial, actual_qty, confirmed_at'),
        supabase
          .from('lab_results')
          .select('id, parent_serial, sample_date, moisture_pct, so2_mg_kg, sample_photo, note, status, created_at')
          .eq('scope', 'kirim'),
      ])

      const intakeBySerial = new Map((intakes ?? []).map((i) => [i.serial, i]))
      const resultBySerial = new Map((results ?? []).map((r) => [r.parent_serial, r]))

      const orderIds = [...new Set((lines ?? []).map((l) => l.order_id))]
      const { data: orders } = await supabase
        .from('kirim_orders')
        .select('order_id, order_date, plate, owner_id')
        .in('order_id', orderIds)
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))

      const awaitingRows: AwaitingLine[] = []
      const sulfurRows: LabResultRow[] = []
      const finishedRows: LabResultRow[] = []

      for (const line of lines ?? []) {
        const intake = intakeBySerial.get(line.serial)
        if (!intake) continue // §5.5.2 W1 trigger: Ombor's actual-weight entry (§5.1)
        const order = orderById.get(line.order_id)
        if (!order) continue

        const result = resultBySerial.get(line.serial)
        if (!result) {
          awaitingRows.push({
            serial: line.serial,
            type_id: line.type_id,
            owner_id: order.owner_id,
            plate: order.plate,
            order_date: order.order_date,
            declared_qty: line.declared_qty,
            actual_qty: intake.actual_qty,
            confirmed_at: intake.confirmed_at,
            target_moisture_pct: line.target_moisture_pct,
            target_so2_mg_kg: line.target_so2_mg_kg,
          })
          continue
        }

        const row: LabResultRow = {
          ...result,
          type_id: line.type_id,
          owner_id: order.owner_id,
          plate: order.plate,
          declared_qty: line.declared_qty,
          actual_qty: intake.actual_qty,
          target_moisture_pct: line.target_moisture_pct,
          target_so2_mg_kg: line.target_so2_mg_kg,
        }
        if (result.status === 'moisture_in') sulfurRows.push(row)
        else finishedRows.push(row)
      }

      // FIFO — oldest arrival first, the one exemption the universal sort
      // rule names explicitly (raw arrival queues).
      setAwaiting([...awaitingRows].sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at)))
      setSulfurPending(sortByDateDesc(sulfurRows, (r) => r.created_at))
      setFinished(sortByDateDesc(finishedRows, (r) => r.created_at))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { awaiting, sulfurPending, finished, loading, refresh }
}
