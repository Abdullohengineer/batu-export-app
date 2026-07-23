import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useLaboratorKirim, type AwaitingLine, type LabResultRow } from '../../lib/useLaboratorKirim'
import { KirimTahlilForm, type TahlilValues } from './KirimTahlilForm'
import { GatePhoto } from '../../components/GatePhoto'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { TextInput } from '../../components/ui/FormField'
import { SerialChip } from '../../components/ui/SerialChip'
import { Stat } from '../../components/ui/Stat'

function shortDate(iso: string) {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

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
      <div className="grid grid-cols-3 gap-3">
        <Stat value={awaiting.length} label="Tahlil kutilmoqda" />
        <Stat value={sulfurPending.length} label="Sera kutilmoqda" tone={sulfurPending.length > 0 ? 'pending' : 'neutral'} />
        <Stat value={finished.length} label="Yakunlandi" tone="ok" />
      </div>

      <div>
        <SectionHeading>1 · Tahlil kutilmoqda — namuna oling</SectionHeading>
        <div className="mt-2 space-y-2">
          {awaiting.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan serial yo'q.</p>}
          {awaiting.map((line) => {
            const isActive = activeTahlil === line.serial
            return (
              <Card key={line.serial}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <SerialChip>{line.serial}</SerialChip>
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                        {ownerName(line.owner_id)} · {typeName(line.type_id)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                      {line.actual_qty.toLocaleString()} kg · skladga kirdi {shortDate(line.confirmed_at)}
                    </div>
                  </div>
                  {!isActive && (
                    <Button variant="primary" size="lg" onClick={() => setActiveTahlil(line.serial)}>
                      Tahlil
                    </Button>
                  )}
                </div>
                {isActive && (
                  <KirimTahlilForm
                    line={line}
                    ownerName={ownerName(line.owner_id)}
                    typeName={typeName(line.type_id)}
                    onCancel={() => setActiveTahlil(null)}
                    onSubmit={(v) => handleTahlil(line, v)}
                  />
                )}
                {tahlilError && isActive && (
                  <div className="mt-2">
                    <StatusNote tone="problem">{tahlilError}</StatusNote>
                  </div>
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
                <SerialChip>{row.parent_serial}</SerialChip>
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                  {ownerName(row.owner_id)} · {typeName(row.type_id)}
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
                  <Button variant="primary" size="md" disabled={seraSaving === row.id} onClick={() => handleSera(row)}>
                    {seraSaving === row.id ? 'Saqlanmoqda…' : 'Sera kiritish'}
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
                <SerialChip>{row.parent_serial}</SerialChip>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {ownerName(row.owner_id)} · {typeName(row.type_id)}
                </span>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {row.moisture_pct}% · {row.so2_mg_kg !== null ? row.so2_mg_kg.toLocaleString() : "Yo'q · naturel"}
                  </div>
                  <div className="text-xs text-slate-400">namligi · SO₂ mg/kg</div>
                </div>
              </button>
              {expandedFinished === row.id && (
                <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
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
                  <div>{row.sample_date} · tahlil to'liq</div>
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
