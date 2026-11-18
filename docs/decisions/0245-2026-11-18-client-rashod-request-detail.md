# 0245 — Client Rasxod: "So'rov tafsilotlarini ko'rish" per dispatch

2026-11-18 — The client portal's Rasxod tab (`ClientRashodTab.tsx`) now has
the staff Hisobot's "So'rov tafsilotlarini ko'rish" link in each truck's
expanded panel. It opens the same `ChiqimRequestPassportModal` /
`ChiqimRequestDetail`, in a new `clientView` mode.

**Shown to the client:**
- cargo content: request lines and each pallet's barcode, seriya, partiya,
  CHIQIM namligi, type, kalibr and kg (0244);
- gate empty/loaded weights, or "Fura — darvozada o'lchanmaydi".

**Hidden from the client (decided with the user):**
- **No photos.** SPEC §3.6's "no photo / nakladnoy links" for the client
  stays in force (reconfirmed). In staff view `gate-photos` is still
  client-readable at the storage layer and `chiqim-fura-photos` isn't; client
  view renders no `GatePhoto` at all, so neither matters here.
- **No staff names or timestamps** (Menejer/Ombor/Qorovul actor rows,
  old-KN collector). The client can read only its own `profiles` row, so
  names would have rendered as raw ids.
- **No Ombor-internal note** ("Hali yig'ib olinmagan — …").
- **Seriya is not clickable.** The client has no serial passport (§3.6).
- **Language:** Uzbek, same labels as staff (user's choice), although the
  rest of the client portal is Russian.

**Verified live, read-only, as the client account (Global Export) on its
latest finished dispatch:** the request, 5 lines and 18 pallet rows came
back, and partiya and namligi resolved for every serial. Reading another
owner's request returned 0 rows. No RLS or migration change was needed.
Build and 89/89 unit tests pass. Not opened in a browser.
