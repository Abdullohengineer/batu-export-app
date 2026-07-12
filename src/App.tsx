import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { useSession } from './lib/useSession'
import { useProfile } from './lib/useProfile'

function App() {
  const { session, loading: sessionLoading } = useSession()
  const { profile, loading: profileLoading } = useProfile(session)

  if (sessionLoading || (session && profileLoading)) return null
  if (!session || !profile) return <LoginPage />

  return <HomePage profile={profile} />
}

export default App
