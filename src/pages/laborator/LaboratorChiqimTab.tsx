import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useLaboratorChiqim, type AwaitingCycle, type ChiqimLabResultRow } from '../../lib/useLaboratorChiqim'
import { ChiqimTahlilForm, type ChiqimTahlilValues } from './ChiqimTahlilForm'
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

// §5.5.3 Laborator CHIQIM — decisive check, hard-gates dispatch (via
// useAvailableFinishedStock/chiqimScan.ts, wired separately). Three
// windows: Tahlil kutilmoqda (FIFO), Sera kutilmoqda (sulfured only,
// amber), Yakunlangan (values + verdict + cycle number).
//
// 🔒 nav/visual-redesign pass (mockup "BATU-Laborator-Screens-v2.pdf" —
// visual language only, see docs/DECISIONS.md): the mockup's own CHIQIM
// pages were drawn against the superseded v1.5 model (dispatch-request-
// tied, no verdict) and are NOT what's built below. Every card here already
// read from `AwaitingCycle`/`wash_cycles` (never `chiqim_requests`) before
// this pass touched anything — this restyle keeps that wash-cycle subject
// exactly as-is, matching SPEC.md §5.5.3's row definition (parent seriya ·
// buyurtmachi · tur · pallet soni · jami kg · ishlab chiqarilgan sana ·
// yuvish sikli), not the mockup's So'rov/moshina/tarkib fields.
export function LaboratorChiqimTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves names on historical/in-flight cycles.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { awaiting, sulfurPending, finished, loading, refresh } = useLaboratorChiqim()

  const [activeTahlil, setActiveTahlil] = useState<string | null>(null)
  const [seraValue, setSeraValue] = useState<Record<string, string>>({})
  const [seraSaving, setSeraSaving] = useState<string | null>(null)
  const [seraError, setSeraError] = useState<string | null>(null)
  const [expandedFinished, setExpandedFinished] = useState<string | null>(null)

  function ownerName(id: string) {
    return owners.find((o) => o.id === id)?.name ?? id
  }
  function typeName(id: string) {
    return productTypes.find((t) => t.id === id)?.name ?? id
  }

  // §5.5.1: same conditionality as KIRIM. Non-sulfured -> verdict happens
  // right here, status goes straight to 'complete', skipping W2 entirely.
  // Sulfured -> status 'moisture_in', no verdict yet, moves to W2; verdict
  // happens at Sera kiritish instead.
  async function handleTahlil(cycle: AwaitingCycle, values: ChiqimTahlilValues) {
    let photoPath: string | null = null
    if (values.photoFile) {
      const path = `${crypto.randomUUID()}.jpg`
      const { error: uploadErr } = await supabase.storage.from('lab-photos').upload(path, values.photoFile)
      if (uploadErr) throw uploadErr
      photoPath = path
    }

    const isSulfured = cycle.target_so2_mg_kg !== null
    const { error } = await supabase.from('lab_results').insert({
      scope: 'chiqim',
      parent_serial: cycle.serial,
      wash_cycle_id: cycle.washCycleId,
      sampled_pallet: values.sampledPallet,
      sample_date: values.sampleDate,
      moisture_pct: values.moisturePct,
      sample_photo: photoPath,
      note: values.note || null,
      tested_by: profile?.id,
      status: isSulfured ? 'moisture_in' : 'complete',
      verdict: isSulfured ? null : values.verdict,
    })
    if (error) throw error

    setActiveTahlil(null)
    refresh()
  }

  // §5.5.3 W2 "Sera kiritish" — SO2 + verdict together, the sulfured line's
  // final save. Reachable only for sulfured lines by construction (W2
  // membership = status='moisture_in', which handleTahlil only sets when a
  // sulfur target exists).
  async function handleSera(row: ChiqimLabResultRow, verdict: 'o_tdi' | 'qayta_yuvish') {
    setSeraError(null)
    const value = parseFloat(seraValue[row.id] ?? '')
    if (isNaN(value)) {
      setSeraError('SO₂ mg/kg ni kiriting.')
      return
    }
    setSeraSaving(row.id)
    try {
      const { error } = await supabase.from('lab_results').update({ so2_mg_kg: value, status: 'complete', verdict }).eq('id', row.id)
      if (error) throw error
      setSeraValue((m) => {
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
          {awaiting.map((cycle) => {
            const isActive = activeTahlil === cycle.washCycleId
            const jamiKg = cycle.pallets.reduce((sum, p) => sum + p.weight_kg, 0)
            return (
              <Card key={cycle.washCycleId}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <SerialChip>{cycle.serial}</SerialChip>
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                        {ownerName(cycle.owner_id)} · {typeName(cycle.type_id)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                      {cycle.pallets.length} ta pallet · {jamiKg.toLocaleString()} kg · {cycle.producedDate ?? '—'} · sikl{' '}
                      {cycle.cycleNo}
                    </div>
                  </div>
                  {!isActive && (
                    <Button variant="primary" size="lg" onClick={() => setActiveTahlil(cycle.washCycleId)}>
                      Tahlil
                    </Button>
                  )}
                </div>
                {isActive && (
                  <ChiqimTahlilForm
                    cycle={cycle}
                    ownerName={ownerName(cycle.owner_id)}
                    typeName={typeName(cycle.type_id)}
                    requireVerdict={cycle.target_so2_mg_kg === null}
                    onCancel={() => setActiveTahlil(null)}
                    onSubmit={(v) => handleTahlil(cycle, v)}
                  />
                )}
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
                  {ownerName(row.owner_id)} · {typeName(row.type_id)} · sikl {row.cycleNo}
                </span>
              </div>
              <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                Namligi {row.moisture_pct}% kiritildi · sera hali yo'q
              </div>
              <div className="mt-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Oltingugurt (SO₂){' '}
                  <span className="font-normal text-slate-400 dark:text-slate-500">
                    (Talab: {row.target_so2_mg_kg} mg/kg)
                  </span>
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <TextInput
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="SO₂ mg/kg"
                    value={seraValue[row.id] ?? ''}
                    onChange={(e) => setSeraValue((m) => ({ ...m, [row.id]: e.target.value }))}
                    className="flex-1"
                  />
                </div>
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
                  {ownerName(row.owner_id)} · {typeName(row.type_id)} · sikl {row.cycleNo}
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
                    SO₂ {row.so2_mg_kg !== null ? `${row.so2_mg_kg} mg/kg` : "Yo'q · naturel"}{' '}
                    {row.target_so2_mg_kg !== null && (
                      <span className="text-slate-400 dark:text-slate-500">(Talab: {row.target_so2_mg_kg} mg/kg)</span>
                    )}
                  </div>
                  <div>
                    {row.sample_date} · namuna: {row.sampled_pallet}
                  </div>
                  {row.note && <div>Qayd: {row.note}</div>}
                  <GatePhoto path={row.sample_photo} label="Namuna rasmi" bucket="lab-photos" />
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
