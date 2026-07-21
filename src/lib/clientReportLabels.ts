// §3.2.7 Uz/Ru toggle -- a report-scoped label dictionary, deliberately NOT
// app-wide i18n. Nothing else in this codebase has any i18n infrastructure
// (§2.8 describes a global toggle that was never built) -- building one
// globally is out of scope for this report; this is a local, minimal
// dictionary just for the client report screen and its Excel export.

export type ReportLocale = 'uz' | 'ru'

export interface ClientReportLabelSet {
  title: string
  period: string
  weightBasis: string
  dateBasisRaw: string
  dateBasisFinished: string
  rawSection: string
  finishedSection: string
  openingBalance: string
  received: string
  processed: string
  produced: string
  departed: string
  closingBalance: string
  closingBalanceHeld: string
  calibreOutput: string
  konditirskiy: string
  processLoss: string
  overageWarning: string
  crossPeriodNote: string
  byType: string
  byCalibre: string
  qualityRecord: string
  intake: string
  delivered: string
  target: string
  naturalNoTarget: string
  verdictPassed: string
  verdictRewash: string
  untested: string
  dispatches: string
  detail: string
  hide: string
  exportExcel: string
  selectClient: string
  from: string
  to: string
  noData: string
  loading: string
  seriya: string
  turi: string
  kalibr: string
  moisture: string
  so2: string
  verdict: string
  cycle: string
  plate: string
  driver: string
  weight: string
}

export const CLIENT_REPORT_LABELS: Record<ReportLocale, ClientReportLabelSet> = {
  uz: {
    title: 'Mijoz hisoboti',
    period: 'Davr',
    weightBasis: "Og'irlik asosi: effective_qty (darvoza netto / oraliq qiymat, §2.16)",
    dateBasisRaw:
      "Sana asosi (xom ashyo): qabul qilingan — kelish (darvoza 1-bosqich); qayta ishlangan — yuvish sikli tugagan sana (§3.2.3 istisnosi)",
    dateBasisFinished: "Sana asosi (tayyor mahsulot): ishlab chiqarilgan — qabul sanasi; olib ketilgan — jo'natish (darvoza 2-bosqich)",
    rawSection: 'XOM ASHYO',
    finishedSection: 'TAYYOR MAHSULOT',
    openingBalance: 'Davr boshiga qoldiq',
    received: 'Davrda qabul qilingan',
    processed: 'Davrda qayta ishlangan',
    produced: 'Davrda ishlab chiqarilgan',
    departed: 'Davrda olib ketilgan',
    closingBalance: 'Davr oxiriga qoldiq',
    closingBalanceHeld: 'Davr oxiriga qoldiq (saqlanmoqda)',
    calibreOutput: 'Kalibrlar',
    konditirskiy: 'Konditirskiy',
    processLoss: "Ishlov yo'qotishi",
    overageWarning: 'Diqqat: xom ashyo balansidan ortiq yuborilgan',
    crossPeriodNote: "Boshqa davr xom ashyosi bo'yicha qayta yuvish",
    byType: 'Tur bo\'yicha',
    byCalibre: 'Kalibr bo\'yicha',
    qualityRecord: 'Kelgan seriyalar va sifat',
    intake: 'Kirim',
    delivered: 'Yetkazilgan',
    target: 'Talab',
    naturalNoTarget: "Talab yo'q · naturel",
    verdictPassed: "O'tdi",
    verdictRewash: 'Qayta yuvish',
    untested: 'Tekshirilmagan',
    dispatches: "Jo'natmalar",
    detail: 'Batafsil',
    hide: 'Yopish',
    exportExcel: 'Excel yuklab olish',
    selectClient: 'Buyurtmachi',
    from: 'Dan',
    to: 'Gacha',
    noData: 'Bu davr uchun maʼlumot yoʻq.',
    loading: 'Yuklanmoqda…',
    seriya: 'Seriya',
    turi: 'Tur',
    kalibr: 'Kalibr',
    moisture: 'Namligi %',
    so2: 'SO₂ mg/kg',
    verdict: 'Verdikt',
    cycle: 'Sikl',
    plate: 'Moshina',
    driver: 'Haydovchi',
    weight: "Og'irlik",
  },
  ru: {
    title: 'Отчёт клиента',
    period: 'Период',
    weightBasis: 'Основа веса: effective_qty (нетто на воротах / промежуточное значение, §2.16)',
    dateBasisRaw:
      'Основа даты (сырьё): принято — прибытие (ворота, этап 1); переработано — дата завершения цикла мойки (исключение §3.2.3)',
    dateBasisFinished: 'Основа даты (готовая продукция): произведено — дата приёмки; отгружено — отгрузка (ворота, этап 2)',
    rawSection: 'СЫРЬЁ',
    finishedSection: 'ГОТОВАЯ ПРОДУКЦИЯ',
    openingBalance: 'Остаток на начало периода',
    received: 'Принято за период',
    processed: 'Переработано за период',
    produced: 'Произведено за период',
    departed: 'Отгружено за период',
    closingBalance: 'Остаток на конец периода',
    closingBalanceHeld: 'Остаток на конец периода (на хранении)',
    calibreOutput: 'Калибры',
    konditirskiy: 'Кондитерский',
    processLoss: 'Технологические потери',
    overageWarning: 'Внимание: отправлено больше остатка сырья',
    crossPeriodNote: 'Повторная мойка сырья другого периода',
    byType: 'По видам',
    byCalibre: 'По калибрам',
    qualityRecord: 'Поступившие партии и качество',
    intake: 'Приём',
    delivered: 'Отгружено',
    target: 'Требование',
    naturalNoTarget: 'Нет требования · натурель',
    verdictPassed: 'Прошёл',
    verdictRewash: 'Повторная мойка',
    untested: 'Не проверено',
    dispatches: 'Отгрузки',
    detail: 'Подробнее',
    hide: 'Скрыть',
    exportExcel: 'Скачать Excel',
    selectClient: 'Заказчик',
    from: 'С',
    to: 'По',
    noData: 'Нет данных за этот период.',
    loading: 'Загрузка…',
    seriya: 'Серия',
    turi: 'Вид',
    kalibr: 'Калибр',
    moisture: 'Влажность %',
    so2: 'SO₂ мг/кг',
    verdict: 'Вердикт',
    cycle: 'Цикл',
    plate: 'Машина',
    driver: 'Водитель',
    weight: 'Вес',
  },
}
