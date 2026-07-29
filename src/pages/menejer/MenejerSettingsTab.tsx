import { ClientsSection } from '../../components/ClientsSection'
import { ProductCategoriesSection } from './ProductCategoriesSection'
import { ProductTypesSection } from './ProductTypesSection'
import { CalibresSection } from './CalibresSection'
import { ThresholdsSection } from './ThresholdsSection'

// §3.3 Sozlamalar — master data (categories/types/calibres/clients) and
// threshold management. Deactivate, never delete (§2.15) — every section
// below toggles `active`, none exposes a delete action. Same stacked-
// sections-in-one-page shell as UsersAdminPage.tsx (Foydalanuvchilar),
// which this page sits alongside — no new page layout invented.
//
// Moved from Rahbar to Menejer (see DECISIONS.md "Boshqaruv moved to
// Menejer") — content/behavior unchanged, including `<ClientsSection
// allowDeactivate />` staying on, so Menejer now has a deactivate control on
// clients here in addition to the existing no-deactivate Mijozlar screen
// (MenejerClientsTab.tsx) — an intentional overlap, not new content, since
// this screen moved as-is per that task's explicit scope.
export function MenejerSettingsTab() {
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
