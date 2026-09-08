## 2026-09-08 — Decisions log restructured to one file per entry
**Context:** `docs/DECISIONS.md` was a single ~8,000-line append-only file, and every task
appended its entry at the same place — the end. Any two branches developed in parallel
therefore collided on the same lines, and git stopped with a conflict it could not resolve,
even though the two entries were unrelated and the correct resolution was always "keep both".

This was not theoretical or occasional. Inside two days it blocked PR #131 and PR #132 at the
same time, then blocked #132 a second time as soon as #131/#136/#138 merged and moved `main`
again, and then blocked PR #139 — this change itself — when #132 landed first. Every one of
those resolutions was mechanical. The cost was never the merge; it was that a PR left open
while anything else merged became un-mergeable, so being slow to review a PR was itself what
broke it.

**Prior attempt, and why it was not enough:** PR #136 added `.gitattributes` with
`docs/DECISIONS.md merge=union` — git's built-in driver for exactly this shape, which keeps
both sides of a conflicting hunk. It worked where a real git client did the merging and
removed all hand-splicing. But it did **not** unblock GitHub's merge button: GitHub's
server-side merge ignores `.gitattributes` merge drivers. That was verified empirically
rather than assumed — a throwaway PR was opened between two branches that both carried the
rule and differed only by an appended entry, and GitHub still reported
`mergeable_state: "dirty"`. It also could not help on the very merge that first introduced
it, since git reads `.gitattributes` at merge start.

**Decision:** One file per entry, `docs/decisions/NNNN-YYYY-MM-DD-short-slug.md`. Two branches
adding different entries now touch different paths, so they cannot conflict — on GitHub or
anywhere else. This is a structural fix rather than a merge-strategy workaround: there is no
shared line for two entries to fight over in the first place.

**Why the `NNNN` sequence prefix, rather than plain dates.** A first cut named files
`YYYY-MM-DD-slug.md`, which sorts by date. That was wrong, and the check that caught it is
worth recording: 31 of the 169 entries refer to their neighbours positionally ("the entry
above", "the two entries below", "Follow-up to the entry above"). Date-sorting silently
changed what those pointed at, because 35 dates carry more than one entry and slug-alphabetical
order is not the order they were written in. Two entries were also genuinely out of date order
in the original file (`0129` and `0166`, both merge artifacts), so even a date-plus-ordinal
scheme still moved them. The sequence prefix preserves the original reading order exactly —
verified by concatenating the files in `ls` order and comparing the result line-by-line, in
sequence, against the old file: identical.

The sequence is a **sort hint, not an identifier**. Two branches taking the same next number
produce different filenames (their slugs differ) and therefore still cannot conflict. Ties and
gaps are harmless and must not be "fixed" by renumbering, which would break the byte-identity
guarantee below.

**Nothing was rewritten.** The 169 entries were split mechanically. Entry text is byte-identical
to the single file — headings left at `##` rather than promoted to `#` — verified two ways:
a multiset comparison of every content line (0 missing, 0 invented) and the order-preserving
comparison above. Only the preamble — title, purpose, format template — stayed behind in
`DECISIONS.md`, which is now a pointer and convention note holding no entries.

**No committed index.** The directory listing is the index. A checked-in index file was
rejected because every task would have to append to it, reintroducing precisely the collision
this change removes.

**Existing citations were deliberately left untouched.** ~200 code comments, 48 migration
headers, ~103 references in `SPEC.md` and 6 in `CLAUDE.md` cite entries by *title*, as
`DECISIONS.md "Serial close-out (Yakunlash)"` — never by line number or path. Those resolve by
grepping `docs/decisions/`, so all of them remain correct without edits. Rewriting 350+
citations would have been large, risky churn for no gain.

**`.gitattributes` removed.** Its only rule was the now-obsolete union driver for
`DECISIONS.md`. Leaving it would have been actively wrong: `DECISIONS.md` is now a small static
pointer file, and union on a static file silently duplicates lines instead of raising a
conflict when two branches genuinely do edit the same text.

**Alternatives considered:**
- *Keep the union driver alone.* Rejected — measured above; it never unblocks GitHub.
- *A workflow that merges `main` into open PRs on every push to `main`.* Would have kept PRs
  continuously mergeable, but it is new write-permissioned automation papering over a layout
  problem, and it leaves the underlying collision in place.
- *Sharding by month or by area.* Fewer files, but two entries in the same shard still collide
  — it reduces the odds rather than removing the failure.
