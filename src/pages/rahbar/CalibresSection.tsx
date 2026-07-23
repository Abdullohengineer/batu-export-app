import { useState, type FormEvent } from 'react'
import { useCalibres } from '../../lib/useCalibres'
import { useProductCategories } from '../../lib/useProductCategories'
import { setActive, createCalibre, renameCalibre } from '../../lib/masterDataAdmin'
import { Button } from '../../components/ui/Button'
import { StatusPill } from '../../components/ui/StatusPill'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { FormField, TextInput } from '../../components/ui/FormField'

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
      <SectionHeading>Kalibrlar</SectionHeading>

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
                            setEditingLabel(c.label)
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
        <FormField label="Nomi">
          <TextInput value={newLabel} onChange={(e) => setNewLabel(e.target.value)} required placeholder="Kalibr 10" />
        </FormField>
        <div className="w-24">
          <FormField label="Kod (Barcode #2 uchun)">
            <TextInput value={newCode} onChange={(e) => setNewCode(e.target.value)} required placeholder="10" />
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
        <div className="w-20">
          <FormField label="Tartib raqami">
            <TextInput type="number" value={newSortOrder} onChange={(e) => setNewSortOrder(e.target.value)} placeholder="0" />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={newIsNumberless} onChange={(e) => setNewIsNumberless(e.target.checked)} />
          Raqamsiz (Konditirskiy kabi)
        </label>
        <Button type="submit" variant="primary" size="md" disabled={busy}>
          Qo'shish
        </Button>
      </form>
    </div>
  )
}
