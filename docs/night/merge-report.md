# The two lanes on one tree

`night/room` and `night/blockers` ran from the same base and neither contained
the other. Nothing had been merged, so no deploy had ever carried both: the room
was built on a tree where the agent still never marked the board, and the
blocker fixes were verified on a tree with no room in it.

This is that merge, verified as one tree.

Result: **`night/integration` now carries everything**, staging runs it, and the
room still passes on the merged build. Running the merged build properly then
found four things, three of which are now fixed — §6 is the part to read.

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

---

## 6. What running it properly then found

The merge was clean. Running the merged build honestly was not, and four
things came out of it. Three were mine to fix and are fixed; one was a decision
for the owner, since taken.

### 6.1 The search quota — reset, on staging only

`section-9` and `e2e-correction` could not run at all: `nga_public_search_quota`
stood at **1000 of 1000**, timestamped 15:23:45, which is inside the §9 run that
failed. Reserved *before* the cache lookup, so a query answered from the
seven-day KV cache still spends a slot — the counter measures requests, not
provider calls, and repeated harness queries against a warm cache drained it.

Reset to 0 on `paillette-db-stg` with the owner's approval. Production
untouched. Note for whoever owns the gate: as written it will drain again on the
next evidence run, and moving the reservation after the cache lookup would make
it count what it was built to count.

### 6.2 A turn that ran out of turns never checked its own work

The post-conditions — the labels gap, the title gap, the unmarked board — only
ran when the model **stopped calling tools**. That is one of the two ways a turn
ends. The other is running out of budget mid-job, and that is the one that ships
the deliverable blank:

```
run 2 · correction: get_exhibition, write_labels, set_exhibition, search,
                    set_exhibition, write_labels, search, set_exhibition
        counts: added 4, dropped 9, relabelled 0, unlabelled 3
        nudges: []
        published /e/NHfBsL7 → 7 works, 3 of them with no wall label
```

Eight calls, ending on `set_exhibition`, three works hung after the wall was
written and never labelled, and **no post-condition ever ran**. That is the
critique's blocker 4 — *"works added after write_labels are never labelled, so
the shareable exhibition usually ships blank"* — still alive after the fix
aimed at it, because the fix was in a branch the turn never reached.

So the checks now run at the ceiling as well, which is the moment a turn is
most likely to have left something. `MAX_NUDGES` still decides how often the
page may buy more calls and `HARD_MAX_TURNS` still ends it.

Two tests, both made to fail on purpose first against the unpatched component:
a turn that never stops calling tools is asked for the labels it never wrote
(unpatched: stops dead at eight calls, `expected 8 to be greater than 8`), and
a turn that ran out with nothing owed is left alone at exactly eight.

### 6.3 The page nudging for a wall it would not let the model write

With that fixed, three correction runs in a row still published blank walls —
and the instrumented harness said why on the first look:

```
write_labels ×10, every one:
  {"ok":false,"error":{"code":"LABELS_RATE_LIMITED",
   "message":"Only 10 labelling calls may be made per hour."}}
nudges: the same labels nudge, naming the same twelve works, after each one
published: 12 works, 12 blank labels, nothing on screen saying why
```

`write_labels` is capped at ten calls an hour. Past that the labels gap asks
for labels the model *cannot write*, the model tries, is refused, and the page
asks again — a loop rather than a nudge, ending in a published show with a
blank wall and no explanation. Some of the critique's *"four of seven published
pages carry no wall labels"* is this, rather than the model failing to label
newcomers.

A refusal the model cannot act on now stands the gap down and is said to the
human, who can see the blank labels and until now could not see the reason. A
malformed call is still the model's own to fix and is still asked again. Test
made to fail first: unpatched, the page nudges into the wall.

**Worth knowing before filming:** ten labelling calls an hour is roughly three
correction runs. It is not a limit a demo will meet — one filmed take spends
two or three — but it is one that back-to-back evidence runs meet every time,
and until today it looked exactly like the feature being broken.

### 6.4 §5c, on the merged build, when nothing is throttled

```
drafted 12 works, unlabelled 0
correction: added 11, dropped 11, relabelled 1, unlabelled 0, title followed
published /e/Xd3bjeh → 12 works, 24 labels, the human's statement verbatim
```

That is the whole §5c claim, end to end, on the deployed merged build.

### 6.5 The harness, three times, and the flake was always ours

`section-9` read the board a flat 2.5 s after a deal, which is a bet on how long
twelve staggered cards take, and the clause after it then pressed a key on a
card that had already left. Under `--voice=stub` it lost that bet about half the
time and reported it as the page losing a card.

Three passes to close it, and the middle one is the one worth recording:

1. Wait for two consecutive reads of the board to agree, instead of sleeping.
2. Re-resolve in `press` rather than reporting a React re-render as a missing
   card — the error became an explicit detach, which was progress and not a fix.
3. **Keep the floor.** A staggered deal has gaps in it, and two reads either
   side of one gap agree while cards are still arriving, so step 1 could return
   *sooner* than the flat sleep it replaced. It made `--voice=off` go from 2 of
   2 to 0 of 2 — my change, presenting as a regression in the page. The quiet
   now has to survive a 2.5 s floor.

After that, on the deployed merged build: **`--voice=off` 3 of 3 and
`--voice=stub` 2 of 2, every clause of §9 in both.** The stub path had never
been green twice running before today.

## 7. Where it stands

`night/integration` carries both lanes and the four fixes above. Staging runs
it. On the deployed merged build:

| | |
| --- | --- |
| §9 as one sequence, `--voice=off` | **3/3**, all six clauses |
| §9 as one sequence, `--voice=stub` | **2/2**, all six clauses |
| the room, `room-demo-path` | **26/26** |
| the room, `room-demo-matrix` | **9/9** cells |
| the agent marking the board, typed | **3/3** runs, every mark on the board |
| §5c draft → correction → published | fully labelled, the human's words kept |
| web / api tests | 108 files / 1383 · 46 files / 867 |
| typecheck, lint | clean |

Nothing here was run on a tree that had only one of the two lanes in it.
