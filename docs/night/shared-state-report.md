# shared-state — what landed

Branch `night/shared-state`, cut from `origin/deploy-nga-open-access`.

Everything below is either pinned by a test or was observed being driven in a
real browser. Where I could not verify something I say so rather than softening
it. The submission lane may describe what is in **What is demonstrably true**
and must not go past it.

---

## 1. What shipped

| Brief item | State |
| --- | --- |
| Flags module, session-scoped, surviving redeals | shipped |
| `P` / `X` / `U` on hovered or focused card + corner badge | shipped |
| `get_view_context` gains flags / selection / hovered / compare / board | shipped |
| Turn payload `{ text?, flagsDelta, selection, hovered, compareChoice }` | shipped, **wired by a shim** — see §6 |
| "Gestures outrank words" rule in the agent system prompt | shipped, verified live on 3 runs |
| `search_by_exemplars` — Rocchio, server-side | shipped, **server-side path, not the degraded one** |
| `redeal`, 12 cards, picks held in place | shipped |
| Enter on an empty prompt bar redeals with no model call | shipped, verified in a browser |
| `compare_artworks` two-up | shipped |
| Multi-select (shift-click), P5 "Point" | shipped |

Four new tools, so `document.modelContext` now carries **21**, not 17. Anywhere
the docs or the video script says 17, it is now wrong.

---

## 2. The exact tool surface

New names and argument shapes as registered. All four use
`additionalProperties: false` and return
`{ok:false,error:{code,message,hint?}}` on failure rather than throwing.

```
flag_artworks                                  readOnlyHint: false
{ flags: [{ artworkId: string,
            flag: "pick"|"reject"|"clear",
            reason?: string }] }                  // 1–3 items, flags required

search_by_exemplars                            readOnlyHint: true
{ positiveIds: string[],                          // 1–32, required
  negativeIds?: string[],                         // ≤32
  excludeIds?: string[],                          // ≤400
  topK?: integer,                                 // 1–100, default 12
  collection?: string }

redeal                                         readOnlyHint: false
{ keep?: "picks",                                 // only legal value; picks are
                                                  // held whether or not it is passed
  strategy?: "tighten"|"widen",                   // default is neither: "steady"
  count?: integer,                                // 1–60, default 12
  note?: string,
  collection?: string }
→ { kept, removed, added, order, exemplars: {positive, negative}, strategy, note }

compare_artworks                               readOnlyHint: false
{ artworkIds: [string, string],                   // exactly 2, required
  question?: string }
```

`get_view_context` additionally returns `flags` (`picks` / `rejects` /
`provisional`, each with id, title, artist and reason where given, plus
`exemplars`), `board` (`order`, `works`, `note`, `lastChangeBy`, `redeals`,
`dealtThisSession`), `selection`, `hovered`, and `compare`.

New HTTP routes:

```
POST /api/public-search/:orgId/exemplars     (web, same-origin proxy; holds the key)
POST /search/exemplars                       (api; the Rocchio scorer)
POST /api/public-agent/turn                  (api; now also accepts `turn`)
```

---

## 3. The engine — which path I took, and why

**Server-side. The backend can fetch an embedding by artwork id, so I did not
take the degraded RRF path.**

The evidence, before I wrote anything: `getImageVectorsByIds` already existed at
`apps/api/src/routes/search.ts:1388`, wrapping `vectorize.getByIds` in chunks of
20, and was already used by the live visual-refinement re-rank. That is a
production path that fetches vectors by the same canonicalised artwork ids the
search API hands out — so the id shape and the fetch are both already proven in
this codebase. `POST /search/exemplars` reuses that same helper.

The score, as implemented:

```
score(x) = cos(x, mean(positives)) − w · max_j cos(x, negative_j)      w = 0.5
```

- `mean(positives)` is unit-normalised and handed to Vectorize as the query
  vector, so the positive term *is* the Vectorize score — no second pass.
- With no negatives there is no re-scoring round trip at all.
- With negatives, the top `6 × topK` candidates are re-fetched by id and scored
  by hand. `max` over the negatives, not `mean`: an average lets a cluster of
  mild rejects cancel out, and one emphatic `X` should move a whole region.
- Exemplars, negatives and `excludeIds` are all blocked from the results.
- `w` is bent by strategy in `redeal`: `tighten` 0.8, `steady` 0.5, `widen`
  0.25 plus an offset of 6, so "widen" moves further from what is already hung
  rather than quietly returning the same neighbours.

**This route makes no embedding call.** Every vector is already indexed. So a
redeal costs no Jina quota and is not metered against the NGA daily search
allowance — which is what makes a per-keystroke cull loop affordable. That claim
is asserted by a test (`apps/api/tests/routes/exemplar-search.test.ts` checks the
route makes no outbound `fetch` at all).

**Not verified:** I have not run this route against the live 63,253-work index.
The unit tests use hand-checkable two-dimensional vectors, and I did not deploy
to staging (see §7). First thing to do at integration.

---

## 4. What is demonstrably true

### Verified in a real browser

`apps/web/scripts/verify-culling-loop.mjs` drives Chromium against a stubbed
network and asserts the loop end to end. It exits non-zero on the first failure.

```sh
pnpm --filter web dev                                   # in another shell
node apps/web/scripts/verify-culling-loop.mjs http://localhost:5173
```

Last run: **24 checks, all passed.** What it proves:

- hover sets the deictic anchor; `P` picks the hovered card, `X` rejects it,
  drawn in the human's ink, with `aria-pressed` on the badge
- `get_view_context` reports the flags
- shift-click selects instead of opening the work; `get_view_context` reports
  "these"; Escape drops it
- **Enter on an empty prompt bar reaches `/exemplars` and never
  `/public-agent` — asserted negatively, so the test can fail if a model call
  ever appears**
- the request carries the human's positive and negative exemplars
- the board deals **12**
- the pick is still in the seat it was in; the reject has left; the board is
  marked as the human's move
- the next *typed* turn carries the gestures, with titles resolved
- one click on the two-up resolves winner → pick, loser → reject, and closes
- no uncaught page errors

### Verified against the live model

The brief's definition-of-done item: *"Given the sofa prompt and two X presses,
the agent's redeal note refers to the content of what was rejected. Check by
hand on three runs."*

I ran the real route against `gpt-5.6-terra` six times — three with the turn
payload, three without — with the sofa prompt, three cool picks and two warm
rejects. All six followed the gestures and named the content of the rejects:

> "You said warm, but you've picked three cool, quiet scenes and rejected the
> golden ones. I'm following the picks: atmospheric blue-grey calm rather than
> literal warmth, while steering clear of grimness."

**Be precise about what this shows.** The behaviour comes from the system-prompt
rule, not from the turn payload: the three control runs *without* the payload
produced the same sentence, because the model calls `get_view_context` first and
the flags are there too. The payload's job is narrower and still real — it puts
the gesture *delta*, with titles, into the first request of a turn so the model
knows what changed since it last looked, without having to spend a tool call.
Do not claim the payload is what makes the agent follow the picks.

### Pinned by tests

- flags store: agent flags land provisional and never reach `getExemplars()`
- pin survival: `redeal` has no argument that can drop a confirmed pick, and a
  pick made before any board existed is still dealt
- the negative term is `max`, not `mean` — add a second unrelated rejection and
  a work near the first must not climb back up the board
- Enter-on-empty-bar reaches the exemplar route and not the agent route
- every new tool's schema and its failure paths
- the turn shim fires exactly once per turn and never mid-loop

---

## 5. Four bugs the browser found that the tests could not

Each is a claim about wiring rather than about a function, which is why jsdom
could not see them. All four are fixed and now have tests.

1. **The culling keys were dead on arrival.** The search input carries
   `autoFocus`, so on every load of `/nga/search` the caret sat in a text field
   — and a bare letter is correctly ignored while one has focus. Hover a card,
   press `P`, nothing happens. Fixed with three conventions rather than a
   heuristic: autofocus only when there is no query yet, blur on submit, and
   Escape lets go of any field. No way to steal a keystroke from someone who is
   genuinely typing.
2. **A redeal ate its own evidence.** Assembling a turn drains the gesture
   journal, and the deterministic redeal assembled one — so flagging three
   works, pressing Enter, then typing meant the agent got an empty payload.
   Only a turn that is actually going to a model drains now.
3. **The page could tear down its own tool surface.** A remount re-registers in
   the same tick the previous unregister is queued in, and the two were not
   serialised: the new `registerTool` overtook the old `unregisterTool`, the
   host rejected the duplicate, and the unregister then removed the survivor.
   All 21 tools gone, every one reported as already registered. The old test
   awaited between dispose and re-register, so it could never see it.
4. **The debug host arrived too late to be believed.** A real host exists before
   the page's script runs; the stub was installed from an effect, effects run
   child-first, and the in-page prompt bar had already concluded there was no
   host and rendered nothing. `?webmcp-debug` had a full tool surface and no way
   to talk to it. The harness now claims `document.modelContext` as its module
   loads.

**Item 4 has a consequence the submission lane should know:** the in-page prompt
bar only renders when a WebMCP host is present at mount. In a plain browser with
no host and no `?webmcp-debug`, there is no bar — and therefore no
Enter-on-empty-bar. That is pre-existing behaviour in `agent-prompt.tsx`, which
belongs to the voice lane; I did not change it. Film with `?webmcp-debug` or
with the Chrome flag.

---

## 6. The one shim, and how to delete it

`apps/web/app/lib/webmcp/turn-bridge.ts` wraps `window.fetch` to attach the
`turn` payload to `POST /api/public-agent/turn`. It exists because the component
that posts the turn is `agent-prompt.tsx`, which I was told not to touch, and
without it the payload was never sent by anything.

It is scoped to that one path and one method, forwards anything it does not
understand untouched, and **passes straight through if the body already carries
`turn`**. So the day the prompt bar sends its own, this becomes a no-op and the
file can be deleted with no coordination. `docs/night/shared-state-notes.md` has
the three-line change for the voice lane.

It is still a monkey-patch on `fetch`, and I would rather it were not there.

---

## 7. What I cut, and what is still not right

- **No staging deploy.** Two other lanes are working against the same staging
  environment tonight and a web deploy would have put my branch in front of
  them. The cost is §3's unverified claim: the exemplar route has not run
  against the real NGA index.
- **`keep` is decorative.** `redeal { keep: "picks" }` is the only legal value
  and picks are held whether or not it is passed, because pin survival is
  enforced in the implementation. The argument exists so the brief's signature
  is honoured and so the model can state its intent; it changes nothing.
- **No provenance ink, no deal animation, no ledger.** Deliberate — those are
  the visuals lane's. Every hook they need is in place and tested as a
  contract: `.paillette-card` carries `data-artwork-id`, `data-flag`,
  `data-flag-by`, `data-flag-provisional`, `data-hovered`, `data-selected`;
  `.paillette-flag-badge` and `.paillette-flag-button[data-flag-action]` carry
  the same flag attributes; `.paillette-compare`, `.paillette-compare-work` and
  `data-side` are on the two-up. Two inks and a dashed state should be CSS with
  no JavaScript.
- **The two-up is plain and has no keyboard answer.** You click a picture or you
  click "Neither". `C` opens it; nothing closes it but a click. I removed the
  line of text telling people to click a picture — it was the interface
  apologising for itself — which does mean the `U`-to-override affordance is now
  discoverable only from the card badges.
- **Agent flags are never rendered as dashed** by me. The data attribute says
  `data-flag-provisional="true"`; drawing it is the visual pass.
- **`redeal` refuses on a collection indexed in-tab** (`/try`), with
  `REDEAL_UNAVAILABLE_HERE`. Relevance feedback needs the published vector
  index. The loop is `/nga/search` only.
- **Nothing persists.** Flags, board and selection are page-session state in
  memory. A refresh loses the cull.

---

## 8. Test and typecheck results, exactly

Baseline was web 59 files / 593 tests, api 41 / 770.

| Command | Result |
| --- | --- |
| `pnpm --filter api test` | **43 files, 791 tests, all passed** |
| `pnpm --filter web test` | **68 files, 718 tests, all passed** |
| `pnpm --filter web typecheck` | **1 error, pre-existing, not mine** |
| `node apps/web/scripts/verify-culling-loop.mjs` | **24 checks, all passed** |

Two things to know about those numbers:

- `pnpm --filter web test` and `typecheck` both fail on a **clean checkout**
  until `pnpm --filter web build` has been run once: `worker.ts` imports
  `./build/server/index.js`, which is a build artifact. After a build,
  `__tests__/worker-cache-control.test.ts` collects and passes. This is
  pre-existing and unrelated to this branch.
- The single remaining typecheck error is
  `app/components/webmcp/agent-activity-panel.tsx(153,9): 'runningEntry' is
  declared but its value is never read`. That file is untouched by this branch
  — the error is present on `origin/deploy-nga-open-access` — and I was told not
  to edit it. One-line fix for whoever owns it.

---

## 9. Files this lane touched

Inside the declared list, plus two justified exceptions.

```
apps/api/src/routes/agent.ts                     turn payload + gesture rules
apps/api/src/routes/search.ts                    POST /search/exemplars
apps/api/tests/routes/{agent-turn,exemplar-search}.test.ts
apps/web/app/lib/webmcp/{flags,redeal,turn,turn-bridge,selection,
                         board-keyboard,client,search-target,store,
                         tools,registry,debug-harness}.ts
apps/web/app/lib/webmcp/__tests__/*
apps/web/app/components/board/{flag-controls,compare-view}.tsx  + tests
apps/web/app/routes/api.public-search.$orgId.exemplars.ts       + test
apps/web/app/routes/galleries.$galleryId.search.tsx             flags, keys, focus
apps/web/scripts/verify-culling-loop.mjs
```

Exceptions, both deliberate:

- `apps/web/app/components/webmcp/webmcp-bridge.tsx` — three lines, to mount the
  turn shim and to stop double-installing the debug harness. Not on the
  forbidden list; it is the WebMCP mount, which is this lane's mechanism.
- `apps/web/app/routes/galleries.$galleryId.search.tsx` — the focus fix, which
  is two lines inside the search form. It is keyboard handling, and without it
  none of the keys work.

**Untouched, as instructed:** `agent-prompt.tsx`, `speak-button.tsx`,
`agent-activity-panel.tsx`, and every layout or styling component.
