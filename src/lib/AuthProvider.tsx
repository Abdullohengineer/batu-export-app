import { createContext, useContext, type ReactNode } from 'react'
import { useSession } from './useSession'
import { useProfile, type Profile } from './useProfile'

interface AuthContextValue {
  profile: Profile | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue>({ profile: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const { session, loading: sessionLoading } = useSession()
  const { profile, loading: profileLoading } = useProfile(session)

  const loading = sessionLoading || (!!session && profileLoading)
  // 🔒 session and profile are two independently-updating hooks — for one
  // render, right after logout, `session` has already gone null but
  // `useProfile`'s own state hasn't caught up yet (its clearing effect only
  // runs after this render commits), so `profile` here can still be the
  // PREVIOUS session's profile even though `loading` is already false.
  // Found live: an OMBOR→MENEJER relogin cycle landing on /login during
  // that exact window saw a still-truthy (stale) profile and bounced
  // straight back to /ombor — reproducible fast enough (Playwright, not a
  // human clicking) to fail report-effective-qty-parity.spec.ts's Scenario B
  // twice in a row. `session` is the one source of truth for "is anyone
  // logged in" — never expose a profile it doesn't agree with, independent
  // of whatever useProfile's own state hasn't caught up to yet.
  const resolvedProfile = session ? profile : null

  return (
    <AuthContext.Provider value={{ profile: loading ? null : resolvedProfile, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
