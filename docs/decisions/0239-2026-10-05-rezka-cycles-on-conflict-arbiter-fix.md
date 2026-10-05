# Rezka: ON CONFLICT (serial) fix for the two 0076-era send functions

`0141` dropped `rezka_cycles`' `unique(serial)` for `unique(serial, cycle_no)` + a
partial `WHERE closed_at IS NULL` index, and fixed `ensure_open_rezka_cycle`'s arbiter
to match, but missed `send_finished_pallets_to_rezka` and `send_old_kn_pool_to_rezka`
(unchanged since `0076`) — both still said `on conflict (serial)`, which Postgres
rejects at parse time (`42P10`), exactly the error that broke the first live Rezka
send. Fixed in `0157` to `on conflict (serial, cycle_no)`, the same fix `0125` already
applied once for the identical `wash_cycles` bug. Not fixed, flagged instead (separate
decision needed before either function is relied on again): `send_finished_pallets_to_rezka`
has had `EXECUTE` revoked from `authenticated`/`anon` since `0142` (superseded by the
ledger-tracked `send_kn_to_rezka` per `0219`/`0220`), and both functions mint through
`mint_serial_from_sources`, which leaves `kirim_lines.process` at its `'moyka'` default —
so even with `EXECUTE` granted, the very next statement would fail `0141`'s
`enforce_serial_process` trigger.
