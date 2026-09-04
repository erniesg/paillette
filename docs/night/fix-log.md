# Fix log

## Iteration 1

Branch `night/integration`. Verdict was FAIL with eleven blocking items. All
eleven are addressed below, each with what changed and how it was checked. The
standing §7b list is at the end. Everything marked "measured" was measured
against **https://paillette-stg.berlayar.ai**, which is deployed from this
branch, not against a dev server and not against a test.

Baseline at the end of the iteration: `pnpm --filter web typecheck` clean,
`pnpm --filter web test` **91 files / 1112 tests**, `pnpm --filter api test`
**44 files / 815 tests**. (The brief's baseline of 59/593 and 41/770 predates
the `night/curation`, `night/activity` and `night/review` merges, which this
iteration performed.)

Evidence: `docs/night/e2e-evidence/fix-iteration-1/`.

---

### 1. The note was grounded in catalogue strings, not in the works — **fixed**

`get_view_context`'s flag entries carried `id`, `title`, `artist`, `by`,
`onBoard` and nothing else, so everything the model could say about a rejected
picture was inferred from two proper nouns.

**Changed.** `toAgentVisualFacts` (`apps/web/app/lib/webmcp/artwork-summary.ts`)
projects the four indexed swatches, the medium, the year and the classification
— the fields already printed on the card — and they now ride:

- every entry in `flags.picks[]`, `flags.rejects[]` and `flags.provisional[]`
  (`tools.ts`, `describeFlags`);
- every entry in `flagsDelta` on the human-turn payload (`turn.ts`, `visualsOf`);
- one added system-prompt line (`apps/api/src/routes/agent.ts`) telling the
  model to name the visual property it can see in the record rather than a mood
  it associates with a name.

The swatches the note was written from are drawn under the note
(`components/board/note-swatches.tsx`, `.lt-note-swatches`): one strip per
flagged work, picks whole, rejects struck through, no words.

**Verified on staging.** `get_view_context.json` in the evidence directory, and
in the e2e transcript:

```
"rejects":[{"id":"…50295","title":"Peaceful Valley","artist":"Alexander Helwig Wyant",
  "palette":["#DEB585","#3B2F1F","#715023","#B09176"],
  "medium":"oil on canvas","year":1872,"classification":"Painting",…}]
```

And the notes it produces now name colour rather than artist — see item 2.

### 2. No negative control — **run, and it passes**

Two conditions, same instruction ("something warm for above the sofa"), same
query, flags inverted: reject the two darkest palettes, then the two brightest.
Darkness computed from the same indexed swatches the agent is handed, so the
conditions differ on exactly the axis the note is supposed to be able to name.
`scripts/demo/negative-control.mjs`.

Two full runs completed. Verbatim:

**Run A — rejected the two darkest** (`#413225…`, `#3B2F1F…`):
> You rejected the two brown-and-ochre oils; these keep the warmth in firelight, gold, and clear sunlit colour.

**Run A — rejected the two brightest** (`#F4E8D6…`, `#ECCEA7…`):
> Warmth here runs from sunlit gold to russet domestic colour, avoiding the tan-and-cream palettes you rejected.

**Run B — darkest:**
> Warm colour in four registers: sunset gold, ember rust, peach, and softened terracotta.

**Run B — brightest:**
> Warmness here is saturated amber, rust, and fruit-toned oil—not the muted beige and umber you rejected.

Three of the four name the rejected works' actual colour, correctly and
differently in each direction — "brown-and-ochre" for the dark pair,
"tan-and-cream" and "muted beige and umber" for the pale pair. The fourth
(Run B, darkest) describes the board without referring to the rejects at all:
not wrong, but not the beat. The two conditions never produced the same note.

`negative-control.json` holds Run B verbatim; Run A's notes are quoted above
from the console and its JSON was overwritten by Run B before it was copied.
That is an evidence-handling mistake on my part, not a claim without a source —
the script is deterministic and re-runnable.

**A third run was blocked by the anonymous agent budget** (40 model calls per
client per hour; one typed instruction costs five or six). The third run got one
call per condition and no note at all. This confirms the `nice_to_have` about
the cap: an afternoon of rehearsal will exhaust it, and whoever films needs a
raised cap or a key.

### 3. `compare_artworks` rendered ~1,700px below the fold — **fixed**

Cause was as diagnosed: a finished GSAP tween leaves `transform:
matrix(1,0,0,1,0,0)` on the results `<section>`, which becomes the containing
block for a `position: fixed` child.

**Changed.** `CompareView` is portalled to `document.body`, which survives the
next person adding a transform. While it is open the root carries
`data-compare-open` and every other body child is `visibility: hidden` — an
opaque overlay alone was not enough, because the nav is sticky at z-40, the
search chrome at z-30 and the agent's glyph at 65, so they stack *above* a
scrim.

**Measured on staging:** `box: {top: 0, left: 0, w: 1440, h: 1000}`,
`portalled: true`, `chromeVisible: []`. Screenshot: `05-compare.png` — two works,
the question in serif between them, nothing else. Unit tests added in
`compare-view.test.tsx`.

### 4. `set_view` outranked the deal board — **fixed**

**Changed.** The `dealtBoard` check is now the first branch in `ResultsLayout`,
above table/salon/atlas. The prompt line that recommended "salon for a curated
hang" now says to leave `set_view` alone once anything is flagged.

**Measured on staging:** the deal grid survives `set_view` for salon, atlas,
table *and* masonry. The e2e's expectations for this were written to document
the old bug; they now assert the fix.

### 5. The curation half was unmerged and undeployed — **merged, deployed, walked**

`night/curation` merged (one conflict, an import block — both sides were
needed; `<ExhibitionHead />` is mounted at `galleries.$galleryId.search.tsx:2901`).
Deployed to staging.

**Walked by hand on the deployed build** — `scripts/demo/e2e-curation.mjs`,
driving the edit the way a person does it: click the paragraph, select all,
type, commit. **11 of 11 pass.** The agent drafts a title, a statement and six
labels; the human rewrites the statement; a turn leaves the page; the agent
re-selects (6 works to 18) and rewrites every label against the correction; it
does not overwrite their sentence; the share control produces a URL that opens
cold in a browser that has never seen Paillette, carrying the human's words
rather than the agent's draft. `curation-walk.json`, `03-exhibition-cold.png`.

**One correction to the verdict.** `share-link.test.tsx:136` does *not* fail on
this branch — the clipboard feature-detect at `share-link.tsx:65` is present and
the file's five tests pass. The lane fixed it in `d66a2c0`, after the critique
read the code. Nothing was needed from me.

**A second correction.** `https://paillette-stg.berlayar.ai/exhibition` returning
404 is correct behaviour, not a missing route: the show travels in the URL
(`?e=…`) and the loader 404s a request with no payload rather than rendering an
empty gallery. The real problem the item named — no UI entry point, no editable
statement, no share button, no labels — was real, and the merge is what fixed it.

### 6. No evidence a label is contextual — **run, and it is decisive**

`scripts/demo/labels-ab.mjs`: the same six works, twice, against the live model,
under two statements that could not be confused for each other (a show about
weather; a show about departure). Both sets committed verbatim in
`labels-ab.json`.

**0 of 6 labels are byte-identical.** They are not paraphrases of each other
either. The same painting:

> **weather** — The river carries the last light of the day beneath a setting sun. Painted in oil on wood, the scene closes the hanging order with weather and illumination settling toward evening.
>
> **leaving** — The river carries the eye through an unpeopled stretch of shore, where no boat or figure interrupts the water's course. At day's end, the scene reads as a place left behind rather than a view awaiting activity.

This is the A/B for the video.

### 7. "Re-selects and re-labels around the correction" was a system prompt — **fixed**

The critique's diagnosis was right and its fix was half of what was needed.

**Changed, part one.** `submitHumanTurn` routes to the agent when there are
pending exhibition edits and no typed text, with the human's own sentence
verbatim as the instruction (`pendingProseInstruction`).

**Changed, part two — not in the critique, and the part that actually mattered.**
Nothing *called* `submitHumanTurn` when the statement was committed. The
gesture is Ctrl+Enter inside a textarea; the board keyboard bails out of
anything typed in a text field; so the correction still sat in the journal until
the human happened to type something unrelated. Committing the statement is now
itself the turn (`exhibition-head.tsx`), dispatched through `commitHumanTurn`,
which is where "decide what the gesture was" and "hand it to the agent" meet so
the board keyboard and the statement field cannot drift apart. The statement
only — a title or a label still rides the next turn rather than costing a model
call per typo.

**Verified on staging:** 2 POSTs to `/public-agent/turn` after the edit, 18 of
18 labels rewritten, the human's sentence untouched. Plus two unit tests.

### 8. Twelve cards did not fit, and there was no reject tray — **fixed**

**Changed.** `DealResults` passes the `tray` prop `DealBoard` already supported,
filled with confirmed rejects that have left the board, most recent first,
rendered desaturated and clickable. The board container is bounded to
`min(74svh, 820px)`, and the card drops its catalogue apparatus in `compact`
mode so it fits its slot.

**One thing I got wrong first and had to redo.** My first attempt measured the
viewport remaining below the board's own top. That is scroll-dependent: a deal
made halfway down a masonry produced a **356px** board with **0 of 12** cards
fully visible, and cards overflowing their slots far enough to intercept each
other's pointer events — hovering a card to press X hit its neighbour. Caught by
running the e2e, not by a test. Replaced with a fixed share of the window plus
an instant (never smooth) scroll that only fires when the board is not already
watchable.

**Measured on staging:** `{"cards":12,"visible":12,"gridHeight":724,"viewport":1000}`.
Tray holds both rejects. Pick at zero pixels on both axes.

### 9. The interface narrated its own mechanism — **fixed**

`night/activity` merged: the header pill, the mini-board, the repeated note and
the empty state are gone, and its three later commits (the ones the critique
listed as uncommitted working-tree changes) were committed by the lane before I
merged, so nothing was lost. Grepping the merged tree for "AGENT ACTIVITY",
"WEBMCP CONNECTED", "PINNED BY THE AGENT", "TOOL CALLS" returns nothing but one
`aria-label`.

**Also cut, by me:** the italic placeholder `something warm for above the sofa`;
the word "Ask" beside a bar with a caret in it; the word "Search" beside a
magnifier inside a field that already has one; the `/ 0MS` breadcrumb.

**And two the critique had not seen**, because they arrived with the curation
merge: the exhibition head shipped placeholders reading `Untitled` and
`What it's about.` — two lines of serif nobody wrote, on screen from the first
pick of every session. Cut. The rules and the `1 WORK` rail carry it.

**Verified on staging:** `placeholder: ""`, zero buttons labelled "Ask" or
"Search", no `/ 0MS`. Screenshot `enter-armed.png`.

### 10. A judge opening staging cold did not reach the good part — **fixed, with one correction**

**Changed.** The stub host is claimed on every visit, not only under
`?webmcp-debug`. The flag was gating the wrong thing: the host is what the
page's own agent talks to, and a visitor without a WebMCP browser is the common
case. Only `window.__paillette_webmcp` — a console back door — stays behind it.

**Verified on staging, no flag:** `host: true`, `debugDriver: false`,
`bar: true`, **25 tools registered**.

**The Enter affordance.** A hairline in the human's ink appears under the bar the
moment their first flag is confirmed, with the `↵` glyph resting on it — the
same mark the send button now carries, so the key and the control are one thing.
No sentence; it is gone again when the flags are. The sentence exists once,
`sr-only`. Verified on staging: `hairline: true, glyph: "↵"`.

**The correction.** *"'warm landscape' and 'golden light' return zero works on
staging"* **is not true on the deployed build.** Measured through the page's own
search, four times each: `warm landscape` **30**, `golden light` **30**,
`sunset landscape` 30, `something warm for above the sofa` 30, `landscape` 30,
`harbour` 30, `river` 30, `autumn` 30, `portrait` 30, `still life` 30,
`mountains` 22. The one thin query is `storm at sea` at **4**, which is the
prompt's own example of a *goal* rather than a query. Either this was fixed by
one of the merged lanes or the earlier measurement caught a cold embedding
service. `scripts/demo/query-counts.mjs` re-runs it in one command; the brief's
instruction to check the demo query before filming stands regardless.

### 11. Two §7b defects in the filming harness — **fixed**

**`PLAYWRIGHT_CORE`.** One resolver, shared by `capture.mjs` and all four e2e
scripts (`scripts/demo/browser.mjs`): explicit override (which must exist, or it
is a typo worth reporting rather than guessing past), then the workspace
dependency, then the pnpm store, then npx caches. Two of the e2e scripts also
had hardcoded paths — into an exact pnpm store version — which the critique had
not caught. `~/.cache/ms-playwright` holds the *browsers*, not the library, and
is Playwright's own default, so it is honoured by leaving
`PLAYWRIGHT_BROWSERS_PATH` alone. Verified: `capture.mjs` now reaches its
argument parsing on this VM.

**`--speak` truncation.** A recogniser's interim results are cumulative — each
one is the whole sentence heard so far, not the newest fragment. The loop wrote
each chunk over the last. It sends the running total now, and reads the field
back before pressing Enter, failing loudly if it does not hold the whole
sentence.

---

## The standing §7b list

1. **Deal animation on `/nga/search` with the real collection** — present and
   measured. 28 distinct layouts across 272 frames on the board-to-board deal,
   with the pick at 0px on both axes, against the real 63,253-work collection.
   Independently checked frame by frame: an entering card travels
   500 → 486 → 478 → 476 → 459 → 454 → 450 → 445 while the held card sits at
   220,144 throughout. I also fixed the *measurement*, which had been swinging
   between 7 and 28 at the same commit because it sampled every
   `[data-artwork-id]` in the document — now including the tray and a two-up
   portalled to `<body>` — and stopped 1.5s after Enter, while the exemplar
   engine takes ~2s to answer.
2. **`capture.mjs` playwright path** — fixed (item 11).
3. **`capture.mjs --speak` truncation** — fixed (item 11).
4. **The `?webmcp-debug` mount race (`928b5dc`)** — **it was not merged.**
   `night/review` is merged now. Its `ensureWebMcpDebugHarness` is kept whole
   for the driver; the host half of the same race is solved more broadly by
   claiming the stub on every visit. The bridge's effect-time install is gone —
   it was doing the work twice. The lane's registry remount tests came with it
   and pass against integration's implementation.
5. **Tool count** — it is **25**, not 21 and not 17. The exhibition tools took
   it from 21 to 25 when `night/curation` merged. Counted live against the
   deployed build via `document.modelContext.getTools()`. Corrected in
   `README.md` (×2), `docs/webmcp-devpost.md`, `docs/HANDOFF.md` (×2) and
   `docs/webmcp-submission-pack.md`. It is derived from one place now
   (`PAILLETTE_TOOL_COUNT`) and the registry test fails if the list and the
   factory disagree, because this number has now been wrong twice.

The lane reports that say "21 tools" are left alone: they were true when written.

---

## What I did not do, and why

- **The `nice_to_have` list is untouched.** Every blocking item was worked
  first, as instructed, and the remaining time went into verifying them on the
  deployed build rather than starting new work.
- **One deterministic e2e check still fails, by design:** *"choosing sends a
  human turn to the agent immediately"* — 0 POSTs in the 3s after the click.
  `resolveCompare` records the choice and lets it ride the next turn so the
  board does not thrash under the human's hands. §4's P4 does say "the click is
  sent as a human turn", so this is a real gap between the brief and the build;
  it is not on the blocking list, and changing it is a behaviour change I did
  not want to make unverified at this hour. Recorded rather than hidden.
- **The third negative-control run** hit the 40-call anonymous budget. Two runs
  completed; a third would want a raised cap or a key.
- **Run A's negative-control JSON was overwritten** before I copied it. The
  notes are quoted verbatim above from the console; the script re-runs it.

## Deployed

Web and API are both deployed to staging from this branch. Web version
`264bffd8-6764-4da4-bbe9-4651c913bb47`; API version
`376f9b4d-48d6-45b6-ada7-89e250ce1d9b` (the system-prompt change). The next e2e
run films this.

---

# Iteration 4 — the fix phase, 09:10–10:05 UTC

Against `verdict.json` (iteration 3, FAIL) and `docs/night/critique-iteration-3.md`.
All five `blocking` items are cleared and re-verified on the deployed build, by
walking the beat in a browser rather than by running a unit test. Nothing from
`nice_to_have` was started; the blocking list took the whole slot.

Deployed at the end of this: web version `1b95cb0e-58e2-4bc5-9ad7-90d598c77405`,
api version `c211e8b8-2e53-4b7e-9709-4298ee6da881`. The next e2e run films this.

Baseline, both green and both up on the last iteration:
`pnpm --filter web typecheck` and `--filter api typecheck` clean;
**web 97 files / 1203 tests**, **api 46 files / 857 tests**.

---

## Blocking 1 — "rejects alone do nothing"

**What it was.** `redeal.ts` refused when `exemplars.positive` was empty, and
returned from `fail()` before reaching `setDealError`, so `X X` then Enter
issued no request, changed no pixel and said nothing. The agent calling
`redeal` on the human's flags got the same refusal and invented four searches
of its own.

**What I changed.** `seedPositives()` in `apps/web/app/lib/webmcp/redeal.ts`.
With no picks, the unrejected works on screen seed the centroid and the rejects
push against it — `cos(x, mean(screen \ rejects)) − w·max_j cos(x, neg_j)`,
exactly the score the verdict specified. Same route, same weights, same
function; only the origin of the positives differs.

Four decisions inside that are worth stating, because they are not obvious:

- **The seeds come off `humanResults` when there is no board.** `board` is null
  until the first deal, which is precisely when someone is most likely to start
  throwing things out. Reading only the board would have missed the case the
  critique reproduced.
- **The whole on-screen set goes into `excludeIds`.** Otherwise the deal hands
  the same grid back and reads as nothing having happened.
- **Seeds are not pins.** Nothing was chosen, so nothing holds a seat and the
  board turns over. Only confirmed picks pin.
- **The outcome carries `seededBy: 'picks' | 'unrejected'`**, and the `redeal`
  tool result carries a hint telling the model not to claim they picked
  anything. A note that says "you picked" about a turn where nobody picked is
  the same hollowness in a different place.

**On the verdict's "relax the positiveIds min-1 requirement": I did not, and I
think that is right.** With the seeding above, `redeal` never sends an empty
positive list, so the server's guard is not in the way. Ranking by
`−w·max_j cos(x, neg_j)` alone — which is what relaxing it would mean — sorts
63,253 works by "least like the thing you hate" and returns the weirdest
corner of the index. Instead `search_by_exemplars` now applies the *same seeding
rule* the human's Enter uses, so an agent asking "less like those" with nothing
to be more like gets the human's answer rather than a 400 or a garbage ranking.
That keeps the "no agent-only path" claim true, which relaxing the server would
not have.

The one remaining refusal — nothing picked and nothing unrejected on screen —
now calls `setDealError`, so it draws.

**Verified on staging**, `scripts/demo/probe-rejects-only.mjs`, twice, on the
final build. Cold `/nga/search?q=warm landscape`, hover-and-`X` on two cards,
Enter on an empty bar:

```
boardBefore 30 → boardAfter 12 · newWorks 12 · rejectsStillOnBoard 0
exemplarCalls 1 · agentCalls 0 · dealError null
dealtBoard true · trayPresent true · tray 2
```

One POST to `/api/public-search/nga/exemplars` and nothing else. Both rejects
in the visible tray. Shots in `docs/night/shots/fix4-rejects/`.

## Blocking 2 — 429 on every agent turn

**What I changed.** `OPENAI_DAILY_CALL_LIMIT = "5000"` in `[env.staging]` of
`apps/api/wrangler.toml`. The site-wide KV day-counter had been falling through
to `DEFAULT_OPENAI_DAILY_CALL_LIMIT = 500`.

And the diagnosis cost, which the verdict was right to call out: `openai.ts`
threw an identical `OpenAiUnavailableError` for two unrelated 429s. They now
carry an `OpenAiFailureCode`, and `agent.ts` relays them apart —
`AGENT_BUDGET_SPENT` ("raise `OPENAI_DAILY_CALL_LIMIT` and redeploy; the
counter resets at 00:00 UTC") versus `AGENT_RATE_LIMITED` (upstream, not ours).

**Verified**: `POST /api/public-agent/turn` returns **200** with a real
assistant message, re-checked at the end of the session. The deployed
`OPENAI_API_KEY` is healthy — no key was changed and no other project's billing
was pointed at, which was correctly not a fix phase's call. Every OpenAI-backed
route on the worker shares that counter, so `/api/public-labels` came back with
it.

## Blocking 3 — the note not grounded in the flagged works

**What I changed.** Two things, and the verdict's diagnosis of which mattered
was right.

- The gesture payload now rides **every** request of a turn
  (`agent-prompt.tsx`), not only `turn === 0`. The wall label is written on the
  last request, five or six deep, and by then the sentence naming the rejects
  had gone.
- `describeHumanTurn` takes `{ continued }` and rewords itself as *"Still
  standing on the board, from before this turn began: …"* once the loop has
  been round, detected from the conversation rather than trusted from the
  client. That is what the original *"do not restate them"* comment was
  protecting, and it costs nothing to keep the facts.
- The gesture rule also now asks for a note naming subject, palette or medium
  rather than one that would fit any board.

**Verified, six runs across two independent triplets**, `notes-fix4.mjs`
against staging: instruction → `X` on two → Enter → one contentless nudge
("again"). **6 of 6 name what was thrown out.** Rejects beside their notes:

| rejected | note |
| --- | --- |
| *Lake Albano, Sunset* (Inness, 1874, oil, `#BFAC66 #584D0B #E8C770 #80793F`) · *Stylized Landscape* (American 19C, 1850, oil, `#584E26 #C0A659 #768347 #A1A97D`) | "You rejected the **gold-and-olive landscape palettes**; moving toward softer, lighter warmth." |
| *Environs de Cremieu* (Ravier, 1885, watercolor and graphite) · *A Hillside Path…* (Michetti, 1905, pastel and charcoal) | "You rejected the **two landscape drawings**; following that move toward warm, simple still lifes." |
| *Northern Landscape Fantasy…* (Berchem, 1660, red chalk) · *Vicinity of Morestal* (Ravier, 1885, watercolor and charcoal) | "You rejected the **two chalk-and-watercolor landscapes**; moving toward warmer, fuller color and away from their spare paper tones." |
| *Still Life, Wineglass, Two Peaches* · *A Peach, Seville* (Hall, 1866, oil, `#C3803A #7E3F0F #6C443C`) | "You rejected the **two peach-heavy, darkest palettes**; keeping the warmth lighter and less literal." |
| same two | "You rejected the **two darkest, brown-fruit palettes**; moving toward lighter, airier warmth." |
| *A Peach, Seville* · *Flower Holder* (Walbeck, 1936, watercolor and graphite) | "You rejected the **two warm still lifes**; following that move toward calmer, less object-centred landscapes." |

Every bolded phrase is checkable against the medium and palette beside it. The
redeal in each run made **0 model calls**. Evidence:
`docs/night/e2e-evidence/fix-iteration-4/notes.json`, shots
`docs/night/shots/fix4-note-run*.png`.

## Blocking 4 — reports claiming more than their evidence

- **`e2e-report.md` §4** rewritten. It quoted two ordering-B notes and said
  *"five notes came back"*; `notes-B.json` records all three B runs as
  `"note": null` against a 429. It now says two came back, both ordering A's,
  and carries a labelled correction quoting the original claim — so the record
  shows what was wrong rather than quietly reading differently. The judgement
  that follows is unchanged; it was always about ordering A's two.
- **`curation-report.md` §4** corrected. *"Nothing is stored on a server"* is
  no longer true: the merged `share-link.tsx` POSTs to `/api/exhibitions` for a
  seven-character code and falls back to the self-contained `?e=…` link. Now
  described as the two tiers it is, with the existing argument kept as what it
  actually is — the case for the fallback.

## Blocking 5 — the sticky toolbar slicing the wall label

**The first attempt was wrong and measuring caught it.** I scoped the fix to
the undealt case, because that is what the broken frame looked like. Then I
listed every pinned box on the page and measured each against the sentence
(`scripts/demo/sticky-audit.mjs`): the board *was* dealt, the note was hanging
in the board's own header, and the results bar (`56–158`) was on it
(`144–170`) — **14 px of overlap at scrollY 261**, 26 px at 320. The earlier
geometry check passed because it measured the bar and never the note.

Both places a label can hang are below the bar in the flow, so the condition is
just "is a label on screen", and the bar gives up `sticky` while one is.
`data-board-note` is now on the note so a harness can find it by name.

**Verified** with `note-vs-toolbar.mjs` on the final build, at scrollY 0, 120,
200, 261 and 320: **overlap 0 at every position**, and I looked at the pictures
rather than the assertion —
`docs/night/shots/fix4-note-toolbar/note-scroll000.png` and `…261.png` both
show the sentence whole above twelve cards at 1440×900.

---

## Section 7b — the standing list

1. **Deal animation on the real `/nga/search`.** Already true and re-confirmed
   here: my own probe returns `dealtBoard: true` with `.lt-deal-viewport` and a
   populated tray on `/nga/search` against the real collection. The critique
   independently measured 14–25 intermediate layouts and picks at 0 px on the
   same route. Nothing to port.
2. **`capture.mjs` hardcoded Mac playwright path.** Already fixed on this
   branch, and now proven rather than read: `capture.mjs` ran on this VM with
   no `PLAYWRIGHT_CORE` set and produced mp4 + webm + beats.json.
3. **`--speak` truncation.** Already fixed, with an explicit guard that throws
   if the field does not hold the whole sentence. Ran it: all 88 characters
   delivered, no throw.
4. **`?webmcp-debug` mount race.** Merged and holding — driver and stub host
   both install at module-evaluation time. Verified over **29 cold loads**:
   handle present, 25 tools, `get_view_context` returning through the driver.
   One caveat below.
5. **Tool count.** It is **25**, not 17 and not 21 — `PAILLETTE_TOOL_NAMES` has
   25 entries and `registry.test.ts` asserts it. Corrected in README (whose own
   table listed sixteen under a heading saying 25), the devpost fields and
   description, the submission pack, demo script v7 and the handoff prompt,
   with each name list checked against `PAILLETTE_TOOL_NAMES` rather than the
   total alone. Dated lane reports under `docs/night/` and the version-stamped
   drafts are left as written: they were true at their timestamps.

**Two things found while verifying the above, and fixed rather than reported:**

- **`beats.json` recorded `toolsFired: []` under a take in which every tool
  fired.** The reader looked for `aside[aria-label="Agent activity"] ol`, which
  is not the markup — and, the interesting half, the log is **closed at rest by
  design**, so the harness was reading a shut drawer. It opens it now, once,
  before the loop. That is not a workaround: §7.4's answer to "how was WebMCP
  implemented" is a judge watching the tools fire, and that is only on camera
  if the drawer is open. Entries are matched by a new `data-activity-id`
  instead of by position, because the list is newest-first and reorders while
  calls are in flight — positional matching reported `list_collections` four
  times for one call, and a beats.json that overstates what happened is worse
  than the empty one it replaced. A typed run now records 7 screenshots and the
  real sequence: `list_collections`, three `search_artworks`, `search_by_color`,
  `set_view`, `set_results`.
- **The debug driver answered `[]` for the first 43–145 ms of every load.** The
  ordering is deliberate and I did not touch it; what changed is the answer.
  The back door now waits up to two seconds for a non-empty list rather than
  reporting an empty surface as fact. A judge opening the console as the page
  paints was reading "not yet" as "broken".

---

## What I could not close

- **One cold load in 29 never produced `window.__paillette_webmcp`** (25 s
  timeout). It happened in the batch run seconds after a `wrangler deploy`,
  while the worker version was rolling over, and 24 consecutive clean loads
  followed it — 12 through the strict probe and 12 through
  `probe-debug-flake.mjs`, which records page errors, failed requests, the
  query parameter and `document.readyState` on every load and caught nothing.
  I believe it was the deploy, not the page, but I could not reproduce it and
  so cannot prove that. `probe-debug-flake.mjs` is committed so the next
  iteration can keep hunting it if it recurs.
- **Nothing from `nice_to_have` was attempted.** The staging homepage still
  points at a different product, the cold search page still has two live text
  fields, and the disagreement is still not drawn on one card. The instruction
  was to clear the blocking list and nothing else, and clearing it — including
  the two capture-harness defects found while verifying it — took the slot.
- **The compare click still does not dispatch a turn**, and re-selection on a
  theme correction still drops works without adding any. Both are on the
  `nice_to_have` list, both were already recorded by earlier iterations, and
  neither was touched.
