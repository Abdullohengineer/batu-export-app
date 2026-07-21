import { useState, type FormEvent } from 'react'
import { useCalibres } from '../../lib/useCalibres'
import { useProductCategories } from '../../lib/useProductCategories'
import { setActive, createCalibre, renameCalibre } from '../../lib/masterDataAdmin'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top text-sm'

// §3.3 — Rahbar-only. calibres was the one master table with no `active`
// column before this task (§3.3's own migration added it). Code/is_numberless
// are set once at creation (they feed Barcode #2 formatting, §2.2) and are
// not editable here — only the display label and active status are.
export function CalibresSection() {
  const { calibres, loading, refetch } = useCalibres(true)
  const { categories } = useProductCategories() // active-only: category picker for new calibres

  function categoryName(id: string) {
    return categories.find((c) => c.id === id)?.name ?? id
  }

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newCode, setNewCode] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [newIsNumberless, setNewIsNumberless] = useState(false)
  const [newSortOrder, setNewSortOrder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!newLabel.trim() || !newCode.trim() || !newCategoryId) return
    setBusy(true)
    setError(null)
    const { error } = await createCalibre(newLabel.trim(), newCode.trim(), newCategoryId, newIsNumberless, Number(newSortOrder) || 0)
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    setNewLabel('')
    setNewCode('')
    setNewSortOrder('')
    await refetch()
  }

  async function handleRename(id: string) {
    if (!editingLabel.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await renameCalibre(id, editingLabel.trim())
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
    const { error } = await setActive('calibres', id, active)
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    await refetch()
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-800">
      <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Kalibrlar</h2>

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                <th className={th}>Nomi</th>
                <th className={th}>Kod</th>
                <th className={th}>Turkum</th>
                <th className={th}>Holat</th>
                <th className={th} aria-label="Amallar" />
              </tr>
            </thead>
            <tbody>
              {calibres.map((c) => (
                <tr key={c.id} className="border-b border-slate-200 text-sm dark:border-slate-700">
                  <td className={td}>
                    {editingId === c.id ? (
                      <input
                        value={editingLabel}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                        autoFocus
                      />
                    ) : (
                      <span className="text-slate-900 dark:text-slate-100">{c.label}</span>
                    )}
                  </td>
                  <td className={`${td} font-mono text-slate-600 dark:text-slate-300`}>{c.code}</td>
                  <td className={`${td} text-slate-600 dark:text-slate-300`}>{categoryName(c.category_id)}</td>
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
                            setEditingLabel(c.label)
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
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Nomi
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            required
            placeholder="Kalibr 10"
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Kod (Barcode #2 uchun)
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            required
            placeholder="10"
            className="mt-1 w-24 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Turkum
          <select
            value={newCategoryId}
            onChange={(e) => setNewCategoryId(e.target.value)}
            required
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500 dark:text-slate-400">
          Tartib raqami
          <input
            type="number"
            value={newSortOrder}
            onChange={(e) => setNewSortOrder(e.target.value)}
            placeholder="0"
            className="mt-1 w-20 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={newIsNumberless} onChange={(e) => setNewIsNumberless(e.target.checked)} />
          Raqamsiz (Konditirskiy kabi)
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
