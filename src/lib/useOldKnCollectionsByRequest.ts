import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface OldKnCollection {
  id: string
  chiqim_line_id: string
  pool_id: string
  collected_kg: number
  collected_at: string
}

// Opening stock, Stage 2 (2026-08-02) — old_kn's own post-finish display,
// sibling to useRawDispatchLinesByRequest.ts (same shape: no request_id
// column on old_kn_collections itself, joined through chiqim_lines one hop
// further, only fetched when the request is expanded).
export function useOldKnCollectionsByRequest(requestId: string | null) {
  const [collections, setCollections] = useState<OldKnCollection[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!requestId) {
      setCollections([])
      return
    }
    setLoading(true)
    try {
      const { data } = await supabase
        .from('old_kn_collections')
        .select('id, chiqim_line_id, pool_id, collected_kg, collected_at, chiqim_lines!inner(request_id)')
        .eq('chiqim_lines.request_id', requestId)
      setCollections(
        (data ?? []).map((row) => ({
          id: row.id,
          chiqim_line_id: row.chiqim_line_id,
          pool_id: row.pool_id,
          collected_kg: row.collected_kg,
          collected_at: row.collected_at,
        })),
      )
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { collections, loading, refresh }
}
