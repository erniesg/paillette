# Shot list

In order. Companion to `docs/webmcp-vo-script-v2.md`. **22 shots plus three in
reserve.**

Everything is `https://paillette-stg.berlayar.ai/nga/search` against the live
63,253 unless stated. **No `?webmcp-debug` in any frame** — the utterance bar, the
stub host and all 25 tools render without it, verified on the deployed build. The
flag now gates only the `window.__paillette_webmcp` console back door; the e2e and
critique harnesses carry it because they drive tools directly, and a camera does
not. `/night/deal` is a 40-work fixture harness and must not appear in the film.

**Columns.** *Headless* — can a Playwright script on this VM capture it. *Exists*
— is there a committed frame today, or has the behaviour been observed live.
*Calls* — anonymous model calls it costs.

**Headless Chromium cannot do real speech recognition** — Chrome ships the audio
to Google's service. **Any genuinely spoken take must be filmed on a real
machine.** Everything after the transcript is capturable headlessly, and **no
shot in this list requires speech.**

**Model budget.** 40 anonymous calls per client per hour, keyed on IP. The film
costs 15–20 in one clean pass. That is **two or three complete takes an hour.**
Film with a raised cap or a key, and probe the budget with one throwaway
instruction before rolling — when it is spent the turn 429s and the page says so
in red under the bar, `role="alert"`, which is legible but not something you want
in a take.

**Reload between takes.** The exemplar route draws a fixed candidate pool and
subtracts everything already dealt: about five clean redeals per pick set, then
the board thins, and by the seventh Enter is a dead key. A fresh page resets it.

---

## Beat 1 — Cold open · 0:00–0:26

### S01 · The instruction typing

- **On screen.** `/nga/search` cold, no query. The sentence appearing in the
  utterance bar, character by character.
- **Said.** *"Most art is never seen. Not because it's hidden — because nobody
  knows what to ask for. So I stop asking. I point."*
- **Page + input.** Click `[aria-label="Ask the agent"]`, type verbatim:
  `I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.`
  Enter.
- **Headless** yes — `node scripts/demo/capture.mjs <url> "<instruction>"`.
  **Exists** yes — `e2e5-01-sofa-instruction-typed.png`. **Calls** 4–5.
- **⚠ Aim at the right field.** On a cold page there are still **two live text
  fields**, and the prominent one is the ordinary catalogue search — a large serif
  *"search by feeling, era, subject…"* at the optical centre. `Ask the agent` is
  small and grey below the divider. Typing into the wrong one produces an ordinary
  search results page and silently invalidates beat 8's *"I didn't search for a
  single one of these."* Check the frame.

### S02 · A board, and a label

- **On screen.** The board filling, then the cyan wall label above it.
- **Said.** — (hold)
- **Headless** yes. **Exists** yes — `e2e5-02-board-and-note.png` (label + **all
  twelve cards**, no human utterance in frame) and
  `e2e5-13-note-inside-board-before-redeal.png` (**the human's graphite sentence,
  the agent's cyan label and the board in one frame**; 8 cards whole, 12 in
  frame). **I opened both files and checked what is in them.** **Calls** 0 (same
  run as S01).
- **⚠ 12–33 s** from Enter to the label, and **the board arrives before the
  sentence does**. A cut at 15 s will sometimes catch a board with no label on it.
  Cut the wait, not the sentence.
- **⚠ Do not say "twelve" here.** The agent's first board measured 8, 10, 11 and
  12 across runs. Twelve is a property of Enter.

### S03 · X, X, P

- **On screen.** Cursor over a card, `X`. Over another, `X`. Over a third, `P`.
  Three graphite marks. Nothing else moves.
- **Said.** — (covered by S01's VO)
- **Page + input.** Hover a card, press the key. Repeat. Do **not** click first.
- **Headless** yes. **Exists** yes — `e2e5-03-flags-X-X-P.png`. **Calls** 0 —
  measured at zero model calls across all three keypresses, 4 of 4 runs.
- **The badges reveal on hover in about a second** and carry `P X U`. That is the
  affordance, and it is the one piece of §5b restraint done well.

### S04 · The agent redeals, under a new label

- **On screen.** The board deals again. A new cyan label replaces the old one.
- **Said.** *"I never typed any of those words. It read what I threw away."*
- **On-screen text**, iteration-5 run 3, verbatim:
  > *Following the pick: sunset watercolor; away from the firelit scene and the
  > red-chalk landscape.*
- **Page + input.** Type `again` into the utterance bar and Enter.
- **Headless** yes. **Exists** yes — `e2e5-20-note-run2.png`,
  `e2e5-21-note-run3.png`, `e2e5-22-note-run4.png`. Run 3 is the one quoted;
  **3 of 3 notes had no wrong word in them**, checked against each named work's
  medium, classification and palette. **Calls** 3, and 8–14 s.
- **Why this and not a deterministic Enter here.** A label is on screen before and
  after, so nothing collapses. See the 🚫 under S06. **The e2e walk pressed Enter
  on the empty bar between the flags and the `again`; the film moves that Enter to
  beat 2.**
- **⚠ `again` deals because the model chose to deal.** `redeal` appears 15 times
  in the night's tool-call census, so it does choose it — but it is a choice, not
  a guarantee. If a take comes back with a search instead of a deal, run it again.
- **⚠ A weak note is possible.** An earlier round produced *"darker, crowded
  scenes"* — accurate but generic — and one run called a drawing a painting. **If
  you get one of those, shoot it again.**

---

## Beat 2 — Enter on an empty bar · 0:26–0:58

### S05 · The armed bar

- **On screen.** The utterance bar, empty, with the hairline under it carrying
  `↵`. Tight.
- **Said.** *"Now the bar is empty. Nothing typed. Nothing said."*
- **Page + input.** Any board with one confirmed human flag on it.
- **Headless** yes. **Exists** yes — `.lt-enter-armed` absent before the first
  flag, `↵` after, verified first-hand. **Calls** 0.
- **⚠ This is the only affordance for the headline behaviour**, and the critique's
  view is that a judge will not find it. Hold the shot long enough that a viewer
  does.

### S06 · Enter, and the deal

- **On screen.** Enter. Rejects slide left into the tray. The pick does not move.
  Newcomers arrive from the right, staggered.
- **Said.** *"Same picks. Same slots. And not one call to a model."*
- **Page + input.** Enter with nothing focused, or with the caret in the empty
  bar — both work.
- **Headless** yes. **Exists** yes — `e2e5-04-redeal-midflight.png`,
  `e2e5-14-note-gone-after-redeal.png` (which I opened: twelve works, the reject
  tray at the left margin holding two desaturated cards, and one frame-lit pick
  wearing its `P X U` badges). Video: `e2e2-deal-on-nga-search.webm`. **Calls** 0.
- **🚫 FILM THE SECOND CONSECUTIVE ENTER, NOT THE FIRST.** The deterministic
  redeal writes no wall label, and the label's wrapper is `empty:hidden`
  (`deal-board.tsx`, read in code). So the **first** Enter after an agent turn
  deletes the sentence and the whole board — picks included — slides up **56 px**:
  44 px of sentence plus 12 px of margin. Measured grid-relative y 72 → 16 inside
  a grid whose own top did not move. Reproduced 3/3 by the critique and twice more
  by the e2e lane. The second Enter has no label before or after, so nothing
  collapses and the pick holds at **zero pixels**. Compare `e2e5-13` and `e2e5-14`
  to see exactly what the first one does.
- **⚠ The first redeal after a *text search* is a jump cut, not a deal** —
  3 to 18 distinct layouts against a board-to-board redeal's 15 to 27. It is a
  masonry becoming a board and there is no slot to hold. Another reason not to
  film the first.

### S07 · The request log

- **On screen.** A held graphic over the settled board. **Not a devtools
  screenshot** — set it.
- **Said.** *"One request, to a vector index, under thirty milliseconds after the
  key. The agent isn't the mechanism. It's a second operator of one that works
  without it."*
- **On-screen text.**
  ```
  POST /api/public-search/nga/exemplars   ← Enter, +8 ms
  POST /api/public-agent/turn             ← 0
  ```
- **Source.** e2e iteration 5, four silence-gated runs: `firstExemplarAt` = +8,
  +11, +14, +21 ms, `modelCallsAfterEnter` = 0 in all four. The critique measured
  +29 ms independently. Regenerate with
  `node scripts/demo/e2e-deterministic.mjs https://paillette-stg.berlayar.ai`.
- **Headless** n/a (graphic). **Exists** yes — `e2e5-08-no-model-call-redeal.png`
  is the measurement frame. **Calls** 0.

### S08 · (optional insert) With no agent on the page at all

- **On screen.** The same board in a page with no prompt bar. Enter still deals.
- **Said.** — (covered by S07)
- **Headless** yes. **Exists** yes — `e2e-17-no-host-deterministic-redeal.png`.
  **Calls** 0.

---

## Beat 3 — Say one thing, do another · 0:58–1:18

### S09 · Three warm picks

- **On screen.** Three graphite frames on three amber works in slots 0, 1, 2.
- **Said.** *"Three warm pictures kept. Now I'll ask it for the opposite."*
- **Page + input.** Hover and `P` on three warm works.
- **Headless** yes. **Exists** yes — `docs/night/shots/crit5/c2-flagged.png`.
  **Calls** 0.

### S10 · The sentence that contradicts them

- **On screen.** The typed sentence in the utterance bar.
- **Said.** — (hold)
- **Page + input.** Type verbatim:
  `I want something cool and blue and severe. Nothing warm.` Enter.
- **Headless** yes. **Exists** yes (as part of the c2 run). **Calls** 3–4, 8–14 s
  of dead air. Cut it.

### S11 · The label, held

- **On screen.** The cyan wall label, its swatch strips beneath it, and twelve
  cards with the three picks still in slots 0, 1, 2.
- **Said.** *"It followed my hands, not my mouth. And it said so."*
- **On-screen text**, verbatim:
  > *You said blue, but picked three amber-brown sunset drawings and paintings;
  > following the picks.*
- **Headless** yes. **Exists** ✅ **yes** —
  `docs/night/shots/crit5/c2-gapnote.png`, committed on this branch from the
  critique's own staging run. **I opened it and checked.** In frame: the label,
  three swatch strips, twelve cards at 1440×900, *Harvesters by Firelight*, *An
  Indian Encampment at Sunset* and *Clouds at Sunset* holding slots 0–2 with
  graphite frames, and the newcomers *Clouds at Dawn*, *Marsh Landscape at
  Twilight*, *Vicinity of Morestal*, *Landscape with Storm*. Amber and dusk,
  against an explicit request for blue.
- **Reproduce it.** `docs/night/shots/crit5/probe-conflict2.mjs` is committed
  beside the frame, with the view context it read at `crit5/ctx-c2.json`.
- **⚠ Use run c2's sentence, not c3's.** c3 said *"three ochre-and-amber
  watercolors"* and the medium could not be confirmed on all three. c2's
  *"drawings and paintings"* is correct of the three works it names.
- **⚠ The probe URL carries `?webmcp-debug`**, used only to *read* palettes
  through `get_view_context`. The instruction was typed and the picks were real
  `P` keypresses. **Drop the flag for the camera.**

---

## Beat 4 — Scale · 1:18–1:30

### S12 · The number

- **On screen.** The board pulling back, or one card held with the number set
  over it.
- **Said.** *"Sixty-three thousand works. Open access, from the National Gallery
  of Art. Three keys move through all of them."*
- **On-screen text.** `63,253 works · National Gallery of Art · CC0`
- **Headless** n/a (graphic over held footage). **Exists** yes — the figure is in
  `docs/HANDOFF.md`, paged to the last record, and renders live on `/about`.
  **Calls** 0.
- **Cut, and staying cut.** *"The true power of Paillette is unleashed when we run
  it over an entire collection."*

---

## Beat 5 — The show leaves the tab · 1:30–1:54

### S13 · Title and statement

- **On screen.** The exhibition head above the board: title and statement in
  serif, behind a hairline rule. **No labels yet** — that is correct.
- **Said.** *"What's left is a show, and the statement is mine."*
- **Page + input.** `node scripts/demo/e2e-curation.mjs https://paillette-stg.berlayar.ai`
- **Headless** yes. **Exists** yes — `crit5/show-x4-before.json`,
  `crit5/show-x4-after.json`, `crit5/x4-show-after.png`. **Calls** ~5, and
  **45–75 s** to a title. One critique run produced nothing at all in 150 s.
- **⚠ Do not say "a label under every work" here.** The opening turn writes none.

### S14 · The correction, typed

- **On screen.** The statement selected and typed over. Ctrl+Enter.
- **Said.** — (hold)
- **On-screen text (typed).** `It is not about weather. It is about leaving: places with the people already gone.`
- **Page + input.** Click the paragraph, select all, type, Ctrl+Enter. Committing
  the statement *is* the turn — it dispatches `commitHumanTurn`. Before that fix
  nothing called it at all.
- **Headless** yes. **Exists** yes. **Calls** 0 (counted in S15).

### S15 · One label, under two statements

- **On screen.** A held graphic. The same work, two labels.
- **Said.** *"The labels are written against it. The same picture reads
  differently under a different sentence."*
- **On-screen text**, verbatim:
  > **under *Weather at Sea*** — *Gray wash and dense linework give wind and cloud
  > as much force as the two ships, which pitch through choppy water. The distant
  > vessel underscores how quickly the storm has swallowed the open sea.*
  >
  > **under *Leaving*** — *Two ships strain through choppy water while a smaller
  > vessel recedes in the distance. The ink and gray wash hold them at the
  > uncertain point between departure and disappearance.*

  *Petrus Johannes Schotel,* Ships in a Stormy Sea, *1835.*
- **Source.** Critique §9 run x4, on today's deploy — both labels are in
  `docs/night/shots/crit5/show-x4-before.json` and `show-x4-after.json`, committed
  on this branch, with the human's statement in the second reading
  `"by": "human", "theirs": true`. A second, isolated pair from
  `verify-contextual-labels.mjs` — same works, same call, only the statement
  changed, **3 of 3 substantively different** — is in
  `docs/night/curation-evidence/contextual-labels.txt`. The Bruegel pair there is
  marked `[caption]` rather than `[catalogue]`, i.e. written from a stored
  description of the picture, which is the stronger card if the film has room:
  > **Weather at Sea** — *…the print shifts weather into a human exchange: a
  > condition imagined through companionship rather than an open horizon.*
  >
  > **Leaving** — *…held close by the print's paired arrangement but never
  > meeting. Their separation gives the exhibition's moment of departure a fixed,
  > formal shape.*
- **Headless** n/a (graphic). **Exists** yes. **Calls** 0 if the graphic is set
  from the archived text.
- **🚫 DO NOT FILM THE RE-SELECTION LIVE.** Run by hand four times on the current
  deploy: one produced nothing in 150 s; one changed **0 works** and left weather
  labels sitting under a wall text reading *"It is not about weather"*; one
  changed **0 labels in 180 s**; one worked completely. **1 of 4.** On camera that
  is a wall arguing with its own wall text. Set the card from archived text and
  film S16 instead.
- **🚫 And the run that worked still ended blank.** `crit5/show-x4-after.json` is
  the successful one, and it reads `"unlabelled": 6` — the six newly-selected
  works (*East Side Interior*, *Das leere Café*, *The New York Window*,
  *L'Inquietude*, *A Corner of the Artist's Room*, *Les Salles des Gardes*) all
  carry `"label": null, "labelBy": null`. Two labelled works, six blank. The
  re-selection and the re-labelling are two tool calls and the second only covers
  what was already there.
- **⚠ Do not imply the label was written from the picture.** `write_labels` reads
  a stored caption where one exists and the catalogue record where it does not,
  and returns which. Most NGA rows have no caption.

### S16 · The link, opened cold

- **On screen.** A browser with no session. The exhibition page: serif title, the
  human's statement behind a rule, works hung full-scale, labels beside them.
  Then the colophon.
- **Said.** *"Then it leaves. A real URL, no account, and a line saying how many
  of the labels an agent wrote."*
- **On-screen text.** `4 of 6 labels written by an agent`
- **Page.** `https://paillette-stg.berlayar.ai/e/MKwsxHy`
- **Headless** yes. **Exists** yes — `docs/night/shots/crit5/share-MKwsxHy.png`,
  which I opened: title *Everything the Light Left Behind*, six works, generous
  negative space, agent labels *"The valley empties of light before anyone has
  decided to go."* and *"A stopping place, which is not the same as an arrival."*,
  and one the human wrote — *"Two people sitting for a picture that will outlast
  the room."* Also `docs/night/shots/share-cold-open.png`. **0 localStorage keys
  read.** **Calls** 0.
- **🚫 Use `MKwsxHy` and no other code.** Of seven published shows, **four carry
  no wall labels at all** — `HcLSkLr`, `QWwJnL5`, `dfbA3tE`, `wycy7SS` — and the
  two twelve-work ones, the two that look most like real exhibitions, are both
  blank. `aWp7U3z` has twelve agent labels but an agent-written statement, so it
  does not show two hands. `MKwsxHy` is the only page where the whole claim is
  visible.
- **⚠ Confirm it still resolves on the day.** It is a staging row with no
  retention policy and no way to delete or expire it.
- **⚠ Do not shoot a social unfurl.** The Open Graph tags and the `og:image` are
  real and were fetched — 30 of 30 crawler requests answered — but nothing has
  ever been pasted into Slack, WhatsApp or X to see a card render.

---

## Beat 6 — Without looking · 1:54–2:14

### S17 · Tab, and a flag

- **On screen.** No cursor anywhere. The focus ring stepping through the board
  and landing on a flag control. A rendered screen-reader caption. Then `X`, and
  the mark appearing.
- **Said.** *"None of this needed a mouse. The control says the work, and it says
  the key. Someone who can't see the pictures is still the one choosing. Not the
  one being told."*
- **On-screen text.** `Pick Environs de Cremieu (P)` then
  `Enter on the empty bar redeals the board from your flags.`
- **Page + input.** `/nga/search?q=warm landscape`, keyboard only, **no mouse
  events at all**. 23 Tab presses from a cold load reach the first card's flag
  control.
- **Headless** yes. **Exists** ❌ **no committed frame — this beat has to be
  shot.** The behaviour was verified first-hand: `document.activeElement` =
  `BUTTON` / `"Pick Environs de Cremieu (P)"`, `[data-hovered="true"]` set by
  focus (`flag-controls.tsx:147`, `onFocus: point`), then `x` flags it
  `by: "human"`, `aria-pressed` following. The `sr-only[role="status"]` string is
  in code at `galleries.$galleryId.search.tsx:3025`. **Calls** 0.
- **⚠ 23 tabs is a lot of screen time.** Cut to the moment the ring lands.
- **Do not use *"Let AI be your eyes and ears."*** The shot shows the opposite.

---

## Beat 7 — WebMCP, on screen · 2:14–2:42

### S18 · The glyph at rest

- **On screen.** Five monospace dots. Tight — the element is 68 × 33 px.
- **Said.** *"How it's built is on the page. Five dots until a tool runs."*
- **Page + input.** Nothing. It renders at rest with no agent on the page.
- **Headless** yes. **Exists** yes — `shots/activity/01b-idle-glyph.png`.
  **Calls** 0.

### S19 · The tool surface

- **On screen.** Click the glyph. The panel opens: `document.modelContext · 25`
  and the twenty-five names.
- **Said.** *"Twenty-five tools on `document.modelContext` —"*
- **Page + input.** Click `[aria-label="Agent activity"]`.
- **Headless** yes. **Exists** yes — `shots/activity/02-log-tool-surface.png`.
  **Calls 0.**
- **This is the shot that answers "how did you implement WebMCP".** It costs
  nothing, it cannot be faked, and it is capturable headlessly today.

### S20 · The log filling, and a row expanded

- **On screen.** Over a live agent run: rows appearing, each with a tool name,
  arguments inline, one line of result, duration right-aligned. Then a row
  expanded into full request and response.
- **Said.** *"— with their arguments, their answers and their timings."*
- **On-screen text**, verbatim from `shots/activity/08-log-row-expanded.png`:
  ```
  search_artworks                                6.0s
  {"query":"estuary at dusk"}
  12 results
  → { "ok": true, "collection": "nga", "count": 12, "queryTimeMs": 118, … }

  redeal                                         6.0s
  {"count":12}
  dealt 12 · 11 new · 1 held · steady
  ```
- **Headless** yes. **Exists** yes — `08-log-row-expanded.png`,
  `07b-log-detail.png`. **Calls** ~4 for a fresh run, or reuse the frame.
- **⚠ The log is closed by design and opens only on a click.** A harness that
  reads it must open it once first, or it records an empty `toolsFired`.

### S21 · The two hands

- **On screen.** A held graphic, not the page: the tool on the left, the key on
  the right.
- **Said.** *"`flag_artworks` is P and X. `redeal` is Enter. `compare_artworks`
  is C. One workspace. Two operators."*
- **On-screen text.**
  ```
  flag_artworks        P · X · U
  redeal               ↵
  compare_artworks     C
  ```
- **Headless** n/a (graphic). **Exists** yes — all three driven from the keyboard
  with zero model calls, and `redeal` is verifiably the same function: the human's
  `submitHumanTurn` and the `redeal` tool both call `runRedeal`. **Calls** 0.
- **⚠ Say *"the loop has no agent-only path"*, not *"there is no agent-only
  API"*.** `write_labels` and `annotate_atlas` have no human control today.

---

## Beat 8 — Co-curator, and the card · 2:42–2:56

### S22 · The finished hang, held, then the card

- **On screen.** The exhibition page, still. No chrome, no cursor. Then the card.
- **Said.** *"So the agent becomes a co-curator. I didn't search for a single one
  of these. I described a room."*
- **On-screen text.** `For everything you can't name. And everything you can't see.`
- **Headless** yes. **Exists** yes. **Calls** 0.
- **⚠** The co-curator line is only true if S01 typed into the **utterance bar**.
  If it went into the catalogue search field, the human did search — cut the line.
  Alternatives in `docs/webmcp-vo-script-v2.md` §3.1.
- **The end card is unconditional.** *Can't see* is carried by S17, which is
  proven, so it no longer depends on read-aloud rendering.

---

## Held in reserve

### R01 · The compare room

Two works at large scale on the charcoal ground, the question in serif between
them, one control, **nothing else on screen**. Measured full-bleed at 1440 × 900,
portalled to `document.body` with every other body child hidden.
`e2e5-06-two-up-room.png` — I opened it: two works on one centre line, catalogue
lines in mono beneath each, *"Which one sits better above a sofa?"* in serif
above, `NEITHER` at the foot. Zero model calls.

**The best-composed screen in the product**, and the cut has no room for it. If a
beat runs short, put it between S03 and S04. Press `C` on a hovered card, or
shift-click two and press `C`; a click answers it (winner → pick, loser → reject)
and the answer rides the next turn. Escape now leaves without answering.

**⚠** Reachable by pressing `C`. **Not** reliably reachable by asking — the model
chose `compare_artworks` zero times in 508 recorded tool calls, and only opened
the room when asked almost verbatim (*"Show me two side by side and let me choose
between them"*).

### R02 · The agent's dashed mark beside the human's solid one

Verified off computed styles rather than asserted: the human's confirmed mark is a
**solid ring drawn with `box-shadow`** (`rgb(230,227,220) 0 0 0 1px`); the agent's
proposal is a **dashed `outline`**, `by: agent`, `provisional: true`. Reading
`outline` alone reports the human's mark as absent.

**⚠ It has to be asked for.** *"Mark the ones on this board you would throw out"*
produced six provisional rejects in agent ink. Natural phrasings did not. And a
redeal sweeps a provisional off the board before it can be answered, deliberately
— provisional flags do not move the exemplars. If this is filmed, film it without
a redeal after it.

### R03 · The board under `prefers-reduced-motion`

25 distinct layouts at `no-preference` against 4 at `reduce`, picks still held; at
`reduce` the held picks collect at the front instead of animating in place.
**⚠ Only spot-checked with a pick in slot 0.** A pick starting at slot 5 is
untested.

---

## Do not film

| | Why |
| --- | --- |
| `/night/deal` | A 40-work fixture harness. Filming it and calling it the app would be dishonest. |
| The ledger filmstrip | Built and tested, imported only by `/night/deal`. It is **not** on `/nga/search`. |
| The `VIEW` row while a board is dealt | It offers Masonry / Salon / Atlas / Table, and choosing any of them destroys the board. A control that undoes the thing the screen is for. |
| A spoken take, on this machine | Headless Chromium exposes `SpeechRecognition` and the mic control renders — but there is no microphone and **0 synthesis voices**. Push-to-talk enters *"Listening — release to send"* and on release nothing lands and nothing is reported. Must be shot on a real machine. |
| Read-aloud | The control renders only on a work with a stored caption; a cold NGA work offered `["Laurent de La Hyre","Public metadata","Copy"]` and no read-aloud button. **No audio has ever been produced from this build by anybody.** Optional insert only, after confirming both. |
| A social unfurl card | Tags verified by fetch; never rendered in a real client. |
| The agent flagging or comparing unprompted | 508 model-chosen tool calls, `flag_artworks` 0, `compare_artworks` 0. Every recorded demonstration was driven through the debug console. |
| Upload and indexing | Throat-clearing. Nothing in it is unique to WebMCP. |
| The bare domain | `https://paillette-stg.berlayar.ai` is a marketing page headed *"Powerful Features"*; `/nga/search` appears in no link on it. |
| Any address bar containing `?webmcp-debug` | The bar and all 25 tools render without it. Leave it in frame and a judge assumes the demo needs it. |

---

## Before the first take

1. **Raise the model cap** for the filming IP, or film with a key. 40/hour is not
   enough for retakes. **Probe with one throwaway instruction** to confirm the
   budget is not already spent.
2. **Confirm the tool count.** `(await document.modelContext.getTools()).length`
   → **25**.
3. **Confirm `https://paillette-stg.berlayar.ai/e/MKwsxHy` still resolves.**
4. **Check the query.** `node scripts/demo/query-counts.mjs` — `warm landscape`
   returned 30 on five separate measurements; `storm at sea` returns 4.
5. **Poll, don't sleep.** The agent bar takes 691–2786 ms to mount across 20 cold
   loads, with an outlier past 4500 ms. Anything driving the page must wait for
   the selector.
6. **Pace takes about a minute apart.** Ten NGA searches per minute per client,
   shared between the agent's bursts and the deterministic redeal — it refused a
   redeal mid-run for the e2e lane. Or raise
   `PUBLIC_SEARCH_COLD_MISS_LIMIT_PER_MINUTE` in `apps/api/wrangler.toml`.
7. **Reload the tab between takes.** Five clean redeals per pick set.
8. **Set the scroll and hold it.** At 1440 × 900, scrollY **120–180** puts the
   agent's label and twelve whole cards in one frame. Scrolling during a beat is
   what loses the sentence, not the layout.
9. **Press Escape after any Enter typed inside the utterance bar.** Otherwise the
   caret stays there, the next `X` types the letter, and the Enter after that
   sends `"xx"` to the model as an instruction. `7dd250c` fixed the *catalogue*
   field's autofocus, not this one.
10. **Read §4 of the voiceover script before shooting S06.** It is the one shot
    that has to be composed around an unfixed defect.
