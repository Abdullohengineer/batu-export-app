import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'
import type { UserRole } from '../lib/useProfile'

// Route guard (SPEC §1.1) — a logged-in user may only reach their own
// role's pages. Enforced here in the client for navigation UX; the real
// enforcement is server-side via RLS (§2.12, supabase/migrations/0007_rls.sql).
export function RoleRoute({ allow, children }: { allow: UserRole[]; children: ReactNode }) {
  const { profile } = useAuth()

  if (!profile) return <Navigate to="/login" replace />
  if (!allow.includes(profile.role)) return <Navigate to={`/${profile.role}`} replace />

  return <>{children}</>
}
