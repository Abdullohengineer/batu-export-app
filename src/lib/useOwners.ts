import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Owner {
  id: string
  name: string
}

export function useOwners() {
  const [owners, setOwners] = useState<Owner[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('owners')
      .select('id, name')
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        setOwners(data ?? [])
        setLoading(false)
      })
  }, [])

  return { owners, loading }
}
