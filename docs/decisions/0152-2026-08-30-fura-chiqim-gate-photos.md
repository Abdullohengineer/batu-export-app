## 2026-08-30 — Fura CHIQIM gate photos

**Task:** for Fura CHIQIM only, Qorovul captures a car photo at entry and a nakladnoy photo
at exit. Regular flow unchanged, Ombor's UI unchanged for both truck types.

### This partially reverses the same day's prompt-13 decision, deliberately

`0104` removed the fura from Qorovul's Window 1 outright, reasoning that a card the guard
can see but never clear would sit in his queue forever. That was right about the **weighing**
and wrong about the **guard**: a fura still physically arrives and still physically leaves,
and Qorovul is still the person standing there. The exclusion is now **photo-only** — the
fura is back in Window 1 with two stages that mirror the weighed flow's shape (`Kirdi` at
entry, `Chiqdi` at exit) and capture the two records a weighed truck's stages produce
incidentally. No weight, no scale, no `gate_weighings` row, ever.

Everything `0104` established is untouched: `chiqim_departed_at()` still returns
`ombor_finished_at` for a fura, the stock/report departure event is still Ombor's finish
click alone, and the undo window still closes there. **These photos gate nothing** — they do
not block Ombor, are not blocked by Ombor, and do not create a departure. The two flows are
physically parallel, which is exactly why the photo record cannot live on `gate_weighings`:
a fura has no weighing row to hang it from.

### Investigation findings (reported before coding, as asked)

**Existing photo upload code** — eight call sites, four buckets, one pattern:
`kirim-photos` (`KirimForm.tsx:110`), `gate-photos` (`QorovulKirimTab.tsx:18`,
`QorovulChiqimTab.tsx:18`), `intake-photos` (`OmborIntakeTab.tsx:54`), `lab-photos`
(`LaboratorKirimTab.tsx:72,156`, `LaboratorChiqimTab.tsx:86,174`). Every one is
`PhotoField` → `compressImage` → `storage.from(bucket).upload(path, file)` → store the
returned path in a `text` column. Three shared pieces already existed and were reused rather
than rebuilt (CLAUDE.md "reuse, don't rebuild"): `PhotoField.tsx` (which brings the
real-device compression-failure handling along for free), `GatePhoto.tsx` (signed URL,
`bucket` prop, `thumbnail` mode, `onOpen` lightbox hook — exactly the passport thumbnail
requirement, so no new display component was written), and `Lightbox.tsx`.

Two things worth recording: `uploadGatePhoto` is **duplicated verbatim** in both Qorovul
tabs rather than shared (flagged, not refactored — out of scope), and **no existing storage
path contains a parent id**; they are all flat `<uuid>.jpg`. The requirement that fura paths
carry `request_id` is therefore a deliberate departure from the house convention, and fura
photos are the first in this app that group by their owning record in the storage browser.

**Bucket setup** — `gate-photos` exists (`0012`), private, with exactly a read policy
(`auth.uid() is not null`) and an insert policy (`my_role() = 'qorovul'`), and **no UPDATE or
DELETE policy**, which is what already makes it append-only. All four buckets share that
shape. No fura bucket existed.

### The picks the task left open

**A new table, not two nullable columns on `chiqim_requests`.** The decisive reason is RLS,
not taste: photo columns would need a `qorovul_updates` UPDATE policy on `chiqim_requests`,
and **Postgres RLS cannot restrict which columns an UPDATE writes**. Storing a JPEG path
would simultaneously have granted Qorovul write access to `status`, `ombor_finished_at`,
`truck_type` and `voided_at` — a privilege escalation to save a photo. Narrowing it would
have meant a security-definer RPC per photo, which is more machinery than a table, not less.
`chiqim_requests` also now carries two BEFORE UPDATE triggers from `0104` that every photo
save would have fired pointlessly. An append-only table needs INSERT only, matches the
convention already used by `notes`/`moyka_sends`/`chiqim_pallet_consumption`/
`raw_dispatch_lines`, and carries `uploaded_by`/`uploaded_at` per capture for free.

**Window membership for a fura is photo-driven, never status-driven.** This is a correctness
requirement, not a style choice, and it is the subtlest thing in this change. Ombor's finish
click flips a fura to `olib_ketildi` (`0104`'s completion trigger). Had Qorovul's window used
the existing `status` test, the row would have been pulled out of his queue the moment Ombor
finished loading — **taking the `Chiqdi` affordance with it, before the guard had ever
photographed the nakladnoy**. Since the two flows are explicitly parallel, Qorovul's queue
tracks Qorovul's own evidence: a fura stays in Window 1 until its `chiqdi` capture exists,
whatever Ombor has done, and leaves once both exist.

**Bucket read policy excludes the `client` role** — a departure from CLAUDE.md's "same shape
as `kirim-photos`/`gate-photos`" rule, flagged rather than made silently. `gate-photos`' read
policy is a bare `auth.uid() is not null`, which includes a logged-in client. This bucket
holds **nakladnoy** photos specifically, and SPEC §3.6 records that nakladnoy photo links
were dropped from the Global Export client portal the same day it shipped. Mirroring
`gate-photos` exactly would have handed clients read access to the one document type that
decision removed. The predicate used instead —
`auth.uid() is not null and my_role() <> 'client'` — is the same one every `read_all` *table*
policy in this schema already uses, applied to storage for the first time.

**"Client report" read as the internal Mijoz hisoboti** (§3.2.7,
`src/pages/reports/ClientReportTab.tsx`, Menejer/Rahbar), **not** the Global Export client
portal (§3.6, `src/pages/client/`). Same §3.6 reasoning. The portal is untouched.

**`FuraPhotoForm`, not a mode on `GateStageForm`.** That form's entire subject is a weight
reading and its required-field logic is built around it; threading a "no weight" mode through
every branch would have been more invasive than a sibling component sharing the same shape
with one input. `PhotoField` is reused as-is inside it, so compression and the documented
real-device compression-failure path come along unchanged.

### A real bug the sandbox caught before this shipped

The first version ordered "latest photo per kind" by `uploaded_at desc`. The sandbox test
inserted a corrected re-upload and read back **the photo it was meant to replace**. Cause:
`now()` is the *transaction* timestamp, so two rows written in one transaction carry the
identical value and the ordering is a coin flip. In production two uploads would normally
land in separate transactions and it would have "worked" — which is precisely the class of
accident CLAUDE.md's origin-filtering rule warns about ("an exclusion that only works because
the data happens not to overlap is not acceptable"). Fixed with a monotonic
`seq bigint generated always as identity`, ordered on exactly; `uploaded_at` stays for
display only. Re-verified: the correction now wins and both rows are kept.

### Verification

Same disposable local Postgres 16 sandbox approach as `0104` (branching is Pro-only): clean
replay of `0001` → `0105`, only the two known data-seed migrations failing for lack of real
rows. On that real schema: both photo paths null initially; Kirdi then Chiqdi populate
`chiqim_request_totals`; a re-upload appends (2 rows kept) and the latest wins; the `kind`
CHECK rejects anything else; the table and bucket each expose **only** INSERT and SELECT
policies (append-only, structurally); the passport payload carries `photos` for the fura and
`null` for the regular dispatch in the same result; and `chiqim_departed_at` is unchanged for
both truck types, confirming the photos gate nothing.

Frontend: typecheck clean, 67 unit tests pass, production build succeeds. Playwright not run
— still no `.env.test` in this clone, same gap flagged in v1.40 and v1.41.

**Applied to the live project** (asked first), then verified there with `TEST-` fixtures in a
rolled-back transaction. Live definitions were hashed against the sandbox replay of the
committed migration file afterwards: all four objects
(`chiqim_fura_photo_paths`, `chiqim_request_totals`, `get_serial_passport`,
`get_client_report`) match exactly, so live is the committed file.

The live run deliberately let **Ombor finish first**, because that is the case a
status-driven window would have broken. With the fura already `olib_ketildi` and no photos
yet:

| | fura | regular |
|---|---|---|
| `status` | `olib_ketildi` | `kutilmoqda` |
| awaiting Kirdi in Qorovul's queue | **yes** | n/a |
| in Window 2 | no | no |

Then Kirdi, Chiqdi and a corrected Kirdi re-upload, all in one transaction (the exact
`seq`-vs-`uploaded_at` case): the corrected photo wins, **3 rows kept** (append-only holds),
the fura moves to Window 2, the passport carries `photos` for the fura and `null` for the
regular dispatch in the same payload, the internal client report shows the fura with both
photos and 400 kg, and `chiqim_departed_at` is unchanged for both truck types — the photos
gated nothing, as designed. Zero residue afterwards: no photo rows, no `TEST-` rows, no
objects in the bucket.

Noted while verifying: the CHIQIM request deleted earlier this session has since been
re-entered by the user **as a fura** (4921AA80 / Namozov U, 2 lines, no gate rows,
`kutilmoqda`) — so the first real row this feature will serve is already waiting in
Qorovul's Window 1 for its Kirdi capture.

**No PR opened** (per standing instruction — Abdulloh reviews and opens it). Branch:
`claude/total-loss-finalized-serials-5jeugz`.
