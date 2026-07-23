import { useState, type FormEvent } from 'react'
import { useProductCategories } from '../../lib/useProductCategories'
import { renameRow, setActive, createProductCategory } from '../../lib/masterDataAdmin'
import { Button } from '../../components/ui/Button'
import { StatusPill } from '../../components/ui/StatusPill'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { FormField, TextInput } from '../../components/ui/FormField'

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
      <SectionHeading>Mahsulot turkumlari</SectionHeading>

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
                    <StatusPill tone={c.active ? 'ok' : 'neutral'}>{c.active ? 'Faol' : 'Nofaol'}</StatusPill>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {editingId === c.id ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="md" disabled={busy} onClick={() => handleRename(c.id)}>
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
                            setEditingId(c.id)
                            setEditingName(c.name)
                          }}
                        >
                          Tahrirlash
                        </Button>
                        <Button variant="secondary" size="md" disabled={busy} onClick={() => handleToggleActive(c.id, !c.active)}>
                          {c.active ? 'Faolsizlantirish' : 'Faollashtirish'}
                        </Button>
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

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <FormField label="Yangi turkum nomi">
            <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={newCalibreApplies} onChange={(e) => setNewCalibreApplies(e.target.checked)} />
          Kalibrga bo'linadi
        </label>
        <Button type="submit" variant="primary" size="md" disabled={busy}>
          Qo'shish
        </Button>
      </form>
    </div>
  )
}
