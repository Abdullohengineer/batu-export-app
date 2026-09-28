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
  // Whose answer `profile` is: the user id it was fetched for, null once
  // cleared for "no session", undefined before the first answer.
  //
  // Post-Rezka cleanup item 4 (2026-09-28, docs/decisions/0230): loading is
  // DERIVED from this, never stored. It used to be a separate flag that the
  // "no session yet" effect set to false on mount; when getSession() then
  // resolved, there was one render with a session, no profile and
  // loading=false -- before this effect had re-run to start the fetch -- so
  // RoleRoute saw "logged in, no profile" and redirected to /login, which
  // bounced to the role's home. Every hard load of a deep route
  // (/menejer/hisobot, a bookmark, a refresh) landed on KIRIM / the
  // dashboard instead. Now "session present, profile not yet loaded for
  // THIS user" is loading by construction, including the relogin-as-a-
  // different-user case (the previous user's answer never counts).
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setLoadedFor(null)
      return
    }

    let cancelled = false
    const userId = session.user.id
    supabase
      .from('profiles')
      .select('id, full_name, role, active, language, phone, owner_id')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        // A newer session superseded this fetch -- its own effect answers.
        if (cancelled) return
        setProfile(data)
        setLoadedFor(userId)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  const loading = session ? loadedFor !== session.user.id : loadedFor === undefined
  return { profile, loading }
}
