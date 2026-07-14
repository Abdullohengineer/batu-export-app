import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface ProductType {
  id: string
  name: string
}

export function useProductTypes() {
  const [productTypes, setProductTypes] = useState<ProductType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('product_types')
      .select('id, name')
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        setProductTypes(data ?? [])
        setLoading(false)
      })
  }, [])

  return { productTypes, loading }
}
