// Newest-first ordering for completed/history lists (see DECISIONS.md
// "History list ordering"). ISO date/timestamp strings sort correctly with
// plain string comparison. Missing dates sort last — a missing timestamp
// isn't "oldest", it's unknown, so it shouldn't outrank real dates either
// direction; putting it last keeps genuinely-dated rows newest-first.
export function sortByDateDesc<T>(items: T[], getDate: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => {
    const da = getDate(a)
    const db = getDate(b)
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return db.localeCompare(da)
  })
}

// Combines two possibly-null date/timestamp strings, keeping the later one.
// For a row whose "most recent activity" spans more than one event log
// (e.g. last moyka_sends.sent_date + last finished_pallets.received_date),
// this gives a single newest-first sort key without picking one log over
// the other.
export function maxDate(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}
