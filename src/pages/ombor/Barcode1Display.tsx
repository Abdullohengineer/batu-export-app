import { useState } from 'react'

// Displays the already-generated Barcode #1 value, large and legible
// on-screen (SPEC §5.1) — this is what would get physically stuck on the
// pile once real printing exists (Phase 2). Re-displays the stored code;
// never generates a new one.
export function Barcode1Display({ code }: { code: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Barcode #1
      </button>
      {open && (
        <div className="mt-2 rounded-md border-2 border-slate-900 bg-white p-4 text-center dark:border-slate-100 dark:bg-slate-950">
          <div className="font-mono text-3xl font-bold tracking-widest text-slate-900 dark:text-slate-100">
            {code}
          </div>
        </div>
      )}
    </div>
  )
}
