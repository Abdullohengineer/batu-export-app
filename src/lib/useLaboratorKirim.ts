import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { sortByDateDesc } from './sortByDate'

// §5.5.2 Laborator KIRIM (descriptive check). W1 is a FIFO arrival queue —
// exempt from the universal newest-first sort (SPEC.md §5 intro named
// invariant), same exemption class as gate/receiving queues.
//
// Trigger changed (2026-07-28, Laborator v2 — see DECISIONS.md "Lab moves
// inside Moyka, wash-cycle concept removed"): VISIBLE as soon as Menejer
// creates the KIRIM order (the line exists), ENTERABLE once gate stage 1
// (Гружёный weigh) completes — the same "show the row, grey out the action
// until ready" pattern OmborIntakeTab.tsx already uses for its own gate-1
// wait. No longer tied to Ombor's own intake accept, which can now happen
// later than the lab's own sampling of the raw pile.

export interface AwaitingLine {
  serial: string
  type_id: string
  owner_id: string
  plate: string
  order_date: string
  declared_qty: number
  actual_qty: number | null // Ombor's own intake weight, if accepted yet — informational only, no longer the trigger
  gruzheny_kg: number | null // gate stage 1 weight — null means visible but not yet enterable
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
  // FIFO/gate fields which no longer matter once sampled.
  type_id: string
  owner_id: string
  plate: string
  declared_qty: number
  actual_qty: number | null
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
}

export function useLaboratorKirim() {
  const [awaiting, setAwaiting] = useState<AwaitingLine[]>([])
  const [sulfurPending, setSulfurPending] = useState<LabResultRow[]>([])
  const [finished, setFinished] = useState<LabResultRow[]>([])
  const [loading, setLoading] = useState(true)
  // 🔒 See useMoykaOutput.ts's identical guard for the full explanation --
  // refresh is exposed for mutation handlers to call too, so a per-effect
  // `cancelled` closure can't cover every call site.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const [{ data: lines }, { data: intakes }, { data: weighings }, { data: results }] = await Promise.all([
        supabase
          .from('kirim_lines')
          .select('serial, order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg'),
        supabase.from('storage_intake').select('serial, actual_qty'),
        supabase.from('gate_weighings').select('order_id, gruzheny_kg').eq('dir', 'kirim'),
        supabase
          .from('lab_results')
          .select('id, parent_serial, sample_date, moisture_pct, so2_mg_kg, sample_photo, note, status, created_at')
          .eq('scope', 'kirim'),
      ])

      const intakeBySerial = new Map((intakes ?? []).map((i) => [i.serial, i]))
      const resultBySerial = new Map((results ?? []).map((r) => [r.parent_serial, r]))
      const gruzhenyByOrder = new Map((weighings ?? []).map((w) => [w.order_id, w.gruzheny_kg]))

      const orderIds = [...new Set((lines ?? []).map((l) => l.order_id))]
      const { data: orders } = await supabase
        .from('kirim_orders')
        .select('order_id, order_date, plate, owner_id, origin')
        .in('order_id', orderIds)
        // Opening stock (Stage 1) and internal_reprocess (Stage 3) never had
        // a real arrival for Laborator to sample — opening_stock has no gate
        // event at all (most lines sit forever behind the "awaiting gate"
        // note below), and the one line that does (old raw's synthetic
        // gate_weighings row, added purely so effective_qty resolves final —
        // see migration 0048) would otherwise show up fully actionable here
        // with a live "Tahlil" button on fabricated stock. Same positive
        // allowlist as useKirimTrips/useIntakeLines.
        .eq('origin', 'delivery')
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))

      const awaitingRows: AwaitingLine[] = []
      const sulfurRows: LabResultRow[] = []
      const finishedRows: LabResultRow[] = []

      for (const line of lines ?? []) {
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
            actual_qty: intakeBySerial.get(line.serial)?.actual_qty ?? null,
            gruzheny_kg: gruzhenyByOrder.get(line.order_id) ?? null,
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
          actual_qty: intakeBySerial.get(line.serial)?.actual_qty ?? null,
          target_moisture_pct: line.target_moisture_pct,
          target_so2_mg_kg: line.target_so2_mg_kg,
        }
        if (result.status === 'moisture_in') sulfurRows.push(row)
        else finishedRows.push(row)
      }

      // FIFO — oldest ARRIVAL first (order_date), the arrival queue's own
      // exemption from the universal newest-first sort. No longer keyed to
      // intake confirmation, which may not have happened yet.
      if (requestIdRef.current !== requestId) return
      setAwaiting([...awaitingRows].sort((a, b) => a.order_date.localeCompare(b.order_date)))
      setSulfurPending(sortByDateDesc(sulfurRows, (r) => r.created_at))
      setFinished(sortByDateDesc(finishedRows, (r) => r.created_at))
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { awaiting, sulfurPending, finished, loading, refresh }
}
