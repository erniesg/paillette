# NGA dimensions: carry the catalogue's measurements through ingest so works hang at true size

## Goal

The room can hang works at their real size, and that is the one thing a flat
page cannot do. Today it never happens for NGA: the room lane sampled 60 NGA
records and 0 parsed, because every record carries
`dimensions: {height: null, width: null, depth: null, unit: null}`.

The data is lost at write time, not at source. The NGA mapper in
`scripts/lib/open-access-art-ingest.mjs` reads `object.dimensions` into
`dimensions_text`, and `scripts/lib/open-access-art-apply.mjs` then inserts
`NULL` for `dimensions_height/width/depth/unit` and drops `dimensions_text`
entirely. `artworks` has the four numeric columns (migrations 0001 and 0006)
and no text column. `parseDimensions` in `apps/web/app/lib/room/dimensions.ts`
already handles `H x W [x D] unit` strings with segment ranking.

## Acceptance tests

- Apply writes parsed `dimensions_height`, `dimensions_width`, `dimensions_depth`
  and `dimensions_unit` (cm) when the NGA string parses, and stores the raw
  string under a `dimensions_text` key in `custom_metadata` in every case, so
  nothing is invented and nothing is lost.
- Parsing lives in one shared module used by both the apply script and the web
  room, with tests for: `overall: 62.5 x 96.8 cm (24 5/8 x 38 1/8 in.)`,
  sheet-vs-image segments, `mm`, inches-only, and unparseable text (must return
  null, never a guess).
- A backfill script updates the existing NGA rows on staging D1 in batches with
  a resumable cursor and a dry-run mode that prints counts only. Run the dry run
  first and put its counts in the PR.
- After the staging backfill: `GET /api/public-search/nga/browse?limit=50` shows
  non-null dimensions for the parsed share; the PR reports parsed / total for the
  whole NGA set (about 63k works) and the ten most common unparsed shapes.
- The exhibition loader (`apps/web/app/lib/exhibition-page.server.ts`) passes
  real values through, and `/e/MKwsxHy?v=room` on staging hangs the six works at
  different sizes. Screenshot before and after into `docs/night/shots/room-scale/`.
- The room never renders a half-parsed size: a record with only one of
  height/width falls back to the default area.

## Validation command

```bash
pnpm --filter web test -- dimensions
node --test scripts/__tests__/
node scripts/backfill-nga-dimensions.mjs --env staging --dry-run
node scripts/backfill-nga-dimensions.mjs --env staging --execute
pnpm --filter web build && pnpm --filter web typecheck
```

## Allowed secrets

None new. Staging D1 writes use the existing Cloudflare login on the trusted VM.
Never touch production D1.

## Artifact outputs

- PR into `night/integration`.
- `docs/night/room-scale-report.md`: parsed / total, the unparsed shapes, the
  before/after screenshots, and how long the backfill took.

## Stop conditions

Stop before writing to production D1. Stop if the parser would need to guess a
unit; report the shapes instead.

## Human clarification protocol

None expected. The NGA open-data `objects.csv` is public; if the ingest inputs
are not on the machine, fetch them from the NGA open-data repository and say so.
