import { useState } from 'react'
import { useNotes } from '../lib/useNotes'

// Reusable append-only Qaydlar UI (SPEC §2.5): a note list + a
// "Qaydlar qo'shish" add form. No edit/delete controls by design — append
// only. First used by Ombor's Moyka tab (§5.2); intended for reuse anywhere
// an entity needs notes.
export function EntityNotes({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { notes, addNote } = useNotes(entityType, entityId)
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    if (!body.trim()) return
    setSaving(true)
    setError(null)
    try {
      await addNote(body)
      setBody('')
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xatolik yuz berdi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((n) => (
            <li key={n.id} className="text-sm text-slate-600 dark:text-slate-400">
              {n.body}
              <span className="ml-2 text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !body.trim()}
              className="rounded-md bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {saving ? 'Saqlanmoqda…' : 'Saqlash'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setBody('')
                setError(null)
              }}
              className="rounded-md px-3 py-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
            >
              Bekor qilish
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-slate-700 underline dark:text-slate-300"
        >
          Qaydlar qo'shish
        </button>
      )}
    </div>
  )
}
