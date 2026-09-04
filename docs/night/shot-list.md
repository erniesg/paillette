# Shot list

In order. Companion to `docs/webmcp-vo-script-v2.md`.

Everything is `https://paillette-stg.berlayar.ai/nga/search` against the live
63,253 unless stated. **No `?webmcp-debug`** — the utterance bar renders without
it, verified on the deployed build. `/night/deal` is a 40-work fixture harness
and must not appear in the film.

**Columns.** *Headless* — can this be captured by a Playwright script on this
VM. *Exists* — is there a committed frame of it today, or has it been observed
in a browser. *Calls* — anonymous model calls it costs.

Anonymous budget is **40 model calls per client per hour**, keyed on IP. A cold
typed instruction costs 5–7; a full loop 8–12. That is **three or four complete
takes an hour.** Film with a raised cap or a key.

**And reload between takes.** The board runs out after about five redeals in one
tab: the fifth Enter is the last full board, the sixth comes back short, and by
the seventh the board is a single card and Enter is a dead key. Reproduced on two
queries. A fresh page resets it. (e2e iteration 2 §4.)

---

## Beat 1 — Cold open · 0:00–0:12

### S01 · The instruction typing

- **On screen.** `/nga/search` cold, no query. The sentence appearing in the
  utterance bar, character by character.
- **Said.** *"Most art is never seen. Not because it's hidden — because nobody
  knows what to ask for. So I don't ask. I say what the room needs."*
- **Page + input.** `/nga/search`. Click `[aria-label="Ask the agent"]`, type
  verbatim: `I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.`
- **Headless** yes — `scripts/demo/capture.mjs`. **Exists** yes —
  `e2e-16-capture-harness-agent-chose-salon.png` (stale: that run predates the
  `set_view` fix). **Calls** ~4–6.

### S02 · A board arrives

- **On screen.** The board filling.
- **Said.** — (hold)
- **Headless** yes. **Exists** yes — `e2e2-06-step1-board-and-note.png`, a cold
  typed instruction landing on a deal board *after* the `set_view` fix.
  `view=deal-board` on all four iteration-2 runs. **Calls** 0 (same run as S01).
- **⚠ 42–59 seconds** from Enter to a board on a cold run. Cut it.
- **⚠ Do not say "twelve" here.** The agent's first board was 8, 12, 10 and 12
  across four runs of the same instruction. Twelve is a property of Enter, not
  of the agent's first board.

---

## Beat 2 — Two rejects, and Enter · 0:12–0:30

### S03 · X, X

- **On screen.** Cursor over a card, `X`. Over another, `X`. Two marks in
  graphite. Nothing else moves.
- **Said.** *"A board comes back. Two of them are wrong, and I can't tell you
  why. So I don't."*
- **Page + input.** Hover a card, press `x`. Repeat.
- **Headless** yes. **Exists** yes — `e2e-02-flags-XXP.png`; re-verified live
  tonight (`data-flag="reject"` ×2, `data-flag-by="human"`). **Calls** 0.

### S04 · Enter, and the deal

- **On screen.** Enter. Rejects slide left into the tray. Picks do not move.
  Newcomers arrive from the right, staggered.
- **Said.** *"I throw them out and press Enter."*
- **Page + input.** Enter with nothing focused. **Film the second redeal.**
- **Headless** yes. **Exists** yes — `e2e2-deal-on-nga-search.webm`,
  `e2e2-09-step6-deal-midflight.png`,
  `e2e2-10-step6-deal-settled-twelve-and-tray.png`. Re-verified live three times
  tonight, identical every run: `{"cards":12,"fullyVisible":12,"rejectsOnBoard":0,
  "gridHeight":724,"tray":2}`, and the pick at `{"dx":0,"dy":0}` before and after.
  **Calls** 0.
- **⚠ The first redeal after a text search is a jump cut, not a deal** — measured
  at 3, 4, 4, 6, 12, 14 and 18 layouts against the second's 16–28. It is a
  masonry becoming a board and there is no slot to hold. Do not film the first.

---

## Beat 3 — The agent says what you did · 0:30–0:52

### S05 · The note, with its swatches

- **On screen.** The wall label in serif above the board, in the agent's cyan
  ink with a rule down its left side. Under it, three swatch strips — the pick
  whole, the two rejects struck through, no words.
- **Said.** *"I never used those words. It read the palettes it was handed. The
  swatches under the sentence are the ones it read."*
- **On-screen text.** *"You said warm; you kept the bone-and-umber etching and
  rejected the darker, greener palettes — following the picks."*
- **Page + input.** `/nga/search?q=warm landscape`. Hover-`X`, hover-`X`,
  hover-`P` on the first three cards, then type `something warm for above the
  sofa` into the utterance bar and press Enter.
- **Headless** yes. **Exists** ✅ **yes, as of tonight** —
  `docs/night/shots/50-note-with-swatches.png` (tight) and
  `51-note-with-swatches-in-context.png` (full page). Raw:
  `docs/night/e2e-evidence/note-swatches.json`. **Calls** 3.
- **Why this frame is the one.** The words are checkable against the picture
  directly under them: the pick's swatches are `#EBD8BC` and `#695943` — bone,
  umber — and the second reject's leading swatch is `#47502B`, a dark olive. The
  sentence also carries the said/chose gap (*"You said warm… following the
  picks"*) in the same breath. **Nothing was staged**; the flags were the first
  three cards on the board.
- **⚠** The strips do not carry `data-flag-by`, so they show *that* a work was
  flagged, not by which hand. Invisible in the film; a real gap in the design.

### S06 · The same work, the other way round

- **On screen.** Cut to the same composition after the flag on one work has been
  flipped. The sentence has moved it to the other side.
- **Said.** *"Flip the flags on the same work — and it changes sides."*
- **On-screen text.** Berthe Morisot, *Landscape*, `open-access-art:nga:52306`,
  colored pencils on wove paper, palette `#D4C7A2 #B6A385 #9A886C`:
  > *picked* — "You kept the pale ochre pencil landscape and rejected the darker
  > peach palette — following its quiet, airy warmth."
  >
  > *rejected* — "Following your warm oil-on-wood fruit pick and moving away
  > from the pale colored-pencil landscape you rejected."
- **Page + input.** Two agent turns with that work flagged opposite ways.
- **Headless** yes. **Exists** ⚠ **text only.** Both notes are archived verbatim
  in `docs/night/e2e-evidence/iteration-2/run3-loop.json` and `run4-loop.json`,
  with the `"to":"pick"` / `"to":"reject"` payloads that produced them. **No
  frame.** **Calls** ~6.
- **⚠ I tried to shoot this tonight and could not.** The flags set correctly
  (`184225` pick, `195765` + `127567` reject, all `by: human`) and the turn
  returned:
  ```
  429 {"success":false,"error":{"code":"AGENT_RATE_LIMITED",
       "message":"You have used this hour’s shared agent budget. Try again shortly."}}
  ```
  Raw: `docs/night/e2e-evidence/note-swatches-inverted.json`.
- **The page does say so, clearly.** *"You have used this hour's shared agent
  budget. Try again shortly."* renders in red under the utterance bar,
  `role="alert"`. So a spent budget is visible on camera and an operator will
  know. **Probe it with one throwaway instruction before rolling.**

---

## Beat 4 — Enter on an empty bar · 0:52–1:12

### S07 · The armed bar

- **On screen.** The utterance bar, empty, with a hairline under it carrying `↵`.
  Tight.
- **Said.** *"Now watch the bar. It's empty."*
- **Page + input.** Any board with one confirmed flag on it.
- **Headless** yes. **Exists** yes — `enter-armed.png`; re-verified live
  (`.lt-enter-armed` absent before the flag, `"↵"` after). **Calls** 0.

### S08 · The redeal, activity glyph closed

- **On screen.** Enter. The board deals. The glyph does not move.
- **Said.** *"Same board. Same picks. Same slots."*
- **Headless** yes. **Exists** yes. **Calls** 0.

### S09 · The network log

- **On screen.** A four-line graphic over the held board. **Not a screenshot of
  devtools** — set it.
- **Said.** *"That redeal made one request, to a scoring endpoint. No model was
  called at all. Sixty-three thousand works, and the loop that moves through
  them is three keys. P, X, Enter. It runs with the agent switched off."*
- **On-screen text.**
  ```
  GET   /api/public-search/nga/quota
  POST  /api/public-search/nga/text
  POST  /api/public-search/nga/exemplars   ← Enter
  POST  /api/public-search/nga/exemplars   ← Enter
  ```
- **Source.** `docs/night/e2e-evidence/deterministic-network.json`, verbatim.
  Regenerate with `node scripts/demo/e2e-deterministic.mjs https://paillette-stg.berlayar.ai`.
- **Headless** n/a (graphic). **Exists** yes. **Calls** 0.

### S10 · (optional insert) With no agent at all

- **On screen.** The same board in a page with no prompt bar.
- **Said.** — (covered by S09's VO)
- **Headless** yes. **Exists** yes — `e2e-17-no-host-deterministic-redeal.png`.
  **Calls** 0.

---

## Beat 5 — The show, and the correction · 1:12–1:50

### S11 · Title, statement, labels

- **On screen.** The exhibition head above the board: title and statement in
  serif. A label under every work.
- **Said.** *"Keep going and there's a show on the table. A title, a statement,
  and a label under every work."*
- **Page + input.** `node scripts/demo/e2e-curation.mjs https://paillette-stg.berlayar.ai`.
- **Headless** yes. **Exists** yes — `fix-iteration-1/01-drafted.png`.
  **Calls** ~5.

### S12 · The correction, typed

- **On screen.** The statement selected and typed over. Ctrl+Enter.
- **Said.** *"The statement is wrong. It isn't about weather. Committing the
  correction* is *the turn."*
- **On-screen text (typed).** `It is not about weather. It is about leaving: places with the people already gone.`
- **Page + input.** Click the paragraph, select all, type, Ctrl+Enter. The
  gesture matters: committing the statement dispatches `commitHumanTurn`
  (fix log §7). Before that fix nothing called it at all.
- **Headless** yes. **Exists** yes — driven in the 11/11 walk. **Calls** 0 (the
  turn it fires is counted in S13).

### S13 · The board and the labels change

- **On screen.** The board re-selects. Every label rewrites. The human's
  sentence sits untouched above it.
- **Said.** *"It re-selects. It rewrites every label against my sentence. It
  doesn't touch my sentence."*
- **Headless** yes. **Exists** yes — `fix-iteration-1/02-after-correction.png`.
  Measured: 2 POSTs to `/public-agent/turn` after the edit, 18 of 18 labels
  rewritten, statement returns `by: "human", theirs: true`. **Calls** ~5–8.

### S14 · One label, before and after

- **On screen.** A two-up card. Same painting, two labels.
- **Said.** — (silent, held)
- **On-screen text.** From `labels-ab.json`, verbatim:
  > **weather** — *The river carries the last light of the day beneath a setting
  > sun. Painted in oil on wood, the scene closes the hanging order with weather
  > and illumination settling toward evening.*
  >
  > **leaving** — *The river carries the eye through an unpeopled stretch of
  > shore, where no boat or figure interrupts the water's course. At day's end,
  > the scene reads as a place left behind rather than a view awaiting activity.*
- **Headless** n/a (graphic). **Exists** yes — `labels-ab.json`. **Calls** 0.
- **⚠** Both of those were written `writtenFrom: "catalogue"` — that work has no
  stored caption. A captioned pair (Bruegel, `source: caption`) is quoted in
  `docs/night/curation-report.md` and is a stronger card if the film has room to
  swap it. Do not let the VO imply the label was written from the image.

---

## Beat 6 — It leaves the tab · 1:50–2:06

### S15 · Copy link

- **On screen.** The `COPY LINK` control on the exhibition rail. Label sequence
  `Copying… → Copied → Copy link`.
- **Said.** *"And it leaves."*
- **Headless** yes. **Exists** yes — sharing report drove it headless against
  staging. **Calls** 0.

### S16 · The link, opened cold

- **On screen.** A browser window with no session. The exhibition page: title in
  serif, works hung, labels under them.
- **Said.** *"A real URL. Six works, the labels, my words —"*
- **Page.** `https://paillette-stg.berlayar.ai/e/MKwsxHy`
- **Headless** yes. **Exists** yes — `fix-iteration-1/03-exhibition-cold.png`
  here, and `docs/night/shots/share-cold-open.png` on `night/sharing`, which is
  **not merged into this branch yet**. Re-verified live
  tonight: `200`, `<h1>` = *Everything the Light Left Behind*, **0 localStorage
  keys read**. **Calls** 0.
- **⚠** Confirm it still resolves on the day. It is a staging row with no
  retention policy and no way to delete or expire it.

### S17 · The colophon

- **On screen.** The line at the foot of the page.
- **Said.** *"— and a line at the bottom saying how many of them an agent
  wrote."*
- **On-screen text.** `·· 4 of 6 labels written by an agent`
- **Headless** yes. **Exists** yes — `42-exhibition-colophon.png`; re-verified
  live tonight. **Calls** 0.
- **⚠ Do not shoot a social unfurl.** The Open Graph tags and the `og:image` are
  real and were fetched, but nothing has ever been pasted into Slack, WhatsApp
  or X to see a card render.

---

## Beat 7 — Co-curator · 2:06–2:18

### S18 · The finished hang, held

- **On screen.** The exhibition page, still. No chrome, no cursor.
- **Said.** *"So the agent becomes a co-curator. I didn't search for a single
  one of these. I described a room."* — see `docs/webmcp-vo-script-v2.md` §3.1
  for the alternatives.
- **Headless** yes. **Exists** yes. **Calls** 0.
- **⚠** The line is only true if S01 was the agentic instruction. If the film
  opens by typing a query into the search field, the human *did* search — cut
  the line.

---

## Beat 8 — Without looking · 2:18–2:34

### S19 · Tab, and a flag

- **On screen.** No cursor anywhere. The focus ring stepping through the board
  and landing on a flag control. A rendered screen-reader caption. Then `X`, and
  the mark appearing.
- **Said.** *"None of that needed a mouse. Tab to a work and the control says
  its name and its key — 'Pick, Environs de Cremieu, P.' The note is one
  sentence."*
- **On-screen text.** `Pick Environs de Cremieu (P)` / `Reject Environs de Cremieu (X)`
- **Page + input.** `/nga/search?q=warm landscape`, keyboard only. **23 Tab
  presses** from cold load reach the first card's flag control — verified
  first-hand tonight. Then `x`.
- **Headless** yes. **Exists** ❌ **no committed frame**, but the behaviour was
  observed live tonight: `document.activeElement` = `BUTTON` /
  `"Pick Environs de Cremieu (P)"`, `[data-hovered="true"]` set by focus
  (`flag-controls.tsx:147`, `onFocus: point`), `x` flags it `by: "human"`,
  `aria-pressed` reflects it. **Calls** 0.
- **⚠** 23 tabs is a lot of screen time. Cut to the moment the ring lands.

### S20 · Read aloud

- **On screen.** An artwork dialog with the `Read this aloud` control. Press it.
- **Said.** *"Ask for a description and the browser reads it aloud, with no
  agent and no account. Someone who can't see the pictures is still the one
  choosing."*
- **Headless** ❌ — headless Chromium here reports `speechSynthesis` with **zero
  voices installed**. No audio has ever been produced from this build.
- **Exists** ❌ **and it may not be shootable.** The control renders only where
  the work has a stored caption or description. Opening a cold NGA work tonight,
  the dialog offered `["Laurent de La Hyre", "Public metadata", "Copy"]` — **no
  read-aloud button.** Most NGA rows have no caption; all twelve labels in the
  A/B were written from the catalogue rather than a caption.
- **Before filming:** find a work that has a caption, confirm the button
  renders, and confirm the machine has a voice installed. **If it does not
  render, cut this shot and the second half of the line.** S19 alone carries the
  beat and is fully proven.
- **Calls** 0 (or 1 if a description has to be generated).

---

## Beat 9 — WebMCP, on screen · 2:34–2:50

### S21 · The glyph at rest

- **On screen.** Five monospace dots. Tight — the element is 68 × 33 px.
- **Said.** *"How it's built is on the page. Five dots until a tool runs."*
- **Headless** yes. **Exists** yes — `shots/activity/01b-idle-glyph.png`;
  re-verified live (`.pa-activity-glyph`, text `·····`, 68 × 33). **Calls** 0.

### S22 · The tool surface

- **On screen.** Click the glyph. The panel opens: `document.modelContext · 25`
  and the twenty-five names in two columns.
- **Said.** *"Twenty-five tools on `document.modelContext` —"*
- **Page + input.** Click `[aria-label="Agent activity"]`.
- **Headless** yes. **Exists** yes — captured live tonight (panel 460 × 276 px).
  **Calls** 0.
- **This is the shot that answers "how did you implement WebMCP".** It costs
  nothing and it cannot be faked.

### S23 · The log filling

- **On screen.** Over a live agent run: rows appearing, each with a tool name,
  its arguments inline, a duration on the right, one line of result. Then a row
  expanded into full request and response JSON.
- **Said.** *"— with their arguments, their answers and their timings."*
- **On-screen text.** From `shots/activity/08-log-row-expanded.png`, verbatim:
  ```
  search_artworks                                6.0s
  {"query":"estuary at dusk"}
  12 results
  → { "ok": true, "collection": "nga", "count": 12, "queryTimeMs": 118, … }

  describe_artwork                               6.0s
  {"artwork":"open-access-art:nga:41623"}
  "A low grey horizon under a bank of cloud, with two boats at anc…"

  redeal                                         6.0s
  {"count":12}
  dealt 12 · 11 new · 1 held · steady
  ```
- **Headless** yes. **Exists** yes — `08-log-row-expanded.png`,
  `07b-log-detail.png`. **Calls** ~4 for a fresh run, or reuse the frame.

### S24 · The two hands

- **On screen.** A held graphic, not the page: the tool on the left, the key on
  the right.
- **Said.** *"Every tool in the culling loop wraps a key the human already
  presses. `flag_artworks` is P and X. `redeal` is Enter. `compare_artworks` is
  C. Same function, either hand. The loop has no agent-only path. One workspace.
  Two operators."*
- **On-screen text.**
  ```
  flag_artworks        P · X · U
  redeal               ↵
  compare_artworks     C
  ```
- **Headless** n/a (graphic). **Exists** yes — all three verified first-hand
  tonight from the keyboard with zero model calls. **Calls** 0.
- **⚠** Say *"the loop has no agent-only path"*, not *"there is no agent-only
  API"*. `write_labels` and `annotate_atlas` have no human control today.

---

## Beat 10 — End card · 2:50–2:58

### S25 · The card

- **On screen.** *For everything you can't name. And everything you can't see.*
- **Said.** — (silent)
- **⚠** If S20 does not survive, cut to *"For everything you can't name."*
  Alternatives in `docs/webmcp-vo-script-v2.md` §3.2.

---

## Held in reserve

### R01 · The compare room

Two works at large scale on the dark ground, the question in serif between them,
**nothing else on screen**. Press `C` on a hovered card. Measured live tonight:
`{"box":{"x":0,"y":0,"w":1440,"h":1000},"portalled":true,"chromeVisible":[],"askedBy":"human"}`.
Headless, zero model calls, and it exists — `fix-iteration-1/05-compare.png`.

It is the best-looking ten seconds in the build and the current cut has no room
for it. If a beat runs short, put it in Beat 2 between S03 and S04: *"or ask for
one of two."* It was 1,700 px below the fold two iterations ago and is now
portalled to `document.body` with every other body child hidden.

### R02 · The board under `prefers-reduced-motion`

25 distinct layouts at `no-preference` against 4 at `reduce`, with the picks
still holding. Worth a caption if the film ever claims accessibility beyond
beat 8. ⚠ Only spot-checked with a pick already in slot 0 — a pick starting at
slot 5 is untested.

---

## Do not film

| | Why |
| --- | --- |
| `/night/deal` | A 40-work fixture harness. Filming it and calling it the app would be dishonest. |
| The ledger filmstrip | Built and tested, imported only by `/night/deal`. It is **not** on `/nga/search`. |
| A spoken take, on this machine | Headless Chromium here *does* expose `SpeechRecognition` and the mic control renders — but there is no microphone and **0 synthesis voices**. Push-to-talk enters `"Listening — release to send"`, and on release **nothing lands and nothing is reported**: no text, no error, no visible failure. Must be shot on a real machine. |
| A social unfurl card | Tags verified by fetch; never rendered in a real client. |
| Upload and indexing | Throat-clearing. Nothing in it is unique to WebMCP. |
| Anything with `?webmcp-debug` in the address bar | The bar renders without it — verified first-hand and by the e2e lane's own no-flag preflight (`e2e2-02-preflight-no-flag-at-all.png`). The flag now gates only the `window.__paillette_webmcp` console back door. **The e2e report's "URL to film" includes the flag because its harness needs the back door to drive tools; a camera does not.** Drop it, or a judge will assume the demo needs it. |

## Before the first take

1. `node scripts/demo/query-counts.mjs` — confirm the demo query still returns
   30. `warm landscape` returned 30 tonight, and 30 on four measurements in the
   fix log. `storm at sea` returns 4.
2. Confirm `https://paillette-stg.berlayar.ai/e/MKwsxHy` still resolves.
3. Confirm the tool count: `(await document.modelContext.getTools()).length`
   → **25**.
4. Raise the model cap for the filming IP, or film with a key. 40/hour is not
   enough for retakes — a cold instruction is 5–7 calls and a full loop 8–12.
   **Verify the budget is not already spent before rolling.** When it is, the
   turn 429s and the page says so in red under the bar — legible, but not
   something you want in a take. One throwaway instruction tells you.
5. **Reload the tab between takes.** Five clean redeals per pick set, then the
   board thins and by the seventh Enter is dead.
6. After any Enter typed *inside* the utterance bar, press Escape. Otherwise the
   caret stays in the bar, the next `X` types the letter, and the Enter after
   that sends `"xx"` to the model as an instruction.
