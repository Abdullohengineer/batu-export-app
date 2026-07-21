import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useLaboratorKirim, type AwaitingLine, type LabResultRow } from '../../lib/useLaboratorKirim'
import { KirimTahlilForm, type TahlilValues } from './KirimTahlilForm'
import { GatePhoto } from '../../components/GatePhoto'

// §5.5.2 Laborator KIRIM — descriptive check, no verdict. Three windows:
// W1 Tahlil kutilmoqda (FIFO), W2 Sera kutilmoqda (sulfured products only,
// amber), W3 Yakunlangan. Client target shown greyed for reference only —
// nothing here gates anything (SPEC.md v1.9 §5.5.2).
export function LaboratorKirimTab() {
  const { profile } = useAuth()
  // §3.3: includeInactive=true -- resolves names on historical serials.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { awaiting, sulfurPending, finished, loading, refresh } = useLaboratorKirim()

  const [activeTahlil, setActiveTahlil] = useState<string | null>(null)
  const [tahlilError, setTahlilError] = useState<string | null>(null)
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

  // §5.5.1: whether this line has a sulfur target decides what happens
  // immediately after save — sulfured -> W2 (moisture_in), natural -> W3
  // directly (complete), skipping W2 entirely. No SO2 value is written
  // either way; that only ever happens via Sera kiritish (W2).
  async function handleTahlil(line: AwaitingLine, values: TahlilValues) {
    setTahlilError(null)
    let photoPath: string | null = null
    if (values.photoFile) {
      const path = `${crypto.randomUUID()}.jpg`
      const { error: uploadErr } = await supabase.storage.from('lab-photos').upload(path, values.photoFile)
      if (uploadErr) throw uploadErr
      photoPath = path
    }

    const isSulfured = line.target_so2_mg_kg !== null
    const { error } = await supabase.from('lab_results').insert({
      scope: 'kirim',
      parent_serial: line.serial,
      sample_date: values.sampleDate,
      moisture_pct: values.moisturePct,
      sample_photo: photoPath,
      note: values.note || null,
      tested_by: profile?.id,
      status: isSulfured ? 'moisture_in' : 'complete',
    })
    if (error) throw error

    setActiveTahlil(null)
    refresh()
  }

  // §5.5.2 W2 "Sera kiritish" — single-field update, only reachable for
  // sulfured products by construction (W2 membership = status='moisture_in',
  // which handleTahlil only ever sets when a sulfur target exists).
  async function handleSera(row: LabResultRow) {
    setSeraError(null)
    const value = parseFloat(seraValue[row.id] ?? '')
    if (!value && value !== 0) {
      setSeraError('SO₂ mg/kg ni kiriting.')
      return
    }
    setSeraSaving(row.id)
    try {
      const { error } = await supabase
        .from('lab_results')
        .update({ so2_mg_kg: value, status: 'complete' })
        .eq('id', row.id)
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
          {awaiting.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan serial yo'q.</p>}
          {awaiting.map((line) => {
            const isActive = activeTahlil === line.serial
            return (
              <div key={line.serial} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-slate-900 dark:text-slate-100">{line.serial}</span>
                    <span className="ml-2 text-slate-500 dark:text-slate-400">
                      {typeName(line.type_id)} · {ownerName(line.owner_id)}
                    </span>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      E'lon qilingan {line.declared_qty.toLocaleString()} kg · Haqiqiy {line.actual_qty.toLocaleString()} kg ·{' '}
                      {line.order_date}
                    </div>
                  </div>
                  {!isActive && (
                    <button
                      onClick={() => setActiveTahlil(line.serial)}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Tahlil
                    </button>
                  )}
                </div>
                {isActive && (
                  <KirimTahlilForm onCancel={() => setActiveTahlil(null)} onSubmit={(v) => handleTahlil(line, v)} />
                )}
                {tahlilError && isActive && (
                  <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                    {tahlilError}
                  </p>
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
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-slate-900 dark:text-slate-100">{row.parent_serial}</span>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">
                    {typeName(row.type_id)} · {ownerName(row.owner_id)}
                  </span>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Namligi {row.moisture_pct}% · {row.sample_date} · Talab: {row.target_so2_mg_kg} mg/kg
                  </div>
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
                  onClick={() => handleSera(row)}
                  disabled={seraSaving === row.id}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  {seraSaving === row.id ? 'Saqlanmoqda…' : 'Sera kiritish'}
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
                  <span className="font-mono text-slate-900 dark:text-slate-100">{row.parent_serial}</span>
                  <span className="ml-2 text-slate-500 dark:text-slate-400">
                    {typeName(row.type_id)} · {ownerName(row.owner_id)}
                  </span>
                </div>
                <span className="text-slate-500 dark:text-slate-400">
                  Namligi {row.moisture_pct}% · SO₂ {row.so2_mg_kg !== null ? `${row.so2_mg_kg} mg/kg` : "Yo'q · naturel"}
                </span>
              </button>
              {expandedFinished === row.id && (
                <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <div>
                    Talab (mijoz): Namligi{' '}
                    <span className="text-slate-400 dark:text-slate-500">
                      {row.target_moisture_pct !== null ? `${row.target_moisture_pct}%` : "Talab yo'q"}
                    </span>{' '}
                    · SO₂{' '}
                    <span className="text-slate-400 dark:text-slate-500">
                      {row.target_so2_mg_kg !== null ? `${row.target_so2_mg_kg} mg/kg` : "Talab yo'q"}
                    </span>
                  </div>
                  <div>{row.sample_date}</div>
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
