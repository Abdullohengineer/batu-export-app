import { useState, type FormEvent } from 'react'
import { useProductTypes } from '../../lib/useProductTypes'
import { useProductCategories } from '../../lib/useProductCategories'
import { renameRow, setActive, createProductType } from '../../lib/masterDataAdmin'
import { Button } from '../../components/ui/Button'
import { StatusPill } from '../../components/ui/StatusPill'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { FormField, TextInput } from '../../components/ui/FormField'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top text-sm'

// §3.3 — Rahbar-only. Same shell as ProductCategoriesSection, plus a
// category picker (active categories only — a new type shouldn't be
// assignable to an already-deactivated category, same "active-only for
// new-entry" rule §3.3's data-layer fix established everywhere else).
export function ProductTypesSection() {
  const { productTypes, loading, refetch } = useProductTypes(true)
  const { categories } = useProductCategories() // active-only: category picker for new types

  function categoryName(id: string) {
    return categories.find((c) => c.id === id)?.name ?? id
  }

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newName, setNewName] = useState('')
  const [newCategoryId, setNewCategoryId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !newCategoryId) return
    setBusy(true)
    setError(null)
    const { error } = await createProductType(newName.trim(), newCategoryId)
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
    const { error } = await renameRow('product_types', id, editingName.trim())
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
    const { error } = await setActive('product_types', id, active)
    setBusy(false)
    if (error) {
      setError(error)
      return
    }
    await refetch()
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 p-6 dark:border-slate-800">
      <SectionHeading>Mahsulot turlari</SectionHeading>

      {loading ? (
        <p className="text-sm text-slate-400">Yuklanmoqda…</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                <th className={th}>Nomi</th>
                <th className={th}>Turkum</th>
                <th className={th}>Holat</th>
                <th className={th} aria-label="Amallar" />
              </tr>
            </thead>
            <tbody>
              {productTypes.map((t) => (
                <tr key={t.id} className="border-b border-slate-200 text-sm dark:border-slate-700">
                  <td className={td}>
                    {editingId === t.id ? (
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                        autoFocus
                      />
                    ) : (
                      <span className="text-slate-900 dark:text-slate-100">{t.name}</span>
                    )}
                  </td>
                  <td className={`${td} text-slate-600 dark:text-slate-300`}>{categoryName(t.category_id)}</td>
                  <td className={td}>
                    <StatusPill tone={t.active ? 'ok' : 'neutral'}>{t.active ? 'Faol' : 'Nofaol'}</StatusPill>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {editingId === t.id ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="md" disabled={busy} onClick={() => handleRename(t.id)}>
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
                            setEditingId(t.id)
                            setEditingName(t.name)
                          }}
                        >
                          Tahrirlash
                        </Button>
                        <Button variant="secondary" size="md" disabled={busy} onClick={() => handleToggleActive(t.id, !t.active)}>
                          {t.active ? 'Faolsizlantirish' : 'Faollashtirish'}
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
          <FormField label="Yangi tur nomi">
            <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </FormField>
        </div>
        <FormField label="Turkum">
          <select
            value={newCategoryId}
            onChange={(e) => setNewCategoryId(e.target.value)}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        <Button type="submit" variant="primary" size="md" disabled={busy}>
          Qo'shish
        </Button>
      </form>
    </div>
  )
}
