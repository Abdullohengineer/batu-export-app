import { useEffect } from 'react'
import { useChiqimRequestById } from '../../lib/useFinishedChiqimRequests'
import { useDispatchManifestLines } from '../../lib/useDispatchManifestLines'
import { useOldKnCollectionsByRequest } from '../../lib/useOldKnCollectionsByRequest'
import { useProfileNames } from '../../lib/useProfileNames'
import { ChiqimRequestDetail } from '../../components/ChiqimRequestDetail'

// Hisobot's eski-KN (old Konditirskiy) CHIQIM row-expand only ever showed
// the collected kg (OldKnRowDetail.tsx) — every other field the request
// actually carries (Menejer/Ombor/Qorovul actors+times, gate photos) was
// already fully built and rendered, just on a DIFFERENT screen (Menejer's
// own "Yuborilgan CHIQIM so'rovlari" — FinishedChiqimList.tsx). Rather than
// invent a new query, this modal is the exact same ChiqimRequestDetail body,
// fed by a request-scoped fetch (useChiqimRequestById) instead of Menejer's
// bulk one — the "passport" §3.2.5 already established for a KIRIM/CHIQIM
// row's parent SERIAL doesn't apply here (old-KN has no serial, per Stage 1
// design — see CLAUDE.md/DECISIONS.md "Opening stock"), so this is scoped
// to the request itself, the only real "parent" an old-KN collection has.
export function OldKnRequestPassportModal({
  requestId,
  onClose,
  typeName,
  calibreLabel,
}: {
  requestId: string
  onClose: () => void
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
}) {
  const { request, loading, error } = useChiqimRequestById(requestId)
  const { lines: manifestLines, loading: manifestLoading } = useDispatchManifestLines(requestId)
  const { collections: oldKnCollections } = useOldKnCollectionsByRequest(requestId)
  const { names } = useProfileNames()

  function actorName(id: string | null) {
    return id ? (names[id] ?? id) : '—'
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="CHIQIM so'rovi tafsilotlari"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">
            CHIQIM so'rovi — {request?.plate ?? '…'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Yopish"
            className="rounded-md px-2 py-1 text-xl leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            ×
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto px-5 py-4 text-sm">
          {loading && <p className="text-sm text-slate-400">Yuklanmoqda…</p>}
          {error && (
            <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          {request && !loading && (
            <ChiqimRequestDetail
              request={request}
              manifestLines={manifestLines}
              manifestLoading={manifestLoading}
              oldKnCollectionsByLine={Object.fromEntries(
                request.lines
                  .filter((l) => l.line_kind === 'old_kn')
                  .map((l) => [l.id, oldKnCollections.filter((c) => c.chiqim_line_id === l.id)]),
              )}
              typeName={typeName}
              calibreLabel={calibreLabel}
              actorName={actorName}
            />
          )}
        </div>
      </div>
    </div>
  )
}
