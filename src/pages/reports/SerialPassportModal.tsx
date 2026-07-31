import { useEffect, useState, type ReactNode } from 'react'
import { fetchSerialPassport, type SerialPassport, type PassportGate } from '../../lib/serialPassport'
import { GatePhoto } from '../../components/GatePhoto'

type OpenPhoto = (url: string, label: string) => void

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
  // Lightbox lives at this level, not inside PassportBody's own scroll
  // container -- it needs to render above (and unclipped by) the passport's
  // own `overflow-y-auto` content area.
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null)

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
    // Escape closes the lightbox first if one is open, the passport itself
    // otherwise -- one shared listener rather than a second one duplicated
    // inside Lightbox, so the two never race over the same keypress.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (lightbox) {
        setLightbox(null)
        return
      }
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, lightbox])

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
            <PassportBody
              passport={passport}
              typeName={typeName}
              calibreLabel={calibreLabel}
              onOpenPhoto={(url, label) => setLightbox({ url, label })}
            />
          )}
        </div>
      </div>

      {lightbox && <Lightbox url={lightbox.url} label={lightbox.label} onClose={() => setLightbox(null)} />}
    </div>
  )
}

// Full-size image overlay, stacked above the passport's own z-50. Click on
// the backdrop (or the × button) closes just the lightbox -- stopPropagation
// keeps that click from also reaching the passport's own onClose handler,
// since this renders as a sibling inside that same click-to-close div.
function Lightbox({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="Yopish"
        className="absolute right-4 top-4 rounded-md px-2 py-1 text-2xl leading-none text-white/80 hover:text-white"
      >
        ×
      </button>
      <figure className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={label} className="max-h-[calc(100vh-6rem)] max-w-full rounded-md object-contain" />
        <figcaption className="mt-2 text-center text-sm text-white/70">{label}</figcaption>
      </figure>
    </div>
  )
}

// One label+value row inside a FieldTable.
interface FieldRow {
  label: string
  value: ReactNode
}

// The shared "headline + table" shape every passport section uses —
// restructure task: a clean label/value table replaces the previous run-on
// text paragraphs. Rows are just label+value pairs; a photo row's value is
// a GatePhoto thumbnail (or several, side by side) instead of text. Callers
// omit a row entirely for a field that doesn't apply yet (a still-pending
// photo, an optional note) rather than rendering an empty value — same
// "missing shows nothing" rule the photos themselves already followed.
function FieldTable({ rows }: { rows: FieldRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''}>
              <td className="w-40 shrink-0 px-3 py-2 align-top text-xs font-medium text-slate-500 dark:text-slate-400">
                {row.label}
              </td>
              <td className="px-3 py-2 align-top text-slate-900 dark:text-slate-100">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const sectionTitle = 'text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300'
const label = 'text-xs text-slate-500 dark:text-slate-400'

function PassportBody({
  passport,
  typeName,
  calibreLabel,
  onOpenPhoto,
}: {
  passport: SerialPassport
  typeName: (id: string) => string
  calibreLabel: (id: string) => string
  onOpenPhoto: OpenPhoto
}) {
  const { order, effectiveQty, gate, intake, kirimLab, cycles, dispatches, rawDispatches, currentPosition } = passport

  const effectiveQtyValue = effectiveQty && (
    <>
      {effectiveQty.valueKg.toLocaleString()} kg
      {effectiveQty.provisional && <span className="text-amber-700 dark:text-amber-400"> (tarozi kutilmoqda)</span>}
      {!effectiveQty.provisional &&
        effectiveQty.truckVarianceDiffKg !== null &&
        effectiveQty.truckVarianceDiffPct !== null &&
        Math.abs(effectiveQty.truckVarianceDiffKg) > 0 && (
          <span className="text-amber-700 dark:text-amber-400 font-normal">
            {' '}
            (e'lon qilingandan {effectiveQty.truckVarianceDiffKg >= 0 ? '+' : ''}
            {effectiveQty.truckVarianceDiffKg.toLocaleString()} kg, {effectiveQty.truckVarianceDiffPct >= 0 ? '+' : ''}
            {effectiveQty.truckVarianceDiffPct.toFixed(1)}% farq)
          </span>
        )}
      {order?.isMultiLine && (
        <span className={`${label} font-normal`}> — ko'p turdagi reys, darvoza brutto hech qachon qabul qilinmaydi</span>
      )}
    </>
  )

  return (
    <div className="space-y-6">
      {/* Buyurtma (Order) */}
      <section>
        <h3 className={sectionTitle}>Buyurtma</h3>
        {order ? (
          <div className="mt-2">
            <FieldTable
              rows={[
                { label: 'Buyurtmachi', value: order.ownerName },
                { label: 'Mahsulot turi', value: typeName(order.typeId) },
                { label: 'Moshina raqami', value: order.plate },
                { label: 'Haydovchi', value: order.driver },
                { label: 'Sana', value: order.orderDate },
                {
                  label: "E'lon qilingan",
                  value: (
                    <>
                      {order.declaredQty.toLocaleString()} kg
                      {order.isMultiLine && order.declaredTotal !== null && (
                        <span className={`${label} font-normal`}>
                          {' '}
                          (butun reys: {order.declaredTotal.toLocaleString()} kg, ko'p turdagi)
                        </span>
                      )}
                    </>
                  ),
                },
                {
                  label: 'Mijoz talabi — Namligi',
                  value: order.targetMoisturePct !== null ? `${order.targetMoisturePct}%` : "Talab yo'q",
                },
                {
                  label: 'Mijoz talabi — SO₂',
                  value: order.targetSo2MgKg !== null ? `${order.targetSo2MgKg} mg/kg` : "Talab yo'q · naturel",
                },
                ...(effectiveQtyValue ? [{ label: 'Effektiv miqdor', value: effectiveQtyValue }] : []),
                // Nakladnoy — captured on the KIRIM form ("Mijoz nakladnoyasini
                // biriktirish") since day one but never shown here before this
                // task; kirim-photos is where KirimForm.tsx uploads it.
                ...(order.docPhoto
                  ? [
                      {
                        label: 'Nakladnoy',
                        value: (
                          <GatePhoto
                            path={order.docPhoto}
                            label="Nakladnoy"
                            bucket="kirim-photos"
                            thumbnail
                            onOpen={onOpenPhoto}
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ) : (
          <p className={label}>Buyurtma topilmadi.</p>
        )}
      </section>

      {/* Darvoza (Gate) */}
      <section>
        <h3 className={sectionTitle}>Darvoza (KIRIM)</h3>
        <div className="mt-2">
          <FieldTable
            rows={buildGateRows(gate, 'Yuk bilan (1-bosqich)', "Bo'sh (2-bosqich)", onOpenPhoto, intake ? intake.boxMassKg : null)}
          />
        </div>
      </section>

      {/* Qabul qilish (Intake) + KIRIM lab — one section, two tables (intake
          and lab have independent existence: intake can exist without a lab
          reading yet), matching the original's two independent empty states. */}
      <section>
        <h3 className={sectionTitle}>Qabul qilish</h3>
        {intake ? (
          <div className="mt-2">
            <FieldTable
              rows={[
                {
                  label: 'Netto (Ombor)',
                  value: (
                    <>
                      {intake.actualQty.toLocaleString()} kg
                      <span className={`${label} font-normal`}> — qatorlar bo'yicha taqsimot, o'lchov emas (§2.16)</span>
                    </>
                  ),
                },
                { label: 'Tara', value: intake.boxMassKg !== null ? `${intake.boxMassKg.toLocaleString()} kg` : '—' },
                { label: 'Qabul qildi', value: `${intake.confirmedByName ?? '—'} · ${new Date(intake.confirmedAt).toLocaleString()}` },
                ...(intake.barcode1 ? [{ label: 'Barcode #1', value: intake.barcode1 }] : []),
                ...(intake.komment ? [{ label: 'Izoh', value: intake.komment }] : []),
                ...(intake.pilePhoto
                  ? [{ label: 'Uyum rasmi', value: <GatePhoto path={intake.pilePhoto} label="Uyum rasmi" bucket="intake-photos" thumbnail onOpen={onOpenPhoto} /> }]
                  : []),
              ]}
            />
          </div>
        ) : (
          <p className={label}>Hali qabul qilinmagan.</p>
        )}
        {kirimLab ? (
          <div className="mt-3">
            <div className={`${label} mb-1 font-semibold uppercase tracking-wide`}>Laboratoriya (kirim, tavsiflovchi)</div>
            <FieldTable
              rows={[
                { label: 'Namligi', value: `${kirimLab.moisturePct}%` },
                { label: 'SO₂', value: kirimLab.so2MgKg !== null ? `${kirimLab.so2MgKg} mg/kg` : "yo'q · naturel" },
                { label: 'Tekshirdi', value: `${kirimLab.testedByName ?? '—'} · ${kirimLab.sampleDate}` },
                ...(kirimLab.note ? [{ label: 'Izoh', value: kirimLab.note }] : []),
                ...(kirimLab.samplePhoto
                  ? [{ label: 'Namuna rasmi', value: <GatePhoto path={kirimLab.samplePhoto} label="Namuna rasmi" bucket="lab-photos" thumbnail onOpen={onOpenPhoto} /> }]
                  : []),
              ]}
            />
          </div>
        ) : (
          <p className={`mt-2 ${label}`}>Hali laboratoriya tekshiruvi yo'q.</p>
        )}
      </section>

      {/* Laborator v2 (2026-07-28): a serial has at most one Moyka/lab
          record now (no more wash-cycle repeats), but `cycles` stays a
          0-or-1-length array for shape compatibility with the rest of this
          modal's rendering. */}
      <section>
        <h3 className={sectionTitle}>Moyka</h3>
        {cycles.length === 0 && <p className={`mt-2 ${label}`}>Hali Moykaga yuborilmagan.</p>}
        <div className="mt-2 space-y-4">
          {cycles.map((cycle) => (
            <div key={cycle.status} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {cycle.status === 'final' ? 'Yakunlangan' : 'Faol'}
                </div>
                {cycle.finalLossPct !== null && (
                  <div className="text-xs font-medium text-red-600 dark:text-red-400">Yo'qotish: {cycle.finalLossPct.toFixed(1)}%</div>
                )}
              </div>
              <div className={`mt-1 ${label}`}>Yuborilgan: {cycle.sentKg.toLocaleString()} kg</div>

              <div className="mt-2 overflow-x-auto">
                {/* Pallet breakdown — already a proper multi-column table
                    (not run-on text), left as-is per this task's own scope. */}
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
                <div className="mt-2">
                  <FieldTable
                    rows={[
                      {
                        label: 'Xulosa',
                        value: (
                          <span className={cycle.lab.verdict === 'o_tdi' ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}>
                            {cycle.lab.verdict === 'o_tdi' ? "O'tdi" : 'Qayta yuvish'}
                          </span>
                        ),
                      },
                      {
                        label: 'Namligi',
                        value: `${cycle.lab.moisturePct}% (talab: ${order?.targetMoisturePct !== null && order?.targetMoisturePct !== undefined ? `${order.targetMoisturePct}%` : "yo'q"})`,
                      },
                      {
                        label: 'SO₂',
                        value: `${cycle.lab.so2MgKg !== null ? `${cycle.lab.so2MgKg} mg/kg` : "yo'q · naturel"}${
                          order?.targetSo2MgKg !== null && order?.targetSo2MgKg !== undefined ? ` (talab: ${order.targetSo2MgKg} mg/kg)` : ''
                        }`,
                      },
                      { label: 'Tekshirdi', value: `${cycle.lab.testedByName ?? '—'} · ${cycle.lab.sampleDate}` },
                      // Was only ever shown in the aggregate Rasmlar gallery
                      // before this task — folded in here now that that
                      // section is going away, so it isn't lost.
                      ...(cycle.lab.samplePhoto
                        ? [{ label: 'Namuna rasmi', value: <GatePhoto path={cycle.lab.samplePhoto} label="Namuna rasmi" bucket="lab-photos" thumbnail onOpen={onOpenPhoto} /> }]
                        : []),
                    ]}
                  />
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
              <FieldTable
                rows={[
                  { label: 'Moshina raqami', value: d.plate },
                  { label: 'Haydovchi', value: d.driver },
                  { label: 'Sana', value: d.requestDate },
                  {
                    label: 'Ombor',
                    value: `${d.omborFinishedByName ? `${d.omborFinishedByName} yakunladi` : 'Ombor hali yakunlamagan'}${
                      d.omborFinishedAt ? ` · ${new Date(d.omborFinishedAt).toLocaleString()}` : ''
                    }`,
                  },
                  ...buildGateRows(d.gate, "Bo'sh (1-bosqich)", 'Yuk bilan (2-bosqich)', onOpenPhoto),
                ]}
              />
              <div className="mt-2 overflow-x-auto">
                {/* Pallet breakdown — already a proper multi-column table
                    (not run-on text), left as-is per this task's own scope. */}
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

      {/* Xom jo'natmalar (Raw dispatches, 2026-07-31) — a distinct entry from
          the pallet-based Jo'natishlar above, per the task's own "distinct
          entry under dispatches" instruction, same headline+FieldTable
          shape. Omitted entirely when empty, matching every other "missing
          shows nothing" section on this passport (e.g. cycles/dispatches
          above don't render an empty table either). */}
      {rawDispatches.length > 0 && (
        <section>
          <h3 className={sectionTitle}>Xom jo'natmalar</h3>
          <div className="mt-2 space-y-3">
            {rawDispatches.map((rd) => (
              <div key={`${rd.requestId}-${rd.loadedAt}`} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                <FieldTable
                  rows={[
                    { label: 'Moshina raqami', value: rd.plate },
                    { label: 'Haydovchi', value: rd.driver },
                    { label: 'Sana', value: rd.requestDate },
                    { label: 'Vazn', value: `${rd.weightKg.toLocaleString()} kg` },
                    { label: 'Tara', value: `${rd.boxMassKg.toLocaleString()} kg` },
                    { label: 'Netto', value: `${rd.netKg.toLocaleString()} kg` },
                    { label: 'Yuklangan', value: new Date(rd.loadedAt).toLocaleString() },
                  ]}
                />
              </div>
            ))}
          </div>
        </section>
      )}

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

// Builds the label/value rows for a gate block (KIRIM's own Darvoza section,
// and each dispatch's own gate info in Jo'natishlar) — every photo lives
// inline here as its own row now; there is no separate aggregate gallery
// any more (removed in the same pass — it duplicated every photo a second
// time, and a serial's dated/actor'd context already lives on the row next
// to it). A still-pending photo is simply omitted, matching the "missing
// shows nothing" rule; the two actor/timestamp rows keep showing
// "kutilmoqda" since they're always relevant once any gate row exists at
// all, just not yet complete.
// taraKg is only passed by the KIRIM Darvoza call site (see PassportBody) --
// gate.netKg is a generated column (gruzheny_kg - pustoy_kg) that never
// subtracts box mass, so it's always "Brutto", never "Netto" (confirmed with
// the user: "if it's loaded - empty, add it as Brutto. if it's loaded -
// empty - box mass, then it's netto"). When taraKg is passed (even as null,
// meaning "not entered yet"), two extra rows make that deduction explicit:
// Tara (this serial's own box mass) and Netto (= Brutto - Tara). The
// dispatch/Jo'natishlar gate omits taraKg entirely -- a dispatched pallet's
// weight has no box mass of its own to subtract (already deducted upstream
// at the raw intake stage), so its gate figure needs no third row, just the
// Brutto rename.
function buildGateRows(
  gate: PassportGate | null,
  stage1Label: string,
  stage2Label: string,
  onOpenPhoto: OpenPhoto,
  taraKg?: number | null,
): FieldRow[] {
  if (!gate || (gate.gruzhenyKg === null && gate.pustoyKg === null)) return []

  const photos: [string | null, string][] = [
    [gate.stage1PlatePhoto, 'Moshina raqami rasmi'],
    [gate.stage1ScalePhoto, 'Tarozi rasmi (1-bosqich)'],
    [gate.stage2ScalePhoto, 'Tarozi rasmi (2-bosqich)'],
    [gate.departureDocPhoto, "Jo'natish hujjati"],
  ]
  const nettoKg = gate.netKg !== null && taraKg !== undefined && taraKg !== null ? gate.netKg - taraKg : null

  return [
    ...(gate.gruzhenyKg !== null ? [{ label: 'Yuk bilan', value: `${gate.gruzhenyKg.toLocaleString()} kg` }] : []),
    ...(gate.pustoyKg !== null ? [{ label: "Bo'sh", value: `${gate.pustoyKg.toLocaleString()} kg` }] : []),
    { label: 'Brutto', value: gate.netKg !== null ? `${gate.netKg.toLocaleString()} kg` : 'kutilmoqda' },
    ...(taraKg !== undefined
      ? [
          { label: 'Tara', value: taraKg !== null ? `${taraKg.toLocaleString()} kg` : '—' },
          { label: 'Netto', value: nettoKg !== null ? `${nettoKg.toLocaleString()} kg` : 'kutilmoqda' },
        ]
      : []),
    {
      label: stage1Label,
      value: `${gate.stage1CreatedByName ?? '—'} · ${gate.stage1CompletedAt ? new Date(gate.stage1CompletedAt).toLocaleString() : 'kutilmoqda'}`,
    },
    {
      label: stage2Label,
      value: `${gate.stage2CreatedByName ?? '—'} · ${gate.stage2CompletedAt ? new Date(gate.stage2CompletedAt).toLocaleString() : 'kutilmoqda'}`,
    },
    ...photos
      .filter((p): p is [string, string] => !!p[0])
      .map(([path, photoLabel]) => ({
        label: photoLabel,
        value: <GatePhoto path={path} label={photoLabel} thumbnail onOpen={onOpenPhoto} />,
      })),
  ]
}

