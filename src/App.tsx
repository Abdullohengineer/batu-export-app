import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { useSession } from './lib/useSession'

function App() {
  const { session, loading } = useSession()

  if (loading) return null

  return session ? <HomePage /> : <LoginPage />
}

export default App
