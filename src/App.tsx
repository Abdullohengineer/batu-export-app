import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthProvider'
import { RoleRoute } from './routes/RoleRoute'
import { LoginPage } from './pages/LoginPage'
import { RahbarLayout } from './pages/rahbar/RahbarLayout'
import { RahbarHome } from './pages/rahbar/RahbarHome'
import { UsersAdminPage } from './pages/admin/UsersAdminPage'
import { MenejerHome } from './pages/menejer/MenejerHome'
import { QorovulHome } from './pages/qorovul/QorovulHome'
import { QorovulKirimTab } from './pages/qorovul/QorovulKirimTab'
import { QorovulHisobotlar } from './pages/qorovul/QorovulHisobotlar'
import { OmborHome } from './pages/ombor/OmborHome'
import { OmborIntakeTab } from './pages/ombor/OmborIntakeTab'
import { OmborHisobotlar } from './pages/ombor/OmborHisobotlar'
import { LaboratorHome } from './pages/laborator/LaboratorHome'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

function AppRoutes() {
  const { profile, loading } = useAuth()

  if (loading) return null

  const homePath = profile ? `/${profile.role}` : '/login'

  return (
    <Routes>
      <Route path="/login" element={profile ? <Navigate to={homePath} replace /> : <LoginPage />} />

      <Route
        path="/rahbar"
        element={
          <RoleRoute allow={['rahbar']}>
            <RahbarLayout />
          </RoleRoute>
        }
      >
        <Route index element={<RahbarHome />} />
        <Route path="foydalanuvchilar" element={<UsersAdminPage />} />
      </Route>

      <Route
        path="/menejer"
        element={
          <RoleRoute allow={['menejer']}>
            <MenejerHome />
          </RoleRoute>
        }
      />
      <Route
        path="/qorovul"
        element={
          <RoleRoute allow={['qorovul']}>
            <QorovulHome />
          </RoleRoute>
        }
      >
        <Route index element={<QorovulKirimTab />} />
        <Route path="hisobotlar" element={<QorovulHisobotlar />} />
      </Route>
      <Route
        path="/ombor"
        element={
          <RoleRoute allow={['ombor']}>
            <OmborHome />
          </RoleRoute>
        }
      >
        <Route index element={<OmborIntakeTab />} />
        <Route path="hisobotlar" element={<OmborHisobotlar />} />
      </Route>
      <Route
        path="/laborator"
        element={
          <RoleRoute allow={['laborator']}>
            <LaboratorHome />
          </RoleRoute>
        }
      />

      <Route path="*" element={<Navigate to={homePath} replace />} />
    </Routes>
  )
}

export default App
