import { useState, type FormEvent } from 'react'
import { PhotoField } from '../../components/PhotoField'
import type { ChiqimLabResultRow } from '../../lib/useLaboratorChiqim'
import { sulfurChoiceFromFlag, type SulfurChoice } from '../../lib/classifySulfur'
import { Button } from '../../components/ui/Button'
import { FormField, TextInput } from '../../components/ui/FormField'
import { StatusNote } from '../../components/ui/StatusNote'
import { StatusPill } from '../../components/ui/StatusPill'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

export interface ChiqimTahlilEditValues {
  sampleDate: string
  sampledPallet: string
  moisturePct: number
  isSulfured: boolean
  so2MgKg: number | null
  photoFile: File | null
  note: string
  verdict: 'o_tdi' | 'qayta_yuvish'
}

// Lab edit action (2026-08-03) — corrects an already-Yakunlangan CHIQIM
// record, same superseding-insert behaviour as KirimTahlilEditForm.tsx.
// Every field on the record is editable, including classification
// (2026-08-15, see DECISIONS.md "Natural/sulphured classification moved
// from Menejer to Laborator; audit trail") and verdict — but per §5.5.3's
// own invariant ("the verdict is an explicit click — never auto-derived,
// even when the reading obviously misses target"), that invariant extends
// to editing too: there is no neutral "Saqlash" that silently carries the
// old verdict forward. The current verdict is shown as context; saving
// still requires clicking one of the two buttons, which may reaffirm it or
// deliberately change it.
//
// Changing the verdict here does NOT retroactively unmake pallets already
// packed under the old verdict — the hard gate (SPEC §5.5.3) is checked
// only at Barcode #2 assignment, at that instant, never re-checked
// retroactively, and it only ever reads the verdict, never is_sulfured (see
// DECISIONS.md) — the same holds for a classification flip: it changes what
// CURRENT lab status reads from this point on, for anything not yet
// packed, never retroactively.
//
// The SO2 field follows the carry-forward rule (2026-08-15): if a
// classification flip hides it, the prior so2_mg_kg is carried into the new
// row unchanged, never forced to null as a side effect of a save that
// simply doesn't present the field. See DECISIONS.md "Edit forms must carry
// forward values they don't present".
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
  const [classification, setClassification] = useState<SulfurChoice>(sulfurChoiceFromFlag(row.is_sulfured))
  const [so2, setSo2] = useState(row.so2_mg_kg !== null ? String(row.so2_mg_kg) : '')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [note, setNote] = useState(row.note ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `!== 'false'`, not `=== 'true'` -- see KirimTahlilForm.tsx's identical
  // comment. An unresolved '' selection must still read as sulfured.
  const hasSulfurTarget = classification !== 'false'
  const moisturePctNum = parseFloat(moisture)
  const so2Num = parseFloat(so2)

  async function submit(verdict: 'o_tdi' | 'qayta_yuvish') {
    setError(null)
    if (classification === '') {
      setError('Mahsulot turini tanlang.')
      return
    }
    if (isNaN(moisturePctNum)) {
      setError('Namligi % ni kiriting.')
      return
    }
    // Carry forward, never blank -- see KirimTahlilEditForm.tsx's identical
    // comment.
    let so2MgKg: number | null = row.so2_mg_kg
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
        isSulfured: classification === 'true',
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
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{row.serial}</span>
            <PartiyaBadge partiyaNo={row.partiyaNo} />
          </span>
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

      {/* Classification, correctable here (2026-08-15) -- see
          KirimTahlilForm.tsx's identical block. */}
      <FormField label="Mahsulot">
        <select
          required
          value={classification}
          onChange={(e) => setClassification(e.target.value as SulfurChoice)}
          className="w-full rounded-md border border-slate-300 px-3 text-base min-h-12 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="" disabled>
            Tanlang…
          </option>
          <option value="false">Naturel</option>
          <option value="true">Sulfatlangan</option>
        </select>
      </FormField>

      <FormField label="Tahlil sanasi">
        <TextInput type="date" required value={sampleDate} onChange={(e) => setSampleDate(e.target.value)} />
      </FormField>

      <div>
        {/* No client target shown -- see DECISIONS.md "Client quality
            targets removed from Menejer/Laborator; explicit natural/
            sulphured flag". */}
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Namligi %</label>
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
      </div>

      {hasSulfurTarget && (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Oltingugurt (SO₂)</label>
          <div className="relative mt-1">
            <TextInput type="number" min="0" step="0.1" required value={so2} onChange={(e) => setSo2(e.target.value)} className="!text-2xl font-bold" />
          </div>
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
