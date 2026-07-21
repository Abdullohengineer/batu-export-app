import { ClientsSection } from '../../components/ClientsSection'

// §3.3 — Menejer's own scope: clients only ("a new buyer shouldn't require
// the owner"). No deactivate control here (Rahbar-only in the UI, even
// though the RLS grant on owners is row-level — see DECISIONS.md "Rahbar
// settings (§3.3)"), and no access to product types/calibres/thresholds at
// all — those routes/nav simply don't exist on Menejer's side.
export function MenejerClientsTab() {
  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Mijozlar</h1>
      <ClientsSection allowDeactivate={false} />
    </div>
  )
}
