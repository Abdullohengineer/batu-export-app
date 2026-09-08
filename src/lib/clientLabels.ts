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
}

export function clientLabel(key: string): string {
  return CLIENT_LABELS[key] ?? key
}
