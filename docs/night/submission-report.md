# Submission lane — report

What I wrote, which claims rest on whose attestation, and — the part that matters
most — **every claim I wanted to make and could not**, so the owner can decide
whether to shoot it, build it, or drop it.

**This lane writes. It does not build.** Nothing outside `docs/` was edited. The
only things run against the product were `pnpm --filter web test` and
`pnpm --filter api test`, and the only things read were the source, the reports,
and the committed frames.

---

## 1. What shipped

| | |
| --- | --- |
| `docs/webmcp-vo-script-v2.md` | **Revised.** Eight beats, ≈2:52, 259 spoken words. Per beat: what is on screen, the exact page and input, whether the shot is possible today, and the evidence tier of every claim. §4 is the one defect the film has to be composed around. |
| `docs/webmcp-devpost-v2.md` | **Revised.** The four judged questions in prose. Q3 leads with the two-operator argument and the gestures-outrank-words behaviour. Q4 carries the real tool names and argument shapes, read out of `tools.ts` rather than out of a report. |
| `docs/night/shot-list.md` | **Revised.** 22 shots plus three in reserve, in order, each with what is on screen, what is said, the page and query that reproduces it, whether it can be captured headlessly, whether a frame exists, and what it costs in model calls. Plus a *Do not film* table and a ten-item pre-flight. |
| `docs/night/submission-report.md` | This file. |
| `docs/night/shots/crit5/` | **New here.** The said/chose frames, the cold root, the share page, and the x4 exhibition JSON — the critique shot them into a scratch directory that the daily `rucksack storage gc` deletes after three days idle. Committed with the probe that produced them. |

Also brought across, unchanged, from `night/submission-draft`, which was never
merged into this branch: the draft lane's four documents and its evidence
(`submission-evidence.md`, `submission-draft-report.md`, `verify-demo-path.mjs`,
`shots/5*.png`, the note-swatch JSON). They arrived in commit `077a3cc` so that
`0db963f`'s diff is the revision and not the arrival.

`docs/webmcp-vo-script-final.md` and `docs/webmcp-devpost-fields.md` are untouched
and superseded. Do not merge them.

---

## 2. Checks I ran myself

I touched no source, so these are a regression check on the merged tree rather
than on my own work.

| | Brief's baseline | This tree, this session |
| --- | --- | --- |
| `pnpm --filter web test` | 59 files / 593 tests | **97 files / 1204 tests, all pass** |
| `pnpm --filter api test` | 41 files / 770 tests | **46 files / 857 tests, all pass** |

The api figure matches the integration lane's iteration-5 number exactly; its
web figure appears as both 1203 and 1204 in different sections of that report, so
1204 here is my own run rather than a quotation. The `api` run prints `INTERNAL_TEXT_SEARCH_SENTINEL` and `NGA quota storage
unavailable` to stderr; those are the tests' own stubbed failures being
exercised, and they appear on a passing run.

**Read in code, not taken from a report:**

- `PAILLETTE_TOOL_NAMES` in `apps/web/app/lib/webmcp/tools.ts` — **25 names**,
  listed in the Devpost. `PAILLETTE_TOOL_COUNT` derives the number in one place.
- The argument schemas for `flag_artworks`, `search_by_exemplars`, `redeal` and
  `compare_artworks`, quoted into the Devpost from the file rather than from the
  shared-state report.
- The Rocchio formula and its weights, from `search_by_exemplars`'s own
  description: `cos(x, mean(positives)) − 0.5 · max(cos(x, each negative))`, with
  0.8 for `tighten` and 0.25 for `widen`.
- **Enter and the `redeal` tool are literally the same function.**
  `submitHumanTurn` (`lib/webmcp/turn.ts:278`) and the `redeal` tool
  (`tools.ts:1645`) both call `runRedeal` from `lib/webmcp/redeal.ts`. This was
  the strongest thing I could add to the "two operators" claim, and it is one
  import rather than a design intention.
- The 56 px collapse, in the component: `deal-board.tsx` renders
  `header ? <div className="mb-3 shrink-0 empty:hidden">`. The deterministic
  redeal passes no note, so the wrapper is not rendered at all.
- The screen-reader string at `galleries.$galleryId.search.tsx:3025`, the
  read-aloud label at `:4962`, `aria-label="Agent activity"` at
  `agent-activity-panel.tsx:608`.
- **`agent-drive.mjs` does not exist** anywhere in this repo, under any path. The
  brief and `docs/HANDOFF.md` §7 both give it as the capture command. The real
  harness is `scripts/demo/capture.mjs <url> "<instruction>"`.

**Frames I opened and checked against the sentence describing them**, because
two consecutive verdicts caught that claim being wrong:

| Frame | What is actually in it |
| --- | --- |
| `e2e5-02-board-and-note.png` | The agent's cyan label and **all twelve cards**. **No human utterance in frame.** The critique's blocking item 5 is correct. |
| `e2e5-13-note-inside-board-before-redeal.png` | The human's graphite sentence, the agent's cyan label behind a cyan rule, and the board. **8 cards whole, 12 in frame.** This is the two-inks frame, and the report should have named this one. |
| `e2e5-14-note-gone-after-redeal.png` | Twelve works, the reject tray at the left margin with two desaturated cards, one frame-lit pick wearing its `P X U` badges — and no words anywhere. The defect, photographed. |
| `crit5/c2-gapnote.png` | The said/chose label, three swatch strips, **twelve cards at 1440×900**, the three picks holding slots 0–2 with graphite frames, and the newcomers all amber. No human utterance in frame. |
| `e2e5-06-two-up-room.png` | Two works on one centre line, catalogue lines in mono, the question in serif above, `NEITHER` at the foot, full-bleed. Nothing else. |
| `crit5/share-MKwsxHy.png` | Serif title, the human's statement, six works full-scale with side labels, generous negative space, colophon at the foot. |

---

## 3. What rests on whose attestation

Every load-bearing claim in the three documents, and where it comes from. Where
two lanes disagreed, the newer one won, and I say which.

| Claim in the pack | Attested by |
| --- | --- |
| Enter on an empty bar makes zero model calls; one vector search 8–29 ms after the key | **e2e lane, iteration 5** — four silence-gated runs. Independently reproduced by the **critique** at +29 ms. Corroborated by iteration 2's 27 redeals across five harnesses. |
| The board deals rather than cuts — 15 to 27 distinct layouts | **e2e lane**, iterations 2–5, consistent across four iterations. |
| The agent's note names the content of what was rejected | **e2e lane, iteration 5** — 3 of 3 with no wrong word, medium and palette checked per work. Iteration 4 was 3 of 3 with one medium misdescribed; iteration 3 was 0 of 5. Improving, and I quote the iteration-5 run. |
| The said/chose gap — *"You said blue, but picked three amber-brown sunset drawings and paintings"* | **Critique, iteration 5 §2** only. Two runs, cold, typed. No other lane tested it. |
| 25 tools on `document.modelContext`, on every visit, no flag | **Code**, read this session; **e2e** saw 25 on 20 of 20 cold loads; `registry.test.ts` enforces it. |
| The activity glyph, its six motions, the tool-surface panel and the log row format | **Activity lane** — 43/43 + 53/53 + 32/32 checks across three runs, both themes, both viewports. |
| Provenance ink: human solid `box-shadow`, agent dashed `outline` | **Visuals lane** (23 browser assertions against the compiled stylesheet) and the **draft lane** (computed styles, not asserted). |
| Keyboard-only flagging, ARIA names, the screen-reader status line | **Draft lane**, first-hand. No committed frame — this beat has to be shot. |
| The two-up opens as a room, full-bleed, zero model calls; Escape leaves without answering | **e2e lane** (geometry, `compareChoice` read off an intercepted turn body) and **integration lane** (`4e79c6c`). |
| The label is contextual — 3 of 3 different under two statements | **Curation lane** (`verify-contextual-labels.mjs`), re-checked and explicitly endorsed by the **critique**, which says this one is real and should not be re-litigated. |
| The human's statement comes back `by: "human", theirs: true` | **Curation lane**, and the **critique** confirmed it on the wire on today's deploy, in every run including the failures. |
| `/e/MKwsxHy` opens cold, server-rendered, 0 localStorage reads, real Open Graph | **Sharing lane** (24/24 cold opens, 30/30 crawler unfurls) and the **critique**, which opened all seven published codes in fresh contexts. |
| The loop survives the model route hard-refusing 429, and no WebMCP host at all | **Integration lane** (`verify-agentless-loop.mjs`, 9 checks × 3) and **e2e**. |
| The 56 px collapse, and its cause | **e2e lane** (arithmetic, grid-relative measurement), **critique** (3/3, on-screen travel), and **my own reading of `deal-board.tsx`**. |
| 63,253 works | **`docs/HANDOFF.md`.** Paged to the last record, rendered live on `/about`. **Not re-derived tonight by anybody**, including me. |

**Where a report and the handoff disagreed, the report won.** `HANDOFF.md` §6
still frames the film around uploading and indexing and asks for "co-creator";
both are superseded by the brief and by this pack.

---

## 4. Every claim I wanted to make and could not

This is the list to act on. Ordered by how much the submission loses.

### 4.1 "The agent disagrees with you, and marks the board." — **cannot claim**

The line I most wanted, and the brief's §P1 promises it: *"the agent flags so it
can disagree in the same currency the human uses"*, and §7.2 promises *"every
screenshot shows two hands."*

Across **508 model-chosen tool calls** in every transcript the night produced,
the model chose `flag_artworks` **0** times and `compare_artworks` **0** times.
The natural things a person types after flagging — *"Narrow these down for me — I
can only hang one."*, *"I'm torn. Help me decide."* — produced a sentence and no
marks. Every demonstration of an agent flag in every report, including the
integration lane's own two-hands frame, was driven through
`window.__paillette_webmcp.call`.

**So there is no frame in which both operators have marked one board**, and the
film does not claim one. What I could keep, because it is verified: asked
almost verbatim — *"mark the ones on this board you would throw out"* — it
produced six provisional rejects in dashed agent ink. The Devpost says exactly
that, including the dent.

- **Shoot it?** Only if the prompt changes first; otherwise a take is a coin toss.
- **Build it?** Yes, and it is small. Make a proposal the required shape of a turn
  where the human has flagged, rather than an optional register — and fund it,
  because `MAX_TURNS` is 8 and five or six get spent searching.
- **Drop it?** It is dropped from the film today. It is the single change that
  would most improve the submission's most distinctive claim.

### 4.2 "Two colours of ink in every state." — **cannot claim**

§9's fifth bullet. It fails at the exact moment the film wants it: the human's
Enter deletes the agent's sentence, and the board ends the headline beat with one
ink on it. Two consecutive iterations reported it unfixed.

There is a second half nobody should be surprised by later: the human's echoed
sentence is a bare `<span>` at `rgb(212,212,212)` with **no `data-provenance`
attribute**, so the only provenance values in the DOM on a dealt board are `none`
and `agent`. Any harness asserting two inks via `[data-provenance]` returns a
false negative, and any future claim built on that attribute is built on sand.

- **Build it.** `redeal` already carries `note?: string`. Have the deterministic
  path write its own one-line label with no model call. It removes the 56 px, it
  keeps a wall label on the board at the headline beat, and it turns the defect
  into the clearest proof in the submission that the board still speaks with the
  model switched off. **This is the highest-value change available to this film.**

### 4.3 "Press Enter and the picks visibly stay put." — **claimed, but only of the second Enter**

The brief asked the cold open to carry *"a redeal where the picks visibly stay
put."* Inside the grid the pick genuinely does not move — `planDeal` pins a held
id to the index it already had, so the layout delta is zero. On screen it moves
56 px, because the row above it collapses.

I did not soften this. The shot list specifies the second consecutive Enter,
where no label exists before or after and nothing collapses. **That is an honest
take of real behaviour, and it is also a take chosen around a defect**, and the
owner should know that is what it is rather than discovering it in the edit.

### 4.4 "You correct the statement and it re-selects the show around it." — **cut**

The draft claimed *"18 of 18 labels rewritten"* and *"3 of 3 runs"*. Both are
true of a lane that finished before the 14:33 api redeploy. Run by hand four
times on the build a judge would open: one produced nothing in 150 s; one changed
0 works and left weather labels sitting under a wall text reading *"It is not
about weather"*; one changed 0 labels in 180 s; one worked completely. **1 of 4.**

Worse, the run that worked ended blank. `crit5/show-x4-after.json`, committed on
this branch, reads `"unlabelled": 6` — the six newly-selected works all carry
`"label": null, "labelBy": null`. The re-selection and the re-labelling are two
tool calls, and the second only covers works that were already there.

- **Build it.** Two small things: raise the turn ceiling on the exhibition path
  only, and refuse to publish a share code while `get_exhibition` reports
  `unlabelled > 0` — the count is already returned, so the check is free.
- **What survives, and is in the pack:** the label is written *against* the
  statement (3 of 3 substantively different under two statements, endorsed by the
  critique), and the human's sentence comes back `theirs: true`. Those are the
  interesting halves and they are solid.

### 4.5 "A shareable exhibition where every label was written around your correction." — **cut**

Four of seven published shows carry **no wall labels at all**, and the two
twelve-work ones — the two that look most like real exhibitions — are exactly the
two that are blank. The shot list names `MKwsxHy` and forbids the others.

Re-publish `HcLSkLr` and `QWwJnL5` with labels, or leave them; either way the
film points at the one page where the claim is visible.

### 4.6 Anything spoken. — **cannot claim**

Push-to-talk, the 1.2 s grace bar, the deictic chips, the note being spoken back
only after a spoken turn. All built, all tested against a fake recogniser, **none
of it has met a microphone**. The live-voice lane says so in its own summary.
Headless Chromium cannot do real speech recognition — Chrome ships the audio to
Google — and this VM reports **zero synthesis voices**.

The script requires none of it. Every beat is typed or keyed, and that is the
point of §5b rather than a consolation. If a spoken take is filmed on a real
machine it is a bonus insert, not a rescue.

### 4.7 "Read it aloud." — **cannot claim**

`SpeakButton` is real, feature-detected, needs no agent and no account. But it
renders only where a work has a stored caption, and a cold NGA work opened during
the run offered `["Laurent de La Hyre", "Public metadata", "Copy"]` and no
read-aloud control. **No audio has ever been produced from this build by
anybody.**

I removed it from the spine and — this is the useful part — **rebuilt the end card
so it no longer depends on it.** *"And everything you can't see"* now rests on the
keyboard and screen-reader beat, which is proven first-hand. The draft's version
would have forced a cut on the day.

### 4.8 "The agent sees the pictures." — **cut, and it is worth understanding why**

It sees four indexed hex swatches, a medium, a year and a classification.
`lookup_artwork` and `describe_artwork` were called **zero** times across every
recorded run. The narration is grounded in the record, not in the image, and the
swatch strips under the note exist precisely so that is checkable. Related: most
wall labels are written `source: "catalogue"` rather than `source: "caption"`.

Both documents say what the agent is handed, in full, rather than implying
vision.

### 4.9 "There is no agent-only API." — **narrowed to "the loop has no agent-only path"**

`write_labels` and `annotate_atlas` have no human control. A human can edit any
label by hand; they cannot ask for six at once, or name a region of the atlas.
The narrower sentence is checkable, so it is the one in the film.

### 4.10 The claims I never got to make at all

Short, so they can be triaged quickly.

| Wanted | Why not |
| --- | --- |
| The ledger filmstrip — *"version history reused as conversation record"*, §7.5 | Built and tested, imported only by `/night/deal`. Not on the product page. Cannot be filmed as a feature. |
| *"One field, two inputs — there is nothing to switch"*, §5 | There are **two live text fields** on a cold page, and the prominent one is the ordinary catalogue search. A judge types into the big one and gets a search results page. Unchanged across two iterations. |
| Enter-on-an-empty-bar as something a judge discovers | The `↵` hairline is the only affordance and it appears after the first flag. The critique's view is that a judge will not find it. Not a copy problem — a design one. |
| A rate for the note behaviour ("it works N% of the time") | Three runs is not a rate. The pack says *3 of 3, with no wrong word*, which is what happened. |
| A social unfurl card | Tags and image fetched and real; nothing ever pasted into a real client. |
| The compare room as something the agent initiates | 0 of 508. Reachable by pressing `C`, and by asking almost verbatim. In reserve, described as the human's key. |
| Flags surviving a reload | Page-session state by design. They survive a new search in the same tab, which is the useful half and is claimed. |
| *"The works are the only saturated thing on screen"*, §7 | Measured on a dealt board: image 15,670 px² against caption 18,961 px² — the caption block is larger than the picture on **every** card, and the artist name is a blue underlined link. The film can frame around it; the claim cannot be made. |
| `prefers-reduced-motion` in general | Spot-checked only with a pick in slot 0. |
| Re-deriving 63,253 | Taken from `HANDOFF.md`, not re-counted tonight. It is the one number in the pack nobody checked this run. |

---

## 5. Decisions I made, since the brief said to make the call

1. **The film is eight beats, not the brief's implied ten.** Co-curator became the
   opening clause of the end card rather than its own beat, and the note-swatch
   beat merged into the cold open. The freed time went to the deterministic beat,
   which the brief said to give room and which is now the longest at 32 s.
2. **The cold open is the sofa loop; the said/chose is beat 3.** Both were
   candidates for the opening. The verdict's `strongest` field argues for opening
   on said/chose; the brief's cold-open specification argues for the loop. Keeping
   them separate means two different proven behaviours instead of one shown twice,
   and it means the cold open is not exposed to the 56 px collapse — its redeal is
   the agent's, with a note on screen before and after. **⚠ That last point is an
   inference from the code, not a measurement. Check it in the first take.**
3. **There is an exhibition beat, at 24 s.** The brief's beat list for the script
   omits §5c entirely. I kept it, scoped hard, because it is the only artifact
   that survives the tab and it is the answer to "and then what do you have". If
   the owner disagrees, cutting S13–S16 costs 24 s and no claim.
4. **The read-aloud shot is out of the spine and the end card is unconditional.**
5. **Recommended, not chosen for you:** *"I didn't search for a single one of
   these. I described a room."* for the co-curator line, and *"For everything you
   can't name. And everything you can't see."* for the ending. Both are argued in
   `webmcp-vo-script-v2.md` §3, with alternatives and the reasons the rejected
   ones stay rejected.
6. **Every URL in the pack points at `/nga/search` directly**, because
   `https://paillette-stg.berlayar.ai` is a marketing page on which the string
   `/nga/search` appears in no link.

---

## 6. If one thing gets fixed before filming

Make the deterministic redeal write its own one-line wall label, with no model
call. `redeal`'s schema already carries `note?: string`.

It removes the 56 px jump on the beat the whole submission is built on. It keeps
a wall label on the board at the exact moment the model is switched off, which
says the thing better than the voiceover does. It turns the weakest item in the
verdict into a proof. And it takes the shot list's most awkward instruction —
*film the second Enter, not the first* — off the page.

If a second thing gets fixed: make an agent proposal the required shape of a turn
where the human has flagged. That is the one change that would let the film say
what §P1 promises and the pack currently cannot.
