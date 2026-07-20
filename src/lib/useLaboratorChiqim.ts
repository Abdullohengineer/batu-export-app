import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { sortByDateDesc } from './sortByDate'

// §5.5.3 Laborator CHIQIM (decisive check). Trigger is a FINALIZED wash
// cycle (`wash_cycles.status='final'`, set only via §5.3 Tugallash) — not
// individual pallet saves, which happen continuously through the day and
// would make "jami kg"/"pallet soni" a moving target. Testing the locked
// batch, not a partial one, matches "finished batches awaiting sampling"
// and the manual-only-finishing invariant this app already follows
// everywhere else (see DECISIONS.md).

export interface CyclePallet {
  barcode2: string
  calibre_id: string
  weight_kg: number
}

export interface AwaitingCycle {
  washCycleId: string
  serial: string
  cycleNo: number
  type_id: string
  owner_id: string
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
  pallets: CyclePallet[]
  producedDate: string | null // max received_date among this cycle's pallets
}

export interface ChiqimLabResultRow {
  id: string
  wash_cycle_id: string
  serial: string
  cycleNo: number
  type_id: string
  owner_id: string
  sample_date: string
  moisture_pct: number
  so2_mg_kg: number | null
  sample_photo: string | null
  note: string | null
  sampled_pallet: string | null
  status: 'moisture_in' | 'complete'
  verdict: string | null
  created_at: string
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
  pallets: CyclePallet[]
}

export function useLaboratorChiqim() {
  const [awaiting, setAwaiting] = useState<AwaitingCycle[]>([])
  const [sulfurPending, setSulfurPending] = useState<ChiqimLabResultRow[]>([])
  const [finished, setFinished] = useState<ChiqimLabResultRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: cycles }, { data: results }] = await Promise.all([
        supabase.from('wash_cycles').select('id, serial, cycle_no').eq('status', 'final'),
        supabase
          .from('lab_results')
          .select(
            'id, wash_cycle_id, sample_date, moisture_pct, so2_mg_kg, sample_photo, note, sampled_pallet, status, verdict, created_at',
          )
          .eq('scope', 'chiqim'),
      ])
      if (!cycles || cycles.length === 0) {
        setAwaiting([])
        setSulfurPending([])
        setFinished([])
        return
      }

      const serials = [...new Set(cycles.map((c) => c.serial))]
      const [{ data: lines }, { data: pallets }] = await Promise.all([
        supabase
          .from('kirim_lines')
          .select('serial, order_id, type_id, target_moisture_pct, target_so2_mg_kg')
          .in('serial', serials),
        supabase
          .from('finished_pallets')
          .select('barcode2, serial, wash_cycle, calibre_id, weight_kg, received_date, status')
          .in('serial', serials),
      ])
      const orderIds = [...new Set((lines ?? []).map((l) => l.order_id))]
      const { data: orders } = await supabase.from('kirim_orders').select('order_id, owner_id').in('order_id', orderIds)

      const lineBySerial = new Map((lines ?? []).map((l) => [l.serial, l]))
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
      const resultByCycleId = new Map((results ?? []).map((r) => [r.wash_cycle_id, r]))

      const awaitingRows: AwaitingCycle[] = []
      const sulfurRows: ChiqimLabResultRow[] = []
      const finishedRows: ChiqimLabResultRow[] = []

      for (const cycle of cycles) {
        const line = lineBySerial.get(cycle.serial)
        if (!line) continue
        const order = orderById.get(line.order_id)
        if (!order) continue

        // Non-voided pallets produced in THIS cycle specifically (matches
        // both serial and wash_cycle number) — jami kg/pallet soni describe
        // this batch, not the serial's whole cumulative history.
        const cyclePallets = (pallets ?? []).filter(
          (p) => p.serial === cycle.serial && p.wash_cycle === cycle.cycle_no && p.status !== 'bekor_qilindi',
        )
        const producedDate = cyclePallets.reduce<string | null>(
          (max, p) => (!max || p.received_date > max ? p.received_date : max),
          null,
        )
        const palletList: CyclePallet[] = cyclePallets.map((p) => ({
          barcode2: p.barcode2,
          calibre_id: p.calibre_id,
          weight_kg: p.weight_kg,
        }))

        const result = resultByCycleId.get(cycle.id)
        if (!result) {
          awaitingRows.push({
            washCycleId: cycle.id,
            serial: cycle.serial,
            cycleNo: cycle.cycle_no,
            type_id: line.type_id,
            owner_id: order.owner_id,
            target_moisture_pct: line.target_moisture_pct,
            target_so2_mg_kg: line.target_so2_mg_kg,
            pallets: palletList,
            producedDate,
          })
          continue
        }

        const row: ChiqimLabResultRow = {
          id: result.id,
          wash_cycle_id: cycle.id,
          serial: cycle.serial,
          cycleNo: cycle.cycle_no,
          type_id: line.type_id,
          owner_id: order.owner_id,
          sample_date: result.sample_date,
          moisture_pct: result.moisture_pct,
          so2_mg_kg: result.so2_mg_kg,
          sample_photo: result.sample_photo,
          note: result.note,
          sampled_pallet: result.sampled_pallet,
          status: result.status,
          verdict: result.verdict,
          created_at: result.created_at,
          target_moisture_pct: line.target_moisture_pct,
          target_so2_mg_kg: line.target_so2_mg_kg,
          pallets: palletList,
        }
        if (result.status === 'moisture_in') sulfurRows.push(row)
        else finishedRows.push(row)
      }

      // FIFO for W1 (arrival queue, universal-sort-rule exemption); W2/W3
      // newest-first like every other stage/history list.
      setAwaiting([...awaitingRows].sort((a, b) => (a.producedDate ?? '').localeCompare(b.producedDate ?? '')))
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
