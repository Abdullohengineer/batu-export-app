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
