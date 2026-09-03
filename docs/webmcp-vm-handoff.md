# WebMCP Challenge — autonomous handoff

> Written 2026-09-03 ~18:00 SGT. **Deadline: 2026-09-04 04:00 SGT** (Sep 3, 1:00 PM PDT).
> Read `docs/webmcp-challenge-plan.md` first — it holds the verified rules,
> judging criteria and scope-cut ladder. This file is the current state of play.

## Ground truth: what is live and proven RIGHT NOW

Staging (`https://paillette-stg.berlayar.ai`) serves the full WebMCP build.
Verified by live end-to-end run, not by unit tests:

- 15 tools registered on `document.modelContext`, all present in the deployed
  client bundle: `search_artworks`, `search_by_image`, `search_by_color`,
  `browse_collection`, `lookup_artwork`, `list_collections`, `get_search_quota`,
  `get_view_context`, `show_artwork`, `set_results`, `create_collection`,
  `add_to_collection`, `index_zip`, `index_folder`, `get_index_status`.
- Anonymous indexing works end-to-end: 8 images uploaded → 8/8 embedded, 0
  errors → `"landscape with trees"` returns 4 ranked hits (top score 0.249).

**Two bugs that only live testing caught — do not regress them:**

1. `apps/api/src/routes/indexing.ts` must send `task: 'retrieval.query'` to the
   embedding endpoint. `retrieval.passage` is rejected for `jina-clip-v2` and
   made every image fail while the job still reported success with an empty
   collection. Fixed in `2750179a`.
2. Vectorize filters only work on **indexed** metadata properties. Searching a
   new collection filters on `indexJobId`, which needed
   `wrangler vectorize create-metadata-index paillette-embeddings-v2-stg
   --property-name=indexJobId --type=string`. Done on staging; **production has
   not had this applied**, nor migration `0021_webmcp_index_jobs.sql`, nor a
   deploy. Production is still 404 on `/api/public-index/jobs`.

Unit tests stub the network, so neither bug was visible from `pnpm test`.
**Any claim that indexing works must be backed by a live run, not a green suite.**

## Sample datasets (built and verified)

`data/samples/` — National Gallery of Art open access, CC0 metadata, CORS-open IIIF:
- `sample-art-100.zip` — 100 JPEGs + `metadata.csv`, ~28 MiB
- `sample-art-25-no-metadata.zip` — 25 JPEGs, no CSV, ~7.3 MiB
- `README.md` — provenance, licence, CSV format, verification log

Caveat: anonymous jobs cap at **40 images** (`INDEXING_CAPS.maxFilesPerJob`), so
the 100-image zip is for the authenticated UI upload path; use the 25-image zip
for anything driven through `index_zip`.

## The gap that matters most

There is **no anonymous "try it" flow in the UI**. A judge landing on the site
cannot create a collection from the demo zip or their own zip without an
account. `zip-uploader.tsx` and `collections.$collectionId.upload.tsx` exist but
sit behind auth. The public-index HTTP routes and the WebMCP tools both work —
only the human-facing entry point is missing. Judges test the live URL, and the
demo video needs this on camera.

## Rules of engagement for autonomous work

- Branch from `deploy-nga-open-access`; open a PR against it. **Do not push to
  `master`** and **do not deploy** — deploys are manual and human-gated because
  staging is the only working artifact this close to the deadline.
- Validate with `pnpm lint`, `pnpm --filter @paillette/web typecheck`,
  `pnpm --filter @paillette/web test`, `pnpm --filter @paillette/api test`.
  Baseline is green: web 512 tests, api 710 tests. Do not regress.
- Where a change touches indexing or search, add a live check against
  `https://paillette-stg.berlayar.ai` and paste the real output in the PR. A
  green unit suite is not evidence for this subsystem.
- No Claude/Anthropic co-author trailers or "Generated with" footers.
- If blocked on a judgement call, say so in the PR rather than guessing.
