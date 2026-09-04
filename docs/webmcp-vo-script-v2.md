# Paillette — WebMCP demo voiceover, v2

Runtime **≈2:58**. **280 spoken words** across ten beats — 1:52 of speech at
~150 wpm, so a third of the film is silence. The pictures carry the rest.

`docs/webmcp-vo-script-final.md` is left in place, unedited, so the two can be
compared. **Do not merge them.**

## What changed from v1, and why

| v1 | v2 | Why |
| --- | --- | --- |
| Opens on upload and indexing (cues 2–4) | Opens on a typed instruction and a board | Indexing is throat-clearing. Nothing in it is unique to WebMCP. |
| Master line *"Let AI be your eyes and ears"* | Cut as a master line | It makes the human passive. The human is the one with taste; the agent supplies the words. Read-aloud survives as beat 8. |
| Cue 7 *"The true power of Paillette is unleashed when we run it over an entire collection"* | Cut | Scale makes it useful. The shared loop makes it new. The number now lands once, in passing, in beat 4. |
| "co-creator" | **co-curator** | The works already exist. What is co-created is the curation. |
| Board is the end of the interaction | Board is the middle | The rejects, the redeal, the statement correction and the share link are all after it. |
| Ends on a roadmap (*"Next, we make the whole thing a conversation"*) | Ends by closing the opening premise | The film opens on "most art is never seen". |
| "seventeen tools" | **25**, verified live | It has been wrong twice. See §Evidence. |

**Revised after e2e iteration 2.** The build moved under the first draft. Beat 1's
timing, beat 2's card count, beat 3's entire evidence base and beat 4's proof
strength all changed — the corrections are listed in
`docs/night/submission-draft-report.md` §5.

## Reading the tiers

Every beat carries the tier of its claims.

- **[P] PROVEN** — a report, a transcript or a live measurement attests to it.
- **[B] BUILT, UNVERIFIED** — the code exists; nothing has demonstrated it end
  to end. **The shot may not exist.** Do not cut the film assuming it does.

Full mapping in `docs/night/submission-evidence.md`. Shot-by-shot capture notes
in `docs/night/shot-list.md`.

---

# 1. The voiceover — paste this

**0:00 · Cold open**

> Most art is never seen. Not because it's hidden — because nobody knows what to
> ask for.
>
> So I don't ask. I say what the room needs.

**0:12 · Two rejects**

> A board comes back. Two of them are wrong, and I can't tell you why.
>
> So I don't. I throw them out and press Enter.

**0:30 · The agent says what you did**

> I never used those words.
>
> It read the palettes it was handed. The swatches under the sentence are the
> ones it read.
>
> Flip the flags on the same work —
>
> — and it changes sides.

**0:52 · Enter on an empty bar**

> Now watch the bar. It's empty.
>
> Same twelve. Same picks. Same slots. And not one call to a model.
>
> Sixty-three thousand works, and the loop that moves through them is three
> keys.

**1:12 · The show**

> Keep going and there's a show on the table. A title, and a statement.
>
> The statement is wrong. It isn't about weather.
>
> It re-selects. It writes a label under every work, against my sentence. And it
> doesn't touch my sentence.

**1:50 · It leaves the tab**

> And it leaves.
>
> A real URL. Six works, the labels, my words. And a line saying how many an
> agent wrote.

**2:06 · Co-curator**

> So the agent becomes a co-curator. I didn't search for a single one of these.
> I described a room.

**2:18 · Without looking**

> None of that needed a mouse. Tab to a work and the control says its name and
> its key. Ask for a description and the browser reads it aloud — no agent, no
> account.
>
> Someone who can't see the pictures is still the one choosing.

**2:34 · WebMCP, on screen**

> How it's built is on the page. Five dots until a tool runs.
>
> Twenty-five tools on `document.modelContext`, with their arguments and their
> timings.
>
> `flag_artworks` is P and X. `redeal` is Enter. `compare_artworks` is C.
>
> One workspace. Two operators.

**2:50 · End card**

> *[silent]*

---

# 2. Beat by beat

## Beat 1 — Cold open · 0:00–0:12

**On screen.** `/nga/search`, cold, no query. The sentence typing into the
utterance bar. Then a board arriving.

**Card (0:00, 2s):** `Most art is never seen.`

**Shot.** `https://paillette-stg.berlayar.ai/nga/search`. Click the utterance
bar (`[aria-label="Ask the agent"]`), type verbatim:

> `I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.`

Enter. **No `?webmcp-debug`.** No microphone.

**Claims.**

| Claim | Tier | Source |
| --- | --- | --- |
| The utterance bar is on the page with no query flag | **[P]** | Live, deployed, 2026-09-04: `barCount: 2` (section + input), `debugDriver: false`. Fix log §10. |
| A typed instruction alone fires the agent | **[P]** | e2e-report §2.1; voice-loop-report. Three runs, three model calls each, 0 page errors. |
| The agent runs several searches and merges them onto one board | **[P]** | `capture-beats.json`: `search_by_color` ×2, `search_artworks` ×2, then `set_results` with 12 works. |
| The board that arrives is the deal board, not salon | **[P]** | e2e iteration 2 §3 step 4 — `view=deal-board` on **all four runs**, with the human's pick still on it. `dealtBoard` is the first branch in `ResultsLayout`; salon, atlas, table and masonry were each called against a dealt board and the grid survived all four. |

**⚠ Timing.** A cold agentic instruction takes **42–59 s** from Enter to a
board, measured across four runs (e2e iteration 2). This is the slowest shot in
the film. Cut it.

**⚠ The agent's first board is not always twelve** — 8, 12, 10, 12 across four
runs of the same instruction. Twelve is a property of Enter, not of the agent's
first board. That is why the VO says *"a board comes back"* here and saves the
number for beat 4.

---

## Beat 2 — Two rejects, and Enter · 0:12–0:30

**On screen.** Hover, `X`. Hover, `X`. Then Enter. The two rejects slide left
into the tray; the picks do not move; newcomers arrive from the right.

**Shot.** Hover each card, press the key. Press Enter with nothing focused.
Film the **second** redeal, not the first.

**Claims.**

| Claim | Tier | Source |
| --- | --- | --- |
| `P`/`X`/`U` flag the hovered card, in the human's ink | **[P]** | Live, first-hand: `{"f":"reject"}` ×2, `{"f":"pick"}`, `data-flag-by="human"`. e2e-report §2.2. |
| Flagging fires no model call | **[P]** | e2e-report §2.2: "3 requests during flagging, none to the agent route". |
| Picks hold their exact slot across a redeal | **[P]** | Integration report iter 2: `220,144 → 220,144` and `500,144 → 500,144`, **zero pixels**. e2e §1.2: `{"page":{"dx":0,"dy":0},"board":{"dx":0,"dy":0}}`. |
| The board deals rather than cuts | **[P]** | **Fourteen board-to-board redeals measured on `/nga/search`: 16 19 21 22 22 22 24 24 24 25 25 27 28 28** distinct layouts (e2e iteration 2 §3 step 6). A jump cut measures 4–5, so the worst is more than three times a cut. |
| Twelve cards, all on screen | **[P]** | Live, first-hand at 1440×1000: `{"cards":12,"fullyVisible":12,"gridHeight":724}`. e2e iteration 2 at 1440×900: `{"count":12,"gridHeight":650,"fullyVisibleAtBestScroll":12,"tray":2}`. |
| Rejects go to a visible tray and stay restorable | **[P]** | Live, first-hand: `.lt-tray` present, 2 items, after both redeals. Fix log §8. |

**⚠ The first redeal after a text search is a cut, not a deal** — measured at
3, 4, 4, 6, 12, 14 and 18 layouts against the second's 16–28. It is a masonry
becoming a board and there is no slot to hold. **Film the second.**

**⚠ The board runs out after about five redeals in one tab.** The fifth Enter is
the last full board; the sixth comes back short; by the seventh the board is one
card and Enter is a dead key. Reproduced on two queries. The cause is arithmetic
in the exemplar route — a fixed candidate pool of ~66 minus 12 struck out per
round — not the collection running out of art. **Reload between takes.** A fresh
page resets it. (e2e iteration 2 §4.)

---

## Beat 3 — The agent says what you did · 0:30–0:52

**This is the beat. Everything else is context for it.**

**On screen.** The note, in serif, as a wall label above the board, in the
agent's ink. Under it, the swatch strips — one per flagged work, picks whole,
rejects struck through, no words. Then the same work with its flag flipped.

**Card A — the note, held.** Two frames exist, and beat 3 should use the wide
one: `docs/night/shots/54-note-and-board-1440x900.png` has the sentence, its
swatches **and the board it describes** in one shot;
`50-note-with-swatches.png` is the tight crop if the cut needs it.

> *You said warm; you kept the bone-and-umber etching and rejected the darker,
> greener palettes — following the picks.*

Under it, three strips. The pick's first two swatches are `#EBD8BC` and
`#695943` — bone, and umber. The second reject's first swatch is `#47502B`, a
dark olive. **The sentence is checkable against the picture directly under it,
which is the whole reason the strips are there.**

**Card B — the same work, the other way round.** Berthe Morisot's *Landscape*,
`open-access-art:nga:52306`, colored pencils, palette `#D4C7A2 #B6A385 #9A886C`.
Picked in one run, rejected in the next:

> *picked* — "You kept the pale ochre pencil landscape and rejected the darker
> peach palette — following its quiet, airy warmth."
>
> *rejected* — "Following your warm oil-on-wood fruit pick and moving away from
> the pale colored-pencil landscape you rejected."

Same work. Same palette. It describes it the same way and moves it to the other
side of the sentence.

**Shot.** Card A: `/nga/search?q=warm landscape`, hover-`X`, hover-`X`,
hover-`P`, then type `something warm for above the sofa` and Enter. **3 model
calls.** Then set the scroll once — the wall label to y≈114, clear of the 159 px
of sticky chrome — and **hold it**. Do not scroll during this beat; one frame
carries both halves and scrolling is what loses the sentence. Card B: the two notes are archived in
`docs/night/e2e-evidence/iteration-2/run3-loop.json` and `run4-loop.json` —
**the frames do not exist and must be shot.**

**Claims.**

| Claim | Tier | Source |
| --- | --- | --- |
| Card A's note, verbatim, with its swatches in one frame | **[P]** | Captured tonight: `shots/50-note-with-swatches.png`, `51-…-in-context.png`, raw in `e2e-evidence/note-swatches.json`. 3 model calls, 0 page errors. |
| The swatch colours match the words | **[P]** | `note-swatches.json` → pick `A Rocky Pond` `rgb(235,216,188)`, `rgb(105,89,73)`; reject `Flying Shadows` `rgb(71,80,43)`. Against "bone-and-umber" and "greener". |
| The same work described consistently and flagged both ways | **[P]** | `run3-loop.json` / `run4-loop.json`, `open-access-art:nga:52306` at `"to":"pick"` then `"to":"reject"`. |
| Four for four name the content of what was rejected; three of four name the reject specifically enough to recognise on screen | **[P]** | e2e iteration 2 §3 step 4, four runs, all verbatim. |
| Every flagged work reaches the agent with palette, medium, year, classification | **[P]** | `run1-loop.json` flagsDelta: `{"title":"A Peach, Seville (George Henry Hall)","palette":["#C3803A","#7E3F0F","#6C443C"],"medium":"oil on canvas","year":1866,…}` |
| The note is one sentence | **[P]** | Every recorded note, in every harness. |

**On the claim that this frame is impossible.** The iteration-2 critique fails
the submission on *"the agent's note and the board it describes cannot be on
screen together at any scroll position"*, deriving a 1464 px requirement for a
900 px viewport. **The stack starts at y=479, so it needs 985 px.** Measured on
the deployed build: at 1440 × 900 the label sits at y=114 with **8 of 12 cards
fully visible and all 12 at least partly**; at a 1400 px-tall viewport, **12 of
12 fully**. The frame is committed. What is genuinely in the way is 291 px
between the sentence and the board, 61 px of which is two **empty** form fields
— the exhibition title and statement, rendered before anyone has curated
anything. See `docs/night/submission-draft-report.md` §2.4.

**⚠ Four things the owner must know before this beat is cut.**

1. **The swatch strips do not carry `data-flag-by`.** They show *that* a work was
   flagged, not *by which hand* — the one place on the page where the
   two-colour contract is not carried (e2e iteration 2 §7.1). Nobody will notice
   in the film; it is a real gap in the design.
2. **A weak note is possible.** Run 1 of four gave "darker, crowded scenes" —
   accurate, but it names no subject and reads generic on camera. **If you get
   one of those, shoot it again.**
3. **Card B has no frame.** The inversion is archived as text only. Shooting it
   costs two agent turns and needs the same work on the board twice.
4. **The negative-control pair the earlier draft used is retired.** Its Run A JSON
   was overwritten before archiving and the notes survive only as a console
   transcript in `fix-log.md` §2. Everything above is committed JSON. Do not go
   back to it.

---

## Beat 4 — Enter on an empty bar · 0:52–1:12

**On screen.** The bar, empty, with the `↵` hairline under it. Enter. The board
redeals. Then a cut to the network log — four lines.

**Card:** the log, verbatim.

```
GET   /api/public-search/nga/quota
POST  /api/public-search/nga/text
POST  /api/public-search/nga/exemplars   ← Enter #1
POST  /api/public-search/nga/exemplars   ← Enter #2
```

**Shot.** Same page, activity glyph closed. Press Enter with the caret in the
empty bar, or with nothing focused — both work. `node
scripts/demo/e2e-deterministic.mjs https://paillette-stg.berlayar.ai` regenerates
the log.

**Claims.**

| Claim | Tier | Source |
| --- | --- | --- |
| Enter on an empty bar makes **zero** model calls | **[P]** | **27 separate redeals across five harnesses, each with its own negative check, zero POSTs to `/api/public-agent/turn`** — counted off the wire by a request listener, not asserted (e2e iteration 2). Plus live first-hand, twice. Each redeal made exactly one call, to the deterministic Rocchio engine. |
| The whole deterministic run is four requests | **[P]** | `iteration-2/deterministic-network.json`, verbatim above — identical shape to iteration 1's. Live re-run today: the same four plus one `/api/public-usage/nga` beacon. |
| It keeps working as the board empties | **[P]** | e2e iteration 2 §4, 18 rounds across two queries: **zero rejects ever appeared on the board, the rendered board matched `board.order` every time, the pick was held every time, zero model calls.** |
| It works with no WebMCP host at all | **[P]** | e2e §3: `no prompt bar without a host: count=0`; `Enter on the bare board redeals, with no agent anywhere`. Shot `e2e-17`. |
| It works with the agent route hard-refusing 429 | **[P]** | `verify-agentless-loop.mjs` — 9 checks, three times in a row (critique §1). |
| The `↵` hairline appears the moment the first flag is confirmed | **[P]** | Live, first-hand: `.lt-enter-armed` absent before the flag, `"↵"` after. |
| 63,253 works | **[P]** | `docs/HANDOFF.md` — paged `/api/public-search/nga/browse` to the last record. Rendered live on `/about`. Not re-derived tonight. |

**Say the negative out loud.** It is the only claim in the submission asserted
negatively and it is what makes "two operators, one mechanism" true rather than
rhetorical.

---

## Beat 5 — The show, and the correction · 1:12–1:50

**On screen.** Title and statement above the board, in serif — **and no labels
yet**. The human selects the statement, types over it, commits. The board
changes. The labels *arrive*. The statement does not move.

**Cards:** the statement before and after, then one label before and after.

> **Before** — *The river carries the last light of the day beneath a setting
> sun. Painted in oil on wood, the scene closes the hanging order with weather
> and illumination settling toward evening.*
>
> **After** — *The river carries the eye through an unpeopled stretch of shore,
> where no boat or figure interrupts the water's course. At day's end, the scene
> reads as a place left behind rather than a view awaiting activity.*

**Shot.** `node scripts/demo/e2e-curation.mjs https://paillette-stg.berlayar.ai`
drives it the way a person does: click the paragraph, select all, type, commit
with Ctrl+Enter. The correction used in the recorded walk:

> `It is not about weather. It is about leaving: places with the people already gone.`

**Claims.**

| Claim | Tier | Source |
| --- | --- | --- |
| The agent drafts a title and a statement | **[P]** | Curation walk on the deployed build, **11 of 11 pass** (fix log §5). |
| ⚠ **The opening turn writes no labels** | **[P], and it corrects an earlier draft of this file** | Iteration-2 critique, measured on staging: `label: null` and `labelBy: null` on all six works, zero POSTs to `/api/public-labels`. Confirmed independently — the sharing lane's flagship link `/e/QWwJnL5` has **12 works and 12 catalogue blocks with no wall label on any of them**. The labels come with the *correction*, which is a better beat and is what the VO now says. |
| Committing the statement is itself a turn | **[P]** | Fix log §7. Verified on staging: **2 POSTs to `/public-agent/turn` after the edit.** Before the fix, nothing called `submitHumanTurn` at all. |
| It re-selects and rewrites every label against the correction | **[P]** | Fix log §7: **18 of 18 labels rewritten.** Curation report Batch 2: 3 of 3 runs. `curation-walk.json` holds both label sets verbatim. |
| It does not overwrite the human's sentence | **[P]** | Fix log §7. Curation report: the statement comes back `by: "human", theirs: true` in every run; an agent write onto it is parked under `deferred`. |
| The same work gets a different label under a different statement | **[P]** | `labels-ab.json` — same six works, two statements, live model. **0 of 6 byte-identical**, and not paraphrases. Pair above is verbatim. |

**⚠ Honesty about where the labels come from.** All twelve labels in the A/B
were written `writtenFrom: "catalogue"` — those six works have no stored
caption, so the prose is contextual but is grounded in the catalogue record, not
in the picture. A captioned pair does exist and is stronger; if the film shows a
label, prefer the Bruegel pair in `docs/night/curation-report.md` (`source:
caption`). **This is the one place where "searchable by what the pictures look
like" is weakest — do not let the VO imply the label was written from the
image.**

**⚠ The curation walk found a real defect first.** In the first batch the agent
re-selected works and never called `write_labels`, leaving every label written
against the theme the human had just rejected. Fixed by putting `write_labels`
first in the correction prompt (`2c68575`). Worth one line in the Devpost's
"what we learned"; not in the film.

---

## Beat 6 — It leaves the tab · 1:50–2:06

**On screen.** Copy link. Cut to a browser with no session: the exhibition page,
title in serif, the works hung, the labels under them. Then the colophon.

**Card:** `4 of 6 labels written by an agent`

**Shot.** `https://paillette-stg.berlayar.ai/e/MKwsxHy` in a clean profile.
`03-exhibition-cold.png` is the reference frame.

**Claims.**

| Claim | Tier | Source |
| --- | --- | --- |
| The link resolves and opens cold | **[P]** | Live today: `200`, `<h1>` = *Everything the Light Left Behind*, **0 localStorage keys read**. |
| The loader re-fetches every record by id on the server | **[P]** | Curation report; that is what makes a cold open work. Sharing report: all six `<img>` reached `complete === true` with `naturalWidth > 0`. |
| The colophon counts agent-written labels from the data | **[P]** | Live today: `"4 of 6 labels written by an agent"`, matching the four sent as agent-written. |
| Real Open Graph tags | **[P]** | Live today, `og:title`, `og:description`, `og:image` on the NGA's own IIIF endpoint, `twitter:card = summary_large_image`. |
| `/exhibition` with no payload redirects rather than 404s | **[P]** | Live today: `302 → /nga/search`. |

**⚠ No unfurl has ever been seen in a real client.** Tags and image were fetched
with curl and a headless browser. Nothing has been pasted into Slack, WhatsApp
or X. **Do not show a social card unless someone shoots one.**

**⚠** Confirm the URL still resolves on the day. It is a staging row with no
retention policy and no way to delete or expire it.

---

## Beat 7 — Co-curator · 2:06–2:18

**On screen.** The finished hang, held. No chrome.

Two decisions for the owner are in §3.

---

## Beat 8 — Without looking · 2:18–2:34

**On screen.** No cursor. Tab moving through the board; the focus ring landing
on a flag control; a screen-reader caption rendered on screen reading *"Pick,
Environs de Cremieu, P"*. Then `X`, and the mark appearing.

**Shot.** `/nga/search?q=warm landscape`, keyboard only, no mouse events at all.

**Claims.**

| Claim | Tier | Source |
| --- | --- | --- |
| Focus sets the flag anchor, not just hover | **[P]** | Live, first-hand: 23 Tab presses from cold load reach `[data-hovered="true"]` with `document.activeElement` = `BUTTON` / `"Pick Environs de Cremieu (P)"`. Then `x` flags it `by: "human"`. `flag-controls.tsx:147` — `onFocus: point`. |
| The control announces the work and the key | **[P]** | Live, first-hand: accessible names `"Pick Environs de Cremieu (P)"`, `"Reject Environs de Cremieu (X)"`, with `aria-pressed`. |
| Enter-on-empty-bar is announced to a screen reader | **[P]** | Live, first-hand: `sr-only[role="status"]` = *"Enter on the empty bar redeals the board from your flags."* |
| The agent's note is one sentence, not a paragraph | **[P]** | Every recorded note across e2e, negative control and the sofa runs. Enforced in the prompt. |
| Read-aloud needs no agent and no account | **[B]** | `SpeakButton` (`speak-button.tsx`), label *"Read this aloud"*, feature-detected on `window.speechSynthesis`, mounted at `galleries.$galleryId.search.tsx:4827`. **See below.** |

**⚠ Read-aloud is [B], and this is the softest claim in the film.**

- The control renders only where the work has a stored caption or description.
  Opening a cold NGA work today, the dialog offered `["Laurent de La Hyre",
  "Public metadata", "Copy"]` — **no read-aloud button.** Most NGA rows have no
  caption; all twelve labels in the A/B were written from the catalogue.
- Headless Chromium on this VM reports `speechSynthesis` with **zero voices
  installed**. No audio has ever been produced from this build, by anybody.
- **Before filming, find a work that has a caption and confirm the button
  renders.** If it does not, cut the read-aloud sentence and keep the keyboard
  sentence, which is fully proven.

**Do not** use *"Let AI be your eyes and ears"* here or anywhere. The claim is
the opposite: the human is still choosing.

---

## Beat 9 — WebMCP, on screen · 2:34–2:50

**On screen.** The glyph at rest — five dots, 68 × 33 px. Click. The tool
surface: `document.modelContext · 25` and the names. Then, over a live run, the
log filling: tool name, arguments inline, duration on the right, one line of
result. Expand a row into the full request and response.

**Card:** a log row, held.

```
search_artworks                                    6.0s
{"query":"estuary at dusk"}
12 results
→ { "ok": true, "collection": "nga", "count": 12, "queryTimeMs": 118, … }

describe_artwork                                   6.0s
{"artwork":"open-access-art:nga:41623"}
"A low grey horizon under a bank of cloud, with two boats at anc…"

redeal                                             6.0s
{"count":12}
dealt 12 · 11 new · 1 held · steady
```

**Shot.** Click the glyph (`[aria-label="Agent activity"]`). The tool surface
opens with **zero model calls** — capturable headlessly today. The filled log
needs a real agent run.

**Claims.**

| Claim | Tier | Source |
| --- | --- | --- |
| 25 tools on `document.modelContext` | **[P]** | Live, first-hand, deployed, no debug flag: 25 names read off `await document.modelContext.getTools()`. `PAILLETTE_TOOL_COUNT` derives it; `registry.test.ts:424` asserts 25. **Every doc saying 17 or 21 is wrong.** |
| The glyph is five cells at rest and animates by tool kind | **[P]** | Live, first-hand: `.pa-activity-glyph`, text `·····`, 68 × 33 px, with no agent on the page. Activity report: six motions — scan, look, deal, mark, build, read. |
| Clicking it lists the whole tool surface | **[P]** | Live, first-hand: panel 460 × 276 px reading `document.modelContext · 25` then all 25 names. Zero model calls. |
| The log shows arguments, durations and results, expandable to full JSON | **[P]** | `docs/night/shots/activity/08-log-row-expanded.png`, verbatim above. |
| No chrome narrating the mechanism | **[P]** | Fix log §9: "AGENT ACTIVITY", "WEBMCP CONNECTED", "PINNED BY THE AGENT", "TOOL CALLS" all grep to nothing but one `aria-label`. Placeholder, "Ask", "Search" and the `/ 0MS` breadcrumb cut. Verified live: `placeholder: ""`. |
| Every culling tool wraps a key the human presses | **[P]** | `flag_artworks` ↔ P/X/U; `redeal` ↔ Enter; `compare_artworks` ↔ C — all three verified first-hand today from the keyboard with **zero model calls**. |

**⚠ Name only tools that exist.** The 25 are listed in
`docs/night/submission-evidence.md`. `agent-drive.mjs` does not exist. The
ledger filmstrip is **not** on `/nga/search` — it is imported only by
`/night/deal`. Do not film it as a product feature.

---

## Beat 10 — End card · 2:50–2:58

Silent. Options in §3.

---

# 3. Two decisions for the owner

## 3.1 Completing "So now the agent becomes a co-curator…"

**Recommended — A.**

> **"I didn't search for a single one of these. I described a room."**

Because it is literally true of the take: the human types one sentence into the
utterance bar and then presses keys. `capture-beats.json` shows the agent
authored all four queries — two `search_by_color`, two `search_artworks`. The
human authored none. It also names the co-curation without using the word:
describing a room *is* the curatorial act, and the works already existed.

**Precondition.** The line is only true if the cold open is the **agentic**
instruction. If the film opens by typing `warm landscape` into the search field,
cut this line — the human did search.

**B.**

> "Sixty-three thousand works, narrowed to five, for one wall in one room."

Good rhythm, but it makes the number the punchline, which is exactly what the
new structure moved away from. Also brittle: the board is twelve and the show
was six in the recorded walk. If you use it, count on the day.

**C, new.**

> "I pointed. It found the word."

Tightest, and it is the single sentence that describes the whole thesis. Weaker
as a *co-curator* line — it describes beat 3, not the show.

## 3.2 The ending and the end card

**Recommended.**

> **"For everything you can't name. And everything you can't see."**

Closes the opening line — *most art is never seen* — on both halves at once:
can't name is the culling loop, can't see is beat 8. No roadmap, no tense
change, no promise. Set it silent over the finished hang; the VO has already
stopped.

**Alternative, if the read-aloud shot does not survive.**

> "For everything you can't name."

If beat 8's read-aloud button turns out not to render on a filmable work, the
second half of the recommended line is doing work the film no longer shows. Cut
it rather than soften it. The first half stands alone.

**Rejected, and why they stay rejected.**

- *"Today, on one collection. Next, on every collection."* — a roadmap. The film
  ends on a promise instead of a thing.
- *"…and in the future, your ears too."* — read-aloud ships today. This makes a
  shipped feature sound unbuilt.

---

# 4. Two constraints, checked against this script

**Text first.** Every beat is typed or keyed. Nothing in the spine needs a
microphone, and the agentic trigger fires from typing alone — proven four times
in e2e iteration 2 and once more tonight. Audited beat by beat:

| Beat | Input | Needs speech? |
| --- | --- | --- |
| 1 Cold open | typed sentence | no |
| 2 Two rejects | hover + `X` `X` `P` | no |
| 3 The note | typed instruction | no |
| 4 Enter on an empty bar | Enter | no |
| 5 The show | typed correction, Ctrl+Enter | no |
| 6 Share | click | no |
| 8 Without looking | Tab, `X`, one button press | no — read-aloud is speech *out*, and the beat stands without it |
| 9 WebMCP on screen | click | no |

The one shot that touches speech is S20's read-aloud button, it is marked
**[B]**, and §3.2 carries the cut if it does not render.

**Cut the words.** The spoken script is **280 words** across ten beats — 1:52 of
speech in a 2:58 film, so a third of the runtime is silence. What went, and why:

- *"Committing the correction is the turn"* — narrating the mechanism. The board
  changing says it.
- *"Same function, either hand. The loop has no agent-only path."* — the three
  tool/key pairs on screen enact it. Saying it as well is a caption on a mark.
  The precise wording stays in the Devpost, where prose is the medium.
- *"…and a line at the bottom saying how many of them an agent wrote"* — the
  card is the line. Read it once, not twice.
- *"Twelve come back"* in beat 2 — deleted for being wrong, not for being long
  (the agent's first board is 8–12), which is the better reason.
- Beat 3 lost half its length the moment the frame existed. The swatches under
  the sentence do the work the second sentence was doing.

Nothing was made cryptic to be short. Every beat still names its subject.

---

# 5. Production notes

**Model budget is the binding constraint, and it fails silently.** 40 anonymous
model calls per client per hour, keyed on IP. A cold instruction costs 5–7 and a
full loop 8–12 — **three or four complete takes an hour.**

When it runs out the turn returns `429` and the page says so in red under the
bar — *"You have used this hour's shared agent budget."* Legible, and not
something you want in a take. I hit it mid-capture tonight and it cost me the
beat-3 inversion frame. **Probe the budget with one throwaway instruction before
rolling**, and film with a raised cap or a key.

**Reload between takes.** Five clean redeals per pick set in one tab; by the
seventh Enter is a dead key.

**Never film in the harness.** Everything above is `/nga/search` against the
live 63,253. `/night/deal` is a fixture route with 40 works. The compare room and
the ledger were built there; the compare room is now on the product page, the
ledger is not.

**Voice cannot be filmed here.** Headless Chromium exposes
`webkitSpeechRecognition` but `recognition.start()` returns nothing — no
`onresult`, no `onerror`, no `onend` — and `speechSynthesis` has zero voices. A
spoken take must be shot on a real machine with a microphone. **The script above
requires none.** Every beat is typed or keyed. That is the point of §5b, and it
is why voice is an accelerant here rather than a dependency.

**One hazard.** Pressing Enter *inside* the utterance bar leaves the caret
there, so the next `X` types the letter into the bar and the Enter after that
sends `"xx"` to the model. Press Escape after any Enter in the bar, or drive it
the way a person does — hover, keys, Enter with nothing focused.

**Check the query before rolling.** `warm landscape` returns 30 today, measured
four times in the fix log and again live tonight. `storm at sea` returns 4.
`node scripts/demo/query-counts.mjs` re-checks in one command.
