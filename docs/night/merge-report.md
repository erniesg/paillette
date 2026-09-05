# The two lanes on one tree

`night/room` and `night/blockers` ran from the same base and neither contained
the other. Nothing had been merged, so no deploy had ever carried both: the room
was built on a tree where the agent still never marked the board, and the
blocker fixes were verified on a tree with no room in it.

This is that merge, verified as one tree.

Result: **`night/integration` now carries everything**, staging runs it, and the
room still passes on the merged build. One thing is blocked, and it is not the
merge — see §4.

---

## 1. What came from where

**The room lane** — the walkable template behind `?v=room`, regions as rooms, the
texture budget, the demo scripts. Twenty commits, `docs/night/room-report.md`.

**The blockers lane** — the beats a demo is filmed on. Twenty commits,
`docs/night/blockers-report.md`. The two that matter most:

- **The agent marks the board from a typed sentence.** Across 508 model-chosen
  tool calls before this, `flag_artworks` was 0. Every two-hands screenshot in
  every report was driven through `window.__paillette_webmcp.call`.
- **The human's own Enter stopped deleting the agent's sentence**, which had been
  sliding twelve cards up 56px at the headline beat.

Only `apps/web/app/tailwind.css` was touched by both, in different sections, so
git merged it without a conflict — and the merge was then verified rather than
trusted.

## 2. The merged tree

```
pnpm --filter web build       ✓
pnpm --filter web typecheck   ✓
pnpm --filter api typecheck   ✓
pnpm --filter web test        ✓  108 files / 1380 tests
pnpm --filter api test        ✓   46 files /  867 tests
pnpm --filter web lint        ✓  clean
```

Room alone was 105 files / 1329 tests and blockers alone added three files and
fifty-one tests; the merged tree is 108 / 1380, so nothing was lost in the merge
and nothing regressed.

Lint is clean for the first time in this body of work. The one error both lanes
reported as pre-existing was a `react-hooks/exhaustive-deps` disable written on
3 September for a rule this repo does not configure — eslint fails on the
directive itself. The reason the dependency list is just the signature was worth
keeping, so it stays as prose.

Deployed to staging: `paillette-api-stg` and `paillette-stg`. Production
untouched.

## 3. Re-run on the merged deploy

**The room, unchanged by the merge.**

```
scripts/room-demo-path.ts    26 of 26   (code u4G4Gkv, two named rooms)
scripts/room-demo-matrix.ts   9 of 9    cells x 26 steps
```

Nine ways: desktop, phone by touch alone, reduced motion, no speech APIs, all
three at once, and shows of one, six, twenty-three and twenty-four works. Peak on
the walk: 31.0 MiB of texture, four works at full resolution.

**The agent's own marks, on the merged build.**

```
scripts/demo/agent-marks.mjs   2 of 2 runs
  run 1: tools=get_view_context,redeal,flag_artworks  provisional=3  onBoard=3  offBoard=0
  run 2: tools=get_view_context,redeal,flag_artworks  provisional=2  onBoard=2  offBoard=0
```

Typed, not called through the console: the model chose `flag_artworks` in both
runs, and every mark it made was on the board where the human could see it. That
is the blockers lane's central fix, holding on a tree that also has a room in it.

## 4. What is blocked, and why it is not the merge

`section-9.mjs` and `e2e-correction.mjs` could not run to completion. Both need
search, and **staging's NGA search quota is exhausted**:

```
nga_public_search_quota   used 1000 / hard_limit 1000   updated_at 2026-09-05 15:23:45
POST /api/public-search/nga/text  ->  429 NGA_PUBLIC_SEARCH_QUOTA_EXHAUSTED
```

That timestamp is inside the §9 run. `agent-marks` had run minutes earlier on the
same deploy and passed, so the board, the tools and the model path are all
working; what failed afterwards is that a search returns no works, so no card
carries a `data-artwork-id` and a harness that types waits for one until it times
out. `e2e-correction` reports the same thing in its own words — "the drafting
turn hung nothing" — twice.

The counter is a lifetime ceiling with no reset, not a rate limit: it is the cost
gate, and `docs/nga-launch-readiness.md` says to ask before spending against it.
So this is a decision for the owner rather than a fix, and until it is made **no
search-driven demo can be run or filmed on staging** — which is the whole culling
path, not only these two harnesses.

Unaffected: everything that reads a published exhibition. The room, the short
links, the shapes matrix and every screenshot in the room report come from
already-published shows and need no search at all.

## 5. What may be claimed that could not be before

The room report's §10 stands as written, with one line it had to hedge now
demonstrated on the same tree: the agent marking the board is no longer a console
call. `agent-marks` shows a typed instruction producing the model's own
`flag_artworks` with the marks visible on the board.

Still not demonstrated, and still not claimable: that a language model chose to
call `annotate_atlas`, which is the leg from a typed instruction to the room's
named rooms. `room-agent-path.ts` drives that tool through the debug back door,
and running the first leg needs search.
