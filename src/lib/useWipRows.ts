import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { queryKeys } from './queryClient'
import { wipKindSortIndex, type WipRow, type WipKind } from './wip'

interface WipDbRow {
  wip_kind: WipKind
  row_key: string
  serial: string | null
  request_id: string | null
  owner_id: string
  type_id: string | null
  partiya_no: number | string | null
  days_waiting: number | string | null
  threshold_days: number | string | null
}

function mapRow(r: WipDbRow): WipRow {
  return {
    wipKind: r.wip_kind,
    rowKey: r.row_key,
    serial: r.serial,
    requestId: r.request_id,
    ownerId: r.owner_id,
    typeId: r.type_id,
    partiyaNo: r.partiya_no === null ? null : Number(r.partiya_no),
    daysWaiting: r.days_waiting === null ? null : Number(r.days_waiting),
    thresholdDays: r.threshold_days === null ? null : Number(r.threshold_days),
  }
}

// §3.2.9 — one exceptions list, seven kinds, sorted by the section's own
// priority order (awaiting_lab first, per its own "highest-value row" note),
// then most-overdue first within a kind.
//
// 2026-09-21 (Phase 2 step 5) -- moved onto React Query, no query params
// (one shared key). No client-side limit added: `wip_rows` (the DB view)
// is already exception-scoped server-side -- every branch of its UNION ALL
// carries its own `days_waiting > threshold_days` predicate (confirmed by
// reading the live view definition), so this is a bounded exceptions list
// by construction, not an unbounded growing log.
export function useWipRows() {
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.wipRows(),
    queryFn: async ({ signal }): Promise<WipRow[]> => {
      const { data, error } = await supabase.from('wip_rows').select('*').abortSignal(signal)
      if (error) throw new Error(error.message)
      const mapped = ((data ?? []) as WipDbRow[]).map(mapRow)
      mapped.sort((a, b) => {
        const kindDiff = wipKindSortIndex(a.wipKind) - wipKindSortIndex(b.wipKind)
        if (kindDiff !== 0) return kindDiff
        return (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0)
      })
      return mapped
    },
  })

  return {
    rows: data ?? [],
    loading: isPending,
    refreshing: isFetching && !isPending,
    error: error ? error.message : null,
    refetch,
  }
}
