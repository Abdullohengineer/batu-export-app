import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface RawDispatchLine {
  id: string
  chiqim_line_id: string
  serial: string
  weight_kg: number
  box_mass_kg: number
  net_kg: number
  loaded_at: string
}

// §5.4 Ombor CHIQIM Window 2 — raw dispatch's own post-finish display,
// sibling to useDispatchManifestLines.ts (same "only fetch when expanded"
// rule, same flat/never-regrouped shape). raw_dispatch_lines has no
// request_id column of its own (only chiqim_line_id, see 0042) -- joined
// through chiqim_lines the same way dispatch_manifest is filtered by its own
// direct request_id, just one hop further.
export function useRawDispatchLinesByRequest(requestId: string | null) {
  const [lines, setLines] = useState<RawDispatchLine[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!requestId) {
      setLines([])
      return
    }
    setLoading(true)
    try {
      const { data } = await supabase
        .from('raw_dispatch_lines')
        .select('id, chiqim_line_id, serial, weight_kg, box_mass_kg, net_kg, loaded_at, chiqim_lines!inner(request_id)')
        .eq('chiqim_lines.request_id', requestId)
      setLines(
        (data ?? []).map((row) => ({
          id: row.id,
          chiqim_line_id: row.chiqim_line_id,
          serial: row.serial,
          weight_kg: row.weight_kg,
          box_mass_kg: row.box_mass_kg,
          net_kg: row.net_kg,
          loaded_at: row.loaded_at,
        })),
      )
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { lines, loading, refresh }
}
