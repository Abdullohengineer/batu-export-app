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

  return (
    <AuthContext.Provider value={{ profile: loading ? null : profile, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
