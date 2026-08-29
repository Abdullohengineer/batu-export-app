import { useEffect, useState, type ReactNode } from 'react'
import { fetchSerialPassport, type SerialPassport, type PassportGate } from '../../lib/serialPassport'
import { GatePhoto } from '../../components/GatePhoto'
import { Lightbox } from '../../components/Lightbox'
import { formatStockDate } from '../../lib/oldStock'
import { formatDate, formatDateTime } from '../../lib/formatDate'
import { formatLossKg } from '../../lib/formatLoss'
import { PartiyaBadge } from '../../components/ui/PartiyaBadge'

type OpenPhoto = (url: string, label: string) => void

// §3.2.5 Serial passport — the densest screen in the app, deliberately: one
// parent serial's whole life. Opens with Joriy holat (2026-08-07), an
// at-a-glance raw+finished reconciliation, then reads top to bottom as the
// material's chronological story (Buyurtma → Darvoza → Qabul qilish →
// Yuvish sikllari 1..N → Jo'natishlar → Saqlashda yo'qotilgan → Qaydlar).
// Reached as a drill-down from a Hisobot row's existing expand panel — see
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
          <h2 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-lg font-bold text-slate-900 dark:text-slate-100">
            <span>
              Seriya: <span className="font-mono">{serial}</span>
            </span>
            {passport?.order && (
              <>
                <span className="text-slate-400 dark:text-slate-500">·</span>
                <span className="inline-flex items-center gap-1.5 text-base font-semibold">
                  Partiya: <PartiyaBadge partiyaNo={passport.order.partiyaNo} />
                  {passport.order.partiyaNo === null && <span className="text-slate-400">—</span>}
                  <span className="font-normal text-slate-500 dark:text-slate-400">({typeName(passport.order.typeId)})</span>
                </span>
              </>
            )}
          </h2>
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
  const {
    order,
    effectiveQty,
    gate,
    intake,
    kirimLab,
    cycles,
    dispatches,
    rawDispatches,
    mintOrigin,
    notes,
    joriyHolat,
    storageLossEvents,
    pendingDispatches,
    dispatchedByCalibre,
  } = passport

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
      {/* Joriy holat (2026-08-07) — at-a-glance raw+finished reconciliation,
          rendered FIRST so the material's current state is visible before
          the chronological lifecycle detail below it. Replaces the old
          bottom-of-page currentPosition (finished-goods-by-calibre only,
          folded in here as stillInStorageBreakdown/byCalibre). Both
          balances reconcile exactly (their own parts sum to their own
          whole) -- raw-sent-to-Moyka vs finished-returned is NOT expected
          to match: that gap is real wash yield loss (yield_rows' domain),
          not a reconciliation error. */}
      <section>
        <h3 className={sectionTitle}>Joriy holat</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <div className={`${label} mb-1 font-semibold uppercase tracking-wide`}>Xom ashyo</div>
            <FieldTable
              rows={[
                { label: 'Qabul qilingan', value: `${joriyHolat.raw.receivedKg.toLocaleString()} kg` },
                { label: 'Moykaga yuborilgan', value: `${joriyHolat.raw.sentToMoykaKg.toLocaleString()} kg` },
                { label: 'Xom holda jo’natilgan', value: `${joriyHolat.raw.collectedRawKg.toLocaleString()} kg` },
                ...(joriyHolat.raw.storageLossKg > 0
                  ? [
                      {
                        label: 'Saqlashda yo’qolgan',
                        value: (
                          <>
                            {joriyHolat.raw.storageLossKg.toLocaleString()} kg
                            {joriyHolat.raw.storageLossClosedAt && (
                              <span className={`${label} font-normal`}>
                                {' '}
                                — turi {formatDate(joriyHolat.raw.storageLossClosedAt)} da yakunlandi, taxminiy ulush
                              </span>
                            )}
                          </>
                        ),
                      },
                    ]
                  : []),
                {
                  label: 'Omborda qoldi',
                  value: <span className="font-semibold">{joriyHolat.raw.stillInStorageKg.toLocaleString()} kg</span>,
                },
              ]}
            />
          </div>
          <div>
            <div className={`${label} mb-1 font-semibold uppercase tracking-wide`}>Tayyor mahsulot</div>
            <FieldTable
              rows={[
                { label: 'Moykadan qaytdi', value: `${joriyHolat.finished.returnedKg.toLocaleString()} kg` },
                { label: "Jo'natildi", value: `${joriyHolat.finished.dispatchedKg.toLocaleString()} kg` },
                ...(joriyHolat.finished.storageLossKg > 0
                  ? [{ label: 'Saqlashda yo’qolgan', value: `${joriyHolat.finished.storageLossKg.toLocaleString()} kg` }]
                  : []),
                ...(joriyHolat.finished.consumedKg > 0
                  ? [{ label: 'Qayta ishlashga ishlatilgan', value: `${joriyHolat.finished.consumedKg.toLocaleString()} kg` }]
                  : []),
                ...(joriyHolat.finished.voidedKg > 0
                  ? [{ label: 'Bekor qilindi', value: `${joriyHolat.finished.voidedKg.toLocaleString()} kg` }]
                  : []),
                {
                  label: 'Omborda qoldi',
                  value: (
                    <>
                      <span className="font-semibold">{joriyHolat.finished.stillInStorageKg.toLocaleString()} kg</span>
                      {joriyHolat.finished.stillInStorageKg > 0 && (
                        <span className={`${label} font-normal`}>
                          {' '}
                          — {[
                            joriyHolat.finished.stillInStorageBreakdown.availableKg > 0 &&
                              `${joriyHolat.finished.stillInStorageBreakdown.availableKg.toLocaleString()} bo'sh`,
                            joriyHolat.finished.stillInStorageBreakdown.reservedKg > 0 &&
                              `${joriyHolat.finished.stillInStorageBreakdown.reservedKg.toLocaleString()} band qilingan`,
                            joriyHolat.finished.stillInStorageBreakdown.awaitingLabKg > 0 &&
                              `${joriyHolat.finished.stillInStorageBreakdown.awaitingLabKg.toLocaleString()} laboratoriya kutilmoqda`,
                            joriyHolat.finished.stillInStorageBreakdown.needsRewashKg > 0 &&
                              `${joriyHolat.finished.stillInStorageBreakdown.needsRewashKg.toLocaleString()} qayta yuvish kerak`,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      )}
                    </>
                  ),
                },
              ]}
            />
          </div>
        </div>
        {joriyHolat.finished.byCalibre.length > 1 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={label}>
                  <th className="px-1 py-1 text-left">Kalibr</th>
                  <th className="px-1 py-1 text-right">Bo'sh</th>
                  <th className="px-1 py-1 text-right">Band qilingan</th>
                  <th className="px-1 py-1 text-right">Tekshiruvda</th>
                </tr>
              </thead>
              <tbody>
                {joriyHolat.finished.byCalibre.map((bc) => (
                  <tr key={bc.calibreId} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-1 py-1 text-slate-900 dark:text-slate-100">{calibreLabel(bc.calibreId)}</td>
                    <td className="px-1 py-1 text-right text-slate-700 dark:text-slate-300">{bc.availableKg.toLocaleString()} kg</td>
                    <td className="px-1 py-1 text-right text-amber-700 dark:text-amber-400">{bc.reservedKg.toLocaleString()} kg</td>
                    <td className="px-1 py-1 text-right text-slate-700 dark:text-slate-300">{bc.underReviewKg.toLocaleString()} kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* §5.4 FIFO dispatch (2026-08-28) — this serial's own dispatched kg
            by calibre, sourced from chiqim_pallet_consumption (migrations
            0087/0088), gate-completed portions only (consistent with every
            other "departed" figure on this passport). Omitted entirely when
            empty, same "missing shows nothing" rule as the rest of this
            page. */}
        {dispatchedByCalibre.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={label}>
                  <th className="px-1 py-1 text-left">Jo'natilgan — kalibr bo'yicha</th>
                  <th className="px-1 py-1 text-right">Miqdor</th>
                </tr>
              </thead>
              <tbody>
                {dispatchedByCalibre.map((dbc) => (
                  <tr key={dbc.calibreId} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-1 py-1 text-slate-900 dark:text-slate-100">{calibreLabel(dbc.calibreId)}</td>
                    <td className="px-1 py-1 text-right text-slate-700 dark:text-slate-300">{dbc.kg.toLocaleString()} kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Kutilayotgan (Pending dispatches, 2026-08-07 — Symptom A fix). A
          request that has reserved this serial's RAW material but hasn't
          produced the completed event yet was previously invisible here
          even though it's already visible on the CHIQIM screen. Finished/
          old_washed dropped out of this list entirely with §5.4 FIFO
          dispatch (2026-08-28) — see PassportPendingDispatch's own comment
          in serialPassport.ts for why. Omitted entirely when empty,
          matching this passport's "missing shows nothing" rule. */}
      {pendingDispatches.length > 0 && (
        <section>
          <h3 className={sectionTitle}>Kutilayotgan yuklashlar</h3>
          <div className="mt-2 space-y-2">
            {pendingDispatches.map((pd) => (
              <div key={`${pd.kind}-${pd.requestId}`} className="rounded-md border border-amber-200 p-2 text-sm dark:border-amber-900">
                <span className="font-medium text-slate-900 dark:text-slate-100">Xom ashyo</span>
                <span className={`ml-2 ${label}`}>
                  {pd.plate} · {pd.driver} · {formatDate(pd.requestDate)}
                </span>
                <div className={label}>Havzaga qo'shilgan, hali yig'ib olinmagan</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Kelib chiqishi (Mint origin) — Stage 3. Rendered FIRST for a minted
          serial: it is this serial's actual beginning, and the Buyurtma /
          Darvoza sections below are near-empty for it by design (no truck
          ever arrived). Omitted entirely for an ordinary delivered serial,
          matching this passport's "missing shows nothing" rule. */}
      {mintOrigin && (
        <section>
          <h3 className={`${sectionTitle} flex items-center gap-1.5`}>
            Kelib chiqishi — qayta ishlangan
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-800 dark:bg-amber-900/50 dark:text-amber-400">
              Eski zaxiradan
            </span>
          </h3>
          <div className="mt-2">
            <FieldTable
              rows={[
                ...(mintOrigin.palletCount > 0
                  ? [
                      {
                        label: 'Manba',
                        value: `${mintOrigin.palletCount} ta eski pallet ishlatildi`,
                      },
                      {
                        label: "Kitob bo'yicha",
                        value: (
                          <>
                            ~{Math.round(mintOrigin.bookTotalKg).toLocaleString()} kg
                            <span className={`${label} font-normal`}> — taxminiy, bir yildan oshgan o'lchov</span>
                          </>
                        ),
                      },
                    ]
                  : []),
                ...(mintOrigin.poolDrawKg > 0
                  ? [{ label: 'Havzadan', value: `${mintOrigin.poolDrawKg.toLocaleString()} kg` }]
                  : []),
                {
                  label: 'Tarozida yuborilgan',
                  value: (
                    <span className="font-medium">{mintOrigin.sentWeighedKg.toLocaleString()} kg</span>
                  ),
                },
                // The whole point of keeping the two figures apart: this gap
                // is storage/dehydration loss, NOT wash loss. Wash loss is
                // computed from the weighed figure against real output.
                ...(mintOrigin.palletCount > 0
                  ? [
                      {
                        label: "Saqlash farqi",
                        value: (
                          <>
                            {mintOrigin.sentWeighedKg - mintOrigin.bookTotalKg >= 0 ? '+' : ''}
                            {Math.round(mintOrigin.sentWeighedKg - mintOrigin.bookTotalKg).toLocaleString()} kg
                            <span className={`${label} font-normal`}> — saqlash yo'qotishi, yuvish yo'qotishiga kirmaydi</span>
                          </>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            {mintOrigin.pallets.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={label}>
                      <th className="px-1 py-1 text-left">Ishlatilgan Barcode #2</th>
                      <th className="px-1 py-1 text-left">Kalibr</th>
                      <th className="px-1 py-1 text-left">Manba seriya</th>
                      <th className="px-1 py-1 text-right">Kitob kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mintOrigin.pallets.map((p) => (
                      <tr key={p.barcode2} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-1 py-1 font-mono text-slate-900 dark:text-slate-100">{p.barcode2}</td>
                        <td className="px-1 py-1 text-slate-700 dark:text-slate-300">{calibreLabel(p.calibreId)}</td>
                        <td className="px-1 py-1 font-mono text-slate-600 dark:text-slate-400">{p.sourceSerial}</td>
                        <td className="px-1 py-1 text-right text-slate-700 dark:text-slate-300">
                          ~{Math.round(p.bookWeightKg).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Buyurtma (Order) */}
      <section>
        <h3 className={`${sectionTitle} flex items-center gap-1.5`}>
          Buyurtma
          {order?.isOldStock && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-800 dark:bg-amber-900/50 dark:text-amber-400">
              Eski zaxira
            </span>
          )}
          {order?.isMinted && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-800 dark:bg-amber-900/50 dark:text-amber-400">
              Qayta ishlangan
            </span>
          )}
        </h3>
        {order ? (
          <div className="mt-2">
            <FieldTable
              rows={[
                { label: 'Buyurtmachi', value: order.ownerName },
                { label: 'Mahsulot turi', value: typeName(order.typeId) },
                { label: 'Moshina raqami', value: order.plate },
                { label: 'Haydovchi', value: order.driver },
                // Opening stock, Stage 2 -- the order date is the seed's
                // backdated anchor for an old-stock serial, not a real
                // arrival (same reasoning as qoldig'i's own date column,
                // shared helper).
                { label: 'Sana', value: formatStockDate(order.isOldStock, order.orderDate) },
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
                  value: order.targetSo2MgKg !== null ? `${order.targetSo2MgKg} ppm` : "Talab yo'q · naturel",
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
                { label: 'Qabul qildi', value: `${intake.confirmedByName ?? '—'} · ${formatDateTime(intake.confirmedAt)}` },
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
                { label: 'SO₂', value: kirimLab.so2MgKg !== null ? `${kirimLab.so2MgKg} ppm` : "yo'q · naturel" },
                { label: 'Tekshirdi', value: `${kirimLab.testedByName ?? '—'} · ${formatDate(kirimLab.sampleDate)}` },
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
          {cycles.map((cycle, i) => (
            <div key={i} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Moykada: {cycle.inMoykaKg.toLocaleString()} kg</div>
                <div
                  className={
                    cycle.lossKg > 0
                      ? 'text-xs font-medium text-red-600 dark:text-red-400'
                      : cycle.lossKg < 0
                        ? 'text-xs font-medium text-amber-600 dark:text-amber-400'
                        : 'text-xs font-medium text-slate-500 dark:text-slate-400'
                  }
                >
                  Yo'qotish: {formatLossKg(cycle.lossKg)}
                </div>
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
                              {p.palletStatus === 'omborda'
                                ? 'Omborda'
                                : p.palletStatus === 'band_qilingan'
                                  ? 'Band qilingan'
                                  : p.palletStatus === 'saqlashda_yoqolgan'
                                    ? 'Saqlashda yo\'qolgan'
                                    : p.palletStatus === 'ishlatilgan'
                                      ? 'Qayta ishlashga ishlatilgan'
                                      : "Jo'natilgan"}
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
                        value: `${cycle.lab.so2MgKg !== null ? `${cycle.lab.so2MgKg} ppm` : "yo'q · naturel"}${
                          order?.targetSo2MgKg !== null && order?.targetSo2MgKg !== undefined ? ` (talab: ${order.targetSo2MgKg} ppm)` : ''
                        }`,
                      },
                      { label: 'Tekshirdi', value: `${cycle.lab.testedByName ?? '—'} · ${formatDate(cycle.lab.sampleDate)}` },
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
                  { label: 'Sana', value: formatDate(d.requestDate) },
                  {
                    label: 'Ombor',
                    value: `${d.omborFinishedByName ? `${d.omborFinishedByName} yakunladi` : 'Ombor hali yakunlamagan'}${
                      d.omborFinishedAt ? ` · ${formatDateTime(d.omborFinishedAt)}` : ''
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
                        <td className="px-1 py-1 text-slate-500 dark:text-slate-400">{formatDateTime(p.loadedAt)}</td>
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
                    { label: 'Sana', value: formatDate(rd.requestDate) },
                    { label: 'Vazn', value: `${rd.weightKg.toLocaleString()} kg` },
                    { label: 'Tara', value: `${rd.boxMassKg.toLocaleString()} kg` },
                    { label: 'Netto', value: `${rd.netKg.toLocaleString()} kg` },
                    { label: 'Yuklangan', value: formatDateTime(rd.loadedAt) },
                  ]}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Saqlashda yo'qotilgan (Storage-loss close-out events, 2026-08-07) —
          the fourth exit path the passport was missing entirely. old_washed
          is per-pallet and exact; old_raw is a single derived-share entry
          (the close-out only books a lump per owner+type, never per
          serial) — no photos exist for a close-out (an administrative RPC
          action, not a physical event with a camera present), so none are
          shown, matching "missing shows nothing" rather than fabricating a
          photo row. */}
      {storageLossEvents.length > 0 && (
        <section>
          <h3 className={sectionTitle}>Saqlashda yo'qotilgan</h3>
          <div className="mt-2 space-y-2">
            {storageLossEvents.map((e, i) => (
              <div key={`${e.kind}-${e.barcode2 ?? i}`} className="rounded-md border border-slate-200 p-2 text-sm dark:border-slate-700">
                {e.kind === 'old_washed' ? (
                  <>
                    <span className="font-mono text-slate-900 dark:text-slate-100">{e.barcode2}</span>
                    <span className={`ml-2 ${label}`}>
                      {e.calibreId && calibreLabel(e.calibreId)} · {e.weightKg.toLocaleString()} kg
                      {e.voidedAt && ` · ${formatDate(e.voidedAt)}`}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-medium text-slate-900 dark:text-slate-100">Xom ashyo — turi yakunlandi</span>
                    <span className={`ml-2 ${label}`}>
                      {e.weightKg.toLocaleString()} kg{e.closedAt && ` · ${formatDate(e.closedAt)}`}
                    </span>
                    {e.note && <div className={label}>{e.note}</div>}
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Qaydlar (2026-08-02, Stage 3) — the passport rendered no notes at
          all before. Read-only here by design: the passport is a record,
          not a workspace, so this shows the notes (including the mint's own
          auto-note recording old-stock lineage) without EntityNotes' add
          form. Adding stays where the work happens — Ombor's Moyka tab and
          Laborator's CHIQIM card. */}
      {notes.length > 0 && (
        <section>
          <h3 className={sectionTitle}>Qaydlar</h3>
          <ul className="mt-2 space-y-1">
            {notes.map((n) => (
              <li key={n.id} className="text-sm text-slate-700 dark:text-slate-300">
                {n.body}
                <span className={`ml-2 ${label}`}>
                  {n.authorName ? `${n.authorName} · ` : ''}
                  {formatDateTime(n.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
      value: `${gate.stage1CreatedByName ?? '—'} · ${gate.stage1CompletedAt ? formatDateTime(gate.stage1CompletedAt) : 'kutilmoqda'}`,
    },
    {
      label: stage2Label,
      value: `${gate.stage2CreatedByName ?? '—'} · ${gate.stage2CompletedAt ? formatDateTime(gate.stage2CompletedAt) : 'kutilmoqda'}`,
    },
    ...photos
      .filter((p): p is [string, string] => !!p[0])
      .map(([path, photoLabel]) => ({
        label: photoLabel,
        value: <GatePhoto path={path} label={photoLabel} thumbnail onOpen={onOpenPhoto} />,
      })),
  ]
}

