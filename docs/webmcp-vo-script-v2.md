# Paillette — WebMCP demo voiceover, v2

Runtime **≈2:58** at ~150 wpm. ~350 spoken words across ten beats; the pictures
carry the rest.

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

> Twelve come back. Two of them are wrong, and I can't tell you why.
>
> So I don't. I throw them out and press Enter.

**0:30 · The agent says what you did**

> I never used the word brown.
>
> It read the palettes it was handed and named the colour I threw away. The
> swatches under the sentence are the ones it wrote from, so you can check it
> without leaving it.
>
> Invert the flags — reject the two brightest instead —
>
> — and the sentence inverts with them.

**0:52 · Enter on an empty bar**

> Now watch the bar. It's empty.
>
> Same board. Same picks. Same slots.
>
> That redeal made one request, to a scoring endpoint. No model was called at
> all.
>
> Sixty-three thousand works, and the loop that moves through them is three
> keys. P, X, Enter. It runs with the agent switched off.

**1:12 · The show**

> Keep going and there's a show on the table. A title, a statement, and a label
> under every work.
>
> The statement is wrong. It isn't about weather.
>
> Committing the correction *is* the turn.
>
> It re-selects. It rewrites every label against my sentence. It doesn't touch
> my sentence.

**1:50 · It leaves the tab**

> And it leaves.
>
> A real URL. Six works, the labels, my words — and a line at the bottom saying
> how many of them an agent wrote.

**2:06 · Co-curator**

> So the agent becomes a co-curator. I didn't search for a single one of these.
> I described a room.

**2:18 · Without looking**

> None of that needed a mouse. Tab to a work and the control says its name and
> its key — *"Pick, Environs de Cremieu, P."* The note is one sentence. Ask for
> a description and the browser reads it aloud, with no agent and no account.
>
> Someone who can't see the pictures is still the one choosing.

**2:34 · WebMCP, on screen**

> How it's built is on the page. Five dots until a tool runs.
>
> Twenty-five tools on `document.modelContext`, with their arguments, their
> answers and their timings.
>
> Every tool in the culling loop wraps a key the human already presses.
> `flag_artworks` is P and X. `redeal` is Enter. `compare_artworks` is C. Same
> function, either hand. The loop has no agent-only path.
>
> One workspace. Two operators.

**2:50 · End card**

> *[silent]*

---

# 2. Beat by beat

## Beat 1 — Cold open · 0:00–0:12

**On screen.** `/nga/search`, cold, no query. The sentence typing into the
utterance bar. Then twelve works arriving.

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
| The board that arrives is the deal board, not salon | **[P]** | Fix log §4 — `dealtBoard` is now the first branch in `ResultsLayout`; survives `set_view` for salon, atlas, table and masonry. **This was broken in the first e2e run; verify on the day.** |

**⚠ Timing.** A cold agentic instruction was **35 s** from Enter to a board
(e2e-report §2.1). This is the slowest shot in the film. Cut it.

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
| The board deals rather than cuts | **[P]** | 22 distinct layouts across 339 frames on the deployed build (integration iter 2); 25 across 205 pre-deploy (e2e §1.2). A jump cut measures 4–5. |
| Twelve cards, all on screen | **[P]** | Live, first-hand: `{"cards":12,"fullyVisible":12,"gridHeight":724,"viewport":1000}`. |
| Rejects go to a visible tray and stay restorable | **[P]** | Live, first-hand: `.lt-tray` present, 2 items, after both redeals. Fix log §8. |

**⚠ The first redeal after a text search is a cut, not a deal** (5 layouts vs
25). It is a masonry becoming a board and there is no slot to hold. Film the
second.

---

## Beat 3 — The agent says what you did · 0:30–0:52

**This is the beat. Everything else is context for it.**

**On screen.** The note, in serif, as a wall label above the board. Under it,
the swatch strips — one per flagged work, picks whole, rejects struck through,
no words. Then the same shot with the flags inverted.

**Card A:** the note, held.

> *You rejected the two brown-and-ochre oils; these keep the warmth in
> firelight, gold, and clear sunlit colour.*

**Card B:** the inverted note.

> *Warmth here runs from sunlit gold to russet domestic colour, avoiding the
> tan-and-cream palettes you rejected.*

**Shot.** `node scripts/demo/negative-control.mjs` — same instruction
(`something warm for above the sofa`), same query (`warm landscape`), flags
inverted between the two conditions. Darkness computed from the same indexed
swatches the agent is handed.

**Claims.**

| Claim | Tier | Source |
| --- | --- | --- |
| Both notes above, verbatim | **[P]** | Fix log §2, Run A. **Caveat below.** |
| The two conditions never produced the same note | **[P]** | Fix log §2, four notes across two runs. |
| Three of four notes name the rejected works' actual colour, correctly and differently in each direction | **[P]** | Fix log §2: "brown-and-ochre" for the dark pair; "tan-and-cream" and "muted beige and umber" for the pale pair. The fourth describes the board without referring to the rejects — not wrong, not the beat. |
| The agent is given the palette, medium, year and classification of every flagged work | **[P]** | `negative-control.json` → `flagsTheAgentSaw.rejects[].palette` = `["#413225","#AB825E"]`, `medium: "oil on canvas"`, `year: 1825`. `toAgentVisualFacts`, `artwork-summary.ts`. |
| The swatches under the note are the ones it wrote from | **[P] in the DOM, [B] on camera** | `negative-control.json`: `swatchesBesideTheNote: 2, rejectSwatches: 2`. `NoteSwatches` is mounted directly under the wall label (`galleries.$galleryId.search.tsx:2932`). **No committed screenshot shows it.** See below. |

**⚠ Three things the owner must know before this beat is cut.**

1. **Run A's JSON was overwritten by Run B before it was copied.** The two notes
   above are quoted from the console in `docs/night/fix-log.md`, not from a
   committed artefact. `negative-control.json` holds Run B. The script is
   deterministic and re-runnable — **re-run it and capture on the day.**
2. **No still frame of the note with its swatches exists.** The two negative-control
   screenshots (`darkest.png`, `brightest.png`) are in salon view and do not
   frame the wall label. The mechanism is proven in the DOM; the shot is not.
3. **A third run was blocked by the anonymous model budget** (40 calls/client/hour).
   Two conditions completed. Film with a raised cap or a key.

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
| Enter on an empty bar makes **zero** model calls | **[P]** | Live, first-hand, twice: `modelCalls: 0`, one POST to `/api/public-search/nga/exemplars`. Asserted negatively in `e2e-deterministic.mjs`, so it fails if a call ever appears. |
| The whole deterministic run is four requests | **[P]** | `deterministic-network.json`, verbatim above. Live re-run today: quota, text, exemplars ×2, plus one `/api/public-usage/nga` beacon. |
| It works with no WebMCP host at all | **[P]** | e2e §3: `no prompt bar without a host: count=0`; `Enter on the bare board redeals, with no agent anywhere`. Shot `e2e-17`. |
| It works with the agent route hard-refusing 429 | **[P]** | `verify-agentless-loop.mjs` — 9 checks, three times in a row (critique §1). |
| The `↵` hairline appears the moment the first flag is confirmed | **[P]** | Live, first-hand: `.lt-enter-armed` absent before the flag, `"↵"` after. |
| 63,253 works | **[P]** | `docs/HANDOFF.md` — paged `/api/public-search/nga/browse` to the last record. Rendered live on `/about`. Not re-derived tonight. |

**Say the negative out loud.** It is the only claim in the submission asserted
negatively and it is what makes "two operators, one mechanism" true rather than
rhetorical.

---

## Beat 5 — The show, and the correction · 1:12–1:50

**On screen.** Title and statement above the board, in serif. A label under
every work. The human selects the statement, types over it, commits. The board
changes. The labels change. The statement does not.

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
| The agent drafts a title, a statement and a label per work | **[P]** | Curation walk on the deployed build, **11 of 11 pass** (fix log §5). `curation-walk.json` holds six drafted labels verbatim. |
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

# 4. Production notes

**Model budget is the binding constraint.** 40 anonymous model calls per client
per hour, keyed on IP. A typed instruction costs three to six; the curation walk
costs ten to fourteen. Beats 1, 3 and 5 together are roughly **30 calls in one
sitting**, before a single retake. **Film with a raised cap or a key**, or the
second take of beat 5 will silently return nothing.

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
