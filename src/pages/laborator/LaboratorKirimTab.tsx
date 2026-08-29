import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/AuthProvider'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useLaboratorKirim, type AwaitingLine, type LabResultRow } from '../../lib/useLaboratorKirim'
import { applySulfurClassification, sulfurChoiceFromFlag, type SulfurChoice } from '../../lib/classifySulfur'
import { KirimTahlilForm, type TahlilValues } from './KirimTahlilForm'
import { KirimTahlilEditForm, type TahlilEditValues } from './KirimTahlilEditForm'
import { GatePhoto } from '../../components/GatePhoto'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { SectionHeading } from '../../components/ui/SectionHeading'
import { StatusNote } from '../../components/ui/StatusNote'
import { TextInput } from '../../components/ui/FormField'
import { SerialChip } from '../../components/ui/SerialChip'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'
import { Stat } from '../../components/ui/Stat'
import { formatDate } from '../../lib/formatDate'

function shortDate(iso: string) {
  return formatDate(iso)
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
  // Per-row override for the Sera-kiritish classification select (2026-08-15)
  // -- absent means "not touched yet," falls back to the row's own current
  // flag (see seraClassificationFor below), not to '' -- a W2 row's flag is
  // always already resolved true by construction (status='moisture_in' is
  // only ever set when Tahlil resolved it sulfured), so there is no
  // unresolved-'' case to default to here the way the Tahlil forms have.
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

  // §5.5.1: whether this line is classified sulfured decides what happens
  // immediately after save — sulfured -> W2 (moisture_in), natural -> W3
  // directly (complete), skipping W2 entirely. No SO2 value is written
  // either way; that only ever happens via Sera kiritish (W2). Classification
  // (2026-08-15) is chosen live in the Tahlil form itself, not read from the
  // line's prior flag -- values.isSulfured is authoritative here.
  async function handleTahlil(line: AwaitingLine, values: TahlilValues) {
    setTahlilError(null)
    await applySulfurClassification(line.serial, line.is_sulfured, values.isSulfured)

    let photoPath: string | null = null
    if (values.photoFile) {
      const path = `${crypto.randomUUID()}.jpg`
      const { error: uploadErr } = await supabase.storage.from('lab-photos').upload(path, values.photoFile)
      if (uploadErr) throw uploadErr
      photoPath = path
    }

    const { error } = await supabase.from('lab_results').insert({
      scope: 'kirim',
      parent_serial: line.serial,
      sample_date: values.sampleDate,
      moisture_pct: values.moisturePct,
      sample_photo: photoPath,
      note: values.note || null,
      tested_by: profile?.id,
      status: values.isSulfured ? 'moisture_in' : 'complete',
    })
    if (error) throw error

    setActiveTahlil(null)
    refresh()
  }

  function seraClassificationFor(row: LabResultRow): SulfurChoice {
    return seraClassification[row.id] ?? sulfurChoiceFromFlag(row.is_sulfured)
  }

  // §5.5.2 W2 "Sera kiritish" — reachable for sulfured lines by construction
  // (W2 membership = status='moisture_in', which handleTahlil only ever sets
  // when Tahlil resolved sulfured) -- but the lab can still discover here
  // that a line is actually natural after all (2026-08-15) and correct it on
  // this same save: SO2 becomes optional, the line completes without it.
  // so2_mg_kg has no carry-forward concern -- a W2 row has never had one set.
  async function handleSera(row: LabResultRow) {
    setSeraError(null)
    const classification = seraClassificationFor(row)
    const isSulfured = classification !== 'false'
    let value: number | null = null
    if (isSulfured) {
      value = parseFloat(seraValue[row.id] ?? '')
      if (!value && value !== 0) {
        setSeraError('SO₂ ppm ni kiriting.')
        return
      }
    }
    setSeraSaving(row.id)
    try {
      await applySulfurClassification(row.parent_serial, row.is_sulfured, isSulfured)
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

  // Lab edit action (2026-08-03) — corrects an already-Yakunlangan record.
  // Inserts a superseding lab_results row rather than updating in place:
  // these are quality records that flow into client reports, and a changed
  // value must stay traceable against the original (the original row is
  // never touched). status is always 'complete' — editing only ever applies
  // to Window 3 rows; Window 2 (moisture_in, sulfur still pending) already
  // has its own entry point via Sera kiritish above. A left-blank photo
  // keeps the previous sample photo rather than dropping it.
  async function handleTahlilEdit(row: LabResultRow, values: TahlilEditValues) {
    setEditError(null)
    await applySulfurClassification(row.parent_serial, row.is_sulfured, values.isSulfured)

    let photoPath = row.sample_photo
    if (values.photoFile) {
      const path = `${crypto.randomUUID()}.jpg`
      const { error: uploadErr } = await supabase.storage.from('lab-photos').upload(path, values.photoFile)
      if (uploadErr) throw uploadErr
      photoPath = path
    }

    const { error } = await supabase.from('lab_results').insert({
      scope: 'kirim',
      parent_serial: row.parent_serial,
      sample_date: values.sampleDate,
      moisture_pct: values.moisturePct,
      so2_mg_kg: values.so2MgKg,
      sample_photo: photoPath,
      note: values.note || null,
      tested_by: profile?.id,
      status: 'complete',
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
          {awaiting.length === 0 && <p className="text-sm text-slate-400">Kutilayotgan serial yo'q.</p>}
          {awaiting.map((line) => {
            const isActive = activeTahlil === line.serial
            const enterable = line.gruzheny_kg !== null
            return (
              <Card key={line.serial}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <SerialChip>{line.serial}</SerialChip>
                      <PartiyaBadge partiyaNo={line.partiyaNo} typeName={typeName(line.type_id)} />
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                        {ownerName(line.owner_id)} · {typeName(line.type_id)}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                      {(line.actual_qty ?? line.declared_qty).toLocaleString()} kg · keldi {shortDate(line.order_date)}
                    </div>
                  </div>
                  {!isActive && enterable && (
                    <Button variant="primary" size="lg" onClick={() => setActiveTahlil(line.serial)}>
                      Tahlil
                    </Button>
                  )}
                </div>
                {!enterable && (
                  <div className="mt-2">
                    <StatusNote tone="pending">⏳ Darvoza (1-bosqich) kutilmoqda</StatusNote>
                  </div>
                )}
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
                <PartiyaBadge partiyaNo={row.partiyaNo} typeName={typeName(row.type_id)} />
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-900 dark:text-slate-100">
                  {ownerName(row.owner_id)} · {typeName(row.type_id)}
                </span>
              </div>
              <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                Namligi {row.moisture_pct}% kiritildi · sera hali yo'q
              </div>
              <div className="mt-2 space-y-2">
                {/* Classification, correctable here too (2026-08-15) -- the
                    lab may discover at this point that a line is actually
                    natural, and correct it on this same save. See
                    KirimTahlilForm.tsx's identical block. */}
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
                <Button variant="primary" size="md" fullWidth disabled={seraSaving === row.id} onClick={() => handleSera(row)}>
                  {seraSaving === row.id ? 'Saqlanmoqda…' : 'Sera kiritish'}
                </Button>
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
                <PartiyaBadge partiyaNo={row.partiyaNo} typeName={typeName(row.type_id)} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {ownerName(row.owner_id)} · {typeName(row.type_id)}
                </span>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {row.moisture_pct}% · {row.so2_mg_kg !== null ? row.so2_mg_kg.toLocaleString() : "Yo'q · naturel"}
                  </div>
                  <div className="text-xs text-slate-400">namligi · SO₂ ppm</div>
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
                      {row.target_so2_mg_kg !== null ? `${row.target_so2_mg_kg} ppm` : "Talab yo'q"}
                    </span>
                  </div>
                  <div>{formatDate(row.sample_date)} · tahlil to'liq</div>
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
                <KirimTahlilEditForm
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
