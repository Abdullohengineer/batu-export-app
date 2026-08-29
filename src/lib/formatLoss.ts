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
// client-portal screens (ClientHisobotTab/ClientSerialSummaryModal) are
// Russian-labelled end to end and pass 'кг' so the unit matches every other
// figure on the same row -- the sign convention itself is identical either
// way, this only swaps which unit string gets appended.
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
