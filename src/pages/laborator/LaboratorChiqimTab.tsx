import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useLaboratorChiqim, type AwaitingCycle, type ChiqimLabResultRow } from '../../lib/useLaboratorChiqim'
import { ChiqimTahlilForm, type ChiqimTahlilValues } from './ChiqimTahlilForm'
import { GatePhoto } from '../../components/GatePhoto'

const VERDICT_LABEL: Record<string, string> = { o_tdi: "O'tdi", qayta_yuvish: 'Qayta yuvish' }

// §5.5.3 Laborator CHIQIM — decisive check, hard-gates dispatch (via
// useAvailableFinishedStock/chiqimScan.ts, wired separately). Three
// windows: Tahlil kutilmoqda (FIFO), Sera kutilmoqda (sulfured only,
// amber), Yakunlangan (values + verdict + cycle number).
export function LaboratorChiqimTab() {
  const { profile } = useAuth()
  const { owners } = useOwners()
  const { productTypes } = useProductTypes()
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
      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Tahlil kutilmoqda</h2>
        <div className="mt-2 space-y-2">
          {awaiting.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan partiya yo'q.</p>}
          {awaiting.map((cycle) => {
            const isActive = activeTahlil === cycle.washCycleId
            const jamiKg = cycle.pallets.reduce((sum, p) => sum + p.weight_kg, 0)
            return (
              <div key={cycle.washCycleId} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-slate-900 dark:text-slate-100">{cycle.serial}</span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">
                      {typeName(cycle.type_id)} · {ownerName(cycle.owner_id)} · yuvish sikli {cycle.cycleNo}
                    </span>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {cycle.pallets.length} ta pallet · {jamiKg.toLocaleString()} kg · {cycle.producedDate ?? '—'}
                    </div>
                  </div>
                  {!isActive && (
                    <button
                      onClick={() => setActiveTahlil(cycle.washCycleId)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Tahlil
                    </button>
                  )}
                </div>
                {isActive && (
                  <ChiqimTahlilForm
                    targetMoisturePct={cycle.target_moisture_pct}
                    pallets={cycle.pallets}
                    requireVerdict={cycle.target_so2_mg_kg === null}
                    onCancel={() => setActiveTahlil(null)}
                    onSubmit={(v) => handleTahlil(cycle, v)}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-amber-600 dark:text-amber-400">Sera kutilmoqda</h2>
        <div className="mt-2 space-y-2">
          {sulfurPending.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan sera yo'q.</p>}
          {sulfurPending.map((row) => (
            <div key={row.id} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
              <div>
                <span className="font-mono text-slate-900 dark:text-slate-100">{row.serial}</span>
                <span className="ml-2 text-slate-500 dark:text-slate-400">
                  {typeName(row.type_id)} · {ownerName(row.owner_id)} · yuvish sikli {row.cycleNo}
                </span>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Namligi {row.moisture_pct}% · {row.sample_date} · Talab: {row.target_so2_mg_kg} mg/kg
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="SO₂ mg/kg"
                  value={seraValue[row.id] ?? ''}
                  onChange={(e) => setSeraValue((m) => ({ ...m, [row.id]: e.target.value }))}
                  className="w-32 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  onClick={() => handleSera(row, 'o_tdi')}
                  disabled={seraSaving === row.id}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {seraSaving === row.id ? '…' : "O'tdi"}
                </button>
                <button
                  onClick={() => handleSera(row, 'qayta_yuvish')}
                  disabled={seraSaving === row.id}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {seraSaving === row.id ? '…' : 'Qayta yuvish'}
                </button>
              </div>
              {seraError && (
                <p className="mt-1 text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                  {seraError}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Yakunlangan</h2>
        <div className="mt-2 space-y-2">
          {finished.length === 0 && <p className="text-sm text-slate-400">Yakunlangan tahlil yo'q.</p>}
          {finished.map((row) => (
            <div key={row.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <button
                type="button"
                onClick={() => setExpandedFinished(expandedFinished === row.id ? null : row.id)}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <span className="font-mono text-slate-900 dark:text-slate-100">{row.serial}</span>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">
                    {typeName(row.type_id)} · {ownerName(row.owner_id)} · sikl {row.cycleNo}
                  </span>
                </div>
                <span
                  className={
                    row.verdict === 'qayta_yuvish'
                      ? 'font-medium text-red-600 dark:text-red-400'
                      : 'font-medium text-emerald-600 dark:text-emerald-400'
                  }
                >
                  {row.verdict ? VERDICT_LABEL[row.verdict] : '—'}
                </span>
              </button>
              {expandedFinished === row.id && (
                <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
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
                  <div>{row.sample_date} · namuna: {row.sampled_pallet}</div>
                  {row.note && <div>Qayd: {row.note}</div>}
                  <GatePhoto path={row.sample_photo} label="Namuna rasmi" bucket="lab-photos" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
