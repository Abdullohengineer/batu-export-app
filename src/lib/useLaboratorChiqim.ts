import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'
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

// KIRIM-stage lab reading (2026-08-29, Prompt 6) -- read-only display
// alongside the CHIQIM (Sera) test, same source/shape useLaboratorKirim.ts
// already reads (lab_results scope='kirim', keyed by parent_serial, latest
// created_at wins). Descriptive only, no verdict here either.
interface RawKirimLabResult {
  parent_serial: string
  moisture_pct: number
  so2_mg_kg: number | null
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
  // KIRIM-stage reading for this serial (2026-08-29) -- null when none
  // exists (e.g. an old-stock re-wash serial minted with no KIRIM lab pass),
  // display "—" in that case, never "0".
  kirimMoisturePct: number | null
  kirimSo2MgKg: number | null
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
  // Same KIRIM-stage reading as AwaitingSerial above, carried through once a
  // serial has a CHIQIM result too.
  kirimMoisturePct: number | null
  kirimSo2MgKg: number | null
}

interface LaboratorChiqimData {
  awaiting: AwaitingSerial[]
  sulfurPending: ChiqimLabResultRow[]
  finished: ChiqimLabResultRow[]
}

const EMPTY_LABORATOR_CHIQIM: LaboratorChiqimData = { awaiting: [], sulfurPending: [], finished: [] }

// 2026-09-21 (Phase 2 step 5) -- moved onto React Query, no query params
// (one shared key). The old monotonic request-id guard (refresh() is also
// called by mutation handlers handleTahlil/handleSera, so a per-effect
// `cancelled` closure couldn't cover every call site) is dropped -- React
// Query already serializes fetches per query key.
export function useLaboratorChiqim() {
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.laboratorChiqim(),
    queryFn: async ({ signal }): Promise<LaboratorChiqimData> => {
      const [{ data: cycles, error: cyclesErr }, { data: sends, error: sendsErr }] = await Promise.all([
        // Path E cheat version (see DECISIONS.md "Path E cheat: multi-cycle
        // wash_cycles scoping") — cycle_no/opened_at added. This loop
        // already iterates one row per wash_cycles row (not per serial),
        // so a twice-processed serial already produces two queue rows for
        // free; what needed fixing is sentKg/sentDate below, which used to
        // be an unbounded whole-serial sum shared identically by both rows.
        supabase.from('wash_cycles').select('id, serial, cycle_no, opened_at').order('cycle_no').abortSignal(signal),
        supabase.from('moyka_sends').select('serial, qty_kg, sent_date').abortSignal(signal),
      ])
      if (cyclesErr) throw new Error(cyclesErr.message)
      if (sendsErr) throw new Error(sendsErr.message)
      if (!cycles || cycles.length === 0) {
        return EMPTY_LABORATOR_CHIQIM
      }

      // Same cycle-window boundary rule as useMoykaOutput.ts: each cycle
      // owns [opened_at, next cycle's opened_at) — never closed_at, which
      // is "when Yakunlash was clicked," not "when the next cycle's
      // material actually started arriving."
      const cyclesBySerial = new Map<string, { id: string; openedAt: string; nextOpenedAt: string | null }[]>()
      for (const c of cycles) {
        const list = cyclesBySerial.get(c.serial) ?? []
        list.push({ id: c.id, openedAt: c.opened_at, nextOpenedAt: null })
        cyclesBySerial.set(c.serial, list)
      }
      for (const list of cyclesBySerial.values()) {
        for (let i = 0; i < list.length - 1; i++) list[i].nextOpenedAt = list[i + 1].openedAt
      }
      const sentByCycleId = new Map<string, number>()
      const earliestSentDateByCycleId = new Map<string, string>()
      for (const list of cyclesBySerial.values()) {
        for (const w of list) {
          const windowSends = (sends ?? []).filter(
            (s) =>
              s.sent_date >= w.openedAt.slice(0, 10) && (w.nextOpenedAt === null || s.sent_date < w.nextOpenedAt.slice(0, 10)),
          )
          sentByCycleId.set(
            w.id,
            windowSends.reduce((sum, s) => sum + s.qty_kg, 0),
          )
          const earliest = windowSends.reduce<string | null>((min, s) => (!min || s.sent_date < min ? s.sent_date : min), null)
          if (earliest) earliestSentDateByCycleId.set(w.id, earliest)
        }
      }

      const serials = [...new Set(cycles.map((c) => c.serial))]
      const [
        { data: lines, error: linesErr },
        { data: results, error: resultsErr },
        { data: kirimResults, error: kirimResultsErr },
      ] = await Promise.all([
        supabase
          .from('kirim_lines')
          .select('serial, order_id, type_id, target_moisture_pct, target_so2_mg_kg, is_sulfured, partiya_no')
          .in('serial', serials)
          // Structurally redundant (this queue is anchored on wash_cycles,
          // which enforce_serial_process forbids for Rezka serials) but kept
          // explicit, same reasoning as lab_turnaround_avg's origin filter.
          .neq('process', 'rezka')
          .abortSignal(signal),
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
          .order('created_at', { ascending: false })
          .abortSignal(signal),
        supabase
          .from('lab_results')
          .select('parent_serial, moisture_pct, so2_mg_kg, created_at')
          .eq('scope', 'kirim')
          .in('parent_serial', serials)
          .order('created_at', { ascending: false })
          .abortSignal(signal),
      ])
      if (linesErr) throw new Error(linesErr.message)
      if (resultsErr) throw new Error(resultsErr.message)
      if (kirimResultsErr) throw new Error(kirimResultsErr.message)
      const orderIds = [...new Set((lines ?? []).map((l) => l.order_id))]
      const { data: orders, error: ordersErr } = await supabase
        .from('kirim_orders')
        .select('order_id, owner_id')
        .in('order_id', orderIds)
        .abortSignal(signal)
      if (ordersErr) throw new Error(ordersErr.message)

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
      // Same latest-wins pattern, keyed by parent_serial — mirrors
      // useLaboratorKirim.ts's own resultBySerial map.
      const latestKirimResultBySerial = new Map<string, RawKirimLabResult>()
      for (const r of (kirimResults ?? []) as RawKirimLabResult[]) {
        if (!latestKirimResultBySerial.has(r.parent_serial)) latestKirimResultBySerial.set(r.parent_serial, r)
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
        const kirimResult = latestKirimResultBySerial.get(cycle.serial)

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
            sentKg: sentByCycleId.get(cycle.id) ?? 0,
            sentDate: earliestSentDateByCycleId.get(cycle.id) ?? '',
            rejected: !!result,
            kirimMoisturePct: kirimResult?.moisture_pct ?? null,
            kirimSo2MgKg: kirimResult?.so2_mg_kg ?? null,
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
          kirimMoisturePct: kirimResult?.moisture_pct ?? null,
          kirimSo2MgKg: kirimResult?.so2_mg_kg ?? null,
        }
        if (result.status === 'moisture_in') sulfurRows.push(row)
        else finishedRows.push(row)
      }

      // FIFO for W1 (arrival queue, universal-sort-rule exemption); W2/W3
      // newest-first like every other stage/history list.
      return {
        awaiting: [...awaitingRows].sort((a, b) => a.sentDate.localeCompare(b.sentDate)),
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
