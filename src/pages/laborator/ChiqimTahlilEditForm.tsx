import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import type { ChiqimLabResultRow } from '../../lib/useLaboratorChiqim'
import { Button } from '../../components/ui/Button'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'

export interface ChiqimTahlilEditValues {
  sampleDate: string
  sampledPallet: string
  moisturePct: number
  so2MgKg: number | null
  photoFile: File | null
  note: string
  verdict: 'o_tdi' | 'qayta_yuvish'
}

// Lab edit action (2026-08-03) — corrects an already-Yakunlangan CHIQIM
// record, same superseding-insert behaviour as KirimTahlilEditForm.tsx.
// Every field on the record is editable, including verdict — but per
// §5.5.3's own invariant ("the verdict is an explicit click — never
// auto-derived, even when the reading obviously misses target"), that
// invariant extends to editing too: there is no neutral "Saqlash" that
// silently carries the old verdict forward. The current verdict is shown
// as context; saving still requires clicking one of the two buttons,
// which may reaffirm it or deliberately change it.
//
// Changing the verdict here does NOT retroactively unmake pallets already
// packed under the old verdict — the hard gate (SPEC §5.5.3) is checked
// only at Barcode #2 assignment, at that instant, never re-checked
// retroactively. It does change what CURRENT lab status reads from this
// point on, for anything not yet packed.
export function ChiqimTahlilEditForm({
  row,
  ownerName,
  typeName,
  onCancel,
  onSubmit,
}: {
  row: ChiqimLabResultRow
  ownerName: string
  typeName: string
  onCancel: () => void
  onSubmit: (values: ChiqimTahlilEditValues) => Promise<void>
}) {
  const [sampleDate, setSampleDate] = useState(row.sample_date)
  const [sampledPallet, setSampledPallet] = useState(row.sampledPallet ?? '')
  const [moisture, setMoisture] = useState(String(row.moisture_pct))
  const [so2, setSo2] = useState(row.so2_mg_kg !== null ? String(row.so2_mg_kg) : '')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [note, setNote] = useState(row.note ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasSulfurTarget = row.target_so2_mg_kg !== null
  const moisturePctNum = parseFloat(moisture)
  const missesMoistureTarget =
    row.target_moisture_pct !== null && !isNaN(moisturePctNum) && moisturePctNum > row.target_moisture_pct
  const so2Num = parseFloat(so2)
  const exceedsSo2Target = hasSulfurTarget && !isNaN(so2Num) && so2Num > (row.target_so2_mg_kg as number)

  async function submit(verdict: 'o_tdi' | 'qayta_yuvish') {
    setError(null)
    if (isNaN(moisturePctNum)) {
      setError('Namligi % ni kiriting.')
      return
    }
    let so2MgKg: number | null = null
    if (hasSulfurTarget) {
      if (so2.trim() === '') {
        setError('Oltingugurt (SO₂) qiymatini kiriting.')
        return
      }
      if (isNaN(so2Num)) {
        setError("SO₂ noto'g'ri qiymat.")
        return
      }
      so2MgKg = so2Num
    }
    setSubmitting(true)
    try {
      await onSubmit({
        sampleDate,
        sampledPallet: sampledPallet.trim(),
        moisturePct: moisturePctNum,
        so2MgKg,
        photoFile,
        note: note.trim(),
        verdict,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saqlashda xatolik yuz berdi.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20"
    >
      <div>
        <StatusPill tone="pending">LABORATOR · TAHLILNI TAHRIRLASH</StatusPill>
        <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">Yakunlangan natijani tuzatish</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Saqlanganda yangi yozuv qo'shiladi — avvalgi natija tarix sifatida saqlanib qoladi.
        </p>
      </div>

      <div className="space-y-1.5 rounded-md bg-slate-100 p-3 dark:bg-slate-800/60">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Seriya</span>
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{row.serial}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Egasi</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{ownerName}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Tur</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">{typeName}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">Joriy natija</span>
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {row.verdict === 'o_tdi' ? "O'tdi" : 'Qayta yuvish'}
          </span>
        </div>
      </div>

      <FormField label="Namuna manbai (ixtiyoriy)">
        <TextInput
          type="text"
          placeholder="masalan: 3-tank"
          value={sampledPallet}
          onChange={(e) => setSampledPallet(e.target.value)}
        />
      </FormField>

      <FormField label="Tahlil sanasi">
        <TextInput type="date" required value={sampleDate} onChange={(e) => setSampleDate(e.target.value)} />
      </FormField>

      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Namligi %{' '}
          <span className="font-normal text-slate-400 dark:text-slate-500">
            (Talab: {row.target_moisture_pct !== null ? `${row.target_moisture_pct}%` : "Talab yo'q"})
          </span>
        </label>
        <div className="relative mt-1">
          <TextInput
            type="number"
            min="0"
            step="0.1"
            required
            value={moisture}
            onChange={(e) => setMoisture(e.target.value)}
            className="!text-2xl font-bold pr-10"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">%</span>
        </div>
        {missesMoistureTarget && (
          <div className="mt-1">
            <StatusNote tone="pending">Talabdan yuqori ({row.target_moisture_pct}%) — baribir saqlash mumkin.</StatusNote>
          </div>
        )}
      </div>

      {hasSulfurTarget && (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Oltingugurt (SO₂){' '}
            <span className="font-normal text-slate-400 dark:text-slate-500">(Talab: {row.target_so2_mg_kg} ppm)</span>
          </label>
          <div className="relative mt-1">
            <TextInput type="number" min="0" step="0.1" required value={so2} onChange={(e) => setSo2(e.target.value)} className="!text-2xl font-bold" />
          </div>
          {exceedsSo2Target && (
            <div className="mt-1">
              <StatusNote tone="pending">Talabdan yuqori ({row.target_so2_mg_kg} ppm) — baribir saqlash mumkin.</StatusNote>
            </div>
          )}
        </div>
      )}

      <PhotoField label="Namuna rasmi · ixtiyoriy, bo'sh qoldirsa avvalgisi saqlanadi" onChange={setPhotoFile} />

      <FormField label="Nuqson/begona modda qaydi (ixtiyoriy)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-base bg-white text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </FormField>

      {error && <StatusNote tone="problem">{error}</StatusNote>}

      {/* §5.5.3: verdict is an explicit click, never auto-derived or
          silently carried forward — same two dedicated buttons as the
          original Tahlil form, pre-context above shows what it currently
          is, but saving always requires choosing one. */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button type="button" variant="success" size="lg" className="flex-1" disabled={submitting} onClick={() => submit('o_tdi')}>
            {submitting ? '…' : "O'tdi"}
          </Button>
          <Button type="button" variant="danger" size="lg" className="flex-1" disabled={submitting} onClick={() => submit('qayta_yuvish')}>
            {submitting ? '…' : 'Qayta yuvish'}
          </Button>
        </div>
        <Button type="button" variant="ghost" size="md" fullWidth onClick={onCancel}>
          Bekor qilish
        </Button>
      </div>
    </form>
  )
}
