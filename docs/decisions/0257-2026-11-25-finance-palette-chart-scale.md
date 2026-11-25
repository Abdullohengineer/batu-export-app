# 0257 — Finance palette refinement; chart-scale check

2026-11-25, owner brief. Follows 0256.

## Chart scale: investigated, not a bug

**Report:** the November tile shows Xarajat 25.94M, while the
Tushum/Xarajat chart's y-axis reaches 1.5B.

**Checked against live data** (confirmed expenses by `period_month`):

| Month | Xarajat | Entries | Largest row |
|---|---|---|---|
| July | 125,930,977 | | |
| August | 424,434,178 | | |
| September | 845,011,960 | | |
| October | 1,081,393,313 | 26 | 500,000,000 (IMIR-TRADE) |
| November | 25,939,870 | | |

- **Not summing across history.** All months together come to about 2.5B,
  and each month's chart value equals that month's tile value.
- **Not tiyin.** `expenses.amount` is `bigint` whole so'm, and nothing
  divides by 100.
- **No row multiplication.** The October count matches the import.

The axis reaches 1.5B because the chart covers six months and October's
1.08B is the largest; the axis rounds up to the next 500M step. November is
small: 25 days in, no tushum entered yet.

**Regression check added** to the Moliya UI suite: after choosing October,
the chart's own data table (the screen-reader table) must show exactly the
tile's Tushum and Xarajat ("Oktabr 47.6M 29.4M" in the fixture). It passes.

## Palette (CSS variables under `[data-theme="dark-finance"]`)

**Surfaces:**

| Token | Old | New |
|---|---|---|
| `--bg` | #0B0D14 | #0B0F14 |
| `--surface` | #14161F | #151B24 |
| `--surface-elev` | #1A1D28 | #202A36 |
| `--border` | #1C1F2A | #1F2733 |
| `--border-strong` | #252835 | #2B3340 |

**Text:**

| Token | Old | New |
|---|---|---|
| `--text-primary` | #F5F5F7 | #F4F7FB |
| `--text-secondary` | #8C8E99 | #A7B0BE |
| `--text-muted` | #5C5F6B | #778394 |

**Accents.** The brief renames the meanings, so the variables were renamed
to match:
- `--accent-income` #4FD3C4 → #2DD4BF;
- `--accent-expense` #8B6FFF → #A78BFA (softer);
- **`--accent-warning` is now the orange**, #F5B45C (it was
  `--accent-utility`);
- **`--accent-critical` is the new pink**, #FB7185 (it was
  `--accent-warning`);
- `--accent-success` is removed. There is no 5th accent: runway of 3+
  months uses income.

**Info.** The blue info tone is folded into neutral emphasis inside the
scope: primary text on `--surface-elev`.

**Derived tints.** Every `rgb(r g b / x)` tint was re-derived from the new
accents.

**Primary / selected.** The violet gradient is now #A78BFA → #8B74E8, with
**dark ink #120D24** on it: 7.0:1, where white would be 2.7:1 on the softer
violet.

## Contrast (WCAG ratios)

| Text level | on bg | on surface | on surface-elev |
|---|---|---|---|
| Primary | 17.9 | 16.1 | 13.5 |
| Secondary | 8.8 | 7.9 | 6.6 |
| Muted | 5.0 | 4.5 | 3.8 |

- The old secondary was 5.3:1 on surface, so it already passed AA. The
  real failure was the old muted, at 2.7:1, which is now fixed.
- Muted is below AA on the elevated surface, so it isn't used for small
  text there; tooltips and pills on that surface use secondary.

## One colour per meaning

| Meaning | Accent |
|---|---|
| Tushum / positive | income |
| Xarajat, and 1 kg tannarxi (a cost) | expense |
| Gaz and elektr prepay dots | warning |
| Negative numbers, sof foyda bars below zero (new `negativeColor` on chart series), runway under 1 month, overdue obligations, bad deltas | critical |

- **Bank and kassa** dots, **transfer** row icons and **links** ("Batafsil
  tarix", "+ Qo'shish") carry no accent: secondary or primary text.
- **Donut, stacked types and category icons** cycle expense → income →
  warning → critical, then greys.
- **Pill tones** are `open` (warning), `done` (income) and `critical`; the
  old `warning` tone name is gone.
- The teal period chip stays, as specified in 0256.

## Chart

- Gridlines are `--border` with a 2,4 dash; the zero baseline is solid
  `--border-strong`.
- Y labels and x labels use `--text-secondary`; the current period's label
  is bold `--text-primary`.
- Area fill runs from 30% to 0. The line is 2.5px.
- Points are r=4, filled with surface, with a 2px accent stroke. The
  selected point is a filled r=6 marker, with a dashed `--border-strong`
  vertical guide.

## "so'm" placement: tested both, kept the suffix

Prefix ("so'm 578.7M") and suffix ("578.7M so'm") were screenshotted side by
side on the Overview tiles. The suffix stays, because:
- the tiles mix units, and the prefix version reads "so'm/kg 530";
- the compact "M" already ends the number;
- number-then-so'm is the natural Uzbek order.

The tables already state the unit once in the header and list bare numbers,
which gives the same scanning benefit the prefix pattern aims for.

Not changed: layout, section order, queries, font (Inter), spacing and radius.

## Verification

- Build passes; 108/108 unit tests; oxlint clean; RPC check OK.
- UI suites: Moliya 33/33 (including the new chart = tile check), Oyni
  yopish 36/36, Tarix 14/14, Rahbar/Menejer read-only 14/14.
