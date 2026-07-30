import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useProfileNames } from '../../lib/useProfileNames'
import { useFinishedChiqimRequests } from '../../lib/useFinishedChiqimRequests'
import { useDispatchManifestLines } from '../../lib/useDispatchManifestLines'
import { GatePhoto } from '../../components/GatePhoto'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { FormField, TextInput } from '../../components/ui/FormField'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'
import { SerialChip } from '../../components/ui/SerialChip'
import { type Tone } from '../../components/ui/tokens'

function fmt(ts: string | null) {
  return ts ? new Date(ts).toLocaleString() : '—'
}

// chiqim_requests only ever carries two status values in practice (see
// useFinishedChiqimRequests.ts) — same shape as KirimOrdersList's own
// STATUS_LABEL map for the sibling KIRIM window, fallback tone covers the
// two enum values that belong to KIRIM's lifecycle and are never actually
// written here. Voided (0033) isn't a status value at all — it's a
// separate voided_at column overlaid on top, checked first in the render.
const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  kutilmoqda: { label: 'Kutilmoqda', tone: 'pending' },
  olib_ketildi: { label: 'Olib ketildi', tone: 'ok' },
}

const FIELD_LABEL: Record<string, string> = {
  request_date: 'Sana',
  plate: 'Moshina raqami',
  driver: 'Haydovchi',
}

interface EditDraft {
  request_date: string
  plate: string
  driver: string
}

// Menejer's CHIQIM second window (§3.1) — same collapsed-by-default /
// expand-to-reveal pattern used everywhere else (OmborChiqimTab W1/W2,
// QorovulChiqimTab Faol/Yakunlangan), and the same "one list, all
// statuses, newest-first, status pill per row" shape as this role's own
// KirimOrdersList.tsx, not a new UI shape. Widened from a finished-only
// view 2026-07-25 (see useFinishedChiqimRequests.ts for the history) — a
// row with no gate_weighing yet (status='kutilmoqda') renders its weighing
// fields as '—', already null-safe throughout below.
export function FinishedChiqimList({ refreshKey }: { refreshKey: number }) {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves names on historical requests.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)
  const { names } = useProfileNames()
  const { requests, loading, refresh } = useFinishedChiqimRequests(refreshKey)
  const [expanded, setExpanded] = useState<string | null>(null)
  const { lines: manifestLines, loading: manifestLoading } = useDispatchManifestLines(expanded)
  const [confirmingVoid, setConfirmingVoid] = useState<string | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft>({ request_date: '', plate: '', driver: '' })
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

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

  // §5.4 Option B (0033) — scoped to exactly what menejer_updates' RLS
  // policy allows (ombor_finished_at IS NULL); the button itself is only
  // ever rendered under that same condition, so a denial here would mean
  // the RLS scope and this UI condition have drifted, not a normal path.
  // (Policy renamed from menejer_voids in 0038 — same predicate, now also
  // used by saveEdit below, voiding was never its only real purpose.)
  async function handleVoid(requestId: string) {
    setVoiding(true)
    setVoidError(null)
    try {
      const { error } = await supabase
        .from('chiqim_requests')
        .update({ voided_at: new Date().toISOString(), voided_by: profile?.id })
        .eq('id', requestId)
      if (error) throw error
      setConfirmingVoid(null)
      refresh()
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'Bekor qilishda xatolik yuz berdi.')
    } finally {
      setVoiding(false)
    }
  }

  function startEdit(request: { id: string; request_date: string; plate: string; driver: string }) {
    setEditingId(request.id)
    setEditDraft({ request_date: request.request_date, plate: request.plate, driver: request.driver })
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError(null)
  }

  // Same "correcting mistaken entries" task as KirimOrdersList.tsx's own
  // saveEdit — see that file's comment for the full field-lock reasoning.
  // Here the lock boundary is the pre-existing ombor_finished_at/voided_at
  // condition (menejer_updates RLS, 0038) rather than a new gate check.
  async function saveEdit(request: { id: string; request_date: string; plate: string; driver: string }) {
    const changes: Record<string, { before: unknown; after: unknown }> = {}
    if (editDraft.request_date !== request.request_date)
      changes.request_date = { before: request.request_date, after: editDraft.request_date }
    if (editDraft.plate !== request.plate) changes.plate = { before: request.plate, after: editDraft.plate }
    if (editDraft.driver !== request.driver) changes.driver = { before: request.driver, after: editDraft.driver }

    if (Object.keys(changes).length === 0) {
      setEditingId(null)
      return
    }

    setEditBusy(true)
    setEditError(null)
    try {
      const { error } = await supabase
        .from('chiqim_requests')
        .update({ request_date: editDraft.request_date, plate: editDraft.plate, driver: editDraft.driver })
        .eq('id', request.id)
      if (error) throw error

      const before = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.before]))
      const after = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.after]))
      await Promise.all([
        supabase.from('audit_log').insert({
          table_name: 'chiqim_requests',
          row_id: request.id,
          actor: profile?.id,
          action: 'edit',
          before,
          after,
        }),
        supabase.from('notes').insert({
          entity_type: 'chiqim_requests',
          entity_id: request.id,
          author: profile?.id,
          body: `Tuzatildi: ${Object.entries(changes)
            .map(([k, v]) => `${FIELD_LABEL[k] ?? k} ${v.before} → ${v.after}`)
            .join(', ')}`,
        }),
      ])

      setEditingId(null)
      refresh()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setEditBusy(false)
    }
  }

  if (loading) return null

  return (
    <div>
      <SectionHeading>Yuborilgan CHIQIM so'rovlari</SectionHeading>
      <div className="mt-2 space-y-2">
        {requests.length === 0 && <p className="text-sm text-slate-400">Hali so'rov yo'q.</p>}
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
                {request.voided_at ? (
                  <StatusPill tone="neutral">Bekor qilindi</StatusPill>
                ) : (
                  <StatusPill tone={STATUS_LABEL[request.status]?.tone ?? 'neutral'}>
                    {STATUS_LABEL[request.status]?.label ?? request.status}
                  </StatusPill>
                )}
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

                  {/* "Correcting mistaken entries" — same boundary as the
                      void action right below (ombor_finished_at IS NULL,
                      not voided): a request Ombor hasn't started/finished
                      loading yet. See KirimOrdersList.tsx's saveEdit for
                      the full field-lock reasoning (date/plate/driver only
                      — owner_id and every line/pallet field stay locked). */}
                  {!request.voided_at && !request.ombor_finished_at && (
                    <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                      {editingId === request.id ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <FormField label="Sana">
                              <TextInput
                                type="date"
                                value={editDraft.request_date}
                                onChange={(e) => setEditDraft((d) => ({ ...d, request_date: e.target.value }))}
                              />
                            </FormField>
                            <FormField label="Moshina raqami">
                              <TextInput
                                type="text"
                                value={editDraft.plate}
                                onChange={(e) => setEditDraft((d) => ({ ...d, plate: e.target.value }))}
                              />
                            </FormField>
                            <FormField label="Haydovchi ismi">
                              <TextInput
                                type="text"
                                value={editDraft.driver}
                                onChange={(e) => setEditDraft((d) => ({ ...d, driver: e.target.value }))}
                              />
                            </FormField>
                          </div>
                          {editError && <StatusNote tone="problem">{editError}</StatusNote>}
                          <div className="flex gap-2">
                            <Button variant="primary" size="md" disabled={editBusy} onClick={() => saveEdit(request)}>
                              {editBusy ? 'Saqlanmoqda…' : 'Saqlash'}
                            </Button>
                            <Button variant="ghost" size="md" onClick={cancelEdit}>
                              Bekor qilish
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="secondary" size="md" onClick={() => startEdit(request)}>
                          Tahrirlash
                        </Button>
                      )}
                    </div>
                  )}

                  {/* §5.4 Option B (0033) — void, scoped to exactly what
                      menejer_updates' RLS policy allows: not yet started by
                      Ombor. A request already loading/loaded needs a real
                      dispatch_manifest unwind, out of scope here. Same
                      two-step confirm shape as OmborChiqimTab's own
                      Yuklashni yakunlash, not a browser confirm(). */}
                  {!request.voided_at && !request.ombor_finished_at && (
                    <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                      {confirmingVoid === request.id ? (
                        <div className="space-y-2">
                          <p className="text-sm text-slate-700 dark:text-slate-300">
                            Bu so'rovni bekor qilasizmi? Band qilingan palletlar bo'shatiladi.
                          </p>
                          {voidError && <StatusNote tone="problem">{voidError}</StatusNote>}
                          <div className="flex gap-2">
                            <Button variant="danger" size="md" onClick={() => handleVoid(request.id)} disabled={voiding}>
                              {voiding ? 'Bekor qilinmoqda…' : 'Ha, bekor qilish'}
                            </Button>
                            <Button variant="ghost" size="md" onClick={() => setConfirmingVoid(null)}>
                              Yo'q
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="ghost" size="md" onClick={() => setConfirmingVoid(request.id)} className="!text-red-600 dark:!text-red-400">
                          Bekor qilish
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
