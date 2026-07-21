import { useState, type FormEvent } from 'react'
import { useOwners } from '../lib/useOwners'
import { createOwner, renameRow, setActive } from '../lib/masterDataAdmin'

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
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Mijozlar</h2>

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
                    <span
                      className={
                        o.active
                          ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                          : 'rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }
                    >
                      {o.active ? 'Faol' : 'Nofaol'}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {editingId === o.id ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => handleRename(o.id)} className="mr-2 text-slate-700 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100">
                          Saqlash
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                          Bekor qilish
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(o.id)
                            setEditingName(o.name)
                          }}
                          className="mr-2 text-slate-600 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                        >
                          Tahrirlash
                        </button>
                        {allowDeactivate && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleToggleActive(o.id, !o.active)}
                            className="text-slate-600 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                          >
                            {o.active ? 'Faolsizlantirish' : 'Faollashtirish'}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <form onSubmit={handleAdd} className="flex items-end gap-3">
        <label className="flex flex-1 flex-col text-xs text-slate-500 dark:text-slate-400">
          Yangi mijoz nomi
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Qo'shish
        </button>
      </form>
    </div>
  )
}
