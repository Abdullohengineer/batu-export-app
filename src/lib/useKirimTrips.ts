import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'

export interface KirimLine {
  serial: string
  type_id: string
  partiya_no: number | null
  declared_qty: number
  process: 'moyka' | 'rezka' // Rezka Prompt 3: badge on the gate card, display only
}

export interface KirimOrderRow {
  order_id: string
  order_date: string
  plate: string
  driver: string
  owner_id: string
  declared_total: number | null
  status: string
  truck_type: string // SPEC.md "KIRIM fura" -- 'regular' | 'fura'
}

export interface GateWeighing {
  id: string
  order_id: string
  gruzheny_kg: number | null
  pustoy_kg: number | null
  net_kg: number | null
  completed_at: string | null
}

export interface KirimTrip {
  order: KirimOrderRow
  lines: KirimLine[]
  weighing: GateWeighing | null
  // SPEC.md "KIRIM fura" -- mirrors ChiqimTrip's own kirdiPhoto/chiqdiPhoto/
  // loadedKg (useChiqimTrips.ts). receivedKg is the sum of this order's
  // lines' own effective qty (declared pre-intake, actual once accepted) --
  // a plain client-side sum for display, not a new balance calculation.
  kirdiPhoto: string | null
  chiqdiPhoto: string | null
  receivedKg: number
}

// Qorovul's KIRIM tab (SPEC §4): the gate cares about the trip, not any one
// serial on it — a trip may carry several serials (§2.1), display-only here.
//
// 2026-09-21 (Phase 2 step 5) -- moved onto React Query, no query params
// (one shared key).
export function useKirimTrips() {
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.kirimTrips(),
    queryFn: async ({ signal }): Promise<KirimTrip[]> => {
      const [
        { data: orders, error: ordersErr },
        { data: lines, error: linesErr },
        { data: weighings, error: weighingsErr },
        { data: intakes, error: intakesErr },
        { data: furaPhotos, error: furaPhotosErr },
      ] = await Promise.all([
        supabase
          .from('kirim_orders')
          // origin='delivery' only (2026-08-02) — the gate weighs TRUCKS.
          // A seeded opening-stock anchor (origin='opening_stock') or a
          // minted re-processing serial (origin='internal_reprocess') never
          // arrived by road, so it must never appear in Qorovul's queue.
          // Without this filter all 5 seeded old-washed orders showed up as
          // phantom trips awaiting weighing (they carry status='kutilmoqda'
          // and no gate_weighings row, which is exactly this screen's
          // "not started" predicate). A positive allowlist, not an
          // exclusion list, so any future non-delivery origin is covered by
          // construction — same reasoning as report_rows' own filter.
          .select('order_id, order_date, plate, driver, owner_id, declared_total, status, truck_type')
          .eq('origin', 'delivery')
          .order('created_at', { ascending: false })
          .abortSignal(signal),
        // Voided TEST lines (0152) are not gate work.
        supabase.from('kirim_lines').select('serial, type_id, declared_qty, order_id, partiya_no, process').is('voided_at', null).abortSignal(signal),
        supabase
          .from('gate_weighings')
          .select('id, order_id, gruzheny_kg, pustoy_kg, net_kg, completed_at')
          .eq('dir', 'kirim')
          .abortSignal(signal),
        // SPEC.md "KIRIM fura": receivedKg for a fura's courtesy card below.
        supabase.from('storage_intake').select('serial, actual_qty').abortSignal(signal),
        // SPEC.md "KIRIM fura": the guard's own kirdi/chiqdi record, mirrors
        // useChiqimTrips.ts's chiqim_fura_photos fetch.
        supabase.from('kirim_fura_photos').select('order_id, kind, photo_url, seq').abortSignal(signal),
      ])
      if (ordersErr) throw new Error(ordersErr.message)
      if (linesErr) throw new Error(linesErr.message)
      if (weighingsErr) throw new Error(weighingsErr.message)
      if (intakesErr) throw new Error(intakesErr.message)
      if (furaPhotosErr) throw new Error(furaPhotosErr.message)

      const actualQtyBySerial = new Map((intakes ?? []).map((i) => [i.serial, i.actual_qty]))

      // Latest photo per (order, kind) by seq, not insertion order -- same
      // "two rows in one transaction share a clock" correctness fix
      // chiqim_fura_photos' own seq column exists for.
      const latestFuraPhoto = new Map<string, { url: string; seq: number }>()
      for (const p of furaPhotos ?? []) {
        const key = `${p.order_id}:${p.kind}`
        const prev = latestFuraPhoto.get(key)
        if (!prev || prev.seq < p.seq) latestFuraPhoto.set(key, { url: p.photo_url, seq: p.seq })
      }

      return (orders ?? [])
        .map((order) => {
          const orderLines = (lines ?? []).filter((l) => l.order_id === order.order_id)
          return {
            order,
            lines: orderLines,
            weighing: (weighings ?? []).find((w) => w.order_id === order.order_id) ?? null,
            kirdiPhoto: latestFuraPhoto.get(`${order.order_id}:kirdi`)?.url ?? null,
            chiqdiPhoto: latestFuraPhoto.get(`${order.order_id}:chiqdi`)?.url ?? null,
            receivedKg: orderLines.reduce((sum, l) => sum + (actualQtyBySerial.get(l.serial) ?? l.declared_qty), 0),
          }
        })
        // A real order always has lines; one with none left had every line
        // voided (TEST only, 0152) -- not a truck anyone should weigh.
        .filter((trip) => trip.lines.length > 0)
    },
  })

  return {
    trips: data ?? [],
    loading: isPending,
    refreshing: isFetching && !isPending,
    error: error ? error.message : null,
    refresh: refetch,
  }
}
