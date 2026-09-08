## 2026-09-08 — Приход Excel export Russian-ized, closing the gap flagged in the previous entry

**Context:** The previous entry (0171) shipped `ClientPrihodTab.tsx`'s Excel export by reusing
`downloadReportExcel` verbatim, flagging rather than fixing that the downloaded `.xlsx` file's own
column headers, `direction` cell text, and summary-row labels stayed Rahbar's hardcoded Uzbek
strings even though the on-screen table is fully Russian — a real, visible inconsistency between
what the client sees on screen and what they get in the file. Follow-up instruction: fix it,
small scope, one export function, same translation map already used on-screen.

**Decision:** `reportExport.ts` gained one optional parameter, `ExportTextOverrides`, threaded
through `buildReportWorkbook`/`downloadReportExcel` and into the internal `columnValue()` helper.
Every field defaults to the function's own existing Uzbek text when the parameter is omitted, so
Rahbar/Menejer's own `HisobotTab.tsx` — which still calls both functions with its original 4 args,
unchanged — gets byte-for-byte identical output to before. `ClientPrihodTab.tsx` is the one caller
that now passes it (`CLIENT_PRIHOD_EXPORT_OVERRIDES`), routing every piece of exported text through
the exact same `clientLabel()` keys the on-screen table/totals strip already use: `col.*` for
column headers (column-key-keyed, not text-keyed, for the same "Kalibr" collision reason 0171's
`col.*` scheme exists at all), `clientLabel('Kirim')` for the `direction` column's cell value
(every row, since direction is permanently locked to KIRIM here), and `total.*`/`col.*` composites
for the summary block. `statusText` is overridden to a constant `''` — the `status` column isn't
in this view's 27-key set at all, so this branch is dead code for this caller, kept only because
`ExportTextOverrides` needed *a* value and an empty string is the cheapest correct one.

**Verification:** `npx tsc -b` and `oxlint` clean. Confirmed `HisobotTab.tsx`'s own call site
still passes exactly 4 arguments (no overrides) — the new 5th parameter is genuinely optional and
additive, not a silent behavior change for the 5 staff roles.
