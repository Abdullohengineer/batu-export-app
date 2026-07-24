import { useEffect, useState } from 'react'
import { fetchSerialPassport, type SerialPassport, type PassportGate } from '../../lib/serialPassport'
import { GatePhoto } from '../../components/GatePhoto'

// §3.2.5 Serial passport — the densest screen in the app, deliberately: one
// parent serial's whole life, grouped by lifecycle stage so it reads top to
// bottom as the material's story (Buyurtma → Darvoza → Qabul qilish →
// Yuvish sikllari 1..N → Jo'natishlar → Joriy holat). Reached as a
// drill-down from a Hisobot row's existing expand panel — see
// KirimRowDetail.tsx/ChiqimRowDetail.tsx's own trigger button — not a
// separate screen/route, per the task's own framing. First modal in this
// codebase (same "first of its kind, deliberately" pattern as the reporting
// engine's first `<table>`): the content is too dense for the compact
// row-expand `<tr>` it's reached from, so it needs its own real estate
// rather than trying to inherit that layout.
export function SerialPassportModal({
  serial,
  onClose,
  typeName,
  calibreLabel,
}: {
  serial: string
  onClose: () => void
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
}) {
  const [passport, setPassport] = useState<SerialPassport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchSerialPassport(serial)
      .then((data) => {
        if (!cancelled) setPassport(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Pasportni yuklashda xatolik yuz berdi.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [serial])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Seriya pasporti ${serial}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-lg bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">Seriya pasporti — {serial}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Yopish"
            className="rounded-md px-2 py-1 text-xl leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            ×
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-slate-400">Yuklanmoqda…</p>}
          {error && (
            <p className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          {passport && !loading && (
            <PassportBody passport={passport} typeName={typeName} calibreLabel={calibreLabel} />
          )}
        </div>
      </div>
    </div>
  )
}

const sectionTitle = 'text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300'
const label = 'text-xs text-slate-500 dark:text-slate-400'

function PassportBody({
  passport,
  typeName,
  calibreLabel,
}: {
  passport: SerialPassport
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
}) {
  const { order, effectiveQty, gate, intake, kirimLab, cycles, dispatches, currentPosition } = passport

  return (
    <div className="space-y-6">
      {/* Buyurtma (Order) */}
      <section>
        <h3 className={sectionTitle}>Buyurtma</h3>
        {order ? (
          <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            <div>
              {order.ownerName} · {typeName(order.typeId)} · {order.plate} · {order.driver} · {order.orderDate}
            </div>
            <div>
              E'lon qilingan: {order.declaredQty.toLocaleString()} kg
              {order.isMultiLine && order.declaredTotal !== null && (
                <span className={label}> (butun reys: {order.declaredTotal.toLocaleString()} kg, ko'p turdagi)</span>
              )}
            </div>
            <div className={label}>
              Mijoz talabi — Namligi: {order.targetMoisturePct !== null ? `${order.targetMoisturePct}%` : "Talab yo'q"} · SO₂:{' '}
              {order.targetSo2MgKg !== null ? `${order.targetSo2MgKg} mg/kg` : "Talab yo'q · naturel"}
            </div>
            {effectiveQty && (
              <div className="font-medium">
                Effektiv miqdor: {effectiveQty.valueKg.toLocaleString()} kg
                {effectiveQty.provisional && <span className="text-amber-700 dark:text-amber-400"> (tarozi kutilmoqda)</span>}
                {!effectiveQty.provisional && effectiveQty.truckVarianceDiffKg !== null && effectiveQty.truckVarianceDiffPct !== null && Math.abs(effectiveQty.truckVarianceDiffKg) > 0 && (
                  <span className="text-amber-700 dark:text-amber-400 font-normal">
                    {' '}
                    (e'lon qilingandan {effectiveQty.truckVarianceDiffKg >= 0 ? '+' : ''}
                    {effectiveQty.truckVarianceDiffKg.toLocaleString()} kg, {effectiveQty.truckVarianceDiffPct >= 0 ? '+' : ''}
                    {effectiveQty.truckVarianceDiffPct.toFixed(1)}% farq)
                  </span>
                )}
                {order.isMultiLine && <span className={`${label} font-normal`}> — ko'p turdagi reys, darvoza netto hech qachon qabul qilinmaydi</span>}
              </div>
            )}
          </div>
        ) : (
          <p className={label}>Buyurtma topilmadi.</p>
        )}
      </section>

      {/* Darvoza (Gate) */}
      <section>
        <h3 className={sectionTitle}>Darvoza (KIRIM)</h3>
        <GateBlock gate={gate} stage1Label="Yuk bilan (1-bosqich)" stage2Label="Bo'sh (2-bosqich)" />
      </section>

      {/* Qabul qilish (Intake) + KIRIM lab */}
      <section>
        <h3 className={sectionTitle}>Qabul qilish</h3>
        {intake ? (
          <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            <div>
              Aniq (Ombor): {intake.actualQty.toLocaleString()} kg
              <span className={`${label} font-normal`}> — qatorlar bo'yicha taqsimot, o'lchov emas (§2.16)</span>
            </div>
            <div className={label}>
              {intake.confirmedByName ?? '—'} · {new Date(intake.confirmedAt).toLocaleString()}
              {intake.barcode1 && ` · Barcode #1: ${intake.barcode1}`}
            </div>
            {intake.komment && <div className={label}>Izoh: {intake.komment}</div>}
            {intake.pilePhoto && <GatePhoto path={intake.pilePhoto} label="Uyum rasmi" bucket="intake-photos" />}
          </div>
        ) : (
          <p className={label}>Hali qabul qilinmagan.</p>
        )}
        {kirimLab ? (
          <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
            <div>
              Laboratoriya (kirim, tavsiflovchi): Namligi {kirimLab.moisturePct}%
              {' · '}
              SO₂: {kirimLab.so2MgKg !== null ? `${kirimLab.so2MgKg} mg/kg` : "yo'q · naturel"}
            </div>
            <div className={label}>
              {kirimLab.testedByName ?? '—'} · {kirimLab.sampleDate}
              {kirimLab.note && ` · ${kirimLab.note}`}
            </div>
            {kirimLab.samplePhoto && <GatePhoto path={kirimLab.samplePhoto} label="Namuna rasmi" bucket="lab-photos" />}
          </div>
        ) : (
          <p className={`mt-2 ${label}`}>Hali laboratoriya tekshiruvi yo'q.</p>
        )}
      </section>

      {/* Yuvish sikllari (wash cycles), repeated 1..N */}
      <section>
        <h3 className={sectionTitle}>Yuvish sikllari</h3>
        {cycles.length === 0 && <p className={`mt-2 ${label}`}>Hali Moykaga yuborilmagan.</p>}
        <div className="mt-2 space-y-4">
          {cycles.map((cycle) => (
            <div key={cycle.cycleNo} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Sikl {cycle.cycleNo}</div>
                {cycle.finalLossPct !== null && (
                  <div className="text-xs font-medium text-red-600 dark:text-red-400">Yo'qotish: {cycle.finalLossPct.toFixed(1)}%</div>
                )}
              </div>
              <div className={`mt-1 ${label}`}>Yuborilgan: {cycle.sentKg.toLocaleString()} kg</div>

              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={label}>
                      <th className="px-1 py-1 text-left">Barcode #2</th>
                      <th className="px-1 py-1 text-left">Kalibr</th>
                      <th className="px-1 py-1 text-right">Kg</th>
                      <th className="px-1 py-1 text-left">Holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycle.pallets.map((p) => (
                      <tr key={p.barcode2} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-1 py-1 font-mono text-slate-900 dark:text-slate-100">{p.barcode2}</td>
                        <td className="px-1 py-1 text-slate-700 dark:text-slate-300">{calibreLabel(p.calibreId)}</td>
                        <td className="px-1 py-1 text-right text-slate-700 dark:text-slate-300">{p.weightKg.toLocaleString()}</td>
                        <td className="px-1 py-1">
                          {p.palletStatus === 'bekor_qilingan' ? (
                            <span className="font-medium text-red-600 dark:text-red-400">
                              Bekor qilindi
                              {p.voidSuccessorBarcodes && p.voidSuccessorBarcodes.length > 0
                                ? ` → ${p.voidSuccessorBarcodes.join(', ')}`
                                : ' → hali yangi barkod chiqarilmagan'}
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">
                              {p.palletStatus === 'omborda' ? 'Omborda' : p.palletStatus === 'band_qilingan' ? 'Band qilingan' : "Jo'natilgan"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {cycle.lab ? (
                <div className="mt-2 text-sm">
                  <span className={cycle.lab.verdict === 'o_tdi' ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}>
                    {cycle.lab.verdict === 'o_tdi' ? "O'tdi" : 'Qayta yuvish'}
                  </span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {' '}
                    — Namligi {cycle.lab.moisturePct}% (talab: {order?.targetMoisturePct !== null && order?.targetMoisturePct !== undefined ? `${order.targetMoisturePct}%` : "yo'q"}) · SO₂:{' '}
                    {cycle.lab.so2MgKg !== null ? `${cycle.lab.so2MgKg} mg/kg` : "yo'q · naturel"}
                    {order?.targetSo2MgKg !== null && order?.targetSo2MgKg !== undefined && ` (talab: ${order.targetSo2MgKg} mg/kg)`}
                  </span>
                  <div className={label}>
                    {cycle.lab.testedByName ?? '—'} · {cycle.lab.sampleDate}
                  </div>
                </div>
              ) : (
                <p className={`mt-2 ${label}`}>Hali laboratoriya xulosasi yo'q.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Jo'natishlar (Dispatches) */}
      <section>
        <h3 className={sectionTitle}>Jo'natishlar</h3>
        {dispatches.length === 0 && <p className={`mt-2 ${label}`}>Hali hech qanday CHIQIM so'roviga bog'lanmagan.</p>}
        <div className="mt-2 space-y-4">
          {dispatches.map((d) => (
            <div key={d.requestId} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {d.plate} · {d.driver} · {d.requestDate}
              </div>
              <div className={label}>
                {d.omborFinishedByName ? `${d.omborFinishedByName} yakunladi` : 'Ombor hali yakunlamagan'}
                {d.omborFinishedAt && ` · ${new Date(d.omborFinishedAt).toLocaleString()}`}
              </div>
              <GateBlock gate={d.gate} stage1Label="Bo'sh (1-bosqich)" stage2Label="Yuk bilan (2-bosqich)" />
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={label}>
                      <th className="px-1 py-1 text-left">Barcode #2</th>
                      <th className="px-1 py-1 text-left">Kalibr</th>
                      <th className="px-1 py-1 text-right">Kg</th>
                      <th className="px-1 py-1 text-left">Yuklangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pallets.map((p) => (
                      <tr key={p.barcode2} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-1 py-1 font-mono text-slate-900 dark:text-slate-100">{p.barcode2}</td>
                        <td className="px-1 py-1 text-slate-700 dark:text-slate-300">{calibreLabel(p.calibreId)}</td>
                        <td className="px-1 py-1 text-right text-slate-700 dark:text-slate-300">{p.weightKg.toLocaleString()}</td>
                        <td className="px-1 py-1 text-slate-500 dark:text-slate-400">{new Date(p.loadedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Rasmlar (Photos) — every image captured across this serial's life,
          gathered into one section, lifecycle order. get_serial_passport
          already returns every path used here (checked the SQL directly,
          nothing added) — this section is purely presentational. */}
      <PhotosSection passport={passport} />

      {/* Joriy holat (Current position), by calibre */}
      <section>
        <h3 className={sectionTitle}>Joriy holat</h3>
        {currentPosition.length === 0 ? (
          <p className={`mt-2 ${label}`}>Hozircha tayyor mahsulot yo'q.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={label}>
                  <th className="px-1 py-1 text-left">Kalibr</th>
                  <th className="px-1 py-1 text-right">Omborda</th>
                  <th className="px-1 py-1 text-right">Band qilingan</th>
                  <th className="px-1 py-1 text-right">Jo'natilgan</th>
                </tr>
              </thead>
              <tbody>
                {currentPosition.map((cp) => (
                  <tr key={cp.calibreId} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-1 py-1 text-slate-900 dark:text-slate-100">{calibreLabel(cp.calibreId)}</td>
                    <td className="px-1 py-1 text-right text-slate-700 dark:text-slate-300">{cp.inStockKg.toLocaleString()} kg</td>
                    <td className="px-1 py-1 text-right text-amber-700 dark:text-amber-400">{cp.reservedKg.toLocaleString()} kg</td>
                    <td className="px-1 py-1 text-right text-slate-700 dark:text-slate-300">{cp.collectedKg.toLocaleString()} kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

interface PhotoItem {
  path: string | null
  bucket: string
  what: string
  who: string | null
  when: string | null
}

// GatePhoto's own `if (!path) return null` already hides a missing photo's
// image — this also hides the who/when caption that would otherwise sit
// above nothing, since captions only make sense attached to a real photo.
function PhotoThumb({ item }: { item: PhotoItem }) {
  if (!item.path) return null
  return (
    <div className="w-24 shrink-0">
      <GatePhoto path={item.path} label={item.what} bucket={item.bucket} thumbnail />
      <div
        className="mt-0.5 truncate text-[10px] text-slate-400"
        title={`${item.who ?? '—'}${item.when ? ' · ' + new Date(item.when).toLocaleString() : ''}`}
      >
        {item.who ?? '—'}
        {item.when && ` · ${new Date(item.when).toLocaleDateString()}`}
      </div>
    </div>
  )
}

function PhotoGroup({ title, items }: { title: string; items: PhotoItem[] }) {
  if (items.every((i) => !i.path)) return null
  return (
    <div>
      <div className={label}>{title}</div>
      <div className="mt-1 flex flex-wrap gap-3">
        {items.map((item, i) => (
          <PhotoThumb key={i} item={item} />
        ))}
      </div>
    </div>
  )
}

// Every path here already comes back from get_serial_passport today (see
// the comment at this section's call site) — this just assembles what's
// already on `passport` into one lifecycle-ordered gallery, grouped by
// stage so a serial with many dispatches or re-wash cycles doesn't turn
// into one undifferentiated wall of thumbnails.
function PhotosSection({ passport }: { passport: SerialPassport }) {
  const { gate, intake, kirimLab, cycles, dispatches } = passport

  const kirimGatePhotos: PhotoItem[] = gate
    ? [
        { path: gate.stage1PlatePhoto, bucket: 'gate-photos', what: 'Moshina raqami', who: gate.stage1CreatedByName, when: gate.stage1CompletedAt },
        { path: gate.stage1ScalePhoto, bucket: 'gate-photos', what: 'Tarozi (1-bosqich)', who: gate.stage1CreatedByName, when: gate.stage1CompletedAt },
        { path: gate.stage2ScalePhoto, bucket: 'gate-photos', what: 'Tarozi (2-bosqich)', who: gate.stage2CreatedByName, when: gate.stage2CompletedAt },
      ]
    : []

  const intakePhotos: PhotoItem[] = intake
    ? [{ path: intake.pilePhoto, bucket: 'intake-photos', what: 'Uyum rasmi', who: intake.confirmedByName, when: intake.confirmedAt }]
    : []

  const kirimLabPhotos: PhotoItem[] = kirimLab
    ? [{ path: kirimLab.samplePhoto, bucket: 'lab-photos', what: 'Namuna (kirim)', who: kirimLab.testedByName, when: kirimLab.sampleDate }]
    : []

  // One per cycle — labelled with the cycle number so a re-washed serial's
  // several sample photos aren't ambiguous about which wash they're from.
  const chiqimLabPhotos: PhotoItem[] = cycles.map((c) => ({
    path: c.lab?.samplePhoto ?? null,
    bucket: 'lab-photos',
    what: `Namuna (chiqim, sikl ${c.cycleNo})`,
    who: c.lab?.testedByName ?? null,
    when: c.lab?.sampleDate ?? null,
  }))

  // Oldest-first for this section specifically — a lifecycle narrative reads
  // forward in time, even though the Jo'natishlar section above (its own
  // established order) shows dispatches newest-first.
  const dispatchPhotos: PhotoItem[] = [...dispatches]
    .sort((a, b) => a.requestDate.localeCompare(b.requestDate))
    .flatMap((d) => [
      { path: d.gate.stage1PlatePhoto, bucket: 'gate-photos', what: `Moshina raqami (${d.plate})`, who: d.gate.stage1CreatedByName, when: d.gate.stage1CompletedAt },
      { path: d.gate.stage1ScalePhoto, bucket: 'gate-photos', what: `Tarozi 1-bosqich (${d.plate})`, who: d.gate.stage1CreatedByName, when: d.gate.stage1CompletedAt },
      { path: d.gate.stage2ScalePhoto, bucket: 'gate-photos', what: `Tarozi 2-bosqich (${d.plate})`, who: d.gate.stage2CreatedByName, when: d.gate.stage2CompletedAt },
      { path: d.gate.departureDocPhoto, bucket: 'gate-photos', what: `Jo'natish hujjati (${d.plate})`, who: d.gate.stage2CreatedByName, when: d.gate.stage2CompletedAt },
    ])

  const groups = [
    { title: 'Darvoza (KIRIM)', items: kirimGatePhotos },
    { title: 'Qabul qilish', items: intakePhotos },
    { title: 'Laboratoriya (kirim)', items: kirimLabPhotos },
    { title: 'Laboratoriya (chiqim)', items: chiqimLabPhotos },
    { title: "Jo'natishlar", items: dispatchPhotos },
  ]
  const hasAnyPhoto = groups.some((g) => g.items.some((i) => i.path))

  return (
    <section>
      <h3 className={sectionTitle}>Rasmlar</h3>
      {hasAnyPhoto ? (
        <div className="mt-2 space-y-3">
          {groups.map((g) => (
            <PhotoGroup key={g.title} title={g.title} items={g.items} />
          ))}
        </div>
      ) : (
        <p className={`mt-2 ${label}`}>Hali rasm yo'q.</p>
      )}
    </section>
  )
}

function GateBlock({ gate, stage1Label, stage2Label }: { gate: PassportGate | null; stage1Label: string; stage2Label: string }) {
  if (!gate || (gate.gruzhenyKg === null && gate.pustoyKg === null)) {
    return <p className={`mt-1 ${label}`}>Hali darvoza ma'lumoti yo'q.</p>
  }
  return (
    <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
      <div>
        Net: {gate.netKg !== null ? `${gate.netKg.toLocaleString()} kg` : 'kutilmoqda'}
        {gate.gruzhenyKg !== null && ` · Yuk bilan: ${gate.gruzhenyKg.toLocaleString()} kg`}
        {gate.pustoyKg !== null && ` · Bo'sh: ${gate.pustoyKg.toLocaleString()} kg`}
      </div>
      <div className={label}>
        {stage1Label}: {gate.stage1CreatedByName ?? '—'} · {gate.stage1CompletedAt ? new Date(gate.stage1CompletedAt).toLocaleString() : 'kutilmoqda'}
      </div>
      <div className={label}>
        {stage2Label}: {gate.stage2CreatedByName ?? '—'} · {gate.stage2CompletedAt ? new Date(gate.stage2CompletedAt).toLocaleString() : 'kutilmoqda'}
      </div>
      <div className="flex flex-wrap gap-3">
        <GatePhoto path={gate.stage1PlatePhoto} label="Moshina raqami rasmi" />
        <GatePhoto path={gate.stage1ScalePhoto} label="Tarozi rasmi (1-bosqich)" />
        <GatePhoto path={gate.stage2ScalePhoto} label="Tarozi rasmi (2-bosqich)" />
        <GatePhoto path={gate.departureDocPhoto} label="Jo'natish hujjati" />
      </div>
    </div>
  )
}
