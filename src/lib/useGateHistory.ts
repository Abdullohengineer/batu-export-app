import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Derived status (task step 3): gate_weighings has no stored status enum —
// it's derived from the weights/completion, per Step 2's design. A gate row
// always has at least stage 1 (loaded weight), so the only two real states
// are in-progress and completed. ("Kutilmoqda"/awaiting-gate is NOT a
// gate_weighings state — such trips have no weighing row yet, so it isn't a
// filter option here.)
export type GateStatus = 'kirdi_boshatilmoqda' | 'yakunlandi'

export interface GateHistoryRow {
  id: string
  direction: 'kirim' | 'chiqim' // real field from gate_weighings.dir — not assumed KIRIM
  sana: string | null // parent trip date (order_date / request_date)
  plate: string | null
  driver: string | null
  ownerId: string | null
  declaredTotal: number | null // kirim_orders.declared_total (KIRIM trips only)
  gruzheny_kg: number | null
  pustoy_kg: number | null
  net_kg: number | null
  completed_at: string | null
  status: GateStatus
}

export interface GateHistoryFilters {
  from: string // YYYY-MM-DD inclusive
  to: string // YYYY-MM-DD inclusive
  plate: string // text match, '' = all
  status: GateStatus | '' // '' = all
}

// Read-only history of gate_weighings (Qorovul Hisobotlar, task step 3).
//
// SCHEMA LIMITATION (flagged, not fixed — no migration this step): gate_weighings
// has no own timestamp (only a nullable completed_at) and a random-uuid PK, so
// it can't be time-ordered or date-bounded server-side. We therefore fetch with
// a hard .limit() cap and filter/sort client-side on the parent trip's sana. If
// gate history ever grows large this wants a created_at on gate_weighings (or
// a parent-anchored query) — see PR/DECISIONS.
//
// Queried direction-agnostically from gate_weighings (embedding BOTH possible
// parents) so nothing hardcodes KIRIM; CHIQIM rows just don't exist yet.
const FETCH_CAP = 500

interface KirimParent {
  order_date: string
  plate: string
  driver: string
  owner_id: string
  declared_total: number | null
}
interface ChiqimParent {
  request_date: string
  plate: string
  driver: string
  owner_id: string
}
// Shape of the embedded-select rows. Cast explicitly because without
// generated DB types the Supabase client widens embed results to a union
// that includes an error type. Both parents are to-one embeds (nullable).
interface RawGateRow {
  id: string
  dir: 'kirim' | 'chiqim'
  gruzheny_kg: number | null
  pustoy_kg: number | null
  net_kg: number | null
  completed_at: string | null
  kirim_orders: KirimParent | null
  chiqim_requests: ChiqimParent | null
}

export function useGateHistory(filters: GateHistoryFilters) {
  const [rows, setRows] = useState<GateHistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  const { from, to, plate, status } = filters

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const { data } = await supabase
          .from('gate_weighings')
          .select(
            'id, dir, gruzheny_kg, pustoy_kg, net_kg, completed_at, ' +
              'kirim_orders(order_date, plate, driver, owner_id, declared_total), ' +
              'chiqim_requests(request_date, plate, driver, owner_id)',
          )
          .limit(FETCH_CAP)

        const mapped: GateHistoryRow[] = ((data ?? []) as unknown as RawGateRow[]).map((w) => {
          const kirim = w.kirim_orders
          const chiqim = w.chiqim_requests
          const parent = kirim ?? chiqim
          return {
            id: w.id,
            direction: w.dir,
            sana: kirim?.order_date ?? chiqim?.request_date ?? null,
            plate: parent?.plate ?? null,
            driver: parent?.driver ?? null,
            ownerId: parent?.owner_id ?? null,
            declaredTotal: kirim?.declared_total ?? null,
            gruzheny_kg: w.gruzheny_kg,
            pustoy_kg: w.pustoy_kg,
            net_kg: w.net_kg,
            completed_at: w.completed_at,
            status: w.completed_at ? 'yakunlandi' : 'kirdi_boshatilmoqda',
          }
        })

        const plateQ = plate.trim().toLowerCase()
        const filtered = mapped
          .filter((r) => (r.sana ? r.sana >= from && r.sana <= to : false))
          .filter((r) => (plateQ ? (r.plate ?? '').toLowerCase().includes(plateQ) : true))
          .filter((r) => (status ? r.status === status : true))
          .sort((a, b) => (b.sana ?? '').localeCompare(a.sana ?? ''))

        if (!cancelled) setRows(filtered)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [from, to, plate, status])

  return { rows, loading }
}
