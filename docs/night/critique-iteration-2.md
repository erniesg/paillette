# Critique, iteration 2 — would this win the WebMCP Challenge?

Read: `BRIEF.md` in full; `docs/night/integration-report.md`, `e2e-report.md`,
`curation-report.md`, `activity-report.md`, `fix-log.md`, `critique-iteration-1.md`,
and the sharing lane's `sharing-report.md` on its own branch; `docs/night/shots/`
and `docs/night/e2e-evidence/iteration-2/`.

**And staging, live, driven by hand.** Nothing in the section headed "measured
here" below is inherited from a lane report. I ran four browser sessions against
`https://paillette-stg.berlayar.ai` — a geometry probe, a chrome census, a cold
share open, and one **live theme-correction loop costing 7 model calls**. Scripts
in `/tmp` (not committed; they touch no source). Screenshots committed as
`docs/night/shots/crit-0*.png`.

**Verdict: FAIL.** Seven blocking items. This is much closer than iteration 1 and
the fix phase did real work — the flags now carry visual facts, the note is
grounded, the compare room is fixed, twelve cards fit, the curation half is
merged and deployed, and the theme-correction loop *works on staging*, which I
proved myself rather than taking on trust.

It fails on one structural thing that nobody has looked at all night, and on a
build-integrity problem that appeared in the last forty minutes.

---

## The short version

**The thesis is true and it is invisible.** "The human points. The agent
narrates. The board is the transcript." The pointing works, verified to a
standard nobody else in this competition will match. The narration works and is
genuinely grounded now. But the narration and the board **cannot be on screen at
the same time**, at any scroll position, at 1440×900. I measured it. The
submission's defining image does not exist and cannot be photographed, which is
why there is not one screenshot in `docs/night/shots/` — including the two named
`…board-and-note.png` and `…agent-note-names-the-reject.png` — that contains the
agent's sentence and the board it is about.

And **staging is no longer running the branch the e2e report tested.** A lane
redeployed over it. That report's foundational sentence is now false.

---

## Measured here, tonight, on staging

Everything in this section I ran myself.

### The note and the board cannot coexist. 1440×900, deployed build.

After `set_results` with a note (no model call), then three human flags, then
Enter on an empty bar (deterministic redeal, **0 POSTs to `/public-agent/turn`**,
confirmed off the wire):

```
scrollY = 0        wallLabel  y=479  h=26   visible      cards fully visible:  0 / 12
                   dealGrid   y=814  h=650  (bottom 1464 in a 900px viewport)
                   agent bar  y=405

scrollY = 689      wallLabel  y=-210        OFF SCREEN   cards fully visible: 12 / 12
                   dealGrid   y=125  h=650  fully framed
                   agent bar  y=-284        OFF SCREEN
```

The wall label is in normal flow, above the board
(`galleries.$galleryId.search.tsx:2922`, `.paillette-wall-label` at
`tailwind.css:1221` — not sticky, not fixed). The stack above the grid is 814 px
of nav + hero + search field + query chip + utterance bar + wall label + swatches
+ exhibition head + toolbar. The grid is 650 px. You need 1464 px. You have 900.

Shots: `crit-01-note-visible-zero-cards.png`,
`crit-02-twelve-cards-note-offscreen.png`.

Two consequences, and the second is worse than the first:

1. The agent's sentence — the load-bearing claim of the whole submission — is
   never in frame with the evidence for it.
2. **The utterance bar goes off screen too.** At the scroll where you can see the
   deal, you cannot see the bar you are pressing Enter in. On camera, the beat
   the brief calls the most important in the submission happens with its own
   control out of shot.

### The theme-correction loop works on staging. I ran it.

One live run, `/nga/search?webmcp-debug`, typed, voice untouched.

**Opening turn** — "Build me a small show about weather at sea — six works — and
draft a title and a statement for it." 36 s, 6 model calls.

```
title:      "Sea Change"                     by: agent
statement:  68 words about weather at sea     by: agent
works:      6
labels:     ALL NULL   —   0 POSTs to /api/public-labels
```

**The correction** — I rewrote the statement in place to *"It is not about
weather. It is about leaving — the hour before someone goes, and the room that
keeps its shape after they have gone."* and committed it. Enter in the field
fires the turn by itself (`exhibition-head.tsx:96`, `commitHumanTurn()`).

8 seconds. Two requests: `POST /api/public-labels`, `POST /api/public-agent/turn`.

```
statement:  verbatim, by: human, theirs: true
KEPT 6 / RELABELLED 6
title:      "Sea Change"  ->  "Sea Change"     (unchanged)
works:      the same six                        (no re-selection)
```

The labels are **genuinely contextual and they are good**:

> *Ships in a Stormy Sea* — "Two ships press through choppy water while a smaller
> vessel recedes beneath a sky of gray wash. The pen lines hold the scene in the
> tense interval between leaving and being lost from sight."

> *Low Tide at Scheveningen* — "Low tide leaves the coast open and paused, a
> shoreline temporarily stripped back. In this exhibition, that exposed ground
> reads as the space left after a vessel has gone."

> *Seacoast by Moonlight* — "Graphite and white crayon set moonlight against a
> gray seacoast, leaving the shore spare and hushed. The scene keeps watch after
> departure, with light remaining where company does not."

Nobody could read those and think they were written about weather. §5c's central
claim is real, on staging, with real retrieval — which the curation lane could
not show, because its three by-hand runs were on `localhost:5174` where, in its
own words, *"the ranking is not real."*

`crit-03-labelled-board-after-correction.png` is the result, and **it is the best
screenshot in the entire evidence pack** — six works, each with a serif wall
label in the agent's ink beneath it, the human's corrected statement in graphite
above them. Nobody captured it tonight. It is not in any report.

Three things it also shows, and they are defects:

- **The opening turn writes no labels.** So the show arrives as a title, a
  statement and an unlabelled list. There is no "before" in the product, which
  means the one thing that proves the feature is not fake — *the same work, two
  labels, two statements* — is invisible to anyone using it. It exists only in a
  verification script.
- **The title did not follow.** "Sea Change" still names the theme the human just
  rejected, and it is the first thing a reader of the shared page sees. The
  curation report claims this fixed in `6afd1ca` and cites, as its evidence,
  `<!--TITLEVERIFY-->` — **an unreplaced HTML comment placeholder.** A claim
  standing on a template variable. My run says the fix does not work.
- **Nothing was re-selected.** Six works in, the same six out. §5c step 4 says
  "re-selects **and** re-labels". Curation's batch 2 showed the board moving by
  1–3 works; that was on the dev server with fake ranking. On staging it did not
  move at all.

### Staging is not running `night/integration`.

```
GET /e/exYNx8X   200   <title>Everything the Light Left Behind — Paillette</title>
GET /e/QWwJnL5   200   <title>The Warm Side of Light — Paillette</title>
GET /e/zzzzzzz   404
GET /exhibition  302
```

The `/e/:code` route exists only on `night/sharing`, which is **13 commits
unmerged** into `night/integration`. Real D1-backed records, a real 404 on a bad
code. So a lane deployed its own build over staging, and the e2e report's
opening paragraph —

> *"`apps/` and `packages/` on this branch are byte-identical to the commit
> staging was deployed from (`2680f51`) … So the page under test is the page that
> is deployed, and the page the next phase films."*

— **is no longer true.** It was true when written. It stopped being true within
the hour. This is the second time tonight: the integration report §7 records
curation doing the same thing and had to redeploy the API to undo it.

The build that is live is probably a superset (sharing merged integration twice),
so I do not think anything measured is *wrong*. But there is no reproducible
build to film, and the next person who redeploys from `night/integration` will
silently delete two working share links that the sharing lane's report publishes
as evidence.

### A judge opening cold does not find the agent.

`/nga/search`, no query, no flag, 1440×900:

```
utterance bar present: true
utterance bar visible: FALSE   —   y = 926, in a 900px viewport
placeholder:           ""      (empty string)
```

It is one pixel-row of underline, 26 px below the fold, with no placeholder, a
mic glyph and a `↵`. Above the fold: a search field, a quota pill reading "698
free searches left", three tabs, a "Try / motif / stormy seas and ships" chip and
four floating thumbnails. Nothing announces the agent, nothing announces
`P`/`X`/`U`, nothing announces Enter. The e2e harness reached the bar because a
selector click scrolls; a person will not.

`crit-04-cold-open-no-agent-bar.png`.

### Chrome census, above the fold, at 1440×900

Words on screen that are not an artwork's own catalogue data:

| state | count |
| --- | --- |
| cold, no query | **84** |
| `?q=warm landscape`, no flags | **53** |

The 53:

```
About · Log in · Create account · National Gallery of Art, Washington /
collection search · 697 free searches left · Text · Image · Colour ·
Search · text · warm landscape · 🎤 · ↵ · 30 / 30 works · "warm landscape" ·
Sort · Relevance · Colour · Newest · Artist · Title · View · Masonry ·
Salon · Atlas · Table · Settings · 30 / 20 · ·····
```

The query is printed **three times**. Fourteen of the 53 are a sort/view menu
that has nothing to do with the culling loop. "697 free searches left" is chrome
narrating the mechanism, which §5b forbids by name.

### The cards on the deal board do not fill their slots.

In the browsing masonry, images fill the card width exactly (292 / 292 px,
`object-fit: contain`, `max-height: none`) — fine. On the **deal board**, tiles
are forced equal (`auto-rows-fr`) and the image keeps its natural size aligned
top-left, so a work occupies roughly **30–60 %** of its tile with the dead
charcoal all on the right and below. Visible in every board shot ever taken:
`e2e2-10`, `e2e2-12`, `crit-02`, `crit-03`. On the same boards, three of twelve
titles hard-clip at the tile edge with no ellipsis — *"The Sabine Hills and Rocca
Santo Stefano, S"*, *"Lake View, near Waymart, Del. & Hudson C"*, *"A Gleamy
Effect—Hollidaysburg, Pennsylva"*.

Also on that screen: **two orphan vertical hairlines** with nothing beside them
(`crit-01`, y ≈ 425–480) — the exhibition head's empty title and statement
rules, correctly given no placeholder, incorrectly still drawing their rules. And
two counts disagreeing three inches apart: "11 works" in the exhibition rail,
"12 / 12 works" in the toolbar.

---

## The eleven questions

### 1. Is this still delegation wearing a costume?

**No, and this is now proven twice over.** It is the best thing in the build.

27 redeals across five harnesses, every one carrying its own negatively-written
zero-model-call assertion, **zero POSTs to `/api/public-agent/turn`** — and each
one made exactly one call, to `/api/public-search/nga/exemplars`. I reproduced it
independently tonight: three flags laid by clicking the badge, Enter on an empty
bar, board redeals to twelve, `agent turn calls: 0`.

It also works with **no host on the page at all** (`e2e-extras.mjs`): `P` and `X`
still flag, Enter still redeals, the deal board still renders. That is the
strongest WebMCP argument anyone will bring to this challenge — *there is no
agent-only API; there is one workspace with two operators, and one of them can
leave.* Every competitor's entry dies when their agent dies. This one does not,
and it is testable rather than rhetorical.

**Where it is still delegation:** the agentic beat is unchanged in shape — type a
sentence, 42–59 seconds and 5–7 model calls later a board arrives. And the two
things §6 hopes will emerge — vocabulary transfer and drift — are still
undemonstrated anywhere in any report.

### 2. Does "gestures outrank words" actually happen?

**Yes. Iteration 1's blocking item is genuinely fixed, and I checked the
mechanism rather than the sentence.**

The flag payload now carries visual facts. Verbatim from the wire, in my own
`get_view_context` read tonight:

```json
{"id":"…195765","title":"Flying Shadows","artist":"Kenyon Cox",
 "palette":["#47502B","#9A8B57","#BDB89B"],"medium":"oil on canvas",
 "year":1883,"classification":"Painting","by":"human","onBoard":true}
```

Four dominant colours, medium, year, classification. So when run 2 says *"you
kept the ochre-and-brown oil still life and rejected the deeper red-brown
peach"*, `#7E3F0F` is in the payload and "oil on canvas" is in the payload. The
note is reading the flags.

Iteration 1's second blocker — *no negative control, the same two rejects three
times* — is also answered, though by accident rather than design. Across the four
runs the flag sets genuinely differ, and the notes track them:

| rejected | note |
| --- | --- |
| the dark peach, run 2 | "rejected the **deeper red-brown peach** — following its softer, quieter warmth" |
| the same peach, run 3 | "rejected the **darker peach palette** — following its quiet, airy warmth" |
| the pale pencil landscape, run 4 | "moving away from the **pale colored-pencil landscape** you rejected" |

Runs 2 and 4 are near-inverses (dark rejected / pale kept, then pale rejected /
warm kept) and the notes invert with them. That is the experiment iteration 1
asked for, and it passes.

**Two honest deductions.** Run 1's note — "steering away from darker, crowded
scenes" — is generic and would fit any board; the e2e report says so itself and
tells the filmer to retake. That is 1 in 4. And the grounding is in *computed
metadata*, not in the picture: palette hex plus a medium string. That is honest
and it is enough, but it means "the agent sees what you pointed at" is true of
four colours and a medium, and the submission should not claim more.

**The real problem is not truth, it is visibility.** See §1 of the measurements:
this sentence is never on screen with its evidence.

### 3. Would a judge who opened staging cold reach the good part?

**No.** Measured: the utterance bar sits at y=926 in a 900 px viewport with an
empty placeholder. Nothing announces `P`/`X`/`U`. Nothing announces Enter. The
one improvement over iteration 1 is real — the host is claimed and the bar exists
without `?webmcp-debug`, so the flag is no longer the incantation — but the bar
being present in the DOM and the bar being *found* are different claims, and only
the first is supported.

There is now no query problem, at least: "warm landscape" returns 30 works
(iteration 1 measured zero).

### 4. Do the visuals hold up?

**Three of them are excellent. The one the brief calls the money shot is not.**

Excellent, and I would film all three:

- **The compare two-up** (`e2e2-13`). Full-bleed charcoal, two works at scale,
  the agent's question in cyan serif between them, one word — NEITHER — at the
  bottom. Nothing else on screen. This is a room, exactly as §7.3 asks, and it is
  the best ten seconds available.
- **The shared exhibition page** (`crit-05`, `40-exhibition-page.png`). Serif
  title over two lines, the statement behind a hairline rule, "3 WORKS", then the
  work large with mono catalogue data set beside it. Designed, quiet, correct.
- **The labelled board after a correction** (`crit-03`) — which nobody captured.

Not excellent: **the deal board**, which is where the FLIP, the picks and the
whole culling argument live. Works floating at 30–60 % of their tiles aligned
top-left; three of twelve titles hard-clipped mid-word; two orphan hairlines; the
reject tray rendering as two 60-px grey ghosts in the left margin that read as an
artifact rather than a tray; and no agent sentence anywhere in frame. Against a
field of entries this is a competent dark grid with a layout bug.

The animation itself is real and well-measured — 16 to 28 distinct layouts across
fourteen board-to-board redeals where a jump cut is 4–5, on the product page, at
`prefers-reduced-motion` too. The motion is fine. The frame it moves in is not.

### 5. Is the WebMCP story real?

**Yes, and it is the most defensible part of the submission.** Tools are
registered through `document.modelContext.registerTool` per spec
(`registry.ts:271`, falling back to `provideContext`), 25 of them, with no flag
gating registration. `document.modelContext` on the deployed page exposes
`registerTool / unregisterTool / getTools` and nothing bespoke.

The parity claim holds for every tool in the loop: `flag_artworks` ↔ `P`/`X`/`U`,
`redeal` ↔ Enter, `compare_artworks` ↔ `C`, `set_view` ↔ the view buttons,
`set_exhibition` ↔ the editable title and statement, `write_labels` ↔ editing a
label in place, `annotate_atlas` ↔ naming a region.

**Four exceptions, and the submission must not overstate around them:**
`describe_artwork`, `search_by_exemplars`, `index_zip` and `index_folder` have no
human control. `search_by_exemplars` is the defensible one — Enter on an empty
bar is the human's route into the identical engine, so the *capability* is
shared even though the tool is not. `describe_artwork` is a genuine agent-only
path. Say "no agent-only path in the culling loop", not "no agent-only API".

One small correction to the e2e report while I am here: it advises harness
authors to *"wait on `tools().length > 0`"*. On the deployed build
`window.__paillette_webmcp.tools()` returns a **Promise**, so that predicate is
never true. Whoever writes the next harness will lose twenty minutes to it.

### 6. Is the interface too wordy?

**Yes, but less than iteration 1 and the worst offender is gone.** The activity
lane deleted "AGENT ACTIVITY", "● WEBMCP CONNECTED", "TOOL CALLS", "No tool calls
yet", the mini-board and the duplicated note, leaving a five-cell glyph `·····`
resting in the corner. That is exactly right and it is the best restraint
decision of the night. The note no longer appears twice; I checked the source
(`agentBoardNote` has one render site).

What is left, counted rather than asserted: **53 words above the fold** with a
query on screen, **84** cold.

Specific defects against §5b:

1. **"697 free searches left"** — chrome narrating the mechanism, in a pill, in
   the centre of the page.
2. **The query printed three times** — in the field, in the "Search · text ·
   warm landscape" chip, and in `30 / 30 works "warm landscape"`.
3. **The `P X U` hover chip.** Three letters in a bordered row floating over the
   card. That is a legend. §7.2 asks for a design that needs "no legend after the
   first second"; this one ships the legend permanently.
4. **Fourteen words of sort/view menu** on a page whose argument is that you cull
   with three keys. Masonry / Salon / Atlas / Table is four ways to arrange a
   grid, on a screen that is trying to say there is one board.
5. **Two contradicting counts** three inches apart ("11 works" / "12 / 12 works").
6. **An empty placeholder on the utterance bar.** This is the opposite failure
   and the brief names it: *"a bare icon nobody can read is its own failure."* A
   1-px underline with a 🎤 and a `↵` is cryptic, not terse.

Does the design need a legend? On the board, yes — it ships one. On the
exhibition page and in the compare room, no, and both are exemplary.

### 7. Does the whole loop work by typing alone, with voice off?

**Yes, and this is properly proven.** Four full runs with the harness asserting
`{"micPresent":true,"micPressed":"false","listening":false}` before it starts;
instructions typed character by character. My own two staging sessions were typed
only. `e2e2-voice.mjs` is 10/10 and separately shows a delivered transcript
sending the *identical* turn payload a typed instruction sends. No beat depends
on speech.

The honest caveat is well stated in the reports and I will not improve on it:
this box has no microphone and zero synthesis voices, so nothing about real
speech in or out is proven anywhere. And **push-to-talk on a machine with no
microphone enters the listening state and then silently does nothing** — no
error, no message. A judge on a locked-down laptop will read that as broken.

### 8. What is the single weakest thing a judge notices first?

The board they are looking at when the money shot happens: works floating in a
third of their tiles, three titles chopped mid-word, two hairlines drawn next to
nothing, and — 210 pixels above the top of the frame — the sentence that was
supposed to be the point.

### 9. Does the curation half actually work?

**Yes for re-labelling, no for re-selection and no for the title.** I ran it live
on staging rather than trusting the lane, because the lane's three by-hand runs
were on a dev server where, in its own report, *"the ranking is not real."*

Re-labelling: **6 of 6 kept works relabelled**, in 8 seconds, on one model call
plus one labels call, with the human's statement surviving verbatim as
`by: human, theirs: true`. The labels are contextual in the way §5c demands — not
adjective-swapping, but re-reading what the picture is *for*. Curation's isolated
A/B (`verify-contextual-labels.mjs`, same works, same call, two statements,
against the deployed route and the real model) corroborates it, and it exits
non-zero if the labels come back identical. This is not decorative. It is the
single best answer to the challenge's *"what can people and agents do together
that was difficult or impossible before"* that the project has.

But the loop as §5c writes it is three verbs — re-select, re-label, keep their
words — and only two happen. The board did not move. And the title still says
*Sea Change* above a statement about leaving, which on a shared page is the first
thing a reader sees. The lane knew about the title, wrote a prompt fix, and
recorded as its evidence an unreplaced `<!--TITLEVERIFY-->` placeholder. That is
a claim that outran the evidence and it is now measurably wrong.

Worse for the video: **the opening turn writes no labels at all**, so there is no
"before". The flagship 12-work share link the sharing lane publishes as evidence
(`/e/QWwJnL5`, "The Warm Side of Light") has **zero labels on twelve works** —
its own report admits *"the typed end-to-end run produced no wall labels."* The
feature is real and the product never shows you that it is.

### 10. Is there a shareable exhibition page?

**Yes — two of them, which is a problem.**

- `/exhibition?e=<blob>` — curation's, merged, deployed, the whole show packed
  into the URL with `CompressionStream`. ~2150 chars for twelve works. Nothing
  stored. Verified cold in a fresh context with zero localStorage reads, all
  images loaded from the Gallery's IIIF endpoint, malformed payloads 404.
- `/e/:code` — sharing's, D1-backed, 7-char codes, Open Graph tags, a crawler
  branch that serves Slackbot a 2.6 kB preview. **Unmerged, but live on staging
  because that lane deployed over the integration build.**

Both open cold and both are well designed — the best-looking surface in the
project. I opened `/e/exYNx8X` in a fresh context: 200, zero localStorage keys,
three images all `complete && naturalWidth > 0`, no failed requests, no
horizontal overflow at 390×844, a colophon that credits the National Gallery,
states CC0, and counts *"1 of 5 labels written by an agent"* from the data rather
than asserting it. A judge would be impressed.

The submission has to pick one and merge it, and the choice is not obvious:
curation's has no server dependency and cannot rot; sharing's unfurls in Slack
and survives long shows. Sharing's also has no delete, no expiry and no
moderation on anonymous published prose under this domain, which is a real
decision and not mine to make. What is not acceptable is shipping both, or
shipping the one that is on an unmerged branch and will vanish on the next
deploy.

### 11. What would make this win that nobody has built yet?

Three, in the order I would build them. All achievable tonight.

**A. Put the sentence inside the board.**

Not above it. *In* it — the wall label occupying one of the twelve slots, or
pinned to the top edge of the grid container so it travels with the grid and is
never more than one line from the cards. Then the FLIP carries it: the note
settles as the newcomers arrive.

This is not a layout tidy-up. It produces the image the entire submission is
missing and that no other entry can produce — one frame, twelve works, two picks
framed in graphite, two rejects sliding to the tray, and one serif sentence in
the agent's ink sitting among them saying *"you kept the ochre-and-brown oil
still life and rejected the deeper red-brown peach."* Two hands on one board, in
one photograph, with no chrome explaining it. Everything else in this critique is
repair; this is the thing that changes how it reads.

Cost: move one JSX block and give it a slot. Half an hour.

**B. The struck-through label.**

The correction turn demonstrably rewrites every label. Keep the old one and
render it once, struck through and dimmed, above the new one, in the ink of
whoever wrote it — the same dashed-proposal vocabulary the page already has for
unaccepted text. Then the ten seconds of video is: the human crosses out
"weather", types "leaving", presses Enter, and six labels visibly cross
themselves out and rewrite around the correction while the pictures stay put.

That is the challenge's fourth question answered in a single shot, and it is the
only moment in the build where a human's *prose* changes what the agent says
about *pictures*. It needs (a) the opening turn to write labels, which is a
prompt line, and (b) one previous-value field. An hour.

**C. A seeded demo URL, with no words.**

`/nga/search?demo=sofa` lands with a query already run, two works already
rejected and one already picked — deterministic, no model call, one route param
reading a fixed id list. A judge's first keystroke is Enter and the board deals
under their hands before they have read anything. It fixes "would a judge reach
the good part" without adding a single sentence of onboarding, which is exactly
the trade §5b asks for: fix the design rather than add the copy.

**And one thing to cut, not build.** Drop Masonry / Salon / Atlas / Table from
the toolbar once flags exist. Fourteen words of menu, offering four ways to
rearrange a grid, on the screen whose whole argument is that there is one board
and two people at it.

---

## What I am not calling blocking, but would fix

- **The compare choice does not send a turn.** It rides the next one. The
  integration lane left this deliberately to protect the model budget and said
  so; I agree with the call. But on camera a compare answered in silence needs
  the next utterance to make it visible, and the video should be cut knowing
  that.
- **The board runs out after five redeals in a tab.** Well diagnosed — the
  exemplar candidate pool is fixed at `topK × 6 ≈ 66` and the exclusion list
  grows, so 66 ÷ 12 ≈ 5.5. Reload between takes. The fix (grow the pool with the
  exclusion list) is small and wants a test.
- **`NoteSwatches` renders `data-flag` but not `data-flag-by`** — the one place
  the two-colour contract is dropped.
- **Provenance on the shared page is colour-only**, so a colour-blind reader
  cannot tell an agent label from a human one. Dashed vs solid would fix it.
- **`e2e-extras.mjs` has three assertions failing because the product moved.**
  Not defects; someone should retire them so a green run means something.
- **The 40-calls-per-hour anonymous ceiling.** `night/capfix` raises it to 600 on
  staging and is unmerged. Merge it before filming or three takes will exhaust
  the budget.

---

## What the reports got right, and it is worth saying

These are unusually honest documents. Three separate lanes caught their own false
positives before I could: the e2e lane disposed of its own run-2 "finding" by
building two more harnesses to disagree with the first and left the wrong output
committed; the curation lane found that its own success criterion was vacuous and
had been printing 3/3 for a batch that was 1/3; the integration lane refused an
instruction to reset-and-re-merge because it would have destroyed ten commits,
and showed the `git log` that proved it. The e2e report's "what a person filming
has to know, or the take is wasted" section is the most useful page in the repo.

The failure below is not a failure of rigour. It is that all that rigour was
pointed at whether the mechanism works, and nobody stood back and looked at the
screen.
