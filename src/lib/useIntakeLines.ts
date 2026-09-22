import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'

export interface IntakeRecord {
  actual_qty: number
  box_mass_kg: number
  pile_photo: string | null
  komment: string | null
  barcode1: string | null
  status: string
  confirmed_at: string
  moisture_pct: number | null
  so2_mg_kg: number | null
}

export interface IntakeLine {
  serial: string
  type_id: string
  partiyaNo: number | null
  declared_qty: number
  order_id: string
  order_date: string
  plate: string
  driver: string
  owner_id: string
  order_status: string
  gruzheny_kg: number | null
  pustoy_kg: number | null
  net_kg: number | null
  gate_completed_at: string | null
  intake: IntakeRecord | null
}

// Storage §1 (SPEC §5.1): a trip is visible the moment the manager submits
// it, but only ACCEPTABLE once gate stage 1 exists (gruzheny_kg set) — it
// does not wait for stage 2 / net weight. One row per serial (line), since
// a serial is single-type by construction (§2.1) and lines on the same
// trip can be accepted independently.
//
// 2026-09-21 (Phase 2 step 2) -- moved onto React Query, no query params
// (one shared key, see queryClient.ts). This is what lets OmborHome's nav
// badge and OmborIntakeTab's own list -- two separate mounts of this same
// hook -- collapse into one request instead of two, and what makes
// OmborIntakeTab's own refresh() after an accept also update the badge for
// free. `loading` (React Query's `isPending`) is true only while there is
// no cached data at all, never during a background refetch -- the same
// "must only gate the FIRST fetch" property the old hasLoadedOnce guard
// existed to provide (see OmborIntakeTab.tsx's handleAccept comment for the
// dropped-submit bug this originally fixed), now built in rather than
// hand-rolled.
export function useIntakeLines() {
  const { data, isPending, refetch } = useQuery({
    queryKey: queryKeys.intakeLines(),
    // 60s, visible-tab-only (2026-09-21, Phase 2 step 2) -- replaces
    // OmborHome's old standalone setInterval, which kept firing all 4
    // section refreshes every 60s regardless of whether the tab was even
    // visible. One query-level option now covers every mount of this hook.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<IntakeLine[]> => {
      const [{ data: orders }, { data: kLines }, { data: weighings }, { data: intakes }] = await Promise.all([
        supabase
          .from('kirim_orders')
          // origin='delivery' only (2026-08-02) — this screen accepts
          // material off an arriving truck. A seeded opening-stock anchor
          // (origin='opening_stock') or a minted re-processing serial
          // (origin='internal_reprocess') has no truck to accept from.
          // Without this filter all 5 seeded old-washed serials appeared as
          // phantom deliveries pending acceptance (they have no
          // storage_intake row, which is exactly this screen's "pending"
          // predicate) — and accepting one would have written a real
          // storage_intake row, materialising ~52 t of phantom raw stock in
          // qoldig'i. A positive allowlist, so future origins are covered.
          .select('order_id, order_date, plate, driver, owner_id, status')
          .eq('origin', 'delivery')
          .order('created_at', { ascending: false }),
        supabase.from('kirim_lines').select('serial, order_id, type_id, declared_qty, partiya_no'),
        supabase
          .from('gate_weighings')
          .select('order_id, gruzheny_kg, pustoy_kg, net_kg, completed_at')
          .eq('dir', 'kirim'),
        supabase
          .from('storage_intake')
          .select('serial, actual_qty, box_mass_kg, pile_photo, komment, barcode1, status, confirmed_at, moisture_pct, so2_mg_kg'),
      ])

      const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))
      const weighingByOrder = new Map((weighings ?? []).map((w) => [w.order_id, w]))
      const intakeBySerial = new Map((intakes ?? []).map((i) => [i.serial, i]))

      const combined: IntakeLine[] = (kLines ?? [])
        .map((line): IntakeLine | null => {
          const order = orderById.get(line.order_id)
          if (!order) return null
          const weighing = weighingByOrder.get(line.order_id) ?? null

          return {
            serial: line.serial,
            type_id: line.type_id,
            partiyaNo: line.partiya_no,
            declared_qty: line.declared_qty,
            order_id: order.order_id,
            order_date: order.order_date,
            plate: order.plate,
            driver: order.driver,
            owner_id: order.owner_id,
            order_status: order.status,
            gruzheny_kg: weighing?.gruzheny_kg ?? null,
            pustoy_kg: weighing?.pustoy_kg ?? null,
            net_kg: weighing?.net_kg ?? null,
            gate_completed_at: weighing?.completed_at ?? null,
            intake: intakeBySerial.get(line.serial) ?? null,
          }
        })
        .filter((l): l is IntakeLine => l !== null)

      return combined
    },
  })

  return { lines: data ?? [], loading: isPending, refresh: refetch }
}
