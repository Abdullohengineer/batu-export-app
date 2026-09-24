import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { run } from './rpc'
import { queryKeys } from './queryClient'
import { sortByDateDesc, maxDate } from './sortByDate'
import { isInRezka } from './stageMembership'
import type { FinishedPallet } from './useMoykaOutput'

const EMPTY: RezkaOutputSerial[] = []

export interface RezkaParentDraw {
  barcode2: string
  qtyKg: number
}

// One row per (serial, rezka cycle) -- the Rezka twin of useMoykaOutput's
// OutputSerial (SPEC.md §5.R). Separate type and hook, not a process flag on
// the Moyka one (stage-2 decision: separate components, not a flag).
export interface RezkaOutputSerial {
  serial: string
  cycleNo: number
  type_id: string
  category_id: string
  owner_id: string
  partiyaNo: number | null
  // origin='delivery' -> Tashqi (a real truck); origin='internal_reprocess'
  // -> Ichki KN (minted by send_kn_to_rezka from Konditerka pallets).
  provenance: 'tashqi' | 'ichki'
  parentDraws: RezkaParentDraw[] // Ichki only: rezka_kn_draws rows for this serial
  closedAt: string | null
  sent: number // Σ rezka_sends.qty_kg within this cycle's window
  received: number // Σ non-void finished_pallets.weight_kg within this cycle's window
  pallets: FinishedPallet[]
  barcodeSeqByCalibre: Record<string, number> // every pallet ever made for the serial, per calibre
  lastActivityDate: string | null
}

export function useRezkaOutput() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.rezkaOutput(),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }): Promise<RezkaOutputSerial[]> => {
      const sends = await run(supabase.from('rezka_sends').select('serial, qty_kg, sent_date').abortSignal(signal))
      const serialList = [...new Set((sends ?? []).map((s) => s.serial))]
      if (serialList.length === 0) return []

      const [kLines, cycles, pallets, draws, types] = await Promise.all([
        run(supabase.from('kirim_lines').select('serial, order_id, type_id, partiya_no').in('serial', serialList).abortSignal(signal)),
        run(
          supabase
            .from('rezka_cycles')
            .select('serial, cycle_no, opened_at, closed_at')
            .in('serial', serialList)
            .order('cycle_no')
            .abortSignal(signal),
        ),
        run(
          supabase
            .from('finished_pallets')
            .select('barcode2, serial, calibre_id, weight_kg, received_date, created_at, status')
            .in('serial', serialList)
            .abortSignal(signal),
        ),
        run(supabase.from('rezka_kn_draws').select('minted_serial, barcode2, qty_kg, drawn_at').in('minted_serial', serialList).abortSignal(signal)),
        run(supabase.from('product_types').select('id, category_id').abortSignal(signal)),
      ])
      const orderIds = [...new Set((kLines ?? []).map((l) => l.order_id))]
      const orders = await run(
        supabase.from('kirim_orders').select('order_id, owner_id, origin').in('order_id', orderIds).abortSignal(signal),
      )

      const lineBySerial = new Map((kLines ?? []).map((l) => [l.serial, l]))
      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
      const categoryByType = new Map((types ?? []).map((t) => [t.id, t.category_id]))

      const drawsBySerial = new Map<string, RezkaParentDraw[]>()
      for (const d of draws ?? []) {
        const list = drawsBySerial.get(d.minted_serial) ?? []
        list.push({ barcode2: d.barcode2, qtyKg: Number(d.qty_kg) })
        drawsBySerial.set(d.minted_serial, list)
      }

      // Cycle windows, same shape as useMoykaOutput's: a send/pallet belongs
      // to the cycle whose [opened_at, next cycle's opened_at) contains it.
      interface CycleWindow {
        cycleNo: number
        openedAt: string
        closedAt: string | null
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

      const barcodeSeqBySerial = new Map<string, Record<string, number>>()
      for (const p of pallets ?? []) {
        const bySerial = barcodeSeqBySerial.get(p.serial) ?? {}
        bySerial[p.calibre_id] = (bySerial[p.calibre_id] ?? 0) + 1
        barcodeSeqBySerial.set(p.serial, bySerial)
      }
      const livePallets = (pallets ?? []).filter((p) => p.status !== 'bekor_qilindi')

      const combined: RezkaOutputSerial[] = []
      for (const serial of serialList) {
        const line = lineBySerial.get(serial)
        if (!line) continue
        const order = orderById.get(line.order_id)
        if (!order) continue
        for (const w of cyclesBySerial.get(serial) ?? []) {
          const cycleSends = (sends ?? []).filter((s) => s.serial === serial && inWindow(s.sent_date, w))
          const cyclePallets: FinishedPallet[] = livePallets
            .filter((p) => p.serial === serial && inWindow(p.received_date, w))
            .map((p) => ({
              barcode2: p.barcode2,
              calibre_id: p.calibre_id,
              weight_kg: Number(p.weight_kg),
              received_date: p.received_date,
              created_at: p.created_at,
            }))
          const lastSent = cycleSends.reduce<string | null>((m, s) => (!m || s.sent_date > m ? s.sent_date : m), null)
          const lastReceived = cyclePallets.reduce<string | null>((m, p) => (!m || p.received_date > m ? p.received_date : m), null)
          combined.push({
            serial,
            cycleNo: w.cycleNo,
            type_id: line.type_id,
            category_id: categoryByType.get(line.type_id) ?? '',
            owner_id: order.owner_id,
            partiyaNo: line.partiya_no,
            provenance: order.origin === 'internal_reprocess' ? 'ichki' : 'tashqi',
            parentDraws: drawsBySerial.get(serial) ?? [],
            closedAt: w.closedAt,
            sent: cycleSends.reduce((sum, s) => sum + Number(s.qty_kg), 0),
            received: cyclePallets.reduce((sum, p) => sum + p.weight_kg, 0),
            pallets: cyclePallets,
            barcodeSeqByCalibre: barcodeSeqBySerial.get(serial) ?? {},
            lastActivityDate: maxDate(lastSent, lastReceived),
          })
        }
      }
      // Universal sort rule: newest first, once, here.
      return sortByDateDesc(combined, (s) => s.lastActivityDate)
    },
  })
  const all = data ?? EMPTY
  // Section mirroring: section 2's Window 2 and section 3's Window 1 are this
  // same set (isInRezka: cycle open and something sent -- an over-received
  // serial stays receivable until closed).
  const inRezka = useMemo(() => all.filter((s) => isInRezka(s.sent, s.received, s.closedAt)), [all])
  const received = useMemo(() => all.filter((s) => s.received > 0 || s.closedAt !== null), [all])
  return { all, inRezka, received, loading: isPending, error, refresh: refetch }
}
