// Client-facing UZ/internal -> RU label map (CLAUDE.md task "Rebuild the
// client portal..." Part C). The client portal is Russian-only end to end
// (SPEC.md §3.6) -- every client screen should resolve its labels through
// this map rather than hardcoding a translation ad hoc, so a spelling fix
// or a new label only ever needs to change in one place.
//
// "Хом"/"Возврат" -> "Возврат" is a deliberate merge, not a typo: the
// schema has no field distinguishing a raw-material sale from a return to
// the client (see docs/DECISIONS.md, client_chiqim_ledger's own header) --
// both read as "Возврат" on the client side until that gap is closed.
export const CLIENT_LABELS: Record<string, string> = {
  'Тайёр': 'Готовая продукция',
  'Konditerka': 'Кондитерка',
  'Хом': 'Возврат',
  'Возврат': 'Возврат',
  'Эски (ювилган)': 'Старый склад (ювилган)',
  'Эски KN': 'Старый склад Кондитерка',
  'Мошина': 'Машина',
  'Тури': 'Тип',
  'Kalibr': 'Калибр',
  'Otgruzka': 'Отгрузка',
  'Kirim': 'Приход',
  'Chiqim': 'Расход',
  'Ombor': 'Склад',
  "Yuvib tugallangan": 'Переработанная',
  'Moykada': 'В мойке',

  // Приход column headers (client portal rebuild, KIRIM-only Hisobot mirror)
  // — keyed by src/lib/reportColumns.ts's own REPORT_COLUMNS `key` field
  // (stable, English, zero collision risk), not by Rahbar's Uzbek `label`
  // text, since several of those labels ("Kalibr") already exist above as
  // keys with a DIFFERENT Russian meaning for a different context. 'Kalibr'
  // above stays untouched (CLAUDE.md: extend, never remove) — this column's
  // header is deliberately "№", not "Калибр", per the task's own mapping.
  'col.direction': 'Тип',
  'col.date': 'Дата',
  'col.serial': 'Серия',
  'col.partiya': 'Партия',
  'col.type': 'Вид сырья',
  'col.calibre': '№',
  'col.declared': 'Приход по накладной',
  'col.tara': 'Тара',
  'col.plate': 'Машина',
  'col.driver': 'Водитель',
  'col.qabul_qilingan': 'Приход нетто',
  'col.omborda_qoldi': 'Остаток сырья',
  'col.moykaga_yuborilgan': 'На переработку',
  'col.moykada': 'В переработке',
  'col.moykadan_chiqgan': 'ИТОГО переработка',
  'col.yoqotish': 'Потеря',
  'col.xom_jonatilgan': 'Возврат сырья',
  'col.olib_ketilgan': 'Отгрузка',
  'col.k1': 'K1',
  'col.k2': 'K2',
  'col.k3': 'K3',
  'col.k4': 'K4',
  'col.k5': 'K5',
  'col.k6': 'K6',
  'col.k7': 'K7',
  'col.k8': 'K8',
  'col.kn': 'Кондитерка',

  // Приход totals-strip chip labels not already covered by a col.* header
  // above (Приход/Отгрузка/Netto/Hisobiy are movement-group concepts that
  // don't have their own shown COLUMN in the 27-column set, but the task
  // asked for the totals strip to show ALL of Rahbar's totals regardless —
  // see ClientPrihodTab.tsx's own ClientTotalsStrip).
  'total.chiqim': 'Расход',
  'total.neto': 'Нетто (приход − расход)',
  'total.hisobiy': 'Расчётный (по факту/накладной)',
}

export function clientLabel(key: string): string {
  return CLIENT_LABELS[key] ?? key
}
