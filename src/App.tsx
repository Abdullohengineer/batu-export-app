import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthProvider'
import { RoleRoute } from './routes/RoleRoute'
import { LoginPage } from './pages/LoginPage'
import { RahbarLayout } from './pages/rahbar/RahbarLayout'
import { RahbarHome } from './pages/rahbar/RahbarHome'
import { UsersAdminPage } from './pages/admin/UsersAdminPage'
import { MenejerHome } from './pages/menejer/MenejerHome'
import { MenejerKirimTab } from './pages/menejer/MenejerKirimTab'
import { MenejerChiqimTab } from './pages/menejer/MenejerChiqimTab'
import { HisobotTab } from './pages/reports/HisobotTab'
import { StockOnHandTab } from './pages/reports/StockOnHandTab'
import { WipTab } from './pages/reports/WipTab'
import { ClientReportTab } from './pages/reports/ClientReportTab'
import { QorovulHome } from './pages/qorovul/QorovulHome'
import { QorovulKirimTab } from './pages/qorovul/QorovulKirimTab'
import { QorovulChiqimTab } from './pages/qorovul/QorovulChiqimTab'
import { QorovulHisobotlar } from './pages/qorovul/QorovulHisobotlar'
import { OmborHome } from './pages/ombor/OmborHome'
import { OmborIntakeTab } from './pages/ombor/OmborIntakeTab'
import { OmborMoykaTab } from './pages/ombor/OmborMoykaTab'
import { OmborTayyorTab } from './pages/ombor/OmborTayyorTab'
import { OmborChiqimTab } from './pages/ombor/OmborChiqimTab'
import { OmborHisobotlar } from './pages/ombor/OmborHisobotlar'
import { LaboratorHome } from './pages/laborator/LaboratorHome'
import { LaboratorKirimTab } from './pages/laborator/LaboratorKirimTab'
import { LaboratorChiqimTab } from './pages/laborator/LaboratorChiqimTab'

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
        <Route path="hisobotlar" element={<HisobotTab />} />
        <Route path="qoldiq" element={<StockOnHandTab />} />
        <Route path="kutilmoqda" element={<WipTab />} />
        <Route path="mijoz-hisoboti" element={<ClientReportTab />} />
        <Route path="foydalanuvchilar" element={<UsersAdminPage />} />
      </Route>

      <Route
        path="/menejer"
        element={
          <RoleRoute allow={['menejer']}>
            <MenejerHome />
          </RoleRoute>
        }
      >
        <Route index element={<MenejerKirimTab />} />
        <Route path="chiqim" element={<MenejerChiqimTab />} />
        <Route path="hisobot" element={<HisobotTab />} />
        <Route path="qoldiq" element={<StockOnHandTab />} />
        <Route path="kutilmoqda" element={<WipTab />} />
        <Route path="mijoz-hisoboti" element={<ClientReportTab />} />
      </Route>
      <Route
        path="/qorovul"
        element={
          <RoleRoute allow={['qorovul']}>
            <QorovulHome />
          </RoleRoute>
        }
      >
        <Route index element={<QorovulKirimTab />} />
        <Route path="chiqim" element={<QorovulChiqimTab />} />
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
        <Route path="moyka" element={<OmborMoykaTab />} />
        <Route path="tayyor" element={<OmborTayyorTab />} />
        <Route path="chiqim" element={<OmborChiqimTab />} />
        <Route path="hisobotlar" element={<OmborHisobotlar />} />
      </Route>
      <Route
        path="/laborator"
        element={
          <RoleRoute allow={['laborator']}>
            <LaboratorHome />
          </RoleRoute>
        }
      >
        <Route index element={<LaboratorKirimTab />} />
        <Route path="chiqim" element={<LaboratorChiqimTab />} />
      </Route>

      <Route path="*" element={<Navigate to={homePath} replace />} />
    </Routes>
  )
}

export default App
