import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { jarayonda, ortiqcha } from './tayyorCompletion'
import { sortByDateDesc, maxDate } from './sortByDate'
import { isAwaitingTugallash } from './stageMembership'
import { fetchActiveCycles } from './activeCycles'

export { computeFinalLossPct } from './tayyorCompletion'

export interface FinishedPallet {
  barcode2: string
  calibre_id: string
  weight_kg: number
  received_date: string
}

export interface OutputSerial {
  serial: string
  type_id: string
  category_id: string
  owner_id: string
  activeCycle: number // §5.5.4/§5.5.5: 1 unless a prior cycle was voided into a re-wash
  isRewash: boolean
  sent: number // Yuborilgan — Σ moyka_sends.qty_kg for the ACTIVE cycle only (derived)
  received: number // Qabul qilingan — Σ finished_pallets.weight_kg for the ACTIVE cycle, non-void (derived)
  inProcess: number // Jarayonda — max(0, sent − received); never negative (see DECISIONS)
  excess: number // Ortiqcha — max(0, received − sent); non-blocking overage flag
  pallets: FinishedPallet[] // this cycle's pallets only
  lastActivityDate: string | null // max(last moyka_sends.sent_date, last finished_pallets.received_date)
  // — used to sort this list newest-first (DECISIONS "Universal sort rule").
  barcodeSeqByCalibre: Record<string, number> // §5.5.5: count of EVERY pallet ever made for this
  // serial+calibre, across ALL cycles and INCLUDING voided ones — barcode2 is a permanent PK
  // (void-never-delete), so the next barcode's sequence number must never collide with a prior
  // cycle's, not even a voided one. Deliberately NOT scoped to the active cycle like `pallets`.
}

// §5.3 Window 2 (Tugallangan): a serial whose ACTIVE cycle has a
// wash_cycles row with status='final' — always via manual Tugallash now
// (DECISIONS.md "Manual-only finishing"). lossPct is the LOCKED figure from
// wash_cycles.final_loss_pct (source of truth once finalized, not
// recomputed) — sent/received/excess stay derived like the active list,
// for display and for the Ortiqcha badge.
export interface CompletedCycle {
  serial: string
  type_id: string
  owner_id: string
  cycleNo: number
  sent: number
  received: number
  lossPct: number // locked wash_cycles.final_loss_pct, floored at 0 (see tayyorCompletion.ts)
  excess: number // Ortiqcha — max(0, received − sent); picks the badge treatment
  pallets: FinishedPallet[]
  lastReceivedDate: string | null // max finished_pallets.received_date — wash_cycles has no
  // finalized_at timestamp (see DECISIONS "Tayyor Mahsulot completion"), so the last receipt
  // date is the closest real signal for "when this cycle was completed"; used to sort
  // Window 2 newest-first (DECISIONS "History list ordering", "Universal sort rule").
}

// §5.3 data: serials sent to Moyka (Step 5) split into two windows — active
// (awaiting Tugallash: sent > 0 and not yet manually finished, regardless
// of received/sent quantities — see stageMembership.ts isAwaitingTugallash
// and DECISIONS "Manual-only finishing") and completed (Tugallangan: a
// final wash_cycles row exists for the ACTIVE cycle, always via Tugallash —
// there is no auto-finalize path anymore). These two are independent, not
// mutually exclusive: a serial can be active AND completed at once if more
// was sent after an earlier cycle finalized. All totals DERIVED (CLAUDE.md
// "derive, don't store") except the locked final_loss_pct itself: sent from
// moyka_sends, received from finished_pallets — both scoped to the serial's
// ACTIVE cycle (§5.5.4/§5.5.5, Step 8 prompt 2 split 2d) via the shared
// fetchActiveCycles helper, so a re-washed serial's numbers describe its
// current cycle, not a mix of cycle 1's already-finalized figures and cycle
// 2's in-progress ones. Both lists sort newest-first (DECISIONS "Universal
// sort rule").
export function useMoykaOutput() {
  const [serials, setSerials] = useState<OutputSerial[]>([])
  const [completed, setCompleted] = useState<CompletedCycle[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: sends }, { data: pallets }, { data: cycles }] = await Promise.all([
        supabase.from('moyka_sends').select('serial, qty_kg, sent_date, wash_cycle'),
        supabase.from('finished_pallets').select('barcode2, serial, wash_cycle, calibre_id, weight_kg, received_date, status'),
        supabase.from('wash_cycles').select('serial, cycle_no, status, final_loss_pct'),
      ])

      const serialList = [...new Set((sends ?? []).map((s) => s.serial))]
      if (serialList.length === 0) {
        setSerials([])
        setCompleted([])
        return
      }

      const activeCycles = await fetchActiveCycles(serialList)
      function cycleOf(serial: string): number {
        return activeCycles.get(serial)?.cycle ?? 1
      }

      // Sent totals (and last send date, for sorting) per serial, scoped to
      // that serial's ACTIVE cycle only — a re-washed serial's cycle-1 sends
      // must not bleed into cycle 2's in-progress total.
      const sentBySerial = new Map<string, number>()
      const lastSentDateBySerial = new Map<string, string>()
      for (const s of sends ?? []) {
        if (s.wash_cycle !== cycleOf(s.serial)) continue
        sentBySerial.set(s.serial, (sentBySerial.get(s.serial) ?? 0) + s.qty_kg)
        const prevSent = lastSentDateBySerial.get(s.serial)
        if (!prevSent || s.sent_date > prevSent) lastSentDateBySerial.set(s.serial, s.sent_date)
      }

      // Pallets (and their received total) per serial, same active-cycle
      // scoping — Konditirskiy from an earlier cycle stays in_stock (§2.13)
      // but must not count toward the CURRENT cycle's received/loss maths.
      const palletsBySerial = new Map<string, FinishedPallet[]>()
      for (const p of pallets ?? []) {
        if (p.status === 'bekor_qilindi') continue
        if (p.wash_cycle !== cycleOf(p.serial)) continue
        const list = palletsBySerial.get(p.serial) ?? []
        list.push({ barcode2: p.barcode2, calibre_id: p.calibre_id, weight_kg: p.weight_kg, received_date: p.received_date })
        palletsBySerial.set(p.serial, list)
      }
      const receivedBySerial = new Map<string, number>()
      for (const [serial, serialPallets] of palletsBySerial) {
        receivedBySerial.set(
          serial,
          serialPallets.reduce((sum, p) => sum + p.weight_kg, 0),
        )
      }

      // §5.5.5: EVERY pallet ever made for a (serial, calibre) — every
      // cycle, including voided ones — since barcode2 is a permanent PK
      // (void-never-delete) and a new cycle's first same-calibre pallet
      // must not reuse a sequence number a voided cycle already claimed.
      const barcodeSeqBySerial = new Map<string, Record<string, number>>()
      for (const p of pallets ?? []) {
        const bySerial = barcodeSeqBySerial.get(p.serial) ?? {}
        bySerial[p.calibre_id] = (bySerial[p.calibre_id] ?? 0) + 1
        barcodeSeqBySerial.set(p.serial, bySerial)
      }

      // A cycle is "final" only when its OWN wash_cycles row (cycle_no =
      // that serial's active cycle) has status='final' — not just any past
      // cycle. Cycle 1's finalized-and-voided record stays in wash_cycles
      // forever (void-never-delete) but must not be read as "still final"
      // once the serial has moved on to a re-wash cycle.
      const finalCycleByKey = new Map((cycles ?? []).filter((c) => c.status === 'final').map((c) => [`${c.serial}:${c.cycle_no}`, c]))
      const lossPctBySerial = new Map<string, number>()
      const finalizedSerials = new Set<string>()
      for (const serial of serialList) {
        const cycle = finalCycleByKey.get(`${serial}:${cycleOf(serial)}`)
        if (cycle) {
          lossPctBySerial.set(serial, cycle.final_loss_pct ?? 0)
          finalizedSerials.add(serial)
        }
      }

      // §5.2 Moyka Window 2 = §5.3 Tayyor Window 1 (section mirroring) —
      // isAwaitingTugallash is the shared, tested predicate: sent at all,
      // not yet manually finished. No quantity comparison at all — an
      // over-received serial (received > sent) stays visible and finishable
      // until the operator clicks Tugallash (DECISIONS "Manual-only
      // finishing").
      const activeSerials = serialList.filter((s) => isAwaitingTugallash(sentBySerial.get(s) ?? 0, finalizedSerials.has(s)))
      // §5.3 Window 2 (Tugallangan) membership — the ACTIVE cycle has a
      // final wash_cycles row. A serial can be in BOTH activeSerials (not
      // yet finished) and completedSerials at once if more was sent after
      // an earlier cycle finalized.
      const completedSerials = serialList.filter((s) => finalizedSerials.has(s))

      const { data: kLines } = await supabase
        .from('kirim_lines')
        .select('serial, order_id, type_id')
        .in('serial', serialList)
      const orderIds = [...new Set((kLines ?? []).map((l) => l.order_id))]
      const [{ data: orders }, { data: types }] = await Promise.all([
        supabase.from('kirim_orders').select('order_id, owner_id').in('order_id', orderIds),
        supabase.from('product_types').select('id, category_id'),
      ])

      const lineBySerial = new Map((kLines ?? []).map((l) => [l.serial, l]))
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
      const categoryByType = new Map((types ?? []).map((t) => [t.id, t.category_id]))

      // Shared join/derivation for both windows — avoids fetching or
      // computing sent/received/pallets twice for the same serial shape.
      function baseRow(serial: string) {
        const line = lineBySerial.get(serial)
        if (!line) return null
        const order = orderById.get(line.order_id)
        if (!order) return null
        const sent = sentBySerial.get(serial) ?? 0
        const received = receivedBySerial.get(serial) ?? 0
        const serialPallets = palletsBySerial.get(serial) ?? []
        const lastReceivedDate = serialPallets.reduce<string | null>(
          (max, p) => (!max || p.received_date > max ? p.received_date : max),
          null,
        )
        return {
          serial,
          type_id: line.type_id,
          owner_id: order.owner_id,
          sent,
          received,
          pallets: serialPallets,
          barcodeSeqByCalibre: barcodeSeqBySerial.get(serial) ?? {},
          lastSentDate: lastSentDateBySerial.get(serial) ?? null,
          lastReceivedDate,
        }
      }

      const combined: OutputSerial[] = activeSerials
        .map((serial): OutputSerial | null => {
          const base = baseRow(serial)
          if (!base) return null
          const cycle = cycleOf(serial)
          return {
            serial: base.serial,
            type_id: base.type_id,
            owner_id: base.owner_id,
            activeCycle: cycle,
            isRewash: cycle > 1,
            sent: base.sent,
            received: base.received,
            pallets: base.pallets,
            barcodeSeqByCalibre: base.barcodeSeqByCalibre,
            category_id: categoryByType.get(base.type_id) ?? '',
            inProcess: jarayonda(base.sent, base.received),
            excess: ortiqcha(base.sent, base.received),
            lastActivityDate: maxDate(base.lastSentDate, base.lastReceivedDate),
          }
        })
        .filter((s): s is OutputSerial => s !== null)

      const completedRows: CompletedCycle[] = completedSerials
        .map((serial): CompletedCycle | null => {
          const base = baseRow(serial)
          if (!base) return null
          return {
            serial: base.serial,
            type_id: base.type_id,
            owner_id: base.owner_id,
            cycleNo: cycleOf(serial),
            sent: base.sent,
            received: base.received,
            pallets: base.pallets,
            lossPct: lossPctBySerial.get(serial) ?? 0,
            excess: ortiqcha(base.sent, base.received),
            lastReceivedDate: base.lastReceivedDate,
          }
        })
        .filter((c): c is CompletedCycle => c !== null)

      // Universal sort rule (DECISIONS "Universal sort rule", SPEC.md §5
      // intro): every stage/history list sorts newest-first. Sorted once
      // here, at the shared hook, so both consumers of `serials`
      // (§5.2 Window 2 and §5.3 Window 1 — section mirroring) inherit it.
      setSerials(sortByDateDesc(combined, (s) => s.lastActivityDate))
      setCompleted(sortByDateDesc(completedRows, (c) => c.lastReceivedDate))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { serials, completed, loading, refresh }
}
