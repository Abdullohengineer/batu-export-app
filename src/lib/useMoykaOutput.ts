import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'
import { jarayonda, ortiqcha } from './tayyorCompletion'
import { sortByDateDesc, maxDate } from './sortByDate'
import { isInMoyka } from './stageMembership'
import { currentLabStatus, type LabGateStatus } from './labVerdict'

const EMPTY_SERIALS: OutputSerial[] = []

export interface FinishedPallet {
  barcode2: string
  calibre_id: string
  weight_kg: number
  received_date: string
  // Real receipt timestamp (2026-08-29, Prompt 9) -- `received_date` above
  // is a plain `date` (day granularity), which can't order two same-day
  // pallets for the same serial. `finished_pallets.created_at` (added in
  // the FIFO migration, 0087) already exists and is already fetched
  // nowhere else in this hook -- one more column on the same select, no
  // new read.
  created_at: string
}

export interface OutputSerial {
  serial: string
  cycleNo: number // wash_cycles.cycle_no (Path E cheat version, see DECISIONS.md
  // "Path E cheat: multi-cycle wash_cycles scoping"). 1 for every ordinary
  // serial — a second, admin-only value only ever exists after a manual
  // residual-reprocess incident (open_second_wash_cycle). ONE ROW PER
  // (serial, cycleNo) now, not per serial — a twice-processed serial
  // appears here twice, each row scoped to its own cycle's own activity.
  type_id: string
  partiyaNo: number | null
  category_id: string
  owner_id: string
  labStatus: LabGateStatus // Laborator v2 (2026-07-28): hard gate on Barcode #2 assignment —
  // 'passed' required before this serial can be packed; OmborTayyorTab.tsx reads this to gate the receive action.
  // Opening stock, Stage 3 (2026-08-02): origin='internal_reprocess' — this
  // serial was minted from consumed old-stock pallets, not delivered. Read
  // by OmborTayyorTab so every pallet packed out of it gets a note
  // recording its old-stock lineage.
  isMinted: boolean
  closedAt: string | null // THIS ROW'S OWN CYCLE'S wash_cycles.closed_at (2026-08-29,
  // Prompt 10 — see DECISIONS.md "Serial close-out (Yakunlash)"; cycle-scoped,
  // Path E cheat version). null = still open (unrealized gap, Moykada); set =
  // closed (realized, Yo'qotish). Drives isInMoyka's third param and
  // computeLossDisplay everywhere this hook's data reaches.
  sent: number // Yuborilgan — Σ moyka_sends.qty_kg WITHIN THIS CYCLE'S OWN WINDOW
  // ([opened_at, next cycle's opened_at) or [opened_at, +inf) for the
  // latest cycle) — cycle-scoped, Path E cheat version. For every
  // single-cycle serial this is identical to the old whole-serial sum
  // (opened_at is backfilled to the earliest send, so the lower bound is a
  // no-op, and there is no next cycle to bound above).
  received: number // Qabul qilingan — Σ finished_pallets.weight_kg, non-void,
  // WITHIN THIS CYCLE'S OWN WINDOW (same cycle-scoping as sent, Path E cheat
  // version). Deliberately still counts 'consumed' pallets (only
  // 'bekor_qilindi' is skipped): status is a CURRENT-LOCATION field, not a
  // did-this-happen field. A pallet later consumed into a re-wash was still
  // genuinely produced by THIS serial's THIS cycle, and its locked
  // final_loss_pct must not move retroactively. Same reasoning as
  // yield_rows.output, which likewise applies no status filter. See DECISIONS.md
  // "Opening stock, Stage 3".
  inProcess: number // Jarayonda — max(0, sent − received), this cycle's own; never negative (see DECISIONS)
  excess: number // Ortiqcha — max(0, received − sent), this cycle's own; non-blocking overage flag
  pallets: FinishedPallet[] // this cycle's own pallets (cycle-scoped by received_date window)
  lastActivityDate: string | null // max(last moyka_sends.sent_date, last finished_pallets.received_date)
  // WITHIN THIS CYCLE — used to sort this list newest-first (DECISIONS "Universal sort rule").
  barcodeSeqByCalibre: Record<string, number> // count of every pallet ever made for this SERIAL
  // (whole-serial, deliberately NOT cycle-scoped, Path E cheat version) — a
  // barcode2 is a permanent PK, so the next barcode's sequence number must
  // never collide with a prior CYCLE's pallets either, not just a prior
  // save within the same cycle. Identical across every cycle-row of the
  // same serial.
}

// §5.3 data: serials sent to Moyka (Step 5). No more manual finish event
// (DECISIONS.md "Moyka loss becomes live; remove Tugallash") — a serial's
// live in-Moyka balance (sent − received) just floats; nothing here closes
// it out. All totals DERIVED (CLAUDE.md "derive, don't store"). Sorted
// newest-first (DECISIONS "Universal sort rule").
//
// Two views over the SAME fetched/derived set (2026-08-29, Prompt 9, see
// DECISIONS.md "Restore Ombor Tayyor Window 2..."): `serials` (positive
// live in-Moyka balance, isInMoyka — the receive-picker's own membership,
// UNCHANGED) and `receivedSerials` (received > 0, regardless of balance —
// Window 2's membership, including serials fully received down to 0). Both
// are filtered `useMemo` views of one `allSerials` array built for every
// serial in this fetch, not two separate queries — no new database read.
//
// Wash-cycle scoping removed (2026-07-28, Laborator v2 — see DECISIONS.md
// "Lab moves inside Moyka, wash-cycle concept removed"): re-washing now
// happens invisibly inside Moyka, so every send/pallet for a serial belongs
// to the same single balance for its whole life — no more active-cycle
// derivation (the old fetchActiveCycles/rewash.ts, both deleted).
// 2026-09-21 (Phase 2 step 2) -- moved onto React Query, no query params
// (one shared key, see queryClient.ts). This is also what replaces the old
// monotonic request-id guard: that existed only because refresh() is called
// both from the mount effect and from mutation handlers elsewhere
// (handleSend/handleReceipt), and a plain per-effect `cancelled` closure
// can't cover both call sites -- React Query already serializes fetches per
// query key internally, so an in-flight fetch can never be clobbered by an
// earlier one's late resolution.
export function useMoykaOutput() {
  const { data, isPending, refetch } = useQuery({
    queryKey: queryKeys.moykaOutput(),
    // 60s, visible-tab-only -- see useIntakeLines.ts's identical comment.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<OutputSerial[]> => {
      const [{ data: sends }, { data: pallets }] = await Promise.all([
        supabase.from('moyka_sends').select('serial, qty_kg, sent_date'),
        supabase.from('finished_pallets').select('barcode2, serial, calibre_id, weight_kg, received_date, created_at, status'),
      ])

      // Anchored on sends, unchanged from before Path E — a wash_cycles row
      // with no send yet (the brief window right after an admin runs
      // open_second_wash_cycle but before the residual is actually sent)
      // simply doesn't surface here, same as a first-ever cycle never did.
      const serialList = [...new Set((sends ?? []).map((s) => s.serial))]
      if (serialList.length === 0) {
        return []
      }

      const labStatusBySerial = await currentLabStatus(serialList)

      const { data: kLines } = await supabase
        .from('kirim_lines')
        .select('serial, order_id, type_id, partiya_no')
        .in('serial', serialList)
      const orderIds = [...new Set((kLines ?? []).map((l) => l.order_id))]
      const [{ data: orders }, { data: types }, { data: cycles }] = await Promise.all([
        supabase.from('kirim_orders').select('order_id, owner_id, origin').in('order_id', orderIds),
        supabase.from('product_types').select('id, category_id'),
        // Path E cheat version (see DECISIONS.md "Path E cheat: multi-cycle
        // wash_cycles scoping") — id/cycle_no/opened_at/closed_at, not just
        // serial/closed_at. Ordered so cycle N's own window end (exclusive)
        // is cycle N+1's opened_at, same boundary rule the SQL-side
        // functions (client_serial_loss_kg etc.) use — never closed_at,
        // which is "when Yakunlash was clicked," not "when the next
        // cycle's material actually started arriving."
        supabase.from('wash_cycles').select('id, serial, cycle_no, opened_at, closed_at').in('serial', serialList).order('cycle_no'),
      ])

      const lineBySerial = new Map((kLines ?? []).map((l) => [l.serial, l]))
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
      const categoryByType = new Map((types ?? []).map((t) => [t.id, t.category_id]))

      interface CycleWindow {
        cycleNo: number
        openedAt: string
        closedAt: string | null
        // Exclusive upper bound — the next cycle's own opened_at, or null
        // for the latest cycle (unbounded above, matching every
        // single-cycle serial's original whole-serial-lifetime behavior).
        nextOpenedAt: string | null
      }
      const cyclesBySerial = new Map<string, CycleWindow[]>()
      for (const c of cycles ?? []) {
        const list = cyclesBySerial.get(c.serial) ?? []
        list.push({ cycleNo: c.cycle_no, openedAt: c.opened_at, closedAt: c.closed_at, nextOpenedAt: null })
        cyclesBySerial.set(c.serial, list)
      }
      for (const list of cyclesBySerial.values()) {
        list.sort((a, b) => a.cycleNo - b.cycleNo)
        for (let i = 0; i < list.length - 1; i++) list[i].nextOpenedAt = list[i + 1].openedAt
      }
      function inWindow(date: string, w: CycleWindow) {
        return date >= w.openedAt.slice(0, 10) && (w.nextOpenedAt === null || date < w.nextOpenedAt.slice(0, 10))
      }

      // Every pallet ever made for a (serial, calibre) — barcode2 is a
      // permanent PK, so the next barcode's sequence number must never
      // collide with a prior one, WHOLE-SERIAL, across every cycle (Path E
      // cheat version — deliberately NOT cycle-scoped, unlike everything
      // else in this hook).
      const barcodeSeqBySerial = new Map<string, Record<string, number>>()
      for (const p of pallets ?? []) {
        const bySerial = barcodeSeqBySerial.get(p.serial) ?? {}
        bySerial[p.calibre_id] = (bySerial[p.calibre_id] ?? 0) + 1
        barcodeSeqBySerial.set(p.serial, bySerial)
      }

      const livePallets = (pallets ?? []).filter((p) => p.status !== 'bekor_qilindi')

      // One row per (serial, cycle) — every field below is scoped to that
      // one cycle's own date window (see inWindow), except
      // barcodeSeqByCalibre (whole-serial, see above).
      const combined: OutputSerial[] = []
      for (const serial of serialList) {
        const line = lineBySerial.get(serial)
        if (!line) continue
        const order = orderById.get(line.order_id)
        if (!order) continue

        const serialCycles = cyclesBySerial.get(serial) ?? []
        for (const w of serialCycles) {
          const cycleSends = (sends ?? []).filter((s) => s.serial === serial && inWindow(s.sent_date, w))
          const cyclePallets = livePallets
            .filter((p) => p.serial === serial && inWindow(p.received_date, w))
            .map((p) => ({
              barcode2: p.barcode2,
              calibre_id: p.calibre_id,
              weight_kg: p.weight_kg,
              received_date: p.received_date,
              created_at: p.created_at,
            }))

          const sent = cycleSends.reduce((sum, s) => sum + s.qty_kg, 0)
          const received = cyclePallets.reduce((sum, p) => sum + p.weight_kg, 0)
          const lastSentDate = cycleSends.reduce<string | null>((max, s) => (!max || s.sent_date > max ? s.sent_date : max), null)
          const lastReceivedDate = cyclePallets.reduce<string | null>(
            (max, p) => (!max || p.received_date > max ? p.received_date : max),
            null,
          )

          combined.push({
            serial,
            cycleNo: w.cycleNo,
            type_id: line.type_id,
            partiyaNo: line.partiya_no,
            owner_id: order.owner_id,
            isMinted: order.origin === 'internal_reprocess',
            closedAt: w.closedAt,
            labStatus: labStatusBySerial.get(serial) ?? 'untested',
            sent,
            received,
            pallets: cyclePallets,
            barcodeSeqByCalibre: barcodeSeqBySerial.get(serial) ?? {},
            category_id: categoryByType.get(line.type_id) ?? '',
            inProcess: jarayonda(sent, received),
            excess: ortiqcha(sent, received),
            lastActivityDate: maxDate(lastSentDate, lastReceivedDate),
          })
        }
      }

      // Universal sort rule (DECISIONS "Universal sort rule", SPEC.md §5
      // intro): every stage/history list sorts newest-first. Sorted once
      // here, at the shared hook, so every consumer of `allSerials` (§5.2
      // Window 2, §5.3 Window 1, §5.3's new Window 2 — section mirroring)
      // inherits it without re-sorting.
      return sortByDateDesc(combined, (s) => s.lastActivityDate)
    },
  })
  // `?? EMPTY_SERIALS` (a stable module-level reference), not `?? []` -- a
  // fresh literal on every render with no data yet would change identity on
  // every render and defeat the useMemo below (flagged by
  // react-hooks/exhaustive-deps).
  const allSerials = data ?? EMPTY_SERIALS

  // Two filtered views of the one fetched/sorted set (2026-08-29, Prompt 9)
  // — see this hook's own header comment. `serials`: §5.3 Window 1's
  // receive-picker membership, unchanged (isInMoyka). `receivedSerials`:
  // §5.3's restored Window 2 — every serial that has ever received
  // anything, balance irrelevant, so a fully-packed serial (received =
  // sent, in-Moyka balance 0) stays visible for the record instead of
  // disappearing the moment packing catches up.
  const serials = useMemo(() => allSerials.filter((s) => isInMoyka(s.sent, s.received, s.closedAt)), [allSerials])
  const receivedSerials = useMemo(() => allSerials.filter((s) => s.received > 0), [allSerials])

  return { serials, receivedSerials, loading: isPending, refresh: refetch }
}
