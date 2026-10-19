# 0243 — "Qo'shimcha hujjatlar": extra document photos per KIRIM order

2026-10-19

## Decided by the user (not re-investigated)

- Per **order**, not per serial. The passport shows its parent order's documents.
- **Replace and delete allowed.** Attachments, not accounting records; nothing
  derives a balance from them.
- Compression and size limits identical to the nakladnoy photo.
- Its own button with its own lifecycle, **not** Tahrirlash, and **not** gated
  on gate_weighings: documents attach to any load however old.

## How the nakladnoy is stored today (inspected live)

- Column `kirim_orders.doc_photo` (text, nullable) holds the **object key
  only** (`<uuid>.jpg`), not a URL.
- Bucket `kirim-photos`, private (`public=false`, no size or mime limit),
  created in 0010.
- Upload: `KirimForm.tsx handlePhotoChange` runs `compressImage()` (longest
  edge 1600px, JPEG 0.7). On a compression failure it keeps the original file
  and shows an error. Submit then calls
  `supabase.storage.from('kirim-photos').upload(\`${uuid}.jpg\`)` and writes
  the key into the `kirim_orders` insert.
- Display: `GatePhoto` with `bucket="kirim-photos"` (signed URL, 1h).
- Storage RLS: `kirim_photos_read` (any signed-in user) and
  `kirim_photos_insert` (`my_role() = 'menejer'`). No UPDATE or DELETE policy.

## Extension

New table `kirim_order_documents(order_id → kirim_orders, photo_path unique,
check photo_path like 'qoshimcha/%')`. Files go into the same `kirim-photos`
bucket under `qoshimcha/<order_id>/<uuid>.jpg`. The nakladnoy column, upload
path and policies are untouched. Table RLS has the same shape as
`kirim_fura_photos` (0155): `read_all` (signed in, not client), plus menejer
insert/update/delete. The one new storage policy, `kirim_photos_qoshimcha_delete`,
lets menejer remove objects **only under `qoshimcha/`**, so a nakladnoy object
(bucket root) can never be deleted through this path. Replace uploads a new
object, updates the row (`replaced_at`) and removes the old object. Replace
and delete each write an `audit_log` row (same pattern as Tahrirlash).
`get_serial_passport` is not changed: the passport reads the documents with
a React Query hook keyed on the order id it already returns.

Migration: `supabase/migrations/0161_kirim_order_documents.sql`, applied live
2026-10-19 (version recorded in `supabase_migrations.schema_migrations`).

## Spec deviation

SPEC §2.15 "Never DELETE — void" is overridden **for this table only**, by
the user's decision above. The audit trail is kept in `audit_log`.

## Verification

**Live DB (Supabase MCP, each run in a transaction that was rolled back;
afterwards 0 rows in the table, 0 `qoshimcha/` objects, 0 audit rows):**
- TEST Menejer added a document to a recent load past the gate (2026-10-17)
  and to an old one past the gate (2026-07-16), two on the old one. A path
  outside `qoshimcha/` was rejected by the check constraint. Replace touched
  1 row, and the audit_log insert worked.
- TEST Ombor, Qorovul, Laborator and Rahbar: insert was rejected by RLS,
  replace touched 0 rows, and each could still read the document. Client:
  insert rejected, update 0 rows, read 0 rows.
- Storage: Ombor and Rahbar uploads to `kirim-photos` were rejected; the
  Menejer upload was accepted.
- **Not executed: DELETE.** The Supabase MCP tool waits for an interactive
  confirmation on DELETE statements and timed out after 60s. The statements
  never reached Postgres (no trace in `postgres_logs`). Verified instead by
  the policy definitions read back live (`menejer_deletes`,
  `kirim_photos_qoshimcha_delete`) and by the UI run below.

**UI, phone viewport 390×844, mocked Supabase responses** (this container
can't reach `*.supabase.co`, and `.env.test` isn't in the clone): 22/22
checks passed.
- The button shows on all three cards.
- Tahrirlash is hidden on the two loads past the gate and shown on the one
  that isn't.
- Upload works on both the recent and the old load past the gate. Files land
  under `qoshimcha/<order_id>/`, are compressed, and show the size line.
- Replace updates the row, writes audit_log and removes the old object.
- Delete asks for confirmation first, then deletes the row, writes audit_log
  and removes the object.
- No write was sent to `kirim_orders`, and no storage removal touched a root
  (nakladnoy) object.
- The passport shows the Nakladnoy row and, beside it, a "Qo'shimcha
  hujjatlar" row with thumbnails that open in the lightbox.
- No console errors.

## Found, not fixed (out of scope; Tahrirlash must not change in this task)

**Tahrirlash on KIRIM orders is broken in production and has been for some
time.** As TEST Menejer, `update kirim_orders ...` raises
`42P17 infinite recursion detected in policy for relation "kirim_orders"`
for *every* order, including ones not yet at the gate. The cause is a policy
cycle: `menejer_edits` (0038) checks `gate_weighings`, whose
`client_read_own_gate_weighings` policy (client-role RLS, 0083, 2026-08-26)
reads `kirim_orders`. Postgres rejects that while expanding the policies,
whatever the data. The last successful `audit_log` `kirim_orders` edit is
2026-07-30, before 0083. The UI still shows the button on loads not at the
gate, and saving fails. A likely fix (its own task) is a `security definer`
helper `kirim_order_gate_started(order_id)` used in `menejer_edits` in place
of the inline `exists (select … from gate_weighings …)`.

Also noted, pre-existing: the `kirim_photos_read` storage policy lets the
client role read any `kirim-photos` object it can name (no client exclusion,
unlike `kirim-fura-photos`). Unchanged here per "no changes to the nakladnoy
path". For the new documents the exposure is limited: the client can't
discover their keys, because `kirim_order_documents` is RLS-hidden from the
client. For the nakladnoy it isn't: `client_read_own_kirim_orders` returns
`doc_photo` for the client's own orders, so a client could fetch their own
nakladnoy, contrary to SPEC §3.6's "no nakladnoy photo links". Worth its own
check.
