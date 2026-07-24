import { useState } from 'react'
import { usePrinter } from '../../lib/usePrinter'
import { pluginErrorMessage } from '../../lib/p1Printer'

// Requirement D: a small UI for Ombor to pick the P1 printer once, plus an
// unobtrusive connection-state dot "near the print button" (rendered inline
// by Barcode1Display/Barcode2Display, not a separate settings screen) so a
// failed print isn't the first sign something's off. Renders nothing on the
// web build — usePrinter()'s `available` is false there (no server.url,
// no plugin), which is the feature-detect requirement G calls for.
export function PrinterStatus() {
  const { available, selected, connected, scanning, printers, loadingSelected, scan, select } = usePrinter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectingTo, setConnectingTo] = useState<string | null>(null)

  if (!available || loadingSelected) return null

  async function handleOpen() {
    setError(null)
    setOpen((o) => !o)
    if (!open) {
      try {
        await scan()
      } catch (err) {
        setError(pluginErrorMessage(err))
      }
    }
  }

  async function handleSelect(printer: { address: string; name: string }) {
    setError(null)
    setConnectingTo(printer.address)
    try {
      await select(printer)
      setOpen(false)
    } catch (err) {
      setError(pluginErrorMessage(err))
    } finally {
      setConnectingTo(null)
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'}`} />
        {selected ? selected.name : 'Printer tanlanmagan'}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-md border border-slate-300 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {scanning ? 'Qidirilmoqda…' : 'Topilgan printerlar'}
            </span>
            <button
              type="button"
              onClick={() => scan().catch((err) => setError(pluginErrorMessage(err)))}
              disabled={scanning}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Qayta qidirish
            </button>
          </div>

          {!scanning && printers.length === 0 && (
            <p className="px-1 py-2 text-xs text-slate-500 dark:text-slate-400">
              Hech narsa topilmadi. Printer yoqilgan va Bluetooth ulanganini tekshiring.
            </p>
          )}

          <ul className="mt-1 space-y-0.5">
            {printers.map((p) => (
              <li key={p.address}>
                <button
                  type="button"
                  onClick={() => handleSelect(p)}
                  disabled={connectingTo === p.address}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <span className="truncate">{p.name}</span>
                  {selected?.address === p.address && (
                    <span className="shrink-0 text-emerald-600 dark:text-emerald-400">✓</span>
                  )}
                  {connectingTo === p.address && <span className="shrink-0 text-xs">…</span>}
                </button>
              </li>
            ))}
          </ul>

          {error && (
            <p className="mt-1 px-1 text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
