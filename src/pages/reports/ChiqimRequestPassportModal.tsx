import { useEffect } from 'react'
import { useChiqimRequestById } from '../../lib/useFinishedChiqimRequests'
import { useDispatchManifestLines } from '../../lib/useDispatchManifestLines'
import { useOldKnCollectionsByRequest } from '../../lib/useOldKnCollectionsByRequest'
import { useProfileNames } from '../../lib/useProfileNames'
import { ChiqimRequestDetail } from '../../components/ChiqimRequestDetail'

// Hisobot's own "everything about this CHIQIM request" drill-down —
// Menejer/Ombor/Qorovul actors+times, gate photos, and full cargo
// composition, all of which was already fully built and rendered, just on
// a DIFFERENT screen (Menejer's own "Yuborilgan CHIQIM so'rovlari" —
// FinishedChiqimList.tsx). Rather than invent a new query, this modal is
// the exact same ChiqimRequestDetail body, fed by a request-scoped fetch
// (useChiqimRequestById) instead of Menejer's bulk one.
//
// Originally built 2026-09-14 (as OldKnRequestPassportModal, renamed
// 2026-09-15) for old-KN's own drill-down only — old-KN has no serial, per
// Stage 1 design (see CLAUDE.md/DECISIONS.md "Opening stock"), so it can't
// use the §3.2.5 serial-passport pattern a KIRIM/CHIQIM row's parent
// SERIAL gets. Widened 2026-09-15 (see docs/decisions/0189-...-chiqim-
// dispatch-full-detail-and-kalibr-breakdown.md) to be every CHIQIM
// dispatch line's own "So'rov tafsilotlarini ko'rish" button
// (ChiqimDispatchRowDetail.tsx), not just old-KN's — that button was
// gated behind "this request has old-KN cargo" at ship time, which meant
// the common case (a pure-pallet or pure-raw fura dispatch) had no way to
// reach its own photos/actor timestamps at all. Regression, not a design
// choice; the fix is this modal becoming unconditional, not a new one.
export function ChiqimRequestPassportModal({
  requestId,
  onClose,
  typeName,
  calibreLabel,
  onOpenPassport,
}: {
  requestId: string
  onClose: () => void
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  // Per-pallet seriya drill-down (2026-09-15 follow-up to 0189's
  // "Regression 2 -- not reproducible"): the operator reported back that
  // the manifest's seriya reference wasn't clickable here, unlike the same
  // list rendered inline in ChiqimDispatchRowDetail.tsx's own expand panel.
  // Root cause was ChiqimRequestDetail never taking an onOpenPassport prop
  // at all (not a wiring break -- it never existed). Threaded through here.
  onOpenPassport: (serial: string) => void
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
              onOpenPassport={onOpenPassport}
            />
          )}
        </div>
      </div>
    </div>
  )
}
