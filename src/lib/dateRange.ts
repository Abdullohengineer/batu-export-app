// Shared "what calendar day is it, in Tashkent" helpers.
//
// Every one of these replaces a `new Date().toISOString().slice(0, 10)`-
// style expression (or the "first of month"/"N days ago" variants of it)
// that used to compute "today" via the UTC calendar day of the current
// instant, not the Tashkent one. Tashkent is UTC+5 with no DST, so the two
// disagree for any local time between 00:00 and 04:59 -- a pack/dispatch/
// sample entry logged in that window got silently dated to the PREVIOUS
// day. Found while verifying finished_pallets.received_date for the
// client portal's Производство tab; swept system-wide once found, since
// every call site used the identical buggy idiom for the identical
// reason (CLAUDE.md task follow-up, 2026-09-08 — see docs/DECISIONS.md
// "Systemic Tashkent date-stamp fix").
//
// All computed via Intl with an explicit `timeZone: 'Asia/Tashkent'`
// rather than the device's own local Date accessors (getFullYear/
// getMonth/getDate) -- correct even if a device's own system timezone is
// misconfigured, which plain local-time accessors would not be.
//
// Native `type="date"` inputs need no fix themselves: once a user has
// picked a value, `e.target.value` is already a literal YYYY-MM-DD string
// with no Date/timezone round-trip involved. Only the INITIAL default
// shown before any pick -- which is exactly what every helper here feeds
// -- was ever at risk.
const TASHKENT_TIME_ZONE = 'Asia/Tashkent'

// en-CA's default date format is exactly what we want (YYYY-MM-DD).
const tashkentDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TASHKENT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Any instant's calendar date, as seen in Asia/Tashkent, as YYYY-MM-DD. */
export function tashkentDateString(d: Date = new Date()): string {
  return tashkentDateFormatter.format(d)
}

function tashkentDateParts(d: Date = new Date()): { year: number; month: number; day: number } {
  const parts = tashkentDateFormatter.formatToParts(d)
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** Today's date in Tashkent, as YYYY-MM-DD. */
export function todayInTashkent(): string {
  return tashkentDateString()
}

/** The 1st of `d`'s (default now) Tashkent month, as YYYY-MM-DD. */
export function firstOfMonthInTashkent(d: Date = new Date()): string {
  const { year, month } = tashkentDateParts(d)
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/**
 * `days` calendar days before `d`'s (default now) Tashkent date, as
 * YYYY-MM-DD. Pure calendar-day arithmetic anchored via Date.UTC (used
 * only as a neutral scratchpad for whole-day math, not as a claim that
 * the date is itself UTC) -- safe because Tashkent has no DST to make a
 * "day" anything other than exactly 24h.
 */
export function daysAgoInTashkent(days: number, d: Date = new Date()): string {
  const { year, month, day } = tashkentDateParts(d)
  const shifted = new Date(Date.UTC(year, month - 1, day) - days * 86400000)
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

/** The full previous Tashkent month (relative to `d`, default now), as {from, to}. */
export function previousMonthRangeInTashkent(d: Date = new Date()): { from: string; to: string } {
  const { year, month } = tashkentDateParts(d)
  const firstOfThisMonthUtc = Date.UTC(year, month - 1, 1)
  const lastOfPrevMonth = new Date(firstOfThisMonthUtc - 86400000)
  const y = lastOfPrevMonth.getUTCFullYear()
  const m = String(lastOfPrevMonth.getUTCMonth() + 1).padStart(2, '0')
  const lastDay = String(lastOfPrevMonth.getUTCDate()).padStart(2, '0')
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${lastDay}` }
}

// Shared default window so history lists don't render unbounded on a phone
// (task step 6). Returns YYYY-MM-DD strings for <input type="date">.
export function defaultDateRange(days = 30): { from: string; to: string } {
  return { from: daysAgoInTashkent(days), to: todayInTashkent() }
}
