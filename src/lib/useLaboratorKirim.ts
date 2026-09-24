import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'
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
  partiyaNo: number | null
  owner_id: string
  plate: string
  order_date: string
  declared_qty: number
  actual_qty: number | null // Ombor's own intake weight, if accepted yet — informational only, no longer the trigger
  gruzheny_kg: number | null // gate stage 1 weight — null means visible but not yet enterable
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
  // Explicit natural/sulphured flag (2026-08-14), replacing the
  // target_so2_mg_kg-is-null inference. null = not yet classified — every
  // consumer must treat it as sulfured (show the field), never as natural.
  // See DECISIONS.md "Client quality targets removed from Menejer/
  // Laborator; explicit natural/sulphured flag".
  is_sulfured: boolean | null
}

interface RawLabResult {
  id: string
  parent_serial: string
  sample_date: string
  moisture_pct: number
  so2_mg_kg: number | null
  sample_photo: string | null
  note: string | null
  status: 'moisture_in' | 'complete'
  created_at: string
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
  partiyaNo: number | null
  owner_id: string
  plate: string
  declared_qty: number
  actual_qty: number | null
  target_moisture_pct: number | null
  target_so2_mg_kg: number | null
  is_sulfured: boolean | null
}

interface LaboratorKirimData {
  awaiting: AwaitingLine[]
  sulfurPending: LabResultRow[]
  finished: LabResultRow[]
}

// 2026-09-21 (Phase 2 step 5) -- moved onto React Query, no query params
// (one shared key). The old monotonic request-id guard (refresh() is also
// called by mutation handlers, so a per-effect `cancelled` closure
// couldn't cover every call site) is dropped -- React Query already
// serializes fetches per query key.
export function useLaboratorKirim() {
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.laboratorKirim(),
    queryFn: async ({ signal }): Promise<LaboratorKirimData> => {
      const [{ data: lines, error: linesErr }, { data: intakes }, { data: weighings }, { data: results }] = await Promise.all([
        supabase
          .from('kirim_lines')
          .select('serial, order_id, type_id, declared_qty, target_moisture_pct, target_so2_mg_kg, is_sulfured, partiya_no')
          // Rezka lines never enter any Laborator queue (Rezka has no lab,
          // SPEC.md "Rezka"). A process='rezka' delivery line is otherwise a
          // real truck that passes the origin='delivery' allowlist below.
          .neq('process', 'rezka')
          .abortSignal(signal),
        supabase.from('storage_intake').select('serial, actual_qty').abortSignal(signal),
        supabase.from('gate_weighings').select('order_id, gruzheny_kg').eq('dir', 'kirim').abortSignal(signal),
        supabase
          .from('lab_results')
          .select('id, parent_serial, sample_date, moisture_pct, so2_mg_kg, sample_photo, note, status, created_at')
          .eq('scope', 'kirim')
          // Newest first, first-kept-per-serial wins -- same latest-wins
          // pattern as labVerdict.ts's currentLabStatus and
          // useLaboratorChiqim.ts's own resultByCycleId (2026-08-03, lab
          // edit action). Editing a Yakunlangan record inserts a
          // superseding row rather than overwriting (traceability for
          // quality records that feed client reports) -- without this
          // ordering, a plain last-in-array Map build would resolve
          // non-deterministically between the original and the correction.
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      ])
      if (linesErr) throw new Error(linesErr.message)

      const intakeBySerial = new Map((intakes ?? []).map((i) => [i.serial, i]))
      const resultBySerial = new Map<string, RawLabResult>()
      for (const r of (results ?? []) as RawLabResult[]) {
        if (!resultBySerial.has(r.parent_serial)) resultBySerial.set(r.parent_serial, r)
      }
      const gruzhenyByOrder = new Map((weighings ?? []).map((w) => [w.order_id, w.gruzheny_kg]))

      const orderIds = [...new Set((lines ?? []).map((l) => l.order_id))]
      const { data: orders, error: ordersErr } = await supabase
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
        .abortSignal(signal)
      if (ordersErr) throw new Error(ordersErr.message)
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
            partiyaNo: line.partiya_no,
            owner_id: order.owner_id,
            plate: order.plate,
            order_date: order.order_date,
            declared_qty: line.declared_qty,
            actual_qty: intakeBySerial.get(line.serial)?.actual_qty ?? null,
            gruzheny_kg: gruzhenyByOrder.get(line.order_id) ?? null,
            target_moisture_pct: line.target_moisture_pct,
            target_so2_mg_kg: line.target_so2_mg_kg,
            is_sulfured: line.is_sulfured,
          })
          continue
        }

        const row: LabResultRow = {
          ...result,
          type_id: line.type_id,
          partiyaNo: line.partiya_no,
          owner_id: order.owner_id,
          plate: order.plate,
          declared_qty: line.declared_qty,
          actual_qty: intakeBySerial.get(line.serial)?.actual_qty ?? null,
          target_moisture_pct: line.target_moisture_pct,
          target_so2_mg_kg: line.target_so2_mg_kg,
          is_sulfured: line.is_sulfured,
        }
        if (result.status === 'moisture_in') sulfurRows.push(row)
        else finishedRows.push(row)
      }

      // FIFO — oldest ARRIVAL first (order_date), the arrival queue's own
      // exemption from the universal newest-first sort. No longer keyed to
      // intake confirmation, which may not have happened yet.
      return {
        awaiting: [...awaitingRows].sort((a, b) => a.order_date.localeCompare(b.order_date)),
        sulfurPending: sortByDateDesc(sulfurRows, (r) => r.created_at),
        finished: sortByDateDesc(finishedRows, (r) => r.created_at),
      }
    },
  })

  return {
    awaiting: data?.awaiting ?? [],
    sulfurPending: data?.sulfurPending ?? [],
    finished: data?.finished ?? [],
    loading: isPending,
    refreshing: isFetching && !isPending,
    error: error ? error.message : null,
    refresh: refetch,
  }
}
