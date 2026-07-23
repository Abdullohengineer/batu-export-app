import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { sortFinishedByOmborFinish } from './chiqimScan'

export interface ChiqimLine {
  id: string
  type_id: string
  calibre_id: string
  qty_kg: number
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
          .select('id, request_date, plate, driver, owner_id, ombor_finished_at, chiqim_lines(id, type_id, calibre_id, qty_kg)'),
        supabase.from('gate_weighings').select('request_id, pustoy_kg, stage1_completed_at').eq('dir', 'chiqim'),
      ])
      const weighingByRequest = new Map((weighings ?? []).map((w) => [w.request_id, w]))

      const requests: ChiqimRequest[] = (data ?? []).map((r) => {
        const weighing = weighingByRequest.get(r.id)
        return {
          id: r.id,
          request_date: r.request_date,
          plate: r.plate,
          driver: r.driver,
          owner_id: r.owner_id,
          ombor_finished_at: r.ombor_finished_at,
          lines: r.chiqim_lines ?? [],
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
