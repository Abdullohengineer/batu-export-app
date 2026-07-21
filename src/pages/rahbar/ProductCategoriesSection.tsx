import { useState, type FormEvent } from 'react'
import { useProductCategories } from '../../lib/useProductCategories'
import { renameRow, setActive, createProductCategory } from '../../lib/masterDataAdmin'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top text-sm'

// §3.3 — Rahbar-only. Same list/rename/deactivate/add shell as
// ClientsSection.tsx, one extra field (calibre_applies) on create.
export function ProductCategoriesSection() {
  const { categories, loading, refetch } = useProductCategories(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newName, setNewName] = useState('')
  const [newCalibreApplies, setNewCalibreApplies] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await createProductCategory(newName.trim(), newCalibreApplies)
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
    const { error } = await renameRow('product_categories', id, editingName.trim())
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
    const { error } = await setActive('product_categories', id, active)
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    await refetch()
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-800">
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Mahsulot turkumlari</h2>

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                <th className={th}>Nomi</th>
                <th className={th}>Kalibrga bo'linadimi</th>
                <th className={th}>Holat</th>
                <th className={th} aria-label="Amallar" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-b border-slate-200 text-sm dark:border-slate-700">
                  <td className={td}>
                    {editingId === c.id ? (
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                        autoFocus
                      />
                    ) : (
                      <span className="text-slate-900 dark:text-slate-100">{c.name}</span>
                    )}
                  </td>
                  <td className={td}>{c.calibre_applies ? 'Ha' : "Yo'q"}</td>
                  <td className={td}>
                    <span
                      className={
                        c.active
                          ? 'rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                          : 'rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }
                    >
                      {c.active ? 'Faol' : 'Nofaol'}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {editingId === c.id ? (
                      <>
                        <button type="button" disabled={busy} onClick={() => handleRename(c.id)} className="mr-2 text-slate-700 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100">
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
                            setEditingId(c.id)
                            setEditingName(c.name)
                          }}
                          className="mr-2 text-slate-600 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                        >
                          Tahrirlash
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleToggleActive(c.id, !c.active)}
                          className="text-slate-600 underline decoration-dotted hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                        >
                          {c.active ? 'Faolsizlantirish' : 'Faollashtirish'}
                        </button>
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

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col text-xs text-slate-500 dark:text-slate-400">
          Yangi turkum nomi
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={newCalibreApplies} onChange={(e) => setNewCalibreApplies(e.target.checked)} />
          Kalibrga bo'linadi
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
