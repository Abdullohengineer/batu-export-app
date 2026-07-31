import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { sortFinishedByOmborFinish } from './chiqimScan'

// §5.4 Option B (2026-07-26) — a line's own earmarked pallets, the prepare-
// list's core data. weight_kg/serial come from the reserved pallet's own
// finished_pallets row (via the barcode2 FK), not the line's aggregate
// qty_kg — this is per-pallet, not a re-derivation of the line total.
export interface ReservedPallet {
  barcode2: string
  serial: string
  weight_kg: number
}

export interface ChiqimLine {
  id: string
  type_id: string
  // Raw dispatch (2026-07-31): a line is either finished (calibre_id set)
  // or raw (raw_serial set) — mutually exclusive, mirrors chiqim_lines'
  // own DB constraint (chiqim_lines_calibre_xor_raw).
  calibre_id: string | null
  raw_serial: string | null
  qty_kg: number
  reservedPallets: ReservedPallet[]
}

export interface ChiqimRequest {
  id: string
  request_date: string
  plate: string
  driver: string
  owner_id: string
  ombor_finished_at: string | null
  lines: ChiqimLine[]
  // Nav/visual-redesign pass (mockup "BATU-Storage-S4-Skladdan-CHIQIM-v2.pdf"
  // p1): whether Qorovul has already recorded the gate's empty weight
  // (dir='chiqim' stage 1 — the truck arrives empty to be loaded, reversed
  // from KIRIM) for this request. Informational only, per the flagged
  // decision in this task's report — display both states, never gates
  // "Yuklashni boshlash" (this app's consistent never-block philosophy).
  gateStage1CompletedAt: string | null
  gatePustoyKg: number | null
}

// §5.4 Ombor CHIQIM: W1 (open — ombor_finished_at is null) and W2
// (finished-by-Ombor — ombor_finished_at set), per the "CHIQIM per-role
// finalization" invariant (SPEC.md §5 intro) — this is Ombor's OWN signal,
// independent of Qorovul's gate weighing or chiqim_requests.status.
// W2 sorts newest-first by ombor_finished_at (universal sort rule).
export function useOmborChiqimRequests() {
  const [open, setOpen] = useState<ChiqimRequest[]>([])
  const [finished, setFinished] = useState<ChiqimRequest[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data }, { data: weighings }] = await Promise.all([
        supabase
          .from('chiqim_requests')
          // §5.4 Option B: voided requests never reach Ombor at all — a
          // voided_at IS NULL filter here, not client-side, since Ombor
          // has no business reason to ever see one (voiding is only
          // allowed pre-scan, see 0033's menejer_voids policy). Nested
          // three levels: each line's own reserved pallets, each pallet's
          // own serial/weight from finished_pallets — the prepare-list's
          // actual data, not a re-derivation of qty_kg.
          .select(
            'id, request_date, plate, driver, owner_id, ombor_finished_at, ' +
              'chiqim_lines(id, type_id, calibre_id, raw_serial, qty_kg, ' +
              'chiqim_line_pallets(barcode2, finished_pallets(serial, weight_kg)))',
          )
          .is('voided_at', null),
        supabase.from('gate_weighings').select('request_id, pustoy_kg, stage1_completed_at').eq('dir', 'chiqim'),
      ])
      const weighingByRequest = new Map((weighings ?? []).map((w) => [w.request_id, w]))

      // Cast explicitly, same reason as useGateHistory.ts/useFinishedChiqimRequests.ts:
      // a `select()` built from a concatenated string (not a literal) widens
      // to a union including PostgREST's generic error shape.
      type RawLine = {
        id: string
        type_id: string
        calibre_id: string | null
        raw_serial: string | null
        qty_kg: number
        chiqim_line_pallets: { barcode2: string; finished_pallets: { serial: string; weight_kg: number } | null }[] | null
      }
      type RawRequest = {
        id: string
        request_date: string
        plate: string
        driver: string
        owner_id: string
        ombor_finished_at: string | null
        chiqim_lines: RawLine[] | null
      }
      const rows = (data ?? []) as unknown as RawRequest[]

      const requests: ChiqimRequest[] = rows.map((r) => {
        const weighing = weighingByRequest.get(r.id)
        return {
          id: r.id,
          request_date: r.request_date,
          plate: r.plate,
          driver: r.driver,
          owner_id: r.owner_id,
          ombor_finished_at: r.ombor_finished_at,
          lines: (r.chiqim_lines ?? []).map((l) => ({
            id: l.id,
            type_id: l.type_id,
            calibre_id: l.calibre_id,
            raw_serial: l.raw_serial,
            qty_kg: l.qty_kg,
            reservedPallets: (l.chiqim_line_pallets ?? [])
              .filter((clp) => clp.finished_pallets !== null)
              .map((clp) => ({
                barcode2: clp.barcode2,
                serial: clp.finished_pallets!.serial,
                weight_kg: clp.finished_pallets!.weight_kg,
              })),
          })),
          gateStage1CompletedAt: weighing?.stage1_completed_at ?? null,
          gatePustoyKg: weighing?.pustoy_kg ?? null,
        }
      })

      setOpen(requests.filter((r) => r.ombor_finished_at === null))
      setFinished(sortFinishedByOmborFinish(requests.filter((r) => r.ombor_finished_at !== null)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { open, finished, loading, refresh }
}
