import { useState } from 'react'
import { useOwners } from '../../lib/useOwners'
import { useProductTypes } from '../../lib/useProductTypes'
import { useCalibres } from '../../lib/useCalibres'
import { useClientReport } from '../../lib/useClientReport'
import { defaultDateRange } from '../../lib/dateRange'
import { CLIENT_REPORT_LABELS, type ReportLocale } from '../../lib/clientReportLabels'
import { downloadClientReportExcel } from '../../lib/clientReportExport'
import { SerialPassportModal } from './SerialPassportModal'
import { Button } from '../../components/ui/Button'
import { StatusNote } from '../../components/ui/StatusNote'

const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const td = 'px-3 py-2 align-top text-sm'

function BalanceLine({ label, value, bold, indent }: { label: string; value: number | string; bold?: boolean; indent?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${indent ? 'pl-6 text-slate-500 dark:text-slate-400' : ''} ${bold ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{typeof value === 'number' ? `${Math.round(value).toLocaleString()} kg` : value}</span>
    </div>
  )
}

// §3.2.7 Mijoz hisoboti (client report) -- the external-facing balance
// document: opening -> movements -> closing, per client, per period, per
// product. No filter bar in the §3.2.2 sense -- just client + period, since
// this is a generated document, not a browsable history. Mounted at
// /menejer/mijoz-hisoboti and /rahbar/mijoz-hisoboti, same read-only-for-
// Rahbar shape as every other §3.2 saved view.
export function ClientReportTab() {
  const initial = defaultDateRange(30)
  // §3.3: includeInactive=true throughout -- the owner select must still be
  // able to generate a report for a deactivated client, and typeName/
  // calibreLabel must resolve every historical line, not just active ones.
  const { owners } = useOwners(true)
  const { productTypes } = useProductTypes(true)
  const { calibres } = useCalibres(true)

  const [ownerId, setOwnerId] = useState<string>('')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [locale, setLocale] = useState<ReportLocale>('uz')
  const [detailOpen, setDetailOpen] = useState(false)
  const [passportSerial, setPassportSerial] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const { report, loading, error } = useClientReport(ownerId || null, from, to)
  const t = CLIENT_REPORT_LABELS[locale]

  function typeName(id: string) {
    return productTypes.find((p) => p.id === id)?.name ?? id
  }
  function calibreLabel(id: string) {
    return calibres.find((c) => c.id === id)?.label ?? id
  }

  async function handleExport() {
    if (!report) return
    setExporting(true)
    try {
      await downloadClientReportExcel(report, locale, { typeName, calibreLabel })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <option value="">{t.selectClient}</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          />
          —
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          />
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLocale('uz')}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${locale === 'uz' ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
          >
            O'zbekcha
          </button>
          <button
            type="button"
            onClick={() => setLocale('ru')}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${locale === 'ru' ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
          >
            Русский
          </button>
          <Button variant="success" size="md" onClick={handleExport} disabled={!report || exporting}>
            {exporting ? '…' : `↓ ${t.exportExcel}`}
          </Button>
        </div>
      </div>

      {!ownerId ? (
        <p className="text-sm text-slate-400">{t.selectClient}</p>
      ) : loading ? (
        <p className="text-sm text-slate-400">{t.loading}</p>
      ) : error ? (
        <StatusNote tone="problem">{error}</StatusNote>
      ) : !report ? (
        <p className="text-sm text-slate-400">{t.noData}</p>
      ) : (
        <div className="space-y-6">
          <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t.title} — {report.owner.name}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t.period}: {report.period.from} — {report.period.to}
            </p>
            <p className="mt-2 text-xs text-slate-400">{t.weightBasis}</p>
            <p className="text-xs text-slate-400">{t.dateBasisRaw}</p>
            <p className="text-xs text-slate-400">{t.dateBasisFinished}</p>
          </div>

          {/* RAW balance */}
          <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
            <h2 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">{t.rawSection}</h2>
            <BalanceLine label={t.openingBalance} value={report.raw.openingKg} />
            <BalanceLine label={`+ ${t.received}`} value={report.raw.receivedKg} />
            <BalanceLine label={`- ${t.processed}`} value={report.raw.processedKg} />
            <BalanceLine label={t.calibreOutput} value={report.raw.processedBreakdown.calibreKg} indent />
            <BalanceLine label={t.konditirskiy} value={report.raw.processedBreakdown.konditirskiyKg} indent />
            <BalanceLine
              label={t.processLoss}
              value={`${Math.round(report.raw.processedBreakdown.lossKg).toLocaleString()} kg (${report.raw.processedBreakdown.lossPct}%)`}
              indent
            />
            <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
            <BalanceLine label={`= ${t.closingBalance}`} value={report.raw.closingKg} bold />

            {report.raw.processedOverageKg > 0 && (
              <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                <p className="font-medium text-amber-800 dark:text-amber-400">
                  ⚠ {t.overageWarning}: {Math.round(report.raw.processedOverageKg).toLocaleString()} kg
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                  {report.raw.cappedSerials.map((cs) => (
                    <li key={cs.serial}>
                      <button type="button" className="underline decoration-dotted" onClick={() => setPassportSerial(cs.serial)}>
                        {cs.serial}
                      </button>
                      : {cs.actualSentKg.toLocaleString()} kg → {cs.effectiveQtyKg.toLocaleString()} kg (+{cs.overageKg.toLocaleString()} kg)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.raw.crossPeriodRewash.length > 0 && (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
                <p className="font-medium text-slate-700 dark:text-slate-300">{t.crossPeriodNote}</p>
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 dark:text-slate-400">
                      <th className="px-2 py-1 text-left">{t.seriya}</th>
                      <th className="px-2 py-1 text-left">{t.cycle}</th>
                      <th className="px-2 py-1 text-right">{t.weight}</th>
                      <th className="px-2 py-1 text-right">{t.calibreOutput}</th>
                      <th className="px-2 py-1 text-right">{t.konditirskiy}</th>
                      <th className="px-2 py-1 text-right">{t.processLoss}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.raw.crossPeriodRewash.map((cp) => (
                      <tr key={`${cp.serial}-${cp.cycleNo}`} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-2 py-1">
                          <button type="button" className="underline decoration-dotted" onClick={() => setPassportSerial(cp.serial)}>
                            {cp.serial}
                          </button>
                        </td>
                        <td className="px-2 py-1">
                          {cp.cycleNo} <span className="text-slate-400">({cp.rawConsumedDate})</span>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{cp.sentKg.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{cp.calibreKg.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{cp.konditirskiyKg.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {cp.lossKg.toLocaleString()} ({cp.lossPct}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.raw.byType.length > 1 && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{t.byType}</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 dark:text-slate-400">
                      <th className="px-2 py-1 text-left">{t.turi}</th>
                      <th className="px-2 py-1 text-right">{t.openingBalance}</th>
                      <th className="px-2 py-1 text-right">{t.received}</th>
                      <th className="px-2 py-1 text-right">{t.processed}</th>
                      <th className="px-2 py-1 text-right">{t.closingBalance}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.raw.byType.map((bt) => (
                      <tr key={bt.typeId} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-2 py-1">{typeName(bt.typeId)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{bt.openingKg.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{bt.receivedKg.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{bt.processedKg.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{bt.closingKg.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* FINISHED balance */}
          <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
            <h2 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">{t.finishedSection}</h2>
            <BalanceLine label={t.openingBalance} value={report.finished.openingKg} />
            <BalanceLine label={`+ ${t.produced}`} value={report.finished.producedKg} />
            <BalanceLine label={`- ${t.departed}`} value={report.finished.dispatchedKg} />
            <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
            <BalanceLine label={`= ${t.closingBalanceHeld}`} value={report.finished.closingKg} bold />

            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{t.byCalibre}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="px-2 py-1 text-left">{t.kalibr}</th>
                    <th className="px-2 py-1 text-right">{t.openingBalance}</th>
                    <th className="px-2 py-1 text-right">{t.produced}</th>
                    <th className="px-2 py-1 text-right">{t.departed}</th>
                    <th className="px-2 py-1 text-right">{t.closingBalance}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.finished.byCalibre.map((bc) => (
                    <tr key={bc.calibreId} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="px-2 py-1">{calibreLabel(bc.calibreId)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{bc.openingKg.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{bc.producedKg.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{bc.dispatchedKg.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{bc.closingKg.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section B: quality record */}
          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100">
              {t.qualityRecord}
            </div>
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
                  <th className={th}>{t.seriya}</th>
                  <th className={th}>{t.turi}</th>
                  <th className={th}>{t.intake}</th>
                  <th className={th}>{t.delivered}</th>
                  <th className={th}>{t.target}</th>
                  <th className={th} aria-label={t.detail} />
                </tr>
              </thead>
              <tbody>
                {report.qualityRecord.map((qr) => (
                  <tr key={qr.serial} className="border-b border-slate-200 dark:border-slate-700">
                    <td className={`${td} whitespace-nowrap font-mono text-slate-900 dark:text-slate-100`}>{qr.serial}</td>
                    <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>{typeName(qr.typeId)}</td>
                    <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>
                      {qr.intakeLab ? `${qr.intakeLab.moisturePct}% / ${qr.intakeLab.so2MgKg ?? t.naturalNoTarget}` : '—'}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {qr.deliveredLab ? (
                        <>
                          {qr.deliveredLab.moisturePct}% / {qr.deliveredLab.so2MgKg ?? '—'}
                          {qr.deliveredLab.cycleNo > 1 && <span className="text-slate-400"> ({t.cycle} {qr.deliveredLab.cycleNo})</span>}{' '}
                          {qr.deliveredLab.verdict === 'o_tdi' ? (
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">{t.verdictPassed}</span>
                          ) : (
                            <span className="font-medium text-red-600 dark:text-red-400">{t.verdictRewash}</span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">{t.untested}</span>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap text-slate-700 dark:text-slate-300`}>
                      {qr.targetSo2MgKg === null ? t.naturalNoTarget : `${qr.targetMoisturePct}% / ${qr.targetSo2MgKg}mg/kg`}
                    </td>
                    <td className={`${td} text-right`}>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        onClick={() => setPassportSerial(qr.serial)}
                      >
                        →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Collapsed, never absent (requirement C): dispatch trips + gate/staff detail */}
          <div className="rounded-md border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setDetailOpen(!detailOpen)}
              className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/60"
            >
              <span>{t.dispatches} ({report.dispatches.length})</span>
              <span>{detailOpen ? '▲' : '▼'}</span>
            </button>
            {detailOpen && (
              <div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-700">
                {report.dispatches.length === 0 ? (
                  <p className="text-sm text-slate-400">{t.noData}</p>
                ) : (
                  report.dispatches.map((d) => (
                    <div key={d.requestId} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700 dark:text-slate-300">
                        <span className="font-medium">{d.plate}</span>
                        <span>{d.driver}</span>
                        <span>{d.requestDate}</span>
                        <span className="text-slate-400">{d.departedAt}</span>
                      </div>
                      <ul className="mt-2 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
                        {d.pallets.map((p) => (
                          <li key={p.barcode2} className="font-mono">
                            {p.barcode2} — {calibreLabel(p.calibreId)} — {p.weightKg.toLocaleString()} kg
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {passportSerial && (
        <SerialPassportModal serial={passportSerial} onClose={() => setPassportSerial(null)} typeName={typeName} calibreLabel={calibreLabel} />
      )}
    </div>
  )
}
