import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface ProductType {
  id: string
  name: string
  category_id: string // needed to filter calibres to a type's category (§5.3)
}

export function useProductTypes() {
  const [productTypes, setProductTypes] = useState<ProductType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('product_types')
      .select('id, name, category_id')
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        setProductTypes(data ?? [])
        setLoading(false)
      })
  }, [])

  return { productTypes, loading }
}
