# Room scale: NGA dimensions carried through ingest (issue #76)

Every number here comes from a run made for this report on 2026-09-24. The
evidence is in `docs/night/room-scale-evidence/` and
`docs/night/shots/room-scale/`.

## What was wrong

The NGA mapper read `objects.csv`'s `dimensions` into `dimensions_text`. Apply
then inserted `NULL` into all four dimension columns and dropped the text.
Before the backfill, staging D1 had **63,253** NGA rows, **0** with a height and
**0** with any stored dimension text.

## What changed

- **One parser.** `packages/types/src/dimensions.mjs`
  (`@paillette/types/dimensions`) is imported by the apply script, the
  backfill and the web room; `apps/web/app/lib/room/dimensions.ts` now just
  re-exports it. It reads `H x W [x D] unit` in cm, mm, m and in, ranks
  qualifiers (overall > support > sheet > image > mount/frame), and returns
  null rather than guessing.
  - Mixed fractions are read whole: `24 5/8 x 38 1/8 in.` → 62.55 × 96.84 cm.
    The old refusal existed to stop a regex from returning `8 × 38`. A number
    may no longer start or stop inside another one, so the only possible match
    is the full figure.
  - Qualifiers that measure something other than the work are refused:
    `original IAD object` (the size of the chair an Index of American Design
    watercolour depicts; 9,491 segments in `objects.csv`), and anything starting
    `base`, `case`, `weight`, `gross weight`, `pedestal`, `accessory`, `box` or
    `stand`. The check is anchored at the start, so `overall without base`
    still reads.
  - A pair with no unit, a diameter or a lone height is null. A unit is never
    assumed.
- **Apply** writes `dimensions_height/width/depth/unit` (always `cm`), or all
  four null, never some of them. It stores the raw string as
  `custom_metadata.dimensions_text` whenever the source has one, whether or not
  it parsed. The `ON CONFLICT` branch updates the columns too.
- **Backfill.** `scripts/backfill-nga-dimensions.mjs --env staging
  --dry-run|--execute`. Rows are matched by the `source_record_id` apply
  stored, and the artwork id is checked against it. The objects.csv SHA-256
  must equal the ingest's pinned source (commit `79d114c2`). Writes go in
  id-ordered batches of 1,000, D1's query count is verified per batch, and a
  cursor is written after each. `custom_metadata` is merged with `json_set`.
  Staging is the only database the script knows about.
- **Loader.** `exhibition-page.server.ts` used to take the API's all-null
  `dimensions` object as present, so nothing behind it was ever read, and it
  looked for the text under `metadata`, which the API does not send. It now
  counts the object as present only when height or width is a number, and
  falls back to `custom_metadata.dimensions_text`. A half object is still
  passed on unchanged, so the room refuses it and hangs the default.
- **Room.** Measured works used to be stretched to the recorded box. Two of
  the five measured works in `/e/MKwsxHy` disagree with their photographs:
  - the Callot (51278) is recorded 12.8 × 13.9 cm and photographed at about
    2:1;
  - the Puvis (138648) is recorded portrait and photographed landscape.

  `fitMeasured` fits the photograph inside the recorded box instead. The work
  is never distorted and never larger than the record in either direction, and
  it does not guess which way round a disagreeing record is.

## Parsed / total, whole NGA set on staging

From the dry run (`backfill-dry-run.json`), confirmed in D1 after execute:

| | rows |
|---|---:|
| NGA rows on staging | **63,253** |
| not in the pinned `objects.csv` | 0 |
| empty `dimensions` at source | 10,689 (10,205 are prints) |
| with dimension text | 52,564 |
| **parsed → columns written** | **50,189** (79.35% of all rows, 95.48% of rows with text) |
| of which with a depth | 1,123 |
| text present, not parsed | 2,375 |

D1 after execute: 50,189 rows with height, width and `unit='cm'`; 0 rows with
only one of height/width; 52,564 rows with `custom_metadata.dimensions_text`.
`openAccessArt` and `provider` are still present on all 63,253 rows, and no row
has invalid JSON.

Which measurement was used (top 10): overall 25,229; sheet 16,272; plate 1,140;
sheet (trimmed to plate) 962; sheet (trimmed to plate mark) 951; image/sheet
675; image 618; overall (approximate) 461; sheet (trimmed within plate mark)
310; page size (approximate) 283.

### The ten most common unparsed shapes

Figures abstracted: `N` is a number, `F` a fraction, `|` a line break.

| count | shape |
|---:|---|
| 1,316 | `overall (diameter): N cm (F in.) \| gross weight: N gr (N lb.) \| axis: N:N` |
| 242 | `overall (diameter): N cm (F in.) \| gross weight: N gr (N lb.)` |
| 170 | `overall (diameter): N cm (F in.)` |
| 66 | `overall (diameter): N cm (N in.) \| gross weight: N gr (N lb.) \| axis: N:N` |
| 56 | `overall (diameter): N cm (F in.) gross weight: N gr` |
| 52 | `height: N cm (F in.)` |
| 36 | `book: N × N (F × F)` (no unit written: refused, per the stop condition) |
| 30 | `overall (height): N cm (F in.)` |
| 28 | `diameter (without border): N cm (F in.)` |
| 24 | `diameter: N cm (F in.)` |

Most of these are medals and coins, recorded only by diameter. A diameter
gives both extents of a round object, but the room hangs rectangles and
reading it would be a choice rather than a parse, so they stay unmeasured.

### Is the parsed size right, not just parseable?

This is an independent check against the NGA's own photographs
(`published_images.csv` at the same commit, primary view). For each of the
50,189 parsed rows it compares the parsed height/width ratio with the
photograph's pixel ratio:

- within 10%: 42,920 (85.5%)
- within 25%: 47,169 (94.0%)
- outside 25%: 3,020. Of those, 663 would agree if the record were transposed.

The worst qualifier is `book`, at 121 of 245 within 25%: books are measured
closed and photographed open. Disagreements are not "fixed" by the parser; the
room's `fitMeasured` keeps them from distorting the picture.

## How long the backfill took

- Dry run: 49.2 s wall (reads 63,253 rows from D1 in keyset pages of 10,000,
  parses 145,657 source objects).
- Execute, run 1: 14:23:41Z–14:36:07Z (12 min 26 s), 48 batches, 48,000 rows.
  Batch 49 failed with a Cloudflare `Authentication error [code: 10000]`
  (`backfill-execute-run1.log`); `wrangler whoami` still showed a valid login
  straight afterwards.
- Execute, resumed from the cursor: 14:36:26Z–14:37:23Z (57 s), 5 batches
  pending after `open-access-art:nga:70225`, 4,564 rows.
- Sum of confirmed batch times: 736.0 s for 52,564 rows over 53 batches.
  Per-batch min 4.7 s, median 7.5 s, max 106.7 s (batch 2).
- A third `--execute` found 0 batches pending.

## Browse after the backfill

`GET https://paillette-stg.berlayar.ai/api/public-search/nga/browse?limit=50`
returned 50 works (200, 5.5 s). **36 have non-null dimensions** in cm and none
are half-filled. D1 shows that all 14 null rows have no dimension text at the
NGA source, so every work on that page with text was parsed
(`browse-after.json`). Browse does not expose `custom_metadata`, so the text
itself is not visible there. That is how the browse route works, not a gap in
the backfill.

## The six-work show

`apps/web/scripts/room-scale-shots.ts` opens `/e/MKwsxHy?v=room` on staging.
It saves the entry view (`before.png` / `after.png`) and both side walls
(`-west`, `-east`), turned by dragging exactly as a visitor would. Next to
each set it writes the loader's data and the size the scene hung each work at
(`before.json` / `after.json`). The browser is headless Chromium on
SwiftShader, so none of this is a frame-rate claim.

- **Before**: taken 14:23Z against the old code and null columns. 6 works, 0
  parsed, every work at the default area. That scene predates the size readout,
  so its hung sizes are null.
- **After**: taken about 15:07Z against web version `16e1cc7b` (this branch)
  and the backfilled D1. 6 works, 5 parsed, **6 distinct hung sizes**, 0 page
  errors.

| work | catalogue (cm) | hung (m) |
|---|---|---|
| 169148 Lory, *Voyage pittoresque* (book) | 46.5 × 35.9 × 4 | 0.353 × 0.465 |
| 50827 Davis, *John and Abigail Montgomery* (sight size) | 22.2 × 35.3 | 0.348 × 0.222 |
| 17711 IAD, *Sofa* (overall; the IAD object line is ignored) | 22.5 × 30.3 | 0.303 × 0.221 |
| 138648 Puvis, *Avalanche* | 35.9 × 23.9 | 0.239 × 0.164 (fitted: photographed landscape) |
| 51278 Callot, *The Stopping Place* | 12.8 × 13.9 | 0.139 × 0.074 (fitted: photographed about 2:1) |
| 6370 Daumier, lithograph | empty at source | 0.597 × 0.703 (default area, unmeasured) |

Hung sizes are width × height; catalogue sizes are height × width, as the
museum writes them.

One consequence is visible in `after-west.png`: the room's declared default
area (0.42 m²) is much larger than the prints and drawings that make up most
of this collection. The unmeasured Daumier now dwarfs the measured works next
to it. That is honest, because the default is a declared stand-in and not a
size, but it will read as odd. Shrinking the default is a design call for the
room, not part of this issue, so it is left as it is.

## What was not done

- **Production.** Not deployed, not migrated, not written.
- **API.** No API code changed, so the API was not redeployed.
- **Future ingests.** Apply is fixed, but no NGA re-ingest was run; the
  existing rows were filled by the backfill.
- **Validation command.** The spec's `node --test scripts/__tests__/` does not
  run on Node 22.22, which does not accept a directory. The equivalent
  `node --test scripts/__tests__/*.test.mjs` was used.
