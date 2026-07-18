import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Small master-list lookup, same shape as useOwners/useProductTypes/
// useCalibres — id -> full_name, for resolving actor columns (created_by,
// ombor_finished_by, stage1_created_by, stage2_created_by) to a display
// name. profiles has a read_all policy for every signed-in user (confirmed
// live before building this), so no new RLS is needed.
export function useProfileNames() {
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name')
      .then(({ data }) => {
        const map: Record<string, string> = {}
        for (const p of data ?? []) map[p.id] = p.full_name
        setNames(map)
        setLoading(false)
      })
  }, [])

  return { names, loading }
}
