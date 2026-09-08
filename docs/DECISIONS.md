# BATU EXPORT — Build Decisions Log

Tracks decisions made during implementation that aren't already locked in `docs/SPEC.md`.
If a decision later supersedes the spec itself, update `SPEC.md` and add a Changelog line
there too.

## Where the entries are

**One file per entry, in [`docs/decisions/`](./decisions/).** This file is a pointer and a
convention note — it holds no entries itself.

```
docs/decisions/NNNN-YYYY-MM-DD-short-slug.md
```

`NNNN` is a zero-padded sequence number. It exists so that the directory listing reproduces
the exact reading order the entries had in the old single file — 31 entries refer to their
neighbours ("the entry above", "the two entries below"), and those references stay correct
only if order is preserved. `ls docs/decisions` *is* the log, in order.

The sequence is a **sort hint, not an identifier.** If two branches both take the same next
number, nothing breaks: their slugs differ, so the filenames differ, so the two files simply
coexist. Do not renumber existing entries to close a gap or a tie.

There is deliberately **no committed index file** — a checked-in index would have to be
appended to by every task, which is the exact problem this layout exists to remove.

## Finding an entry

Citations throughout the codebase — in `SPEC.md`, in migration headers, and in ~200 code
comments — refer to entries **by title**, in the form `DECISIONS.md "Serial close-out
(Yakunlash)"`. Those citations remain correct and resolve by search:

```sh
grep -rl "Serial close-out" docs/decisions/     # find the entry file by title
grep -rn "wash_cycles" docs/decisions/          # every entry touching a topic
ls docs/decisions | tail -20                    # the 20 most recent decisions
```

Grepping the directory replaces scrolling one 8,000-line file, which is what the old layout
was already being used for in practice.

## Adding an entry

Create a new file — **never append to this one.**

```
docs/decisions/0170-2026-09-09-short-slug.md
```

Take the next sequence number after the highest in the directory, and use the established
shape:

```
## YYYY-MM-DD — Short title
**Context:** why this came up
**Decision:** what was chosen
**Alternatives considered:** (optional)
```

The heading stays `##` (not `#`) so entry text is byte-identical to how it read in the old
single file, and so existing quotes of an entry's heading still match verbatim.

## Why one file per entry

The log was append-only and every task appended at the same place — the end of the file — so
any two branches developed in parallel collided there. Git could not resolve it, even though
the entries were unrelated and the answer was always "keep both". This blocked PRs #131 and
#132 simultaneously, then blocked #132 a second time.

A `merge=union` driver (PR #136) removed the manual splicing but not the block: GitHub's
server-side merge ignores `.gitattributes` merge drivers, verified by probe, so the conflict
still appeared and still needed a local catch-up merge. That rule has been removed as
obsolete — with entries in separate files, two branches adding different entries touch
different paths and never conflict, on GitHub or anywhere else.

Full reasoning: `docs/decisions/0170-2026-09-08-decisions-log-one-file-per-entry.md`.
