import type { FinishedChiqimRequest, FinishedChiqimLine } from '../lib/useFinishedChiqimRequests'
import type { ManifestLine } from '../lib/useDispatchManifestLines'
import type { OldKnCollection } from '../lib/useOldKnCollectionsByRequest'
import { GatePhoto } from './GatePhoto'
import { formatDateTime } from '../lib/formatDate'

function fmt(ts: string | null) {
  return ts ? formatDateTime(ts) : '—'
}

// A line's own display label, whichever of the five kinds it is — mirrors
// OmborChiqimTab.tsx's identical helper (its own comment: "Eski (yuvilgan)",
// "Eski KN", "Eski xom" are the app-wide names for these three, not invented
// here). Widened from FinishedChiqimList.tsx's original finished|raw-only
// version when this component was extracted from it (see
// useFinishedChiqimRequests.ts's own widening note) — old_washed/old_kn/
// old_raw lines were already flowing through unlabelled before this.
function lineLabel(line: FinishedChiqimLine, calibreLabel: (id: string) => string) {
  switch (line.line_kind) {
    case 'raw':
      return `Xom · ${line.rawSerialPool.join(', ') || '—'}`
    case 'old_raw':
      return `Eski xom · ${line.rawSerialPool.join(', ') || '—'}`
    case 'old_washed':
      return `Eski (yuvilgan) ${calibreLabel(line.calibre_id ?? '')}`
    case 'old_kn':
      return 'Eski KN'
    default:
      return calibreLabel(line.calibre_id ?? '')
  }
}

// The full "everything about this CHIQIM request" body — extracted out of
// FinishedChiqimList.tsx (Menejer's own W2 receipt view) so the identical
// Menejer/Ombor/Qorovul actor+time+photo blocks and line list can be reused
// unchanged from OldKnRequestPassportModal.tsx (Hisobot's eski-KN
// drill-down) instead of being rebuilt — this WAS already "all info", it
// just had nowhere else to render. FinishedChiqimList.tsx keeps its own
// Tahrirlash/Bekor qilish actions, which are Menejer-specific write
// affordances that don't belong in a read-only Hisobot passport.
export function ChiqimRequestDetail({
  request,
  manifestLines,
  manifestLoading,
  oldKnCollectionsByLine,
  typeName,
  calibreLabel,
  actorName,
}: {
  request: FinishedChiqimRequest
  manifestLines: ManifestLine[]
  manifestLoading: boolean
  oldKnCollectionsByLine: Record<string, OldKnCollection[]>
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  actorName: (id: string | null) => string
}) {
  const w = request.weighing
  return (
    <div className="space-y-3">
      <div>
        <div className="font-medium text-slate-700 dark:text-slate-300">Menejer</div>
        <div className="text-slate-500 dark:text-slate-400">
          {actorName(request.created_by)} · {fmt(request.created_at)}
        </div>
      </div>

      <div>
        <div className="font-medium text-slate-700 dark:text-slate-300">Ombor</div>
        <div className="text-slate-500 dark:text-slate-400">
          {actorName(request.ombor_finished_by)} · {fmt(request.ombor_finished_at)}
        </div>
      </div>

      <div>
        <div className="font-medium text-slate-700 dark:text-slate-300">Qorovul — Bo'sh vazn (kirish)</div>
        <div className="text-slate-500 dark:text-slate-400">
          {actorName(w?.stage1_created_by ?? null)} · {fmt(w?.stage1_completed_at ?? null)} · {w?.pustoy_kg?.toLocaleString() ?? '—'} kg
        </div>
        <div className="mt-1 flex flex-wrap gap-3">
          <GatePhoto path={w?.stage1_plate_photo ?? null} label="Moshina raqami rasmi" />
          <GatePhoto path={w?.stage1_scale_photo ?? null} label="Tarozi rasmi (kirish)" />
        </div>
      </div>

      <div>
        <div className="font-medium text-slate-700 dark:text-slate-300">Qorovul — Yuk bilan vazn (chiqish)</div>
        <div className="text-slate-500 dark:text-slate-400">
          {actorName(w?.stage2_created_by ?? null)} · {fmt(w?.completed_at ?? null)} · {w?.gruzheny_kg?.toLocaleString() ?? '—'} kg
        </div>
        <div className="mt-1 flex flex-wrap gap-3">
          <GatePhoto path={w?.stage2_scale_photo ?? null} label="Tarozi rasmi (chiqish)" />
          <GatePhoto path={w?.departure_doc_photo ?? null} label="Chiqish hujjati rasmi" />
        </div>
      </div>

      <div>
        <div className="font-medium text-slate-700 dark:text-slate-300">Yuk tarkibi</div>
        {request.lines.map((line) => (
          <div key={line.id}>
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
              <span>
                {typeName(line.type_id)} · {lineLabel(line, calibreLabel)}
              </span>
              <span>{line.qty_kg === null ? '—' : `${line.qty_kg.toLocaleString()} kg (so'rov)`}</span>
            </div>
            {/* Old-KN's own recorded event — the actual old_kn_collections
                row(s), committed only at Ombor's "Yuklashni yakunlash". This
                is the exact field that answers "why isn't this in Hisobot
                yet": no collection row means the truck may have already
                departed (see the request's own Qorovul/status above) while
                nothing was ever recorded here — surfaced directly rather
                than left for someone to re-derive from raw tables again. */}
            {line.line_kind === 'old_kn' &&
              (() => {
                const collections = oldKnCollectionsByLine[line.id] ?? []
                if (collections.length === 0) {
                  return (
                    <div className="pl-3 text-xs text-amber-700 dark:text-amber-400">
                      Hali yig'ib olinmagan — Ombor "Yuklashni yakunlash" bosmagan, shu tufayli Hisobotda ko'rinmaydi.
                    </div>
                  )
                }
                return (
                  <ul className="pl-3">
                    {collections.map((c) => (
                      <li key={c.id} className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>Yig'ib olindi — {actorName(c.created_by)} · {fmt(c.collected_at)}</span>
                        <span>{c.collected_kg.toLocaleString()} kg</span>
                      </li>
                    ))}
                  </ul>
                )
              })()}
          </div>
        ))}
        {manifestLoading && <p className="mt-1 text-xs text-slate-400">Yuklanmoqda…</p>}
        {!manifestLoading && manifestLines.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {manifestLines.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-xs">
                <span className="font-mono text-slate-600 dark:text-slate-400">
                  {m.barcode2} · {typeName(m.type_id)} · {calibreLabel(m.calibre_id)}
                </span>
                <span className="text-slate-600 dark:text-slate-400">{m.weight_kg.toLocaleString()} kg</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
