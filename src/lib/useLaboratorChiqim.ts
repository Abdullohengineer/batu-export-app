import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { sortByDateDesc } from './sortByDate'

// §5.5.3 Laborator CHIQIM (decisive check). Trigger changed (2026-07-28,
// Laborator v2 — see DECISIONS.md "Lab moves inside Moyka, wash-cycle
// concept removed"): a serial's wash_cycles row now exists as soon as it is
// FIRST sent to Moyka (OmborMoykaTab.tsx's send action mints it, status
// 'active'), not at Tugallash — CHIQIM lab testing is enterable immediately,
// well before any pallet exists. There is nothing to sample a specific
// pallet from anymore; "jami kg" here is the serial's total sent-to-Moyka
// weight, not a pallet sum.

interface RawLabResult {
  id: string
  wash_cycle_id: string
  sample_date: string
  moisture_pct: number
  so2_mg_kg: number | null
  sample_photo: string | null
  note: string | null
  sampled_pallet: string | null
  status: 'moisture_in' | 'complete'
  verdict: string | null
  created_at: string
}

export interface AwaitingSerial {
  washCycleId: string
  serial: string
  type_id: string
  partiyaNo: number | null
  owner_id: string
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
  // Explicit natural/sulphured flag (2026-08-14), replacing the
  // target_so2_mg_kg-is-null inference. null = not yet classified — every
  // consumer must treat it as sulfured (defer verdict, show the field),
  // never as natural. See DECISIONS.md "Client quality targets removed
  // from Menejer/Laborator; explicit natural/sulphured flag".
  is_sulfured: boolean | null
  sentKg: number // Σ moyka_sends.qty_kg for this serial — the batch size Laborator sees, no pallets exist yet
  sentDate: string // earliest moyka_sends.sent_date for this serial — FIFO sort key
  rejected: boolean // true when this serial's LATEST verdict was qayta_yuvish — awaiting RE-test, not a first-time one
}

export interface ChiqimLabResultRow {
  id: string
  wash_cycle_id: string
  serial: string
  type_id: string
  partiyaNo: number | null
  owner_id: string
  sample_date: string
  moisture_pct: number
  so2_mg_kg: number | null
  sample_photo: string | null
  note: string | null
  sampledPallet: string | null // free-text sample source now (e.g. "tank 3") — no real pallet exists at test time
  status: 'moisture_in' | 'complete'
  verdict: string | null
  created_at: string
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
  is_sulfured: boolean | null
}

export function useLaboratorChiqim() {
  const [awaiting, setAwaiting] = useState<AwaitingSerial[]>([])
  const [sulfurPending, setSulfurPending] = useState<ChiqimLabResultRow[]>([])
  const [finished, setFinished] = useState<ChiqimLabResultRow[]>([])
  const [loading, setLoading] = useState(true)
  // 🔒 See useMoykaOutput.ts's identical guard for the full explanation --
  // refresh is exposed for mutation handlers (handleTahlil/handleSera) to
  // call too, so a per-effect `cancelled` closure can't cover every call
  // site. A monotonic request id ensures only the most-recently-started
  // call ever commits state, regardless of resolution order.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const [{ data: cycles }, { data: sends }] = await Promise.all([
        supabase.from('wash_cycles').select('id, serial'),
        supabase.from('moyka_sends').select('serial, qty_kg, sent_date'),
      ])
      if (!cycles || cycles.length === 0) {
        if (requestIdRef.current === requestId) {
          setAwaiting([])
          setSulfurPending([])
          setFinished([])
        }
        return
      }

      const sentBySerial = new Map<string, number>()
      const earliestSentDateBySerial = new Map<string, string>()
      for (const s of sends ?? []) {
        sentBySerial.set(s.serial, (sentBySerial.get(s.serial) ?? 0) + s.qty_kg)
        const prev = earliestSentDateBySerial.get(s.serial)
        if (!prev || s.sent_date < prev) earliestSentDateBySerial.set(s.serial, s.sent_date)
      }

      const serials = [...new Set(cycles.map((c) => c.serial))]
      const [{ data: lines }, { data: results }] = await Promise.all([
        supabase
          .from('kirim_lines')
          .select('serial, order_id, type_id, target_moisture_pct, target_so2_mg_kg, is_sulfured, partiya_no')
          .in('serial', serials),
        supabase
          .from('lab_results')
          .select(
            'id, wash_cycle_id, sample_date, moisture_pct, so2_mg_kg, sample_photo, note, sampled_pallet, status, verdict, created_at',
          )
          .eq('scope', 'chiqim')
          .in(
            'wash_cycle_id',
            cycles.map((c) => c.id),
          )
          .order('created_at', { ascending: false }),
      ])
      const orderIds = [...new Set((lines ?? []).map((l) => l.order_id))]
      const { data: orders } = await supabase.from('kirim_orders').select('order_id, owner_id').in('order_id', orderIds)

      const lineBySerial = new Map((lines ?? []).map((l) => [l.serial, l]))
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
      // Latest lab_results row per wash_cycle_id wins — results are already
      // ordered newest-first, so the first kept per id is current. A reject
      // followed by a re-test is a NEW row against the SAME wash_cycle_id,
      // never a second wash_cycles row (see labVerdict.ts).
      const latestResultByCycleId = new Map<string, RawLabResult>()
      for (const r of (results ?? []) as RawLabResult[]) {
        if (!latestResultByCycleId.has(r.wash_cycle_id)) latestResultByCycleId.set(r.wash_cycle_id, r)
      }

      const awaitingRows: AwaitingSerial[] = []
      const sulfurRows: ChiqimLabResultRow[] = []
      const finishedRows: ChiqimLabResultRow[] = []

      for (const cycle of cycles) {
        const line = lineBySerial.get(cycle.serial)
        if (!line) continue
        const order = orderById.get(line.order_id)
        if (!order) continue

        // A serial belongs back in Window 1 either because it's never been
        // tested at all, OR because its LATEST verdict was a reject — a
        // reject touches no pallets (none exist yet), so the only way it
        // "reappears for re-test" is by re-entering this same awaiting set,
        // immediately, with no Ombor action in between (see DECISIONS.md
        // "Lab moves inside Moyka, wash-cycle concept removed").
        // `rejected` lets the UI highlight this distinctly from a
        // first-time test.
        const result = latestResultByCycleId.get(cycle.id)
        if (!result || result.verdict === 'qayta_yuvish') {
          awaitingRows.push({
            washCycleId: cycle.id,
            serial: cycle.serial,
            type_id: line.type_id,
            partiyaNo: line.partiya_no,
            owner_id: order.owner_id,
            target_moisture_pct: line.target_moisture_pct,
            target_so2_mg_kg: line.target_so2_mg_kg,
            is_sulfured: line.is_sulfured,
            sentKg: sentBySerial.get(cycle.serial) ?? 0,
            sentDate: earliestSentDateBySerial.get(cycle.serial) ?? '',
            rejected: !!result,
          })
          continue
        }

        const row: ChiqimLabResultRow = {
          id: result.id,
          wash_cycle_id: cycle.id,
          serial: cycle.serial,
          type_id: line.type_id,
          partiyaNo: line.partiya_no,
          owner_id: order.owner_id,
          sample_date: result.sample_date,
          moisture_pct: result.moisture_pct,
          so2_mg_kg: result.so2_mg_kg,
          sample_photo: result.sample_photo,
          note: result.note,
          sampledPallet: result.sampled_pallet,
          status: result.status,
          verdict: result.verdict,
          created_at: result.created_at,
          target_moisture_pct: line.target_moisture_pct,
          target_so2_mg_kg: line.target_so2_mg_kg,
          is_sulfured: line.is_sulfured,
        }
        if (result.status === 'moisture_in') sulfurRows.push(row)
        else finishedRows.push(row)
      }

      // FIFO for W1 (arrival queue, universal-sort-rule exemption); W2/W3
      // newest-first like every other stage/history list.
      if (requestIdRef.current !== requestId) return
      setAwaiting([...awaitingRows].sort((a, b) => a.sentDate.localeCompare(b.sentDate)))
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
