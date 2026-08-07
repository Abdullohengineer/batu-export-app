// Shared date-display formatting (2026-08-07). Before this, every screen
// formatted dates independently -- 1 toLocaleDateString, 13 toLocaleString
// (browser-locale-dependent), and 6 hand-rolled formatters (3 of them exact
// duplicate pairs) across 14 files, none agreeing on a display shape. One
// helper now, so a future format change is one edit, not twenty.
//
// Native `type="date"` inputs and the YYYY-MM-DD helpers that feed them
// (dateRange.ts, isoToday/isoFirstOfMonth) are untouched by design -- the
// HTML date input spec requires YYYY-MM-DD regardless of display format.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// DD-MM-YY -- date only, no time.
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${pad(d.getFullYear() % 100)}`
}

// DD-MM-YY HH:MM -- for timestamps where the time also matters (gate
// completion, intake confirmation, notes, etc.), replacing the
// browser-locale-dependent toLocaleString() call sites.
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Excel export cells: a real Date value (not a DD-MM-YY string) so the
// column stays sortable/filterable as a date in the spreadsheet -- paired
// with EXCEL_DATE_FORMAT as the cell's numFmt so it still *displays*
// DD-MM-YY. A DD-MM-YY text string would sort alphabetically and break
// chronological order in every exported sheet.
export const EXCEL_DATE_FORMAT = 'dd-mm-yy'

export function toExcelDate(value: string | Date | null | undefined): Date | '' {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return ''
  return d
}
