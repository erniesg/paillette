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
| Turn payload `{ text?, flagsDelta, selection, hovered, compareChoice }` | shipped, **wired by a shim** — see §7 |
| "Gestures outrank words" rule in the agent system prompt | shipped, verified live on 9 runs |
| `search_by_exemplars` — Rocchio, server-side | shipped; formula verified over the real index |
| `redeal`, 12 cards, picks held in place | shipped |
| Enter on an empty prompt bar redeals with no model call | shipped, verified in a browser |
| `compare_artworks` two-up | shipped; `C` verified in a browser |
| Multi-select (shift-click), P5 "Point" | shipped |
| Pin survival in `set_results` as well as `redeal` | shipped |
| Failure, slow-network and empty-collection paths | shipped, 25 checks |
| Terseness pass on this lane's own surfaces | shipped — see §6 |
| Flags surviving a new search | shipped, verified in a browser |

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

`set_results` is unchanged in its arguments but not in its behaviour: passing
`artworkIds` now also writes the board, and any **confirmed human pick the
agent left out is added back** and reported as `heldPicks`. Pin survival is no
longer a property of `redeal` alone.

`get_view_context` additionally returns `flags` (`picks` / `rejects` /
`provisional`, each with id, title, artist and reason where given, plus
`exemplars`), `board` (`order`, `works`, `note`, `lastChangeBy`, `redeals`,
`dealtThisSession`), `selection`, `hovered`, `compare`, and — when a deal has
just failed — `lastDealFailed` and `dealing`.

The four verification harnesses, all runnable by hand:

```
apps/web/scripts/verify-culling-loop.mjs     29 checks, the loop end to end
apps/web/scripts/verify-failure-paths.mjs    25 checks, every way it can refuse
apps/web/scripts/verify-sofa-run.mjs         the brief's definition of done, live
apps/api/scripts/verify-exemplars-live.mjs   the engine over the real 63,253
```

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

**Now verified against the real collection** — see §4, "The engine over the
real 63,253". The premise that the backend can fetch an embedding by artwork id
is no longer an inference: `getByIds` resolved three real NGA ids to three real
1024-dimension vectors, and the centroid of three shipwrecks returned ten
seascapes.

**What is still not verified:** the route's *own code path* has never executed
against the real index. The verification runs the same arithmetic in a separate
worker, because the route needs a D1 binding local dev does not carry and
remote dev will not open a preview session on the API's custom domain. So: the
formula is proven over real vectors, and the route is proven to implement the
formula, but the two have not been proven in the same process. A staging deploy
closes that, and is the first thing to do at integration.

---

## 4. What is demonstrably true

### Verified in a real browser

`apps/web/scripts/verify-culling-loop.mjs` drives Chromium against a stubbed
network and asserts the loop end to end. It exits non-zero on the first failure.

```sh
pnpm --filter web dev                                   # in another shell
node apps/web/scripts/verify-culling-loop.mjs http://localhost:5173
```

Last run: **29 checks, all passed**, three times in a row. What it proves:

- hover sets the deictic anchor; `P` picks the hovered card, `X` rejects it,
  drawn in the human's ink, with `aria-pressed` on the badge
- `get_view_context` reports the flags
- shift-click selects instead of opening the work; `get_view_context` reports
  "these"; Escape drops it
- **Enter on an empty prompt bar reaches `/exemplars` and never
  `/public-agent` — asserted negatively, so the check can fail if a model call
  ever appears**
- the request carries the human's positive and negative exemplars
- the board deals **12**
- the pick is still in the seat it was in; the reject has left; the board is
  marked as the human's move
- **the flags and the exemplars survive the human running a different search**
  — the definition-of-done clause "flags persist per session"
- the next *typed* turn carries the gestures, with titles resolved
- `C` on a hovered card pairs it against a work already kept, and declining
  closes the two-up without flagging anything
- one click on the two-up resolves winner → pick, loser → reject, and closes
- no uncaught page errors

### The unhappy paths, driven the way a host drives them

`apps/web/scripts/verify-failure-paths.mjs` calls tools that should fail
through `window.__paillette_webmcp.call` on a real page. **25 checks, all
passed.** The point is not that the code refuses — unit tests cover that — but
that the refusal arrives as a readable `{ok:false,error:{code,message,hint}}`
rather than as a thrown exception, a hang, or a half-applied board.

- stale ids on `flag_artworks`, `compare_artworks`, `search_by_exemplars`,
  `set_results`, `show_artwork`, `describe_artwork`
- malformed input on five tools — one id where two are required, the same work
  twice, an empty positive set, an unknown flag value, no arguments at all
- `redeal` with nothing picked: says there is no direction rather than dealing
  at random
- the backend refusing (422): the upstream code reaches the caller and the
  board is not half-applied
- the connection dead: a shaped failure, the flags untouched, the agent told
  through `get_view_context`, and the human told on the page
- the collection exhausted: the picks stay and the board is not cleared
- the connection slow: a second Enter on top of an in-flight deal is refused
  rather than interleaved, and the latch releases afterwards
- Enter with nothing flagged at all: silent, and nothing breaks

### Verified against the live model

The brief's definition-of-done item: *"Given the sofa prompt and two X presses,
the agent's redeal note refers to the content of what was rejected. Check by
hand on three runs."*

`apps/web/scripts/verify-sofa-run.mjs` is that sequence, typed, in a real
browser, against the real model. Only the corpus is stubbed — fixtures with
legible warm and cool titles, so the note can be read against what was thrown
out. Everything else is live: the page, the tools, `POST
/api/public-agent/turn`, the system prompt, `gpt-5.6-terra`.

```sh
cd apps/api && npx wrangler dev --port 8787            # needs OPENAI_API_KEY
PAILLETTE_API_URL=http://localhost:8787 pnpm --filter web dev
node apps/web/scripts/verify-sofa-run.mjs http://localhost:5173 3
```

**Nine consecutive runs, all nine the same shape.** Every run:
`get_view_context`, then `redeal` — twelve cards, board marked as the agent's
move, the human's pick still on it — and a one-sentence note naming what was
rejected. Verbatim:

> "You said warm; you picked the grey harbour and rejected the golds — following
> the picks."

> "You said warm, but picked the grey harbour and rejected the golds—following
> the picks."

> "You said warm; you picked the grey harbour and rejected the golds—following
> the pick's quiet light."

The reply field was empty in **eight of the nine**: the note had already said
it, and the same sentence twice on one screen is the thing the owner objects
to. The ninth restated the note as its reply. So the rule holds most of the
time and is not absolute — if the duplication matters on camera, the reply is
worth suppressing in the page rather than asked for in the prompt.

**Be precise about what this shows, and about what it does not.**

- The said-versus-chose behaviour comes from the **system-prompt rule**, not
  from the turn payload. Three earlier control runs *without* the payload
  produced the same sentence, because the model calls `get_view_context` first
  and the flags are there too. Do not claim the payload is what makes the agent
  follow the picks. Its job is narrower and still real: it puts the gesture
  *delta*, with titles, into the first request of a turn.
- The corpus in these runs is **eight fixture works with invented titles**, not
  the NGA. The behaviour is real; the pictures are not. Nothing here shows the
  engine returning good works from the real collection.

### The engine over the real 63,253

`apps/api/scripts/verify-exemplars-live.mjs` points the scoring formula at the
staging vector index and prints titles, so the result can be read rather than
scored. There is no green tick — the output is a list of pictures and a person
decides.

```sh
cd apps/api/scripts
../node_modules/.bin/wrangler dev -c exemplar-probe.wrangler.toml \
  --experimental-vectorize-bind-to-prod --port 8790
node apps/api/scripts/verify-exemplars-live.mjs
```

**Read the caveat first.** This runs a *mirror* of the route's arithmetic in a
throwaway worker (`exemplar-probe-worker.mjs`), not the route itself, for the
reason given in §3. Its header says so loudly. What follows is therefore
evidence about the formula and the index, not about the shipped handler.

Positives — three works found through the ordinary text search: *Storm at Sea*
(Niss), *Storm-Tossed Ships Wrecked on a Rocky Coast* (Dietzsch), *Shipwreck*
(Calame).

**1. Embeddings resolve by artwork id.** Asked for 3, got 3, at **1024
dimensions** — `jina-clip-v2`, as documented. This was the gamble in taking the
server-side path over the client-side RRF fallback, and it holds.

**2. The centroid lands where it should.** Ten nearest, all ten seascapes:

```
0.8489  Weymouth Bay                     David Lucas after John Constable
0.8475  At Sea                           Elbridge Kingsley
0.8452  Sailing Boats in a Tempest       Schelte Adams Bolswert
0.8410  Mount's Bay                      Francis Seymour Haden
0.8391  The Resounding Sea               Thomas Moran
0.8358  The Much Resounding Sea          Thomas Moran
0.8335  A Rock in the Sea                Elbridge Kingsley
0.8299  Norwegian Coast During a Storm   Johan Christian Dahl
```

No catalogue field says "sea" for all of those. The pictures do.

**3. One rejection moves a region, not a work.** Reject the top result,
*Weymouth Bay* — a calm Constable coastal view — and *Mount's Bay*, the other
calm bay etching, leaves the board with it. What arrives: *The Breakers*,
*Ships in a Stormy Sea*, *The Coming Storm: A Fishing Boat Making for Home off
Whitby*. One `X` drifts the board from calm coasts toward storms. This is the
"drift" the brief describes, on real data.

**4. `max` over the negatives, measured rather than argued.** Reject *Weymouth
Bay* **and** an unrelated portrait. Under `max` the portrait is ignored and the
board stays stormy. Under `mean` the penalty is halved and **Mount's Bay climbs
back to third** — the exact work the rejection was meant to push away. That is
the dilution the design avoids, with a title on it.

This is the strongest evidence in the lane and the clearest demo material: the
board moving from calm bays to storms on a single keypress, with no model
anywhere in the path.

### Verified typed, with voice off

Every check above is typed and clicked. No speech API is touched anywhere in
this lane — `grep` for `SpeechRecognition`, `speechSynthesis` or
`webkitSpeech` across `lib/webmcp`, `components/board`, the verification
scripts and the agent route returns nothing. The agentic trigger fires from a
typed instruction alone, and the deterministic loop fires from a keypress.

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

## 6. The terseness pass

Section 5b of the brief, applied to this lane's own surfaces. What came out:

- **"assembled by the agent"**, the caption above the board. A word doing an
  ink's job, and wrong the moment a human redeal could put a board there. Gone;
  `data-provenance="human"|"agent"` on the wall label is the hook for a colour.
- **The board's fallback label** — "12 works, dealt from 3 picks" — was
  rendered as the wall label whenever nobody wrote a note. That is the
  mechanism narrating itself. The page now renders the note or nothing; the
  factual label survives only in `get_view_context`, where a machine reads it.
- **Tooltips on the flag buttons** ("Pick — P") restating the letter printed on
  the button. Gone; the accessible name still carries the word.
- **"Neither — close"** on the two-up is now **"Neither"**.
- **Thirty-six letters of chrome.** Twelve cards times three controls, stamped
  over every work. Looking at a rendered twelve-up rather than reasoning about
  the component settled it: the badge is now quiet until the card is hovered,
  focused, or flagged. A set flag is a mark and stays. Nothing is unmounted, so
  tab order and screen readers are unaffected.
- **The agent's note is one sentence**, enforced in the system prompt and in
  the schema (`maxLength` 160, down from 280), and it may not be repeated as
  the spoken reply. Six live runs produced one sentence and an empty reply.

The one place a word was **added**, deliberately: a failed deal now says so, in
one sentence. Enter is cheap to press, and a dead key is the single response a
person cannot act on — they cannot tell a broken connection from a collection
with nothing left. That is a failure report, not helper text.

Still wordy, and **not mine to fix**: the agent activity panel repeats the
note underneath a mini-board and a list of tool calls, so the same sentence
appears twice on screen. The brief's triage item 9 says to hide that panel
entirely rather than show a chat. A human is editing that file; the
recommendation is in `docs/night/shared-state-notes.md`.

---

## 7. The one shim, and how to delete it

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

## 8. What I cut, and what is still not right

- **No staging deploy.** Two other lanes are working against the same staging
  environment tonight and a web deploy would have put my branch in front of
  them. The engine was verified without one, by binding a throwaway worker to
  the staging vector index read-only (§4); what a deploy would still add is the
  route's own handler running end to end against real data.
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
- **The two-up is plain and has no keyboard answer.** You click a picture or
  you click "Neither". `C` opens it; nothing closes it but a click — Escape
  does not, which is the most obvious remaining gap in it. The line of text
  telling people to click a picture is gone, so the `U`-to-override affordance
  is discoverable only from the card badges.
- **Agent flags are never rendered as dashed** by me. The data attribute says
  `data-flag-provisional="true"`; drawing it is the visual pass.
- **`redeal` refuses on a collection indexed in-tab** (`/try`), with
  `REDEAL_UNAVAILABLE_HERE`. Relevance feedback needs the published vector
  index. The loop is `/nga/search` only.
- **Nothing persists.** Flags, board and selection are page-session state in
  memory. A refresh loses the cull.
- **A second Enter during a slow deal is dropped, not queued.** It returns
  `REDEAL_IN_FLIGHT` and nothing happens. That is deliberate — the flags have
  not changed, so the next press would read the same thing — but on a slow
  connection it will feel like a missed keypress until the visual pass marks
  `dealing`.
- **The deal is not animated and picks do not visibly hold their seats.** The
  data is correct — `order` keeps a pick at its index — but with no FLIP
  animation a redeal is a jump cut. That is the visuals lane's money shot, and
  it is not in this branch.
- **The fixture corpus is not the collection, on the model side.** Every live
  model run used eight invented works, so nothing shows the *agent* reasoning
  about real NGA pictures. The engine underneath it has now been run against
  the real index (§4), but the two have not been joined up.
- **No lane has run the route's own handler against the real index.** The
  formula is verified there and the handler is verified to implement the
  formula; a staging deploy is what closes the gap.

---

## 9. Test and typecheck results, exactly

Baseline was web 59 files / 593 tests, api 41 / 770.

| Command | Result |
| --- | --- |
| `pnpm --filter api test` | **43 files, 791 tests, all passed** |
| `pnpm --filter web test` | **68 files, 732 tests, all passed** |
| `pnpm --filter web typecheck` | **1 error, pre-existing, not mine** |
| `verify-culling-loop.mjs` | **29 checks, all passed, 3 runs** |
| `verify-failure-paths.mjs` | **25 checks, all passed, 3 runs** |
| `verify-exemplars-live.mjs` | **ran; output is for reading, not a pass/fail** |
| `verify-sofa-run.mjs` | **9 runs, all 9 redealt with a one-sentence note** |

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

## 10. Files this lane touched

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
