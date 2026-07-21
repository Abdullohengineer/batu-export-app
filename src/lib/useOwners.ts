import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Owner {
  id: string
  name: string
  active: boolean
}

// §2.4 OWNERS master data. Default (includeInactive=false) is for NEW-ENTRY
// dropdowns only (KIRIM/CHIQIM forms) -- a deactivated client must still be
// selectable to view/filter their history, and any id->name RESOLUTION for
// a historical row must never drop to a raw uuid just because that owner
// was deactivated after the row was created (§3.3). Pass
// includeInactive: true at any call site doing either of those things.
// `refetch` (§3.3, new) lets the Sozlamalar/Mijozlar admin screens reload
// the list after a create/rename/deactivate without a full page reload.
export function useOwners(includeInactive = false) {
  const [owners, setOwners] = useState<Owner[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(() => {
    setLoading(true)
    let query = supabase.from('owners').select('id, name, active').order('name')
    if (!includeInactive) query = query.eq('active', true)
    return query.then(({ data }) => {
      setOwners(data ?? [])
      setLoading(false)
    })
  }, [includeInactive])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { owners, loading, refetch }
}
