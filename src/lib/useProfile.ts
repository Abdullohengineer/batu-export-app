import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type UserRole = 'rahbar' | 'menejer' | 'qorovul' | 'ombor' | 'laborator' | 'client'

export interface Profile {
  id: string
  full_name: string | null
  role: UserRole
  active: boolean
  language: 'uz' | 'ru'
  phone: string | null
  // Only set for role='client' — links this login to one `owners` row
  // (supabase/migrations/0083_client_role_rls_and_reporting.sql). Null for
  // every internal-staff role.
  owner_id: string | null
}

export function useProfile(session: Session | null) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setLoading(false)
      return
    }

    setLoading(true)
    supabase
      .from('profiles')
      .select('id, full_name, role, active, language, phone, owner_id')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setProfile(data)
        setLoading(false)
      })
  }, [session])

  return { profile, loading }
}
