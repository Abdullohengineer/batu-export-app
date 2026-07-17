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
      const { data } = await supabase
        .from('chiqim_requests')
        .select('id, request_date, plate, driver, owner_id, ombor_finished_at, chiqim_lines(id, type_id, calibre_id, qty_kg)')

      const requests: ChiqimRequest[] = (data ?? []).map((r) => ({
        id: r.id,
        request_date: r.request_date,
        plate: r.plate,
        driver: r.driver,
        owner_id: r.owner_id,
        ombor_finished_at: r.ombor_finished_at,
        lines: r.chiqim_lines ?? [],
      }))

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
