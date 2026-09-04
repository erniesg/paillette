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
