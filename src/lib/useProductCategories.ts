import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface ProductCategory {
  id: string
  name: string
  calibre_applies: boolean
  active: boolean
}

// §3.3 new — no admin screen existed before this task, so no consumer of
// product_categories as a standalone list existed either (product_types/
// calibres reference it only via category_id). Default (includeInactive=
// false) is for assigning a NEW type/calibre to a category; the §3.3
// Sozlamalar screen itself passes includeInactive: true to manage every
// category regardless of status. `refetch` reloads after a mutation.
export function useProductCategories(includeInactive = false) {
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(() => {
    setLoading(true)
    let query = supabase.from('product_categories').select('id, name, calibre_applies, active').order('name')
    if (!includeInactive) query = query.eq('active', true)
    return query.then(({ data }) => {
      setCategories(data ?? [])
      setLoading(false)
    })
  }, [includeInactive])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { categories, loading, refetch }
}
