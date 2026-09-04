# Paillette — WebMCP demo voiceover, v2

Runtime **≈2:52**. **259 spoken words** across eight beats — 1:44 of speech at
150 wpm, so 40% of the film is silence. The board carries the rest.

This is a **revision** of the draft lane's v2, not a new script. What changed and
why is in §0. `docs/webmcp-vo-script-final.md` is superseded and must not be
merged back in.

## Reading the tiers

Every claim carries the tier of its evidence.

- **[P] PROVEN** — a report, a transcript, a committed frame or a live
  measurement attests to it. Named, with the source.
- **[B] BUILT, UNVERIFIED** — the code exists; nothing has demonstrated it end to
  end. **The shot may not exist.** Do not cut assuming it does.

**Nothing in the spoken script rests on a [B] claim.** The two [B] items —
read-aloud and any spoken take — are optional inserts, listed in §5, and the film
is complete without them.

Full mapping in `docs/night/submission-evidence.md`. Shot-by-shot capture notes
in `docs/night/shot-list.md`. What I wanted to say and could not is in
`docs/night/submission-report.md`.

---

# 0. What changed from the draft, and why

The draft was written mid-run, against iteration 2 of the end-to-end walk.
Iteration 5's walk and critique moved five things under it.

| Draft v2 | This revision | Why |
| --- | --- | --- |
| Ten beats, 2:58 | **Eight beats, ≈2:52** | Co-curator folded into the ending; beat 3 rebuilt around a stronger take. |
| Beat 3 was the note-and-swatches frame from `warm landscape` | **Beat 3 is the said/chose gap**, shot on staging in iteration 5 | *"You said blue, but picked three amber-brown sunset drawings and paintings; following the picks."* Two runs, cold, typed, with a committed frame. It is the strongest thing in the build and no lane had tested it. |
| Beat 5 said *"It re-selects. It writes a label under every work."* | **The re-selection claim is cut.** Beat 5 now claims contextual labels and statement provenance only | On today's deploy the correction turn worked in **1 of 4** hand-run attempts. One run put weather labels under a wall text reading *"It is not about weather"*. The claim outran the build. |
| *"Same picks. Same slots."* over any redeal | Same line; the shot is now **specified as the second consecutive Enter** | The deterministic redeal writes no note, the note's wrapper is `empty:hidden`, and the whole board — picks included — slides up **56 px** into the gap. §4. |
| Read-aloud in the spine, end card conditional on it | **Read-aloud is an optional insert. The end card is unconditional** | It renders only on a work with a stored caption, and no audio has ever been produced from this build by anyone. The keyboard half carries the beat alone and is fully proven. |
| `/e/MKwsxHy` alongside `/e/QWwJnL5` | **`/e/MKwsxHy` only** | Of seven published shows, four carry **no wall labels at all**, and both twelve-work ones are blank. `MKwsxHy` is the one page where the feature is visibly working. |
| "25 tools" | unchanged, re-verified in code this session | `PAILLETTE_TOOL_NAMES` in `apps/web/app/lib/webmcp/tools.ts`. |

Unchanged and still right: no upload beat, no *"Let AI be your eyes and ears"*,
no *"the true power of Paillette is unleashed…"*, **co-curator** not co-creator,
and an ending that closes the opening premise rather than announcing a roadmap.

---

# 1. The voiceover — paste this

**0:00 · Cold open — the loop**

> Most art is never seen. Not because it's hidden — because nobody knows what to
> ask for.
>
> So I stop asking. I point.
>
> *[hold — the board deals, the label lands]*
>
> I never typed any of those words. It read what I threw away.

**0:26 · Enter on an empty bar**

> Now the bar is empty. Nothing typed. Nothing said.
>
> *[Enter. The board deals.]*
>
> Same picks. Same slots. And not one call to a model.
>
> One request, to a vector index, under thirty milliseconds after the key.
>
> The agent isn't the mechanism. It's a second operator of one that works
> without it.

**0:58 · Say one thing, do another**

> Three warm pictures kept. Now I'll ask it for the opposite.
>
> *[types. hold — the label lands]*
>
> It followed my hands, not my mouth. And it said so.

**1:18 · Scale**

> Sixty-three thousand works. Open access, from the National Gallery of Art.
>
> Three keys move through all of them.

**1:30 · The show leaves the tab**

> What's left is a show, and the statement is mine.
>
> The labels are written against it. The same picture reads differently under a
> different sentence.
>
> Then it leaves. A real URL, no account, and a line saying how many of the
> labels an agent wrote.

**1:54 · Without looking**

> None of this needed a mouse.
>
> *[the focus ring lands; the caption renders]*
>
> The control says the work, and it says the key.
>
> Someone who can't see the pictures is still the one choosing. Not the one
> being told.

**2:14 · WebMCP, on screen**

> How it's built is on the page. Five dots until a tool runs.
>
> Twenty-five tools on `document.modelContext`, with their arguments, their
> answers and their timings.
>
> `flag_artworks` is P and X. `redeal` is Enter. `compare_artworks` is C.
>
> One workspace. Two operators.

**2:42 · Co-curator, and the card**

> So the agent becomes a co-curator. I didn't search for a single one of these.
> I described a room.
>
> *[silent]*

---

# 2. Beat by beat

Each beat names the shot it needs, whether that shot is possible today, and the
tier of every claim. **⚠ marks a dependency on something a lane reported
unverified, or a way the shot can go wrong.**

## Beat 1 — Cold open · 0:00–0:26

**On screen.** `/nga/search`, cold. The sofa sentence typing into the utterance
bar. A board, and a cyan wall label above it. Then `X`, `X`, `P` — three graphite
marks. Then one word typed, and the board deals again under a new label.

**Card (0:00, 2 s):** `Most art is never seen.`

**The shot — possible today.** `https://paillette-stg.berlayar.ai/nga/search`,
**no `?webmcp-debug`**. Type verbatim into `[aria-label="Ask the agent"]`:

> `I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.`

Enter. Wait for the label. Hover, `x`. Hover, `x`. Hover, `p`. Then type `again`
and Enter.

Every piece of that is from the walk the e2e lane ran three times in iteration 5
on the deployed build, with one deliberate omission: **their walk pressed Enter on
the empty bar between the flags and the `again`.** The film moves that Enter to
beat 2, where it belongs, so beat 1 goes label → `again` → label with no
collapse in between.

**⚠ `again` produces a redeal because the model chose one** — `redeal` appears 15
times in the night's tool-call census, so it does choose it, but it is a choice
and not a guarantee. If a take comes back with a search instead of a deal, run it
again.

**The label to hold**, iteration-5 run 3, verbatim:

> *Following the pick: sunset watercolor; away from the firelit scene and the
> red-chalk landscape.*

Rejected: *Harvesters by Firelight* (Samuel Palmer, pen and black ink with
watercolor and gouache) and *Northern Landscape Fantasy Evoking Tivoli*
(Berchem, **red chalk on laid paper**). Picked: *Clouds at Sunset*. Every noun in
that sentence is true of a specific work on the board.

| Claim | Tier | Source |
| --- | --- | --- |
| A typed instruction alone fires the agent — no microphone, no flag | **[P]** | e2e iteration 5, seven runs. The voice lane ran the whole loop with `SpeechRecognition` and `speechSynthesis` **deleted before any page script**. |
| `P`/`X`/`U` flag the hovered card in the human's ink, with zero model calls | **[P]** | e2e iteration 5: `pick/human`, `reject/human`; 4 of 4 runs measured **0 model calls across all three keypresses**. Shot `e2e5-03`. |
| The agent's redeal note names the *content* of what was rejected | **[P]** | e2e iteration 5, **3 of 3, with no wrong word in any of them** — medium, classification and palette checked against each named work. Shots `e2e5-20/21/22`. |
| The note is one sentence | **[P]** | Every note recorded in every harness all night. Capped at 160 characters in `redeal`'s own schema. |
| The board, the agent's label and the human's own sentence are in one frame | **[P]** | `e2e5-13-note-inside-board-before-redeal.png` — **I opened this file and checked it.** The graphite echo *"I want something to hang above the sofa…"* behind a grey rule, the cyan label *"A quiet warm-toned hang…"* behind a cyan rule, and the board: 8 cards whole, 12 in frame. |

**⚠ Timing, and it is the slowest thing in the film.** A cold typed instruction
costs **4–5 model calls** and the label lands **12–33 s** after Enter. The board
arrives before the sentence does, so a take cut at 15 s will sometimes catch a
board with no label on it. The follow-up costs 3 more calls and 8–14 s. Cut both
waits.

**⚠ Do not say "twelve" here** — even though it probably will be. The agent's
first board was 12 in **7 of 7** iteration-5 runs, but 8, 12, 10 and 12 across
iteration 2's four. Twelve is guaranteed of Enter and only likely of the agent's
first board. Beat 2 can say the number; this beat cannot.

**⚠ Do not name a screenshot that does not contain what you say it does.**
`e2e5-02-board-and-note.png` has the cyan label and **all twelve cards** but
**no human utterance in frame** — I checked. Two consecutive iterations of
reports claimed otherwise and were caught. Use `e2e5-13` for two inks; use
`e2e5-02` for twelve cards.

---

## Beat 2 — Enter on an empty bar · 0:26–0:58

**This is the strongest argument in the submission. It gets the most time.**

**On screen.** The utterance bar, empty, the `↵` hairline under it. Enter. The
board deals — rejects slide left into the tray, the pick does not move,
newcomers arrive from the right. Then a cut to the request log.

**Card**, the log, set as a graphic rather than a devtools screenshot:

```
POST /api/public-search/nga/exemplars   ← Enter, +8 ms
POST /api/public-agent/turn             ← 0
```

**The shot — possible today.** Same page, activity glyph closed. **Film the
second consecutive Enter, not the first** — see §4. Regenerate the log with
`node scripts/demo/e2e-deterministic.mjs https://paillette-stg.berlayar.ai`.

| Claim | Tier | Source |
| --- | --- | --- |
| Enter on an empty bar makes **zero** model calls | **[P]** | e2e iteration 5, four **silence-gated** runs — no request to `/api/public-agent/turn` for 20 consecutive seconds before touching anything, then every request timed from the keypress: `modelCallsAfterEnter = 0` in all four. The critique reproduced it independently. Iteration 2 counted 27 redeals across five harnesses with zero POSTs. |
| The first request is a vector search, under 30 ms after the key | **[P]** | `firstExemplarAt` = **+8 ms, +11 ms, +14 ms, +21 ms** (e2e iteration 5) and **+29 ms** (critique). Five independent measurements, all under 30. |
| The picks hold their slot | **[P], with one condition — read §4** | `planDeal` pins held ids to the index they already occupied, so Framer measures a delta of zero and animates nothing (`deal-board.tsx`, read this session). Measured board-to-board at `{"dx":0,"dy":0}`. |
| It deals rather than cuts | **[P]** | Distinct grid-relative layouts per redeal, iteration 5: **24, 20, 26, 15, 27** across 350–720 sampled frames. A jump cut measures 4–5. |
| Rejects go to a visible tray and stay restorable | **[P]** | `.lt-tray`, present after every redeal, visible at the left margin in `e2e5-14` — which I opened. |
| It keeps working with the model route hard-refusing `429` | **[P]** | `verify-agentless-loop.mjs` — 9 checks, three runs in a row. |
| It works with no WebMCP host on the page at all | **[P]** | e2e: *"no prompt bar without a host: count=0"*, and Enter still deals. Shot `e2e-17`. |
| Enter and the agent's `redeal` tool are the same function | **[P]** | Read in code this session: `submitHumanTurn` (`turn.ts:278`) and the `redeal` tool (`tools.ts:1645`) both call `runRedeal` from `lib/webmcp/redeal.ts`. Not a design intention — one import. |

**Say the negative out loud.** It is the only claim in the submission asserted
negatively, and it is what makes "two operators, one mechanism" a fact rather
than a slogan.

**⚠ Reload between takes.** The exemplar route draws from a fixed candidate pool
and subtracts everything already dealt, so after about five redeals on one pick
set the board thins and Enter goes dead. A fresh page resets it.

---

## Beat 3 — Say one thing, do another · 0:58–1:18

**On screen.** A board with three warm works picked, graphite frames on all
three. A sentence typed that asks for the opposite. Then the cyan label, held.

**Card**, verbatim:

> *You said blue, but picked three amber-brown sunset drawings and paintings;
> following the picks.*

**The shot — possible today, and a frame already exists.** From beat 1's board:
hover and `P` on three warm works, then type

> `I want something cool and blue and severe. Nothing warm.`

`docs/night/shots/crit5/c2-gapnote.png` is committed on this branch, from the
critique's own staging run. **I opened it and checked what is in it**: the cyan
label above, three swatch strips under it, twelve cards in one 1440×900 frame,
and *Harvesters by Firelight*, *An Indian Encampment at Sunset* and *Clouds at
Sunset* holding slots 0, 1 and 2 with graphite frames — while the newcomers are
*Clouds at Dawn*, *Marsh Landscape at Twilight*, *Vicinity of Morestal*,
*Landscape with Storm*. Amber and dusk, against an explicit request for blue.

The probe that produced it is committed beside it: `crit5/probe-conflict2.mjs`.

| Claim | Tier | Source |
| --- | --- | --- |
| The agent names the gap between what was said and what was chosen, and says which it followed | **[P]** | Critique iteration 5 §2. **Two runs, cold contexts, typed, no coaching**, on web `579886d4` / api `9995af12`. Both produced it. Frames `crit5/c2-gapnote.png`, `crit5/c3-gapnote.png`. |
| The board follows the picks while the words ask for the opposite | **[P]** | Same frame. Nine warm newcomers against a request for cool and blue. |
| Every human turn carries the words and the gestures together | **[P]** | `{ text?, flagsDelta, selection, hovered, compareChoice }` on every turn; e2e read `compareChoice` off an intercepted turn body verbatim. |
| Each flagged work reaches the agent with its palette, medium, year and classification | **[P]** | e2e iteration 5 read `get_view_context` off the wire: `{"palette":["#EEC8AB","#D88E5E","#C4A88C"],"medium":"red chalk on laid paper","year":1660,"classification":"Drawing"}`. |

**⚠ Use run c2's sentence, not c3's.** c3 said *"three ochre-and-amber
watercolors"* and the critique could not confirm the medium on all three. c2's
*"drawings and paintings"* is correct of the three works it names. A wrong word
in the one sentence the film is built on is the worst outcome available.

**⚠ The probe used `?webmcp-debug`** — but only to *read* palettes through
`get_view_context`. The instruction was typed and the three picks were real `P`
keypresses. **A camera needs no flag.** Drop it, or a judge will assume the demo
requires it.

**⚠ This beat costs a second agent turn** — 3–4 model calls and 8–14 s of dead
air. Cut the wait.

---

## Beat 4 — Scale · 1:18–1:30

**On screen.** The board pulling back, or one card held with the number set over
it. Evidence, not climax.

**Card:** `63,253 works · National Gallery of Art · CC0`

| Claim | Tier | Source |
| --- | --- | --- |
| 63,253 open-access works | **[P]** | `docs/HANDOFF.md` — paged `/api/public-search/nga/browse` to the last record. Rendered live on `/about`. Not re-derived tonight. |
| The loop through them is three keys | **[P]** | `P`, `X`, Enter, all driven from the keyboard with zero model calls. |

**The line that was cut, and stays cut.** *"The true power of Paillette is
unleashed when we run it over an entire collection."* Scale makes it useful; the
shared loop makes it new. The number lands once, in passing, and the film moves
on.

---

## Beat 5 — The show leaves the tab · 1:30–1:54

**On screen.** The exhibition head above the board: a title and a statement in
serif. The statement selected and typed over. Then a cut to a browser with no
session: `/e/MKwsxHy`, cold.

**Cards:** one label under two statements, then the colophon.

> **under *Weather at Sea*** — *Gray wash and dense linework give wind and cloud
> as much force as the two ships, which pitch through choppy water. The distant
> vessel underscores how quickly the storm has swallowed the open sea.*
>
> **under *Leaving*** — *Two ships strain through choppy water while a smaller
> vessel recedes in the distance. The ink and gray wash hold them at the
> uncertain point between departure and disappearance.*

Petrus Johannes Schotel, *Ships in a Stormy Sea*, 1835. Both labels are committed
verbatim in `docs/night/shots/crit5/show-x4-before.json` and `show-x4-after.json`,
where the human's statement reads back `"by": "human", "theirs": true`.

**Colophon card:** `4 of 6 labels written by an agent`

**The shot — possible today, in two pieces.**
`node scripts/demo/e2e-curation.mjs https://paillette-stg.berlayar.ai` drives the
correction the way a person does: click the paragraph, select all, type, commit
with Ctrl+Enter. Then `https://paillette-stg.berlayar.ai/e/MKwsxHy` in a clean
profile — the frame is `docs/night/shots/crit5/share-MKwsxHy.png`, which I opened.

| Claim | Tier | Source |
| --- | --- | --- |
| The agent drafts a title and a statement | **[P]** | Curation walk on the deployed build, 11 of 11. |
| A statement the human has edited stays theirs | **[P]** | Comes back `by: "human", theirs: true`; an agent write onto it parks under `deferred`. The critique confirmed it **on the wire** on today's deploy, in every run — including the ones that otherwise failed. |
| The same work gets a genuinely different label under a different statement | **[P]** | `verify-contextual-labels.mjs` — same works, same call, only the statement changed: **3 of 3 substantively different**, not paraphrases. The critique re-checked `curation-evidence/contextual-labels.txt` and says explicitly this one is real and should not be re-litigated. |
| Committing the statement is itself a turn | **[P]** | Fix log §7: 2 POSTs to `/public-agent/turn` after the edit. Before that fix nothing called `submitHumanTurn` at all. |
| `/e/MKwsxHy` opens cold, server-rendered, with agent labels and one human-written one | **[P]** | Critique §10 opened all seven published codes in fresh contexts. This one: 200, six works, six images, a 45-word human statement, agent labels *"The valley empties of light before anyone has decided to go."* and *"A stopping place, which is not the same as an arrival."*, and the human's own *"Two people sitting for a picture that will outlast the room."* **0 localStorage keys read.** |
| Real Open Graph tags, and a JSON branch for crawlers | **[P]** | Sharing lane: 30 of 30 crawler unfurls with `og:title`, `og:image` on the Gallery's own IIIF endpoint, `summary_large_image`. |
| The colophon counts agent-written labels from the data | **[P]** | *"4 of 6 labels written by an agent"*, matching the four sent as agent-written. |

**⚠ Do not say "it re-selects".** On today's deploy the critique ran the
correction four times by hand: one produced nothing at all in 150 s; one changed
**0 works** and left weather labels under a wall text reading *"It is not about
weather"*; one changed **0 labels in 180 s**; one worked completely. **1 of 4.**
`MAX_TURNS` is 8 and a drafting turn routinely spends five or six of them
searching, so the correction turn starves. The earlier 3-of-3 evidence comes
from a lane that predates the 14:33 API redeploy.

**⚠ Do not shoot the board's labels arriving live.** Works added to a show after
`write_labels` are never labelled. **Four of seven published shows carry no wall
labels whatsoever**, and the two twelve-work ones — the two that look most like
real exhibitions — are exactly the two that are blank. Point at `MKwsxHy`, which
works, and film the finished page rather than the drafting.

**⚠ Do not imply the label was written from the picture.** `write_labels` reads
a stored caption where one exists and the catalogue record where it does not,
and returns which. Most NGA rows have no caption.

**⚠ Do not shoot a social unfurl.** The tags and the image were fetched and are
real; nothing has ever been pasted into Slack, WhatsApp or X.

---

## Beat 6 — Without looking · 1:54–2:14

**On screen.** No cursor anywhere. Tab stepping through the board, the focus ring
landing on a flag control, a screen-reader caption rendered on screen. Then `X`,
and the mark appearing.

**Cards:** `Pick Environs de Cremieu (P)`, then
`Enter on the empty bar redeals the board from your flags.`

**The shot — possible today.** `/nga/search?q=warm landscape`, keyboard only, no
mouse events at all. **23 Tab presses** from a cold load reach the first card's
flag control. Cut to the moment the ring lands; 23 tabs is a lot of screen time.
No committed frame exists — this beat has to be shot.

| Claim | Tier | Source |
| --- | --- | --- |
| Focus sets the flag anchor, not just hover | **[P]** | Draft lane, first-hand: `document.activeElement` = `BUTTON` / `"Pick Environs de Cremieu (P)"`, `[data-hovered="true"]` set by focus (`flag-controls.tsx:147`, `onFocus: point`), then `x` flags it `by: "human"`. |
| The control announces the work and the key | **[P]** | Accessible names `"Pick Environs de Cremieu (P)"` / `"Reject Environs de Cremieu (X)"`, with `aria-pressed`. |
| The headline behaviour is announced to a screen reader | **[P]** | `sr-only[role="status"]`; string read in code this session at `galleries.$galleryId.search.tsx:3025`. |
| The deal announces what changed, not that it animated | **[P]** | `deal-board.tsx`: `"N works on the board. K kept in place, M new."`, `sr-only`, `aria-live="polite"`. |
| The board survives `prefers-reduced-motion` | **[P], partial** | 25 distinct layouts at `no-preference` against 4 at `reduce`, picks still held. **Only spot-checked with a pick in slot 0.** |

**This beat is participation, not assistance.** The line is *"still the one
choosing"*, and it earns it: a keyboard user sets the anchor, presses the key,
and hears what changed on the board. They are directing attention and making
judgements, not receiving descriptions. **Do not use *"Let AI be your eyes and
ears"* here or anywhere** — it says the opposite of what the shot shows.

---

## Beat 7 — WebMCP, on screen · 2:14–2:42

**On screen.** The glyph at rest — five monospace dots, 68 × 33 px. Click. The
tool surface: `document.modelContext · 25` and the names. Then, over a live run,
the log filling. Then one row expanded into full request and response.

**Card**, verbatim from `shots/activity/08-log-row-expanded.png`:

```
search_artworks                                    6.0s
{"query":"estuary at dusk"}
12 results
→ { "ok": true, "collection": "nga", "count": 12, "queryTimeMs": 118, … }

redeal                                             6.0s
{"count":12}
dealt 12 · 11 new · 1 held · steady
```

**Card, held, at 2:34:**

```
flag_artworks        P · X · U
redeal               ↵
compare_artworks     C
```

**The shot — possible today, headlessly, for free.** Click
`[aria-label="Agent activity"]`. **The tool surface opens with zero model
calls.** Only the filled log needs a live run.

| Claim | Tier | Source |
| --- | --- | --- |
| 25 tools on `document.modelContext`, on every visit, no flag | **[P]** | `PAILLETTE_TOOL_NAMES` counted in `tools.ts` this session; e2e saw 25 on **20 of 20** cold loads; `registry.test.ts` fails if the list and the factory disagree. **Every doc saying 17 or 21 is wrong.** |
| The glyph is five cells at rest and animates by tool kind | **[P]** | `.pa-activity-glyph`, text `·····`, 68 × 33 px, with no agent on the page. Six motions — scan, look, deal, mark, build, read — with distinct frame tables; contact sheet at `shots/activity/09-frames-contact-sheet.png`. |
| Clicking it lists the whole tool surface | **[P]** | Panel reads `document.modelContext · 25` then all 25 names, read from the registry. **Zero model calls.** |
| The log shows arguments, results and durations, expandable to full JSON | **[P]** | `shots/activity/08-log-row-expanded.png`. The critique read one off its own run: `get_view_context · 11ms · {} · read the view · nga · 30 on screen`. |
| No chrome narrating the mechanism | **[P]** | Fix log §9: "AGENT ACTIVITY", "WEBMCP CONNECTED", "PINNED BY THE AGENT" all grep to nothing but one `aria-label`. Placeholder empty on the deployed build. |
| Each of the three culling tools wraps a key the human presses | **[P]** | `P`/`X`/`U`, Enter and `C` all driven from the keyboard with zero model calls; `redeal` and Enter are one function. |

**⚠ Say *"the loop has no agent-only path"*, not *"there is no agent-only
API"*.** `write_labels` and `annotate_atlas` have no human control today. A human
can write any label by hand; they cannot ask for six at once, or name a region of
the atlas.

**⚠ Name only tools that exist.** The 25 are listed in
`docs/night/submission-evidence.md`. The **ledger filmstrip is not on
`/nga/search`** — it is imported only by `/night/deal`, a 40-work fixture route.
Do not film it as a product feature. **`agent-drive.mjs` does not exist** anywhere
in this repo; the capture harness is `scripts/demo/capture.mjs`.

---

## Beat 8 — Co-curator, and the card · 2:42–2:56

**On screen.** The finished hang, held. No chrome, no cursor. Then the card.

**End card:** `For everything you can't name. And everything you can't see.`

Decisions and alternatives in §3.

**⚠ The co-curator line has a precondition.** *"I didn't search for a single one
of these"* is only true if the cold open was the **agentic instruction** in the
utterance bar. If the film opens by typing into the catalogue search field, the
human did search — cut the line. On a cold `/nga/search` there are still **two
live text fields**, and the prominent one is the ordinary catalogue search. Aim
the cursor carefully, and check the frame afterwards.

---

# 3. Two decisions for the owner

## 3.1 Completing "So now the agent becomes a co-curator…"

**Recommended — A.**

> **"I didn't search for a single one of these. I described a room."**

It is literally true of the take: the human types one sentence into the utterance
bar and then presses keys. The agent authored every query — the recorded capture
shows `search_by_color` ×2 and `search_artworks` ×2, and the human authored none.
It names the curatorial act without using the word: describing a room *is* the
curation, and the works already existed. Twelve words, no abstraction in any of
them.

**B.**

> "Sixty-three thousand works, narrowed to five, for one wall in one room."

Better rhythm, and it combines with A. But it makes the number the punchline,
which is exactly what this structure moved away from — and beat 4 has already
spent the number. It is also brittle: the board is twelve and the recorded show
was six, so **count on the day** if you use it.

**A + B, if the beat can take four more seconds:**

> *"I didn't search for a single one of these. I described a room. Sixty-three
> thousand works, for one wall."*

**C.**

> "I pointed. It found the word."

The tightest sentence available, and the whole thesis in five words — but it
describes beat 3, not the show, so it is a weaker *co-curator* line. Keep it for
the Devpost, where it opens the answer to "what's newly possible".

**On the word.** **Co-curator, not co-creator.** The works already exist; what is
co-created is the curation. The precision is free, and the wrong word invites the
obvious objection from a judge who is looking for one.

## 3.2 The ending and the end card

**Recommended.**

> **"For everything you can't name. And everything you can't see."**

It closes the opening line — *most art is never seen* — on both halves at once.
*Can't name* is the culling loop. *Can't see* is beat 6, and **beat 6 is fully
proven without read-aloud**: a keyboard user tabs to a control that says the work
and the key, presses it, and hears what changed on the board. That is someone who
cannot see the pictures doing the choosing.

**This is now unconditional.** The draft made the second half contingent on the
read-aloud button rendering, which it may not. That contingency is gone — the
second half now rests on the keyboard and screen-reader beat, which is proven
first-hand, so nothing has to be cut on the day.

Set it silent over the finished hang. The voiceover has already stopped.

**Alternative, if beat 6 is cut for time.**

> "For everything you can't name."

Cut the second half rather than softening it. The first stands alone.

**Rejected, and still rejected.**

- *"Today, on one collection. Next, on every collection."* — roadmap-speak. The
  film would end on a promise instead of a thing.
- *"…and in the future, your ears too."* — read-aloud ships today. It makes a
  shipped feature sound unbuilt. (Though see §5: shipped is not the same as
  demonstrated.)

---

# 4. The one defect the film has to be shot around

**The human's own Enter deletes the agent's sentence, and the whole board slides
up 56 px into the gap.**

Read in code this session, and the arithmetic closes exactly. `deal-board.tsx`
renders `header ? <div className="mb-3 shrink-0 empty:hidden">`. The
deterministic redeal writes no note, so `header` is `null`, the wrapper is not
rendered at all, and 44 px of sentence plus 12 px of margin collapse. The e2e
lane measured the pick at grid-relative y **72 → 16**, inside a grid whose own
top did not move (176 → 176) — so this is the card changing position, not the
container sliding under a still board. Reproduced 3 of 3 by the critique, twice
more by the e2e lane. Shots `e2e5-13` (a cyan label over twelve works) and
`e2e5-14` (twelve works and silence) are the before and after. **I opened both.**

It lands on the beat the whole submission is built on, and that beat's entire
content is that the picks do not move.

**What to do, in order of preference.**

1. **Fix it.** `redeal`'s schema already carries `note?: string`. Have the
   deterministic path write its own one-line label with no model call — *"Two
   rejects held. Ten works away from red chalk and firelight."* That removes the
   56 px, keeps a wall label on the board at the headline beat, and turns the
   defect into the clearest possible proof that **the board still speaks with the
   model switched off**. It is the single highest-value change available to this
   film. Reserve `paillette-exhibition-head`'s 104 px separately; the e2e lane
   proved they are two independent defects and that fixing the strip alone will
   not hold the picks.
2. **Film the second consecutive Enter.** With no label on screen before or
   after, nothing collapses and the picks hold at zero pixels. This is what the
   shot list specifies. It is an honest take of real behaviour — the board is
   silent because no model was called, which is the point of the beat — but it is
   a take chosen around a defect, and the owner should know that is what it is.
3. **Do not** say *"same picks, same slots"* over a first Enter from a
   label-bearing board. The footage contradicts the line, and a judge who scrubs
   back will see it.

**Beat 1 is not exposed to this**, because its redeal is the agent's and a note
is on screen before and after, so nothing collapses. ⚠ That is an inference from
the code, not a measurement — **check it in the first take** rather than assuming
it.

---

# 5. What the film does not claim, and why

All of this is real code that nobody has demonstrated. None of it is in the
spoken script.

**Read-aloud.** `SpeakButton` is real, feature-detected on
`window.speechSynthesis`, labelled *"Read this aloud"*, and needs no agent and no
account. But it renders only where a work has a stored caption, and a cold NGA
work opened by the draft lane offered `["Laurent de La Hyre", "Public metadata",
"Copy"]` — **no read-aloud control**. Headless Chromium here reports **zero
voices installed**. **No audio has ever been produced from this build, by
anybody.** If a captioned work is found on a machine with a voice, it is a good
optional insert in beat 6. It is not in the script, and the end card no longer
depends on it.

**The spoken half of the loop.** Push-to-talk, the 1.2 s grace bar, the deictic
chips, and the note being spoken back only after a spoken turn. All built, all
tested against a fake recogniser, **none of it has met a microphone**. The
live-voice lane says so in its own summary. Headless Chromium cannot do real
speech recognition — Chrome ships the audio to Google's service. **A spoken take
must be filmed on a real machine.** The script above requires none: every beat is
typed or keyed.

**The agent marking the board.** `flag_artworks` and `compare_artworks` work,
render in dashed agent ink beside the human's solid mark, and are reachable from
a typed sentence — *"mark the ones on this board you would throw out"* produced
six provisional rejects in agent ink. But across **508 model-chosen tool calls**
in every transcript the night produced, the model chose `flag_artworks` **0**
times and `compare_artworks` **0** times, and the natural phrasings — *"Narrow
these down for me — I can only hang one."*, *"I'm torn. Help me decide."* —
produced a sentence and no marks. **The film does not show two hands marking one
board**, because outside a debug console that frame does not exist. Describe what
the tool does; never imply the agent volunteers it.

**The compare two-up.** The best-composed screen in the product — two works large
on charcoal, the question in serif between them, one control, nothing else
(`e2e5-06`, full-bleed at 1440×900, which I opened). It is in the shot list's
reserve. It is reliably reachable by pressing `C`; it is not reliably reachable
by asking.

---

# 6. Two constraints, audited

**Text first.** Every beat is typed or keyed. Nothing in the spine needs a
microphone, and the agentic trigger fires from typing alone — seven runs in e2e
iteration 5, six more by the critique, and once with the speech APIs deleted
before any page script ran.

| Beat | Input | Needs speech? |
| --- | --- | --- |
| 1 Cold open | typed sentence, `X` `X` `P`, one word | no |
| 2 Enter on an empty bar | Enter | no |
| 3 Say one thing, do another | `P` ×3, typed sentence | no |
| 4 Scale | — | no |
| 5 The show | typed correction, Ctrl+Enter, one click | no |
| 6 Without looking | Tab, `X` | no |
| 7 WebMCP on screen | one click | no |
| 8 End card | — | no |

**Cut the words.** 259 spoken words in a 2:52 film — 1:44 of speech, so 40% of
the runtime is silence. What went this round, and why:

- *"It re-selects. It writes a label under every work."* — **untrue on today's
  deploy.** Cut for being wrong, which is the best reason available.
- *"Ask for a description and the browser reads it aloud."* — never demonstrated.
  Cut.
- *"A real URL. Six works, the labels, my words. And a line saying how many an
  agent wrote."* — four clauses where the card is already the line. Now one
  sentence.
- The beat-3 explanation of *how* the note was written. The swatch strips sit
  under the sentence; saying it as well is a caption on a mark.
- *"Same function, either hand."* — the three tool/key pairs on screen enact it.
  The precise wording lives in the Devpost, where prose is the medium.

Nothing was made cryptic to be short. Every beat still names its subject.

---

# 7. Production notes

**Model budget fails quietly until it doesn't.** 40 anonymous calls per client per
hour, keyed on IP. Beat 1 costs 7–8, beat 3 costs 3–4, beat 5 costs 5–8. That is
**two or three complete takes an hour.** When it runs out the turn returns 429 and
the page renders the server's own sentence in red under the bar, `role="alert"` —
*"You have used this hour's shared agent budget. Try again shortly."* Legible,
and not something you want in a take. **Probe with one throwaway instruction
before rolling.** Film with a raised cap or a key.

**Poll, don't sleep.** The agent bar takes **691–2786 ms** to mount across 20 cold
loads, with at least one outlier past 4500 ms. A harness that sleeps a flat
interval will report a false failure.

**Search rate limit.** Ten NGA searches per minute per client, shared between the
agent's search bursts and the deterministic redeal. It refused a redeal mid-run
for the e2e lane. **Pace takes about a minute apart**, or raise
`PUBLIC_SEARCH_COLD_MISS_LIMIT_PER_MINUTE` in `apps/api/wrangler.toml` — it is an
abuse control on a public site, so the number is the owner's to pick.

**Reload between takes.** Five clean redeals per pick set; by the seventh, Enter
is a dead key.

**Never film the harness.** Everything above is `/nga/search` against the live
63,253. `/night/deal` is a 40-work fixture route. The compare room reached the
product page; the ledger did not.

**Never film the address bar with `?webmcp-debug` in it.** The utterance bar, the
stub host and all 25 tools render without it. The flag now gates only the
`window.__paillette_webmcp` console back door, which a camera does not need. The
e2e and critique harnesses carry it because they drive tools directly.

**A judge handed the bare domain never reaches the app.**
`https://paillette-stg.berlayar.ai` is titled *"Paillette - AI-Powered Gallery
Platform"*, headed *"Powerful Features"*, and the string `/nga/search` appears in
no link on the page. Unchanged across two iterations. Either add one link, or
point every URL in the submission straight at `/nga/search`.

**One hazard.** Pressing Enter *inside* the utterance bar can leave the caret
there, so the next `X` types the letter into the bar and the Enter after that
sends `"xx"` to the model as an instruction. `7dd250c` fixed the *catalogue*
field's autofocus, not this. Press Escape after any Enter in the bar, or drive it
the way a person does — hover, keys, Enter with nothing focused.

**Check the query before rolling.** `warm landscape` returned 30 on five separate
measurements. `storm at sea` returns 4. `node scripts/demo/query-counts.mjs`
re-checks in one command.
