import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/formatDate'
import { useAuth } from '../../lib/AuthProvider'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useLaboratorChiqim, type AwaitingSerial, type ChiqimLabResultRow } from '../../lib/useLaboratorChiqim'
import { applySulfurClassification, sulfurChoiceFromFlag, type SulfurChoice } from '../../lib/classifySulfur'
import { ChiqimTahlilForm, type ChiqimTahlilValues } from './ChiqimTahlilForm'
import { ChiqimTahlilEditForm, type ChiqimTahlilEditValues } from './ChiqimTahlilEditForm'
import { EntityNotes } from '../../components/EntityNotes'
import { GatePhoto } from '../../components/GatePhoto'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { TextInput } from '../../components/ui/FormField'
import { SerialChip } from '../../components/ui/SerialChip'
import { Stat } from '../../components/ui/Stat'
import { StatusPill } from '../../components/ui/StatusPill'

const VERDICT_LABEL: Record<string, string> = { o_tdi: "O'tdi", qayta_yuvish: 'Qayta yuvish' }

// §5.5.3 Laborator CHIQIM — decisive check, hard-gates BOTH Barcode #2
// assignment (OmborTayyorTab.tsx, since 2026-07-28 Laborator v2) and
// dispatch (useAvailableFinishedStock/chiqimScan.ts). Three windows: Tahlil
// kutilmoqda (FIFO), Sera kutilmoqda (sulfured only, amber), Yakunlangan
// (values + verdict).
//
// Trigger changed (2026-07-28, Laborator v2 — see DECISIONS.md "Lab moves
// inside Moyka, wash-cycle concept removed"): a serial reaches Window 1 as
// soon as it's sent to Moyka, not once a wash cycle finalizes pallets — no
// pallets exist yet at this stage, so the row shows total sent kg, not
// pallet count/weight, and there is no wash-cycle number to display.
export function LaboratorChiqimTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves names on historical/in-flight cycles.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { awaiting, sulfurPending, finished, loading, refresh } = useLaboratorChiqim()

  const [activeTahlil, setActiveTahlil] = useState<string | null>(null)
  const [seraValue, setSeraValue] = useState<Record<string, string>>({})
  // Per-row override for the Sera-kiritish classification select (2026-08-15)
  // -- see LaboratorKirimTab.tsx's identical comment.
  const [seraClassification, setSeraClassification] = useState<Record<string, SulfurChoice>>({})
  const [seraSaving, setSeraSaving] = useState<string | null>(null)
  const [seraError, setSeraError] = useState<string | null>(null)
  const [expandedFinished, setExpandedFinished] = useState<string | null>(null)
  const [editingFinished, setEditingFinished] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }

  // §5.5.1: same conditionality as KIRIM. Non-sulfured -> verdict happens
  // right here, status goes straight to 'complete', skipping W2 entirely.
  // Sulfured -> status 'moisture_in', no verdict yet, moves to W2; verdict
  // happens at Sera kiritish instead. Classification (2026-08-15) is chosen
  // live in the Tahlil form itself -- values.isSulfured is authoritative
  // here, including for internal_reprocess (opening-stock re-wash) serials
  // that never had a KIRIM check at all, where this IS the only chance the
  // lab ever gets to classify the line (see DECISIONS.md).
  async function handleTahlil(item: AwaitingSerial, values: ChiqimTahlilValues) {
    await applySulfurClassification(item.serial, item.is_sulfured, values.isSulfured)

    let photoPath: string | null = null
    if (values.photoFile) {
      const path = `${crypto.randomUUID()}.jpg`
      const { error: uploadErr } = await supabase.storage.from('lab-photos').upload(path, values.photoFile)
      if (uploadErr) throw uploadErr
      photoPath = path
    }

    const { error } = await supabase.from('lab_results').insert({
      scope: 'chiqim',
      parent_serial: item.serial,
      wash_cycle_id: item.washCycleId,
      sampled_pallet: values.sampledPallet || null,
      sample_date: values.sampleDate,
      moisture_pct: values.moisturePct,
      sample_photo: photoPath,
      note: values.note || null,
      tested_by: profile?.id,
      status: values.isSulfured ? 'moisture_in' : 'complete',
      verdict: values.isSulfured ? null : values.verdict,
    })
    if (error) throw error

    setActiveTahlil(null)
    refresh()
  }

  function seraClassificationFor(row: ChiqimLabResultRow): SulfurChoice {
    return seraClassification[row.id] ?? sulfurChoiceFromFlag(row.is_sulfured)
  }

  // §5.5.3 W2 "Sera kiritish" — SO2 + verdict together, the sulfured line's
  // final save. Reachable for sulfured lines by construction (W2 membership
  // = status='moisture_in', which handleTahlil only sets when Tahlil
  // resolved sulfured) -- but the lab can still correct the classification
  // here too (2026-08-15): if flipped to natural, SO2 becomes optional; the
  // verdict click stays mandatory either way, unchanged (§5.5.3's own
  // "explicit click, never auto-derived" invariant already covers this
  // form regardless of classification). so2_mg_kg has no carry-forward
  // concern -- a W2 row has never had one set.
  async function handleSera(row: ChiqimLabResultRow, verdict: 'o_tdi' | 'qayta_yuvish') {
    setSeraError(null)
    const classification = seraClassificationFor(row)
    const isSulfured = classification !== 'false'
    let value: number | null = null
    if (isSulfured) {
      value = parseFloat(seraValue[row.id] ?? '')
      if (isNaN(value)) {
        setSeraError('SO₂ ppm ni kiriting.')
        return
      }
    }
    setSeraSaving(row.id)
    try {
      await applySulfurClassification(row.serial, row.is_sulfured, isSulfured)
      const { error } = await supabase.from('lab_results').update({ so2_mg_kg: value, status: 'complete', verdict }).eq('id', row.id)
      if (error) throw error
      setSeraValue((m) => {
        const next = { ...m }
        delete next[row.id]
        return next
      })
      setSeraClassification((m) => {
        const next = { ...m }
        delete next[row.id]
        return next
      })
      refresh()
    } catch (err) {
      setSeraError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSeraSaving(null)
    }
  }

  // Lab edit action (2026-08-03) — corrects an already-Yakunlangan CHIQIM
  // record, same superseding-insert as the KIRIM tab: never overwrites, the
  // original row stays queryable as history. Verdict is always required on
  // save (ChiqimTahlilEditForm's own explicit-click buttons), even when
  // only correcting an unrelated field like the sample date — matching
  // §5.5.3's "explicit click, never auto-derived" invariant. Does not
  // retroactively affect pallets already packed under the prior verdict;
  // the hard gate only ever checks the CURRENT latest verdict, at the
  // instant a new pallet is created.
  async function handleTahlilEdit(row: ChiqimLabResultRow, values: ChiqimTahlilEditValues) {
    setEditError(null)
    await applySulfurClassification(row.serial, row.is_sulfured, values.isSulfured)

    let photoPath = row.sample_photo
    if (values.photoFile) {
      const path = `${crypto.randomUUID()}.jpg`
      const { error: uploadErr } = await supabase.storage.from('lab-photos').upload(path, values.photoFile)
      if (uploadErr) throw uploadErr
      photoPath = path
    }

    const { error } = await supabase.from('lab_results').insert({
      scope: 'chiqim',
      wash_cycle_id: row.wash_cycle_id,
      sampled_pallet: values.sampledPallet || null,
      sample_date: values.sampleDate,
      moisture_pct: values.moisturePct,
      so2_mg_kg: values.so2MgKg,
      sample_photo: photoPath,
      note: values.note || null,
      tested_by: profile?.id,
      status: 'complete',
      verdict: values.verdict,
    })
    if (error) throw error

    setEditingFinished(null)
    refresh()
  }

  if (loading) return null

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat value={awaiting.length} label="Tahlil kutilmoqda" />
        <Stat value={sulfurPending.length} label="Sera kutilmoqda" tone={sulfurPending.length > 0 ? 'pending' : 'neutral'} />
        <Stat value={finished.length} label="Yakunlandi" tone="ok" />
      </div>

      <div>
        <SectionHeading>1 · Tahlil kutilmoqda — namuna oling</SectionHeading>
        <div className="mt-2 space-y-2">
          {awaiting.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan partiya yo'q.</p>}
          {awaiting.map((item) => {
            const isActive = activeTahlil === item.washCycleId
            return (
              <Card key={item.washCycleId} tone={item.rejected ? 'problem' : 'neutral'}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <SerialChip>{item.serial}</SerialChip>
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                        {ownerName(item.owner_id)} · {typeName(item.type_id)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                      {item.sentKg.toLocaleString()} kg · yuborilgan {formatDate(item.sentDate)}
                    </div>
                    {item.rejected && (
                      <div className="mt-1 text-sm font-medium text-red-700 dark:text-red-400">
                        Rad etildi — qayta tekshirish kerak
                      </div>
                    )}
                  </div>
                  {!isActive && (
                    <Button variant="primary" size="lg" onClick={() => setActiveTahlil(item.washCycleId)}>
                      Tahlil
                    </Button>
                  )}
                </div>
                {isActive && (
                  <ChiqimTahlilForm
                    item={item}
                    ownerName={ownerName(item.owner_id)}
                    typeName={typeName(item.type_id)}
                    onCancel={() => setActiveTahlil(null)}
                    onSubmit={(v) => handleTahlil(item, v)}
                  />
                )}
                {/* Qaydlar (2026-08-02, opening stock Stage 3) — this tab
                    rendered no notes at all before. It matters now because
                    a re-washed old-stock serial carries an auto-note from
                    the mint ("Eski zaxiradan qayta yuvish: N ta eski
                    pallet, kitob bo'yicha ~X kg, tarozida Y kg") and the
                    lab is explicitly meant to see that this material is old
                    stock before judging it. Same generic EntityNotes /
                    entity_type='moyka' keyed by serial that OmborMoykaTab
                    already writes and reads, so the note the mint wrote is
                    the note shown here — no second mechanism. */}
                <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Qaydlar</div>
                  <div className="mt-1">
                    <EntityNotes entityType="moyka" entityId={item.serial} />
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      <div>
        <SectionHeading tone="pending">2 · Sera natijasi kutilmoqda (1 kun)</SectionHeading>
        <div className="mt-2 space-y-2">
          {sulfurPending.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan sera yo'q.</p>}
          {sulfurPending.map((row) => (
            <Card key={row.id} tone="pending">
              <div className="flex items-center gap-2">
                <SerialChip>{row.serial}</SerialChip>
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                  {ownerName(row.owner_id)} · {typeName(row.type_id)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                Namligi {row.moisture_pct}% kiritildi · sera hali yo'q
              </div>
              <div className="mt-2 space-y-2">
                {/* Classification, correctable here too (2026-08-15) -- see
                    LaboratorKirimTab.tsx's identical block. */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Mahsulot</label>
                  <select
                    required
                    value={seraClassificationFor(row)}
                    onChange={(e) => setSeraClassification((m) => ({ ...m, [row.id]: e.target.value as SulfurChoice }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 text-base min-h-12 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="" disabled>
                      Tanlang…
                    </option>
                    <option value="false">Naturel</option>
                    <option value="true">Sulfatlangan</option>
                  </select>
                </div>
                {seraClassificationFor(row) !== 'false' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Oltingugurt (SO₂)</label>
                    <TextInput
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="SO₂ ppm"
                      value={seraValue[row.id] ?? ''}
                      onChange={(e) => setSeraValue((m) => ({ ...m, [row.id]: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <Button variant="success" size="md" className="flex-1" disabled={seraSaving === row.id} onClick={() => handleSera(row, 'o_tdi')}>
                    {seraSaving === row.id ? '…' : "O'tdi"}
                  </Button>
                  <Button variant="danger" size="md" className="flex-1" disabled={seraSaving === row.id} onClick={() => handleSera(row, 'qayta_yuvish')}>
                    {seraSaving === row.id ? '…' : 'Qayta yuvish'}
                  </Button>
                </div>
              </div>
              {seraError && (
                <div className="mt-1">
                  <StatusNote tone="problem">{seraError}</StatusNote>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      <div>
        <SectionHeading>3 · Yakunlangan</SectionHeading>
        <div className="mt-2 space-y-2">
          {finished.length === 0 && <p className="text-sm text-slate-400">Yakunlangan tahlil yo'q.</p>}
          {finished.map((row) => (
            <Card key={row.id} padding="compact">
              <button
                type="button"
                onClick={() => setExpandedFinished(expandedFinished === row.id ? null : row.id)}
                className="flex w-full items-center gap-2 text-left"
              >
                <SerialChip>{row.serial}</SerialChip>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {ownerName(row.owner_id)} · {typeName(row.type_id)}
                </span>
                {row.verdict && (
                  <StatusPill tone={row.verdict === 'qayta_yuvish' ? 'problem' : 'ok'}>
                    {VERDICT_LABEL[row.verdict]}
                  </StatusPill>
                )}
              </button>
              {expandedFinished === row.id && (
                <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <div>
                    Namligi {row.moisture_pct}%{' '}
                    <span className="text-slate-400 dark:text-slate-500">
                      (Talab: {row.target_moisture_pct !== null ? `${row.target_moisture_pct}%` : "Talab yo'q"})
                    </span>
                    {' · '}
                    SO₂ {row.so2_mg_kg !== null ? `${row.so2_mg_kg} ppm` : "Yo'q · naturel"}{' '}
                    {row.target_so2_mg_kg !== null && (
                      <span className="text-slate-400 dark:text-slate-500">(Talab: {row.target_so2_mg_kg} ppm)</span>
                    )}
                  </div>
                  <div>
                    {formatDate(row.sample_date)}
                    {row.sampledPallet ? ` · namuna manbai: ${row.sampledPallet}` : ''}
                  </div>
                  {row.note && <div>Qayd: {row.note}</div>}
                  <GatePhoto path={row.sample_photo} label="Namuna rasmi" bucket="lab-photos" />
                  {editingFinished !== row.id && (
                    <div className="pt-1">
                      <Button variant="secondary" size="md" onClick={() => setEditingFinished(row.id)}>
                        Tahrirlash
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {editingFinished === row.id && (
                <ChiqimTahlilEditForm
                  row={row}
                  ownerName={ownerName(row.owner_id)}
                  typeName={typeName(row.type_id)}
                  onCancel={() => setEditingFinished(null)}
                  onSubmit={(v) => handleTahlilEdit(row, v)}
                />
              )}
              {editError && editingFinished === row.id && (
                <div className="mt-2">
                  <StatusNote tone="problem">{editError}</StatusNote>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
