import { useState } from 'react'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useProfileNames } from '../../lib/useProfileNames'
import { useFinishedChiqimRequests } from '../../lib/useFinishedChiqimRequests'
import { useDispatchManifestLines } from '../../lib/useDispatchManifestLines'
import { GatePhoto } from '../../components/GatePhoto'
import { Card } from '../../components/ui/Card'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusPill } from '../../components/ui/StatusPill'
import { SerialChip } from '../../components/ui/SerialChip'

function fmt(ts: string | null) {
  return ts ? new Date(ts).toLocaleString() : '—'
}

// Menejer's finished-CHIQIM view (§3.1, Step 7 prompt 4) — same collapsed-
// by-default / expand-to-reveal pattern already used for every other
// second-window in this app (OmborChiqimTab W1/W2, QorovulChiqimTab
// Faol/Yakunlangan), not a new UI shape. Single window, not a two-window
// split: this list IS the "finished" window by construction
// (useFinishedChiqimRequests only ever fetches status='olib_ketildi'), so
// there's no counterpart "still open" state to show here — that's Ombor's
// and Qorovul's own screens, not this one.
export function FinishedChiqimList() {
  // §3.3: includeInactive=true -- resolves names on historical requests.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const { names } = useProfileNames()
  const { requests, loading } = useFinishedChiqimRequests()
  const [expanded, setExpanded] = useState<string | null>(null)
  const { lines: manifestLines, loading: manifestLoading } = useDispatchManifestLines(expanded)

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }
  function actorName(id: string | null) {
    return id ? (names[id] ?? id) : '—'
  }

  if (loading) return null

  return (
    <div>
      <SectionHeading>Yakunlangan so'rovlar</SectionHeading>
      <div className="mt-2 space-y-2">
        {requests.length === 0 && <p className="text-sm text-slate-400">Hali yakunlangan so'rov yo'q.</p>}
        {requests.map((request) => {
          const isExpanded = expanded === request.id
          const w = request.weighing
          return (
            <Card key={request.id}>
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : request.id)}
                className="flex min-h-12 w-full items-center gap-3 text-left"
              >
                <SerialChip>So'rov</SerialChip>
                <span className="min-w-0 flex-1">
                  <span className="block text-base text-slate-900 dark:text-slate-100">
                    {ownerName(request.owner_id)} · {request.plate}
                  </span>
                  <span className="block text-sm text-slate-500 dark:text-slate-400">
                    {request.request_date} · {request.driver} · {request.lines.length} qator
                  </span>
                </span>
                <StatusPill tone="ok">Olib ketildi</StatusPill>
              </button>
              <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                net {w?.net_kg?.toLocaleString() ?? '—'} kg · {fmt(w?.completed_at ?? null)}
              </div>

              {isExpanded && (
                <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
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
                      {actorName(w?.stage1_created_by ?? null)} · {fmt(w?.stage1_completed_at ?? null)} ·{' '}
                      {w?.pustoy_kg?.toLocaleString() ?? '—'} kg
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3">
                      <GatePhoto path={w?.stage1_plate_photo ?? null} label="Moshina raqami rasmi" />
                      <GatePhoto path={w?.stage1_scale_photo ?? null} label="Tarozi rasmi (kirish)" />
                    </div>
                  </div>

                  <div>
                    <div className="font-medium text-slate-700 dark:text-slate-300">Qorovul — Yuk bilan vazn (chiqish)</div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {actorName(w?.stage2_created_by ?? null)} · {fmt(w?.completed_at ?? null)} ·{' '}
                      {w?.gruzheny_kg?.toLocaleString() ?? '—'} kg
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3">
                      <GatePhoto path={w?.stage2_scale_photo ?? null} label="Tarozi rasmi (chiqish)" />
                      <GatePhoto path={w?.departure_doc_photo ?? null} label="Chiqish hujjati rasmi" />
                    </div>
                  </div>

                  <div>
                    <div className="font-medium text-slate-700 dark:text-slate-300">Yuk tarkibi</div>
                    {request.lines.map((line, i) => (
                      <div key={i} className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                        <span>
                          {typeName(line.type_id)} · {calibreLabel(line.calibre_id)}
                        </span>
                        <span>{line.qty_kg.toLocaleString()} kg (so'rov)</span>
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
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
