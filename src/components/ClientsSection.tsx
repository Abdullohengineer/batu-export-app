import { useState, type FormEvent } from 'react'
import { useOwners } from '../lib/useOwners'
import { createOwner, renameRow, setActive } from '../lib/masterDataAdmin'
import { Button } from './ui/Button'
import { StatusPill } from './ui/StatusPill'
import { SectionHeading } from './ui/SectionHeading'
import { FormField, TextInput } from './ui/FormField'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top text-sm'

// §3.3 — shared between Rahbar's Sozlamalar (full: rename + deactivate) and
// Menejer's Mijozlar (create + rename only, no deactivate control —
// "clients only" scopes which table Menejer can touch, not every verb on
// it; deactivate stays Rahbar-only in the UI even though the RLS grant is
// row-level, see DECISIONS.md "Rahbar settings (§3.3)"). First CRUD admin
// table in this codebase — built from the closest existing furniture (the
// reporting tables' th/td shell + UsersAdminPage's form-section style), a
// deliberate first-of-its-kind rather than a new interaction pattern
// invented for its own sake.
export function ClientsSection({ allowDeactivate }: { allowDeactivate: boolean }) {
  const { owners, loading, refetch } = useOwners(true) // includeInactive: this IS the admin view of every client
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await createOwner(newName.trim())
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    setNewName('')
    await refetch()
  }

  async function handleRename(id: string) {
    if (!editingName.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await renameRow('owners', id, editingName.trim())
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    setEditingId(null)
    await refetch()
  }

  async function handleToggleActive(id: string, active: boolean) {
    setBusy(true)
    setError(null)
    const { error } = await setActive('owners', id, active)
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    await refetch()
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-800">
      <SectionHeading>Mijozlar</SectionHeading>

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                <th className={th}>Nomi</th>
                <th className={th}>Holat</th>
                <th className={th} aria-label="Amallar" />
              </tr>
            </thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o.id} className="border-b border-slate-200 text-sm dark:border-slate-700">
                  <td className={td}>
                    {editingId === o.id ? (
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                        autoFocus
                      />
                    ) : (
                      <span className="text-slate-900 dark:text-slate-100">{o.name}</span>
                    )}
                  </td>
                  <td className={td}>
                    <StatusPill tone={o.active ? 'ok' : 'neutral'}>{o.active ? 'Faol' : 'Nofaol'}</StatusPill>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {editingId === o.id ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="md" disabled={busy} onClick={() => handleRename(o.id)}>
                          Saqlash
                        </Button>
                        <Button variant="ghost" size="md" onClick={() => setEditingId(null)}>
                          Bekor qilish
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={() => {
                            setEditingId(o.id)
                            setEditingName(o.name)
                          }}
                        >
                          Tahrirlash
                        </Button>
                        {allowDeactivate && (
                          <Button variant="secondary" size="md" disabled={busy} onClick={() => handleToggleActive(o.id, !o.active)}>
                            {o.active ? 'Faolsizlantirish' : 'Faollashtirish'}
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>}

      <form onSubmit={handleAdd} className="flex items-end gap-3">
        <div className="flex-1">
          <FormField label="Yangi mijoz nomi">
            <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </FormField>
        </div>
        <Button type="submit" variant="primary" size="md" disabled={busy}>
          Qo'shish
        </Button>
      </form>
    </div>
  )
}
