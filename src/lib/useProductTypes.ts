import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface ProductType {
  id: string
  name: string
  category_id: string // needed to filter calibres to a type's category (§5.3)
  active: boolean
}

// §3.3: default (includeInactive=false) is for NEW-ENTRY dropdowns only.
// Any id->name RESOLUTION for a historical row, or any filter/selection
// dropdown over existing data, must pass includeInactive: true -- see
// useOwners.ts for the full rationale. `refetch` lets the Sozlamalar admin
// screen reload after a create/rename/deactivate.
export function useProductTypes(includeInactive = false) {
  const [productTypes, setProductTypes] = useState<ProductType[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(() => {
    setLoading(true)
    let query = supabase.from('product_types').select('id, name, category_id, active').order('name')
    if (!includeInactive) query = query.eq('active', true)
    return query.then(({ data }) => {
      setProductTypes(data ?? [])
      setLoading(false)
    })
  }, [includeInactive])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { productTypes, loading, refetch }
}
