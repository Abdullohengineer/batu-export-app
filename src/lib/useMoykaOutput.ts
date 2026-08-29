import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { jarayonda, ortiqcha } from './tayyorCompletion'
import { sortByDateDesc, maxDate } from './sortByDate'
import { isInMoyka } from './stageMembership'
import { currentLabStatus, type LabGateStatus } from './labVerdict'

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
  closedAt: string | null // wash_cycles.closed_at (2026-08-29, Prompt 10 — see
  // DECISIONS.md "Serial close-out (Yakunlash)"). null = still open (unrealized
  // gap, Moykada); set = closed (realized, Yo'qotish). Drives isInMoyka's third
  // param and computeLossDisplay everywhere this hook's data reaches.
  sent: number // Yuborilgan — Σ moyka_sends.qty_kg (derived)
  received: number // Qabul qilingan — Σ finished_pallets.weight_kg, non-void (derived).
  // Deliberately still counts 'consumed' pallets (only 'bekor_qilindi' is skipped):
  // status is a CURRENT-LOCATION field, not a did-this-happen field. A pallet later
  // consumed into a re-wash was still genuinely produced by THIS serial, and its
  // locked final_loss_pct must not move retroactively. Same reasoning as
  // yield_rows.output, which likewise applies no status filter. See DECISIONS.md
  // "Opening stock, Stage 3".
  inProcess: number // Jarayonda — max(0, sent − received); never negative (see DECISIONS)
  excess: number // Ortiqcha — max(0, received − sent); non-blocking overage flag
  pallets: FinishedPallet[] // this serial's pallets
  lastActivityDate: string | null // max(last moyka_sends.sent_date, last finished_pallets.received_date)
  // — used to sort this list newest-first (DECISIONS "Universal sort rule").
  barcodeSeqByCalibre: Record<string, number> // count of every pallet ever made for this serial+calibre —
  // barcode2 is a permanent PK, so the next barcode's sequence number must never collide with a prior one.
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
export function useMoykaOutput() {
  const [allSerials, setAllSerials] = useState<OutputSerial[]>([])
  const [loading, setLoading] = useState(true)
  // 🔒 refresh is called both from the mount effect below AND from mutation
  // handlers elsewhere (handleSend/handleReceipt) — a plain
  // per-effect `cancelled` closure (this codebase's usual guard, e.g.
  // useYieldRows.ts) can't cover both call sites. A monotonic request id
  // does: only the most-recently-STARTED call is ever allowed to commit
  // state, regardless of which one resolves first. Without this, React
  // StrictMode's dev-only double-invoke of the mount effect (or a mutation's
  // refresh() landing while the mount fetch is still in flight) can let an
  // earlier, in-flight response overwrite a later, correct one with stale
  // (sometimes empty) data.
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const [{ data: sends }, { data: pallets }] = await Promise.all([
        supabase.from('moyka_sends').select('serial, qty_kg, sent_date'),
        supabase.from('finished_pallets').select('barcode2, serial, calibre_id, weight_kg, received_date, created_at, status'),
      ])

      const serialList = [...new Set((sends ?? []).map((s) => s.serial))]
      if (serialList.length === 0) {
        if (requestIdRef.current === requestId) {
          setAllSerials([])
        }
        return
      }

      const labStatusBySerial = await currentLabStatus(serialList)

      const sentBySerial = new Map<string, number>()
      const lastSentDateBySerial = new Map<string, string>()
      for (const s of sends ?? []) {
        sentBySerial.set(s.serial, (sentBySerial.get(s.serial) ?? 0) + s.qty_kg)
        const prevSent = lastSentDateBySerial.get(s.serial)
        if (!prevSent || s.sent_date > prevSent) lastSentDateBySerial.set(s.serial, s.sent_date)
      }

      const palletsBySerial = new Map<string, FinishedPallet[]>()
      for (const p of pallets ?? []) {
        if (p.status === 'bekor_qilindi') continue
        const list = palletsBySerial.get(p.serial) ?? []
        list.push({
          barcode2: p.barcode2,
          calibre_id: p.calibre_id,
          weight_kg: p.weight_kg,
          received_date: p.received_date,
          created_at: p.created_at,
        })
        palletsBySerial.set(p.serial, list)
      }
      const receivedBySerial = new Map<string, number>()
      for (const [serial, serialPallets] of palletsBySerial) {
        receivedBySerial.set(
          serial,
          serialPallets.reduce((sum, p) => sum + p.weight_kg, 0),
        )
      }

      // Every pallet ever made for a (serial, calibre) — barcode2 is a
      // permanent PK, so the next barcode's sequence number must never
      // collide with a prior one.
      const barcodeSeqBySerial = new Map<string, Record<string, number>>()
      for (const p of pallets ?? []) {
        const bySerial = barcodeSeqBySerial.get(p.serial) ?? {}
        bySerial[p.calibre_id] = (bySerial[p.calibre_id] ?? 0) + 1
        barcodeSeqBySerial.set(p.serial, bySerial)
      }

      const { data: kLines } = await supabase
        .from('kirim_lines')
        .select('serial, order_id, type_id, partiya_no')
        .in('serial', serialList)
      const orderIds = [...new Set((kLines ?? []).map((l) => l.order_id))]
      const [{ data: orders }, { data: types }, { data: cycles }] = await Promise.all([
        supabase.from('kirim_orders').select('order_id, owner_id, origin').in('order_id', orderIds),
        supabase.from('product_types').select('id, category_id'),
        supabase.from('wash_cycles').select('serial, closed_at').in('serial', serialList),
      ])

      const lineBySerial = new Map((kLines ?? []).map((l) => [l.serial, l]))
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
      const categoryByType = new Map((types ?? []).map((t) => [t.id, t.category_id]))
      const closedAtBySerial = new Map((cycles ?? []).map((c) => [c.serial, c.closed_at as string | null]))

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
          partiyaNo: line.partiya_no,
          owner_id: order.owner_id,
          isMinted: order.origin === 'internal_reprocess',
          closedAt: closedAtBySerial.get(serial) ?? null,
          sent,
          received,
          pallets: serialPallets,
          barcodeSeqByCalibre: barcodeSeqBySerial.get(serial) ?? {},
          lastSentDate: lastSentDateBySerial.get(serial) ?? null,
          lastReceivedDate,
        }
      }

      // Built for EVERY serial in this fetch (2026-08-29, Prompt 9) — not
      // pre-filtered to isInMoyka any more. Window 2 (receivedSerials,
      // below) needs a fully-received serial (balance 0) to stay in this
      // set; the receive picker's own membership (serials, isInMoyka) is
      // still exactly what it was, just derived as a filter AFTER this map
      // instead of before it — same rows, same figures, no behaviour change
      // for that consumer.
      const combined: OutputSerial[] = serialList
        .map((serial): OutputSerial | null => {
          const base = baseRow(serial)
          if (!base) return null
          return {
            serial: base.serial,
            type_id: base.type_id,
            partiyaNo: base.partiyaNo,
            owner_id: base.owner_id,
            isMinted: base.isMinted,
            closedAt: base.closedAt,
            labStatus: labStatusBySerial.get(serial) ?? 'untested',
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

      // Universal sort rule (DECISIONS "Universal sort rule", SPEC.md §5
      // intro): every stage/history list sorts newest-first. Sorted once
      // here, at the shared hook, so every consumer of `allSerials` (§5.2
      // Window 2, §5.3 Window 1, §5.3's new Window 2 — section mirroring)
      // inherits it without re-sorting.
      if (requestIdRef.current !== requestId) return
      setAllSerials(sortByDateDesc(combined, (s) => s.lastActivityDate))
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Two filtered views of the one fetched/sorted set (2026-08-29, Prompt 9)
  // — see this hook's own header comment. `serials`: §5.3 Window 1's
  // receive-picker membership, unchanged (isInMoyka). `receivedSerials`:
  // §5.3's restored Window 2 — every serial that has ever received
  // anything, balance irrelevant, so a fully-packed serial (received =
  // sent, in-Moyka balance 0) stays visible for the record instead of
  // disappearing the moment packing catches up.
  const serials = useMemo(() => allSerials.filter((s) => isInMoyka(s.sent, s.received, s.closedAt)), [allSerials])
  const receivedSerials = useMemo(() => allSerials.filter((s) => s.received > 0), [allSerials])

  return { serials, receivedSerials, loading, refresh }
}
