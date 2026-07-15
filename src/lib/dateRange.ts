// Shared default window so history lists don't render unbounded on a phone
// (task step 6). Returns YYYY-MM-DD strings for <input type="date">.
export function defaultDateRange(days = 30): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}
