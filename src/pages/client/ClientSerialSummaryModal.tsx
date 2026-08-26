import { useEffect, useState } from 'react'
import { fetchClientSerialSummary, type ClientSerialSummary } from '../../lib/clientPortalReport'
import { useCalibres } from '../../lib/useCalibres'
import { GatePhoto } from '../../components/GatePhoto'
import { Lightbox } from '../../components/Lightbox'
import { formatDate } from '../../lib/formatDate'

function kg(v: number): string {
  return `${Math.round(v).toLocaleString()} кг`
}

// Global Export's per-serial drill-down — deliberately NOT the internal
// serial passport (task: "a view section like hisobot, but without
// passport"). Shows exactly what was asked: output by calibre + KN + loss,
// and links to every nakladnoy (KIRIM waybill photo + every CHIQIM
// departure waybill photo this serial's material was actually dispatched
// under) so the client can cross-reference against the physical documents
// Qorovul/Menejer attach.
export function ClientSerialSummaryModal({ serial, onClose }: { serial: string; onClose: () => void }) {
  const [summary, setSummary] = useState<ClientSerialSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null)
  const { calibres } = useCalibres(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchClientSerialSummary(serial)
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка загрузки')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [serial])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (lightbox) {
        setLightbox(null)
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, lightbox])

  function calibreLabel(id: string): string {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Серия ${serial}`}
      onClick={onClose}
    >
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">Серия — {serial}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-md px-2 py-1 text-xl leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            ×
          </button>
        </div>

        <div className="max-h-[80vh] space-y-5 overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-slate-400">Загрузка…</p>}
          {error && (
            <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && !summary && (
            <p className="text-sm text-slate-400">Данные не найдены.</p>
          )}

          {summary && (
            <>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Выход по калибрам</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {summary.byCalibre.map((c) => (
                      <tr key={c.calibreId} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-1 text-slate-600 dark:text-slate-400">{calibreLabel(c.calibreId)}</td>
                        <td className="py-1 text-right tabular-nums text-slate-900 dark:text-slate-100">{kg(c.weightKg)}</td>
                      </tr>
                    ))}
                    {summary.byCalibre.length === 0 && (
                      <tr>
                        <td colSpan={2} className="py-1 text-slate-400">
                          Ещё нет выхода
                        </td>
                      </tr>
                    )}
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-1 text-slate-600 dark:text-slate-400">Кондитерский (КН)</td>
                      <td className="py-1 text-right tabular-nums text-slate-900 dark:text-slate-100">{kg(summary.knKg)}</td>
                    </tr>
                    <tr>
                      <td className="py-1 font-medium text-slate-700 dark:text-slate-300">Убыток</td>
                      <td className="py-1 text-right tabular-nums font-medium text-slate-900 dark:text-slate-100">
                        {summary.lossKg === null ? 'ещё в переработке' : kg(summary.lossKg)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">Накладные</h3>
                {!summary.kirimNakladnoy && summary.chiqimNakladnoys.length === 0 && (
                  <p className="text-sm text-slate-400">Накладные пока не прикреплены.</p>
                )}
                <div className="flex flex-wrap gap-3">
                  {summary.kirimNakladnoy && (
                    <div className="flex flex-col items-center gap-1">
                      <GatePhoto
                        path={summary.kirimNakladnoy.photoUrl}
                        label={`Накладная — приход (${formatDate(summary.kirimNakladnoy.date)})`}
                        bucket="kirim-photos"
                        thumbnail
                        onOpen={(url, label) => setLightbox({ url, label })}
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">Приход</span>
                    </div>
                  )}
                  {summary.chiqimNakladnoys.map((n) => (
                    <div key={n.requestId} className="flex flex-col items-center gap-1">
                      <GatePhoto
                        path={n.photoUrl}
                        label={`Накладная — отгрузка (${formatDate(n.date)}, ${n.plate})`}
                        thumbnail
                        onOpen={(url, label) => setLightbox({ url, label })}
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(n.date)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {lightbox && <Lightbox url={lightbox.url} label={lightbox.label} onClose={() => setLightbox(null)} />}
    </div>
  )
}
