// Shared loss-display formatting (2026-08-29, Prompt 6). Before this, every
// screen that rendered a signed wash-process loss figure did its own sign
// handling -- some correct (SerialPassportModal's cycle.lossKg), most not
// (YieldTable/YieldTab/ClientHisobotTab/ClientSerialSummaryModal/RahbarHome/
// ClientReportTab all rendered a native negative number, e.g. "-50 kg", on a
// surplus cycle instead of "+50 kg"). One helper now, so the convention is
// enforced in one place instead of re-derived (and re-broken) per screen.
//
// Sign convention: the underlying signedKg/signedPct is sent − received
// (migration 0086, "Moyka loss becomes live") -- positive = real loss,
// negative = surplus/overage. The DISPLAY inverts which side gets the sign:
// a real loss is the "expected/neutral" case and renders bare ("50 kg"); a
// surplus is the noteworthy case and gets the explicit "+" -- the opposite
// of a naive `.toLocaleString()` on the raw signed number, which would mark
// loss (the common case) with nothing and surplus with a bare "-50" that
// reads as a negative/bad number instead of the good news it actually is.
// `unit` defaults to 'kg' (every internal, Uzbek-labelled screen); the
// client-portal screens (ClientPrihodTab and friends) are Russian-labelled
// end to end and pass 'кг' so the unit matches every other figure on the
// same row -- the sign convention itself is identical either way, this
// only swaps which unit string gets appended.
export function formatLossKg(signedKg: number, unit = 'kg'): string {
  if (signedKg > 0) return `${Math.round(signedKg).toLocaleString()} ${unit}`
  if (signedKg < 0) return `+${Math.round(Math.abs(signedKg)).toLocaleString()} ${unit}`
  return `0 ${unit}`
}

// Same convention, percent -- no rounding applied here (callers already pass
// a figure rounded to whatever precision they intend, e.g. SQL's
// round(..., 1) on yield_rows.loss_pct); this only decides the sign/prefix.
export function formatLossPct(signedPct: number): string {
  if (signedPct > 0) return `${signedPct}%`
  if (signedPct < 0) return `+${Math.abs(signedPct)}%`
  return '0%'
}

// Realized-vs-unrealized loss split (2026-08-29, Prompt 10, see DECISIONS.md
// "Serial close-out (Yakunlash) + realized-vs-unrealized loss"). Before
// this, "Moykada" (sent - received, floored) and "Yo'qotish" (sent -
// received, signed) were the SAME gap read two different ways at once --
// correct under 0086's "no serial ever closes" model (every gap was
// genuinely still in-process, `lossKg` on an open serial was never anything
// but a to-date snapshot), but conflated once Yakunlash reintroduces a real
// closure event: an OPEN serial's gap is still-in-process (Moykada, not a
// loss yet); a CLOSED serial's gap is booked loss (Yo'qotish), and Moykada
// reads exactly 0 -- the material isn't "still in Moyka" once its serial
// has been declared done.
//
// This is the canonical TS-side split for the few screens that already hold
// raw sent/received/closedAt from useMoykaOutput (OmborTayyorTab's Window 2,
// OmborMoykaTab's Window 2). Every SQL-sourced payload (passport, Hisobot,
// Yield, client report, Rahbar) gets pre-split fields computed by the
// identical rule server-side (wash_cycles.closed_at gated, same two
// branches) -- this helper is not re-called there, there is nothing left
// for it to compute once the fields already arrive split.
export interface LossDisplay {
  moykadaKg: number
  yoqotishKg: number | null
  isRealized: boolean
}

export function computeLossDisplay(sent: number, received: number, closedAt: string | null): LossDisplay {
  if (closedAt === null) {
    return { moykadaKg: Math.max(0, sent - received), yoqotishKg: null, isRealized: false }
  }
  return { moykadaKg: 0, yoqotishKg: sent - received, isRealized: true }
}
