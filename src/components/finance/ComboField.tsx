import { useId, useMemo, useState } from 'react'

// Buxgalteriya combo input (brief invariant 2): type to filter existing rows,
// pick one, or create a new row inline ("+ … qo'shish") and select it -- no
// settings page. Used for counterparties (Qabul qiluvchi) and categories.
export interface ComboOption {
  id: string
  name: string
  hint?: string
}

export function ComboField({
  label,
  value,
  options,
  onSelect,
  onCreate,
  addLabel,
  placeholder,
  helpText,
  allowClear = false,
}: {
  label: string
  value: ComboOption | null
  options: ComboOption[]
  onSelect: (option: ComboOption | null) => void
  onCreate: (name: string) => Promise<ComboOption>
  addLabel: (name: string) => string
  placeholder?: string
  helpText?: string
  allowClear?: boolean
}) {
  const inputId = useId()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const text = open ? query : value?.name ?? ''
  const q = query.trim().toLowerCase()
  const matches = useMemo(
    () => (q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options).slice(0, 8),
    [options, q],
  )
  const exact = options.some((o) => o.name.trim().toLowerCase() === q)

  function pick(o: ComboOption | null) {
    onSelect(o)
    setOpen(false)
    setQuery('')
    setError(null)
  }

  async function create() {
    const name = query.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    try {
      pick(await onCreate(name))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Qo'shib bo'lmadi.")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(e) => {
          setOpen(true)
          setQuery(e.target.value)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (matches.length > 0 && q) pick(matches[0])
            else if (q && !exact) void create()
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {matches.length > 0 && (
            <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Mavjud · {matches.length} ta
            </div>
          )}
          {matches.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={value?.id === o.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              className="block w-full rounded px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span className="block text-sm text-slate-900 dark:text-slate-100">{o.name}</span>
              {o.hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{o.hint}</span>}
            </button>
          ))}
          {q && !exact && (
            <button
              type="button"
              disabled={creating}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void create()}
              className="mt-1 block w-full rounded border-t border-slate-100 px-2 py-2 text-left text-sm font-medium text-teal-700 hover:bg-teal-50 dark:border-slate-800 dark:text-teal-400 dark:hover:bg-teal-950/40"
            >
              {creating ? 'Qo‘shilmoqda…' : `+ ${addLabel(query.trim())}`}
            </button>
          )}
          {allowClear && value && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(null)}
              className="block w-full rounded px-2 py-2 text-left text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Tanlovni olib tashlash
            </button>
          )}
          {matches.length === 0 && !q && <div className="px-2 py-2 text-sm text-slate-400">Hali yozuv yo'q — nomini yozing.</div>}
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {helpText && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helpText}</p>}
    </div>
  )
}
