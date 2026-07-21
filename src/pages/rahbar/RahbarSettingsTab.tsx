import { ClientsSection } from '../../components/ClientsSection'
import { ProductCategoriesSection } from './ProductCategoriesSection'
import { ProductTypesSection } from './ProductTypesSection'
import { CalibresSection } from './CalibresSection'
import { ThresholdsSection } from './ThresholdsSection'

// §3.3 Rahbar settings — master data (categories/types/calibres/clients)
// and threshold management. Rahbar-only, everything else Rahbar can write
// (§6.4 Boshqaruv). Deactivate, never delete (§2.15) — every section below
// toggles `active`, none exposes a delete action. Same stacked-sections-
// in-one-page shell as the existing UsersAdminPage.tsx (Foydalanuvchilar),
// which this page sits alongside — no new page layout invented.
export function RahbarSettingsTab() {
  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Sozlamalar</h1>
      <ClientsSection allowDeactivate />
      <ProductCategoriesSection />
      <ProductTypesSection />
      <CalibresSection />
      <ThresholdsSection />
    </div>
  )
}
