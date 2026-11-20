# 0248 — Client Производство: incoming and after-Moyka moisture columns

2026-11-20 — The client portal's Производство table gains two columns:

- **Влажность прихода**, placed after "Приход нетто": the serial's latest
  `lab_results` reading with `scope = 'kirim'`.
- **Влажность после мойки**, placed after "Всего произведено": the serial's
  latest reading with `scope = 'chiqim'`. This is the same "latest test"
  rule as decision 0244.

Either column shows "—" when that test hasn't happened yet.

Both values come from the existing `useSerialPartiyaMoisture` hook (0244),
which now also returns `kirimMoisturePct`. It's still one `lab_results`
query, now over both scopes. No migration was needed: the client already
reads its own `lab_results` through `client_read_own_lab_results`. I
checked this live, read-only, as the Global Export client account; for
example, 091126-002 reads 21.5% on arrival and 23.5% after Moyka.

Not added to the Excel export (`clientProductionLedgerExport.ts`), which
was out of the request.
