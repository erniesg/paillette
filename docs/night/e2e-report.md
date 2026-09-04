# End to end — the demo loop on a deployed build, driven by typing

# Iteration 3

Run on 2026-09-04, 07:55–08:46 UTC, against **https://paillette-stg.berlayar.ai**
(web version `9b056c22`, api `8a017206`), from `night/integration` at `164c416`.

I did not redeploy. `git diff --name-only 941f1c1..HEAD -- apps packages` is
empty, so the page under test is byte-identical to the commit staging was
deployed from. Everything below was measured in a browser against the live
63,253-work index. Nothing is stubbed and nothing is inherited from another
lane's report; where I quote an earlier report it is to say it is now wrong.

---

## Verdict

**No — not the whole loop, not right now. Half of it is filmable this minute and
half of it is dead.**

The deterministic half — deal, `P`, `X`, Enter on an empty bar, twelve cards,
picks nailed in place, rejects into the tray, the deal animating — works, on
`/nga/search`, against the real collection, with **zero model calls**. I have it
on video. That half needs nothing from anybody.

The agentic half is **blocked**. Since roughly 08:20 UTC the deployed agent has
returned `429` to every single turn, continuously, for the 25 minutes I polled
it:

```
{"success":false,"error":{"code":"AGENT_UNAVAILABLE",
 "message":"The shared daily agent budget for this site is spent."}}
```

No typed instruction can fire the agent while that holds, so there is no board
from the agent, no wall label, no note, no two inks in one frame, and no
`beats.json` with tools in it. The capture harness ran to completion and
recorded `"toolsFired": []`.

I got in under the wire: between 07:55 and 08:20 the agent still answered, and
**everything §9 asks for was exercised against real model turns before it died.**
So this report has the evidence. It just cannot be reproduced today until the
budget question is settled.

### What blocks it, precisely

**Blocker 1 — the shared daily OpenAI budget is spent, and the limit is a
default nobody set.**

`apps/api/wrangler.toml:97` sets `AGENT_MODEL_CALLS_PER_HOUR = "600"` — the
capfix lane raised that ceiling. It does **not** set `OPENAI_DAILY_CALL_LIMIT`,
so `parseLimit` falls through to `DEFAULT_OPENAI_DAILY_CALL_LIMIT = 500`
(`apps/api/src/utils/openai.ts:35`). That is a **site-wide** counter, not
per-client: one KV key, `openai-quota:v1:<UTC date>` (`openai.ts:37`),
incremented once per model call by every lane, every verification harness and
every visitor, and reset only by the date rolling over at 00:00 UTC.

One typed instruction costs 5–6 of those 500. The night's lanes have been
spending them all along; my own runs spent roughly 55. There were two ceilings
and the capfix lane raised the wrong one — or rather, only one of the two.

**I could not determine from outside which of the two 429 branches fired**, and
that is itself worth fixing. `openaiChat` throws an identical
`OpenAiUnavailableError(…, 429)` when the site counter refuses *before* any
OpenAI request (`openai.ts:146`) and when OpenAI itself answers 429
(`openai.ts:173`), and `agent.ts` maps both to the same sentence. Timing does
not separate them: the refusal takes 0.68–1.55 s, a real `gpt-5.6-terra` round
trip from this box takes 1.22–1.75 s, and the worker's own `/health` takes
0.45 s. The two hypotheses are:

- the site's own 500/day counter is full — remedy is one line in
  `wrangler.toml` (`OPENAI_DAILY_CALL_LIMIT = "5000"`) plus an api redeploy;
- the worker's `OPENAI_API_KEY` is out of quota upstream — remedy is the owner's,
  not a code change.

Evidence bearing on it: **the key in `~/code/erniesg/tong/.env` is healthy.** I
called `gpt-5.6-terra` with it directly and got `200`. So whatever is exhausted
is either the site counter or a *different* key held as a Worker secret. I did
**not** rotate the deployed secret to the working key. That would have unblocked
the run in one command, but it points a public staging site's agent budget at an
unrelated project's billing account, and that is the owner's call, not a fix
phase's.

**Blocker 2 — the agent's note does not name what was rejected. 0 for 5.**

§9's third clause: *"Given the sofa prompt and two X presses, the agent's redeal
note refers to the content of what was rejected."* It did not, in any of the
five runs that completed before the budget ran out, under either reading of the
ordering. All five notes are quoted verbatim in §4 below, and I found the
mechanism: **the gestures reach the model on the first request of a turn only,
and the note is written five requests later, by which point the sentence naming
the rejects is no longer in context.**
`apps/web/app/components/webmcp/agent-prompt.tsx:396`:

```js
...(turn === 0 && gestures ? { turn: gestures } : {}),
```

This is not a blocker for *filming* — the notes that come back are good
sentences and the board is right. It is a blocker for the claim, and the claim
is one of the five bullets in the definition of done.

### Not blocking, but nobody should discover these on the day

1. **A human redeal writes no wall label at all.** Measured at five scroll
   positions after two human Enter redeals: `note: null` every time (§7). The
   label is the agent's only. So "two colours of ink in one frame" needs a live
   agent turn, and is unfilmable while blocker 1 stands.
2. **Choosing in the two-up still does not send a turn.** 0 POSTs within 1.5 s
   of the click. It resolves to pick/reject correctly; the choice rides the next
   turn. Unchanged from iteration 2, which flagged it deliberately.
3. **Flags do not survive a reload.** They survive a new search in the same tab
   — which is what "per session" has to mean — but a reload clears them
   completely. Iteration 2's advice to *"reload between takes"* therefore also
   wipes the flags. Both facts are true; whoever films needs both.
4. **The first redeal is a cut, not a deal**, and how bad depends on what was on
   screen first. From a browsing masonry: 4 distinct layouts and the picks
   travel 481 px and 425 px. From a board the agent set: 25 layouts and 54 px.
   Board-to-board it is 14–25 layouts and **0 px**. Film the second redeal, as
   every previous report has said.
5. **The note is clipped by the sticky search chrome** at the scroll position
   the page lands on after an agent turn — visible in
   `e2e3-01-after-instruction.png`, where the sentence is cut through
   horizontally by the toolbar.

---

## The two preflight questions

**Does the in-page agent render under `?webmcp-debug`? Yes.** `928b5dc` is an
ancestor of `HEAD` and works on the deployed build. No cherry-pick needed.

```json
{"bar":true,"host":true,"debugDriver":"function","cards":30,
 "glyph":true,"activeEl":"BODY","pageErrors":[]}
```

`activeEl: "BODY"` matters as much as the rest: focus is not parked in the
search field on a cold load, so `P`/`X`/`U` are live immediately.

**Is the deal animation on the real page, or only in the harness? It is on the
real page.** This is the one thing the brief called potentially blocking that
turns out to be fine, and I measured it rather than reading it off a report.

On `/nga/search?q=warm+landscape`, against the real collection, sampling every
card's bounding box once per animation frame across four consecutive redeals:

| redeal | cards | tray | distinct layouts | picks moved |
| --- | --- | --- | --- | --- |
| 1 (masonry → board) | 12 | 2 | 4 | 481 px, 425 px |
| 2 | 12 | 2 | **17** | 0 px, 2 px |
| 3 | 12 | 2 | **17** | 0 px, 0 px |
| 4 | 12 | 2 | **14** | 0 px, 0 px |

A jump cut measures 4–5, which is exactly what redeal 1 measures and exactly
what it is. Redeals 2–4 pass through 14–17 intermediate layouts. Video, 1440×900,
no model call anywhere in it:
**`docs/night/shots/video/e2e3-deal-on-nga-search.webm`**.

`/night/deal` is not what I tested and is not needed.

---

## §9, step by step

### 1. The sofa instruction, typed, with voice untouched

Typed character by character into the bar and submitted with Enter. Voice was
never used: no mic button was pressed, and the turn is dispatched as channel
`text`. (Headless Chromium *does* expose `webkitSpeechRecognition`, so the mic
button does render — my first harness asserted it would not and was wrong about
that. It renders and is ignored.)

The whole instruction arrived: **88 of 88 characters** in the field before Enter.

- **5 POSTs to `/api/public-agent/turn`** — a typed instruction alone fired the
  agent, with no coaching and nothing else on the page touched.
- **14,105 ms** from Enter to a settled board.
- **12 works** came back.
- The note, verbatim, in the agent's cyan (`rgb(94, 200, 216)`) and EB Garamond,
  `data-provenance="agent"`:

> **"Warm light, open breathing room, and gentle domestic colour for an easy
> living-room hang."**

Tool chain, read off the activity log the way a human would see it — name,
duration, arguments:

```
get_view_context     12ms  ok  {}
search_artworks     619ms  ok  {"query":"open landscape","collection":"nga","topK":12,"minScore":0.25}
search_artworks     782ms  ok  {"query":"quiet interior","collection":"nga","topK":12,"minScore":0.25}
search_artworks     758ms  ok  {"query":"still life flowers","collection":"nga","topK":12,"minScore":0.25}
search_by_color     874ms  ok  {"color":"gold","query":"landscape","collection":"nga","topK":12}
set_results          35ms  ok  {"artworkIds":["open-access-art:nga:184225", …]}
set_view              6ms  ok  {"view":"salon"}
```

Shots: `e2e3-01-after-instruction.png`, `e2e3-01b-activity-log.png`.

### 2. `X` on two, `P` on one — the flags persist and are visible

Hovered each card, pressed the key. Read back off the DOM and off computed
style, not off class names:

```
reject  nga:184225  data-flag-by=human  provisional=false  box-shadow rgba(230,227,220,.58) 0 0 0 1px
reject  nga:46426   data-flag-by=human  provisional=false  box-shadow rgba(230,227,220,.58) 0 0 0 1px
pick    nga:50826   data-flag-by=human  provisional=false  box-shadow rgb(230,227,220) 0 0 0 1px + lift
```

`rgb(230,227,220)` is graphite — the human's ink. Flagging made **0 requests of
any kind**, so it certainly made no model call.

`get_view_context` returns them, with the catalogue record attached, which is
what lets the agent talk about *content* rather than ids:

```json
{"picks":[{"id":"open-access-art:nga:50826","title":"Stylized Landscape",
  "artist":"American 19th Century","palette":["#584E26","#C0A659","#768347","#A1A97D"],
  "medium":"oil on canvas","year":1850,"classification":"Painting",
  "by":"human","onBoard":true}],
 "rejects":[{"id":"open-access-art:nga:184225","title":"Environs de Cremieu",
  "artist":"François-Auguste Ravier","palette":["#B89E81","#644F3F","#F4E8D6","#DCB17F"],
  "medium":"watercolor and graphite on laid paper","year":1885, …}, …]}
```

**Persistence, tested two ways** (`e2e3-10-*.png`):

| | result |
| --- | --- |
| a new search in the same tab (`"harbour at dusk"`) | **survives** — same 1 pick, same 2 rejects |
| a reload | **lost** — `{"picks":[],"rejects":[]}` |

### 3. Enter on an empty bar — the redeal, and no model call

This is the claim the brief says not to take on faith, so here is not a count
but **every request the page made**, from the keypress to the settled board:

```
POST /api/public-search/nga/exemplars
GET  https://api.nga.gov/iiif/bc34d795-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/16db7d22-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/4d3fb453-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/c552208a-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/af969695-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/efe2953f-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/b28faf81-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/aa56fcc5-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/717f3a55-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/dfea6612-…/full/400,/0/default.jpg
GET  https://api.nga.gov/iiif/f867baac-…/full/400,/0/default.jpg
```

Twelve requests: **one call to the deterministic Rocchio route and eleven
pictures.** There is nothing in that list a model call could be hiding in. The
listener was attached to `page.on('request')` before navigation, so it saw
everything the page issued.

The board that came back:

- **12 cards**
- both rejects gone from the board, and **both in the visible tray** —
  `tray holds 2: nga:46426, nga:184225`
- 11 works the board had not seen
- 25 distinct layouts across 478 sampled frames, first movement at 10 ms

Across every redeal I ran today — 2 in the ordered walk, 4 in the recorded
deterministic run, 3 in the note runs, 1 in the plain-browser run, 2 in the
framing run: **12 redeals, 0 POSTs to `/public-agent/turn`.**

And it holds with no agent on the page at all. Without `?webmcp-debug` the
console driver is absent (`debugDriver: false`) but the host is still claimed and
the bar still renders, and Enter on it deals twelve from the flags: `0` model
calls, `1` exemplar call (`e2e3-09-plain-browser-redeal.png`).

Picks, board to board: **`780,192 → 780,192`, zero pixels.**

Shots: `e2e3-03-after-redeal.png`, `e2e3-04-second-redeal.png`,
`e2e3-11-deal-*.png`.

### 4. The agent's next note, three times — this is the one that fails

Two orderings, because §9's wording permits both. Every note below came back
from a real model turn against the deployed build. The rejected works are given
in full so the "content" judgement can be made rather than taken.

**Ordering A — the brief's own step order.** Instruction → `X` on two → Enter on
an empty bar → one neutral nudge (`"again"`, deliberately empty of content, so
that anything the note says about the rejects came from the flags).

> **Run 1.** Rejected: *"Environs de Cremieu"* (Ravier, 1885, watercolor and
> graphite, `#B89E81 #644F3F #F4E8D6 #DCB17F`) and *"A Hillside Path with
> Blooming Cherry Trees under an Overcast Sky"* (Michetti, 1905, pastel and
> charcoal, `#E3D5C1 #9A9080 #3F3C2B #AEB4A8`).
>
> Note: **"A quieter second hang: honeyed landscapes and simple still lifes,
> kept clear of drama and visual clutter."**

> **Run 2.** Rejected: *"Harvesters by Firelight"* (Palmer, 1830) and *"Northern
> Landscape Fantasy Evoking Tivoli"* (Berchem, 1660).
>
> Note: **none — the turn failed.** This was the first 429 of the session.

> **Run 3.** Rejected: the same two works as run 1.
>
> Note: **"Brighter, friendlier warmth: fruit, flowers, and open ground with
> clean, restful compositions."**

**Ordering B — flags first, then the instruction**, so gestures and words arrive
on the same turn. This is the shape iteration 1 used when it got notes like
*"you picked the grey sea and rejected the dramatic boat."*

> **Runs 1, 2 and 3.** Rejected: *"Environs de Cremieu"* and *"Flying Shadows"*
> (Kenyon Cox, 1883, oil on canvas, `#47502B #9A8B57 #BDB89B`).
>
> Note: **none, in all three.** Every one of them returned
> `429 AGENT_UNAVAILABLE` on its first and only request. Ordering B produced no
> model output at all, and `e2e3-08-note-B1.png` shows *"The shared daily agent
> budget for this site is spent."* in red on the page.

> **Correction, written in the fix phase.** This section originally quoted two
> notes for ordering B — *"Soft light, simple forms, and warm colour for an
> easy, welcoming wall"* and *"Warm light, open space, and softened colour…"* —
> and concluded *"five notes came back."* Neither sentence is in
> `e2e-evidence/iteration-3/notes-B.json`, which records all three B runs as
> `"note": null` against a 429. **Two notes came back, not five, and both of
> them are ordering A's.** The judgement below is unchanged by this: it was
> always about ordering A's two, and they are real and quoted correctly. But
> the count was wrong and the two B quotations were not supported by this
> report's own evidence, which is the one thing §10 of the brief forbids.

Two notes came back. **Neither of them names what was thrown out.** They are
sentences about what is now on the board. Both carry a comparative that gestures
at a rejection without content — *"a quieter second hang"*, *"brighter"* — and
that is the closest either of them gets. The system prompt asks for more than this
and says so explicitly (`apps/api/src/routes/agent.ts:109`):

> *"On a redeal after they have flagged something, the note is where the
> disagreement gets named, in that one sentence: 'You said warm; you picked the
> grey harbour and rejected the golds — following the picks.' Name what they
> threw out, not only what you kept."*

**The mechanism, from the request bodies.** The gestures do reach the model, and
they are well-formed. Ordering A, run 1, request 5 of 10:

```json
{"text":"again",
 "flagsDelta":["reject:Environs de Cremieu (François-Auguste Ravier)",
               "reject:A Hillside Path with Blooming Cherry Trees under an Overcast Sky (Francesco Paolo Michetti)"]}
```

Requests 6, 7, 8 and 9 of that same turn carry **no `turn` key at all**. The
server appends the gesture sentence as a trailing system message only when
`body.turn` is present (`agent.ts:357–367`), and the client sends `turn` only on
the first pass (`agent-prompt.tsx:396`, with the comment *"restating the
gestures there would read as the human having done it all again"*). The client's
message history never contains that injected system message, so it is not
carried forward either.

So the model is told what was rejected once, while deciding its *first* tool
call, and by the time it calls `set_results` and writes the note — five round
trips later — the sentence is gone from its context. That is consistent with
every note I got: they describe the board the model can see, because that is all
it can still see.

Shots: `e2e3-07-note-run*.png`, `e2e3-08-note-B*.png`.

### 5. `compare_artworks`

Driven through `window.__paillette_webmcp.call`. The room opens as a room, not a
dialog:

```json
{"box":{"top":0,"left":0,"w":1440,"h":900},
 "question":"Which one belongs above the sofa?",
 "works":2,"neither":true,"compareOpenAttr":"true"}
```

Full-bleed at the viewport origin, the question set between the two works, the
"Neither" door present, and `data-compare-open` on the root taking the nav and
the chrome off screen.

Clicking a work closes the room and **resolves to pick / reject** correctly:

```json
[{"id":"nga:56994","flag":"pick","by":"human"},
 {"id":"nga:53881","flag":"reject","by":"human"}]
```

**It does not send a turn.** 0 POSTs to `/public-agent/turn` within 1.5 s of the
click. §4's P4 says *"the click is sent as a human turn"*; the choice is recorded
and rides the next turn instead. Iteration 2 found the same thing and left it
deliberately, and I am not overturning that — but it is still divergent from the
brief and it is still true.

Shots: `e2e3-05-compare-room.png`, `e2e3-06-after-compare-choice.png`.

### 6. The deal animation and picks holding position

Answered in the preflight section above: 14–25 distinct layouts board-to-board,
picks at 0 px, twelve cards, tray of two, on `/nga/search` with the real
collection. Video committed.

---

## 7. Framing — where to point the camera

Measured on a human-dealt board at 1440×900, at five scroll positions:

| scrollY | bar on screen | cards whole | note |
| --- | --- | --- | --- |
| 0 | yes (top 182) | 8/12 | none |
| **120** | **yes (top 62)** | **12/12** | none |
| 200 | no (−18) | 12/12 | none |
| 261 | no (−79) | 12/12 | none |
| 320 | no (−138) | 12/12 | none |

Two things follow.

**Iteration 2's framing advice is out of date.** It reported *"there is no single
position holding the bar and twelve uncropped cards"* and said to film from the
top of the page. At **scrollY 120** the utterance bar and all twelve whole cards
are on screen together — verified by eye in `e2e3-12-framing-scroll120.png`, not
just by the numbers. scrollY 0 clips the bottom row.

**But there is no note in any of those rows**, because a human redeal does not
write one. The full money shot — bar, note, board, two inks — could not be
re-measured today at all, because it needs a live agent turn. The one frame I
have of it is `e2e3-01-after-instruction.png` from 08:24, and in that frame the
note is **horizontally clipped by the sticky search toolbar**.

---

## 8. What remains unproven on this machine

- **Real speech recognition, and speech out.** Headless Chromium ships audio to
  Google's service and there is no microphone here. `webkitSpeechRecognition`
  exists and the mic button renders, but nothing can be spoken into it. A spoken
  take must be filmed on a real machine. Unchanged, and I did not try to fake it:
  every turn in this report is typed.
- **The agentic loop after 08:20 UTC.** Blocked by the 429; see blocker 1.
- **A `beats.json` with tools in it.** `scripts/demo/capture.mjs` itself is
  fine — it resolved the browser driver on this VM without any override, drove
  the page, recorded `capture.mp4` (1440×900, 3.1 MB) and wrote `beats.json`.
  §7b item 2 is genuinely fixed. But it ran during the outage, so:

  ```json
  {"mode":"type","durationMs":243647,"toolsFired":[],"screenshots":[],
   "beats":[{"elapsedMs":558,"event":"type","instruction":"I want something to hang above the sofa…"}]}
  ```

  Worth noting as a harness gap: it waited out its full 243 s quiet deadline and
  printed `final panel:` with nothing after it. It never surfaced the 429 that
  caused it. A harness that cannot say *why* it captured nothing costs an hour
  of somebody's night.
- **Which of the two 429 branches fired.** See blocker 1.

## 9. What I changed

No application code. Eight harnesses under `scripts/demo/e2e3/` (`preflight`,
`dom-probe`, `loop`, `notes`, `notes-ab`, `deterministic`, `persistence`,
`framing`, `turn-probe`), the evidence under
`docs/night/e2e-evidence/iteration-3/`, and the shots below.

Two of my own harness bugs are worth recording so nobody repeats them:
`[data-artwork-id]` also matches `.lt-note-swatch` and `.lt-tray-card`, so a bare
query counts a work up to three times and reads `data-flag-by` off a swatch that
never had one; and clicking a card to move focus navigates to the work. Both
produced convincing-looking product failures that were not real. Everything is
scoped to `article.paillette-card` now.

## 10. Shots, in order

| file | what |
| --- | --- |
| `e2e3-00-cold-load.png` | `/nga/search?q=warm+landscape&webmcp-debug`, 30 cards, agent bar, glyph |
| `e2e3-01-after-instruction.png` | after the typed sofa instruction — board and note (note clipped by the toolbar) |
| `e2e3-01b-activity-log.png` | the tool log open: the seven calls that produced that board |
| `e2e3-02-flagged.png` | `X`, `X`, `P` — graphite marks |
| `e2e3-03-after-redeal.png` | Enter on an empty bar, first redeal |
| `e2e3-04-second-redeal.png` | second redeal — twelve cards, tray at the left edge |
| `e2e3-05-compare-room.png` | `compare_artworks`, full-bleed, question between the works |
| `e2e3-06-after-compare-choice.png` | after choosing — winner picked, loser rejected |
| `e2e3-07-note-run1.png` · `-run2-error.png` · `-run3.png` | ordering A, three runs (run 2 is the first 429) |
| `e2e3-08-note-B1/B2/B3.png` | ordering B, three runs |
| `e2e3-09-plain-browser-redeal.png` | no `?webmcp-debug`: the loop with one operator |
| `e2e3-10-flags-after-new-search.png` | flags survive a new search |
| `e2e3-10b-flags-after-reload.png` | flags do not survive a reload |
| `e2e3-11-deal-00-browsing.png` → `-05-redeal4.png` | the recorded deterministic run, deal by deal |
| `e2e3-12-framing-scroll{000,120,200,261,320}.png` | framing sweep |
| `e2e3-13-capture-harness-final.png` | what `capture.mjs` captured during the outage |
| `video/e2e3-deal-on-nga-search.webm` | the deal, four redeals, no model call |

Raw evidence: `docs/night/e2e-evidence/iteration-3/` — `loop.json`, `notes.json`,
`notes-B.json`, `deterministic.json`, `persistence.json`, `framing.json`,
`capture/beats.json`.

---

# Iteration 2

Everything below was run on 2026-09-04 against
**https://paillette-stg.berlayar.ai**, from `night/integration` at `c7f38d8`.
Staging was already deployed and I did not redeploy: `apps/` and `packages/` on
this branch are **byte-identical** to the commit staging was deployed from
(`2680f51`) — `git diff --name-only 2680f51..HEAD` touches only `docs/`. So the
page under test is the page that is deployed, and the page the next phase films.

Nothing in this report is inherited from another lane. Every number was measured
here, in a browser, against the live 63,253-work index.

---

## Verdict

**Yes. The demo loop is filmable right now, typed, with voice switched off.**

All six steps of §9 ran end to end on the deployed build. The claim the brief
calls the most important in the submission — *Enter on an empty bar redeals from
the flags with the picks in place and no model call* — is proven, not asserted:
across **27 separate redeals** in this session, driven from five different
harnesses and each one carrying its own explicit check, there were **zero POSTs
to `/api/public-agent/turn`**, counted off the wire with a request listener that
saw every request the page made. Each redeal made exactly one call, to
`/api/public-search/nga/exemplars`, the deterministic Rocchio engine.

The three things iteration 1 called blocking are all gone, and I checked each one
myself rather than taking the fix log's word for it:

| Iteration 1's blocker | Now |
| --- | --- |
| the compare two-up rendered ~1,700 px below the fold | **fixed** — `{"box":{"top":0,"left":0,"w":1440,"h":1000},"portalled":true}`, and nothing else visible on screen |
| `set_view` could take the board out of the deal view | **fixed** — salon, atlas, table and masonry were all called against a dealt board and the deal grid survived all four |
| twelve cards did not fit on screen | **fixed** — `{"count":12,"gridHeight":650,"viewport":900,"fullyVisibleAtBestScroll":12,"tray":2}` at 1440×900, and the reject tray is on screen |

**And the deal animation is on the real page.** Not only on the visuals lane's
`/night/deal` fixture route. Measured on `/nga/search` against the real
collection by sampling every card's bounding box once per animation frame and
counting distinct layouts: **16 to 28 distinct layouts across fourteen
board-to-board redeals**, where a jump cut measures 4–5. Video: `docs/night/shots/e2e2-deal-on-nga-search.webm`.

### What a person filming has to know, or the take is wasted

None of these stops the loop. All of them will spoil a take if nobody is told.

1. **The board runs out after about five redeals in one tab.** Quantified in
   §4: the fifth Enter is the last full board, the sixth comes back short, and
   by the seventh the board is **one card**. Reproduced on two different queries
   with the same shape, and the arithmetic that causes it is in the API. Reload
   between takes.
2. **The first redeal after a search is a cut, not a deal** — 4 to 18 distinct
   layouts against the second's 16 to 28, because it is turning a browsing
   masonry into a board. The *second* is the deal, every time. Film the second.
3. **A cold typed instruction takes 42–59 seconds** from Enter to a board, and
   spends 5–7 model calls out of an anonymous budget of 40 per client per hour.
   A full loop costs 8–12. That is three or four complete takes an hour.
4. **The compare choice does not send a turn when you click it.** It rides the
   next turn instead. §4's P4 says the click *is* a human turn; the build defers
   it. Detail and the payload that proves it does arrive in §3, step 5.
5. **Push-to-talk on a machine with no microphone enters the listening state and
   then silently does nothing** — no words, no error, no visible failure. §6.

Nothing about the *spoken* path is proven here and it cannot be on this machine.
§6 says exactly which parts remain unproven and why.

---

## 1. The two things to check before starting. Both were fine.

`scripts/demo/e2e2-preflight.mjs` — **17 assertions, 17 passed, 0 model calls.**
Raw: `docs/night/e2e-evidence/iteration-2/preflight.json`.

### 1.1 The in-page agent renders under `?webmcp-debug`. No cherry-pick needed.

`928b5dc` is already an ancestor of this branch (`git merge-base --is-ancestor
928b5dc HEAD` → true), so the mount-order race it fixes is not present. **I did
not cherry-pick anything.** Measured:

```
the debug host registers tools                              25 tools
the in-page agent bar renders under ?webmcp-debug           count=1
the bar is actually visible, not merely in the DOM          true
focus is on BODY at cold load, so P/X/U are live            BODY
no "already registered" warnings                            0
```

And with no flag at all — which is what a judge opening the URL cold gets:

```
{"host":true,"driver":false,"bar":1,"cards":30}
```

The host is claimed and the bar renders for an ordinary visitor; only the console
back door `window.__paillette_webmcp` stays behind the flag. Shots:
`e2e2-01-preflight-agent-renders-under-debug-flag.png`,
`e2e2-02-preflight-no-flag-at-all.png`.

One thing to know before writing a harness against this page: registration is not
synchronous with `document.modelContext` existing. Wait on `tools().length > 0`.

### 1.2 The deal animation is on `/nga/search`, with the real collection

This was the finding that could have been blocking, and it is not. `/night/deal`
does exist and answers `HTTP 200`, but **nothing in this report was measured on
it.** Everything below is the product page against the live index.

On `/nga/search?q=sunset landscape`, flagging two picks and two rejects and
pressing Enter twice:

| | distinct layouts | frames |
| --- | --- | --- |
| first redeal (masonry → board) | 6 | 156 |
| **second redeal (board → board)** | **25** | 149 |

and the held picks, board to board:

```
[{"id":"…50295","dxPage":0,"dyPage":0,"dxBoard":0,"dyBoard":0},
 {"id":"…184224","dxPage":0,"dyPage":0,"dxBoard":0,"dyBoard":0}]
```

Zero pixels, on the page and in the slot. Twelve cards, all twelve fully visible
at 1440×900 in a 650 px grid, two rejects in the tray. Shot:
`e2e2-03-preflight-deal-on-nga-search.png`.

---

## 2. How the loop was driven, and what it cost

`scripts/demo/e2e2-loop.mjs --full` runs the brief's six steps **in the brief's
order**, typed. It is deliberately different from iteration 1's agent harness,
which laid the flags down before the instruction because that is cheaper. Here
the cold instruction comes first, as §9 describes it.

Voice is untouched: the instruction is typed character by character into
`input[aria-label="Ask the agent"]` with `type(…, {delay: 12})`, and the harness
asserts before it starts that nothing is listening
(`{"micPresent":true,"micPressed":"false","listening":false}`).

Four full runs against staging:

| run | step 1 | step 4 | total model calls | first → second deal | score |
| --- | --- | --- | --- | --- | --- |
| 1 | 42 s / 5 calls, 8 works | 17 s / 3 calls | 8 | 18 → 21 layouts | **22/22** |
| 2 | 59 s / 7 calls, 12 works | 33 s / 5 calls | 12 | 3 → 3 layouts | 19/22 — **harness fault, §5** |
| 3 | 44 s / 5 calls, 10 works | 36 s / 5 calls | 10 | 12 → 16 layouts | **22/22** |
| 4 | 47 s / 5 calls, 12 works | 17 s / 3 calls | 8 | 14 → 19 layouts | **22/22** |

Run 2's three failures were **my measurement, not the product**, and §5 shows the
work that establishes that rather than assuming it. Run 4 is the same script with
the measurement corrected; it is the canonical run and every shot numbered 04–12
comes from it.

Also run, all against the same deployed build:

| Harness | Result | Model calls |
| --- | --- | --- |
| `e2e2-preflight.mjs` | **17 / 17** | 0 |
| `e2e-deterministic.mjs` (checked in, iteration 1's) | 38 / 1 — the one failure is step 5, §3 | 0 |
| `e2e2-loop.mjs --full` × 4 | 22/22, 19/22, 22/22, 22/22 | 38 |
| `e2e2-redeal-reliability.mjs` × 2 queries | 18 redeals; §4 | 0 |
| `e2e2-run2-repro.mjs` | **8 / 8** | 0 |
| `e2e2-voice.mjs` | **10 / 10** | 0 |
| `e2e2-ink.mjs` | 6 / 6, one of them vacuous — §7 | 0 |
| `e2e-extras.mjs` (checked in) | 7 / 3 — all three are superseded assertions, §7 | 0 |

**38 model calls spent in total**, all of them in the four full loops.

### The suite, on the tree these scripts ran against

This phase added six scripts under `scripts/demo/` and touched no application
code, so the suite should be exactly where the integration lane left it, and it
is:

```
pnpm --filter web typecheck   clean, 0 errors
pnpm --filter web test        Test Files  91 passed (91)   Tests  1115 passed (1115)
pnpm --filter api test        Test Files  44 passed (44)   Tests   815 passed (815)
```

Identical to the integration report's numbers. Nothing was skipped or deleted.

---

## 3. The loop, step by step

### Step 1 — the instruction that needs no coaching

Typed into the bar on a cold `/nga/search?webmcp-debug` with **no query at all** —
an empty page, so the board can only come from the agent.

> "I want something to hang above the sofa in my living room. Warm, not busy,
> nothing grim."

A board came back with a written note on all four runs. The notes, verbatim from
`.paillette-wall-label`:

> **run 1** — "Warm ochres, honeyed light, and open breathing room—quiet pictures
> built to soften a living room."

> **run 2** — "Quiet amber, honey, and earth tones with open space or a single
> clear subject—warm company without visual noise."

> **run 3** — "Warm, low-clutter pictures held together by ochre, peach, and
> quiet open space."

> **run 4** — "Warm, uncluttered pictures with gentle light and enough open
> breathing room for a living room."

Each carries `data-provenance="agent"` — the note arrives in the agent's ink, not
the page's. The board size the agent chose varied: 8, 12, 10, 12 works.

The tool sequence for run 1, timestamped off the wire
(`iteration-2/run1-loop.json`):

```
 3807ms  POST /api/public-agent/turn
 7059ms  POST /api/public-agent/turn
10440ms  POST /api/public-search/nga/text
15575ms  POST /api/public-search/nga/text
20372ms  POST /api/public-search/nga/text
24989ms  POST /api/public-search/nga/text
30093ms  POST /api/public-agent/turn
30985ms  GET  /api/public-search/nga/quota
33675ms  POST /api/public-agent/turn
36114ms  POST /api/public-agent/turn
```

Five model turns, four searches merged into one board. **41.8 s from Enter to a
board on screen.** The first turn's payload, verbatim:

```json
{"text":"I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.",
 "flagsDelta":[],"selection":[],"hovered":null,"compareChoice":null,"exhibitionEdits":[]}
```

Shots: `e2e2-04-cold-load-no-query.png`,
`e2e2-05-step1-sofa-instruction-typed.png`, `e2e2-06-step1-board-and-note.png`.

### Step 2 — `X` on two works, `P` on one; the flags persist and are visible

Hovering each card and pressing the key. Every mark landed, human-owned, not
provisional, on all four runs. Run 4:

```
rejects: ["Landscape — Berthe Morisot",
          "The Hudson River at Hastings — Jasper Francis Cropsey"]
picks:   ["Still Life of Fruit — American 19th Century"]
every flag by=human, provisional=false
flagging fires no model call — 0
```

They are visible, not merely in the store — `data-flag="reject"` / `"pick"` on
the card element itself — and they persist: the same three works are still in
`get_view_context` two redeals later, and arrive in the agent's turn payload at
step 4 carrying palette, medium, year and classification (§3, step 4).

Shot: `e2e2-07-step2-flagged-XXP.png`.

**A hazard for whoever films.** `P`/`X`/`U` are correctly suppressed while a text
field holds the caret. Pressing Enter *inside* the utterance bar leaves the caret
there, so the next `X` types the letter `x` into the bar instead of rejecting the
card under the cursor. Every harness here blurs first. On camera: click the board
before you cull.

### Step 3 — Enter on an empty bar, and the no-model-call proof

Proven negatively, off the wire, in four independent harnesses. Run 4:

```
STEP 3 — the bar is empty before Enter                    ""
STEP 3 — the board redeals to twelve                      12 cards, view=deal-board
STEP 3 — NO MODEL CALL: zero POSTs to /public-agent/turn  0 of 14 requests after Enter;
                                                          API traffic was /api/public-search/nga/exemplars
STEP 3 — it hit the deterministic engine instead          /api/public-search/nga/exemplars
STEP 3 — the pick is still on the board after the redeal  {"dxPage":0,"dyPage":-70,"dxBoard":0,"dyBoard":-2}
STEP 3 — both rejects have left the board                 tray: ["…56976","…52306"]
```

`dyBoard: -2` on the first redeal is the masonry becoming a board; board to board
it is exactly zero, measured at step 6 below.

**The strongest version of this claim** is the count across everything run
tonight. Every redeal below carried its own explicit zero-model-call check, and
each assertion is written negatively, so it fails if a model call ever appears:

| Where | Redeals |
| --- | --- |
| `e2e2-redeal-reliability.mjs`, `still life fruit` | 10 |
| `e2e2-redeal-reliability.mjs`, `warm landscape` | 8 |
| `e2e2-loop.mjs --full`, step 3, four runs | 4 |
| `e2e-deterministic.mjs`, two explicit assertions | 2 |
| `e2e2-preflight.mjs`, two redeals under one 0-of-113-requests assertion | 2 |
| `e2e-extras.mjs`, the redeal with no host on the page at all | 1 |
| **Total** | **27 — zero POSTs to `/api/public-agent/turn` in any of them** |

Independently, `e2e-deterministic.mjs` on the same build:

```
PASS  Enter on an empty bar makes NO model call — 0 requests to /public-agent/turn;
      12 requests total in the window
PASS  Enter on an empty bar hits the deterministic exemplar engine —
      POST https://paillette-stg.berlayar.ai/api/public-search/nga/exemplars
PASS  Enter with nothing focused (bare board) redeals with NO model call — 0 model calls; 1 exemplar calls
```

and with **no `?webmcp-debug` and no host on the page at all**, from
`e2e-extras.mjs`:

```
PASS  P and X still flag with no agent on the page
PASS  Enter on the bare board redeals, with no agent anywhere —
      https://paillette-stg.berlayar.ai/api/public-search/nga/exemplars
PASS  the deal board renders for a visitor with no agent
```

The loop is not merely model-free at that beat; it is agent-free.

Shot: `e2e2-08-step3-redeal-no-model-call.png`.

### Step 4 — does the note refer to the *content* of what was rejected?

Run four times, as §9 asks (it asks for three). All four verbatim, each with the
works that were actually thrown out:

**Run 1**
rejected: *A Peach, Seville* (George Henry Hall); *Still Life with Milk Jug and Fruit* (Paul Cezanne)
picked: *A Corner of the Artist's Room, Rue Terre Neuve, Meudon* (Gwen John)
> "Following your pick's pale ochre watercolor and quiet interior; steering away
> from darker, crowded scenes."

**Run 2**
rejected: *A Peach, Seville* (George Henry Hall); *A Dessert* (Raphaelle Peale)
picked: *Still Life with Apples, Sherry, and Tea Cake* (Raphaelle Peale)
> "You kept the ochre-and-brown oil still life and rejected the deeper red-brown
> peach—following its softer, quieter warmth."

**Run 3**
rejected: *A Peach, Seville* (George Henry Hall); *Flask* (John Tarantino)
picked: *Landscape* (Berthe Morisot)
> "You kept the pale ochre pencil landscape and rejected the darker peach
> palette—following its quiet, airy warmth."

**Run 4**
rejected: *Landscape* (Berthe Morisot); *The Hudson River at Hastings* (Jasper Francis Cropsey)
picked: *Still Life of Fruit* (American 19th Century)
> "Following your warm oil-on-wood fruit pick and moving away from the pale
> colored-pencil landscape you rejected."

**Four for four refer to content rather than to the bare fact of rejection, and
three of the four name the rejected work specifically enough to recognise it on
screen.** Runs 2, 3 and 4 name it — "the deeper red-brown peach" is *A Peach,
Seville*; "the darker peach palette" is the same work; "the pale colored-pencil
landscape you rejected" is the Morisot. Run 1 is the weak one: "darker, crowded
scenes" is a description of the rejected still lifes and is accurate about them,
but it does not name a subject, and on camera it would read as generic. **If you
get run 1's kind of note on a take, do it again.**

This is not the model guessing from titles. The turn payload carries the visual
facts — here is the flagsDelta that produced run 1's note, verbatim from
`iteration-2/run1-loop.json`:

```json
{"artworkId":"open-access-art:nga:214119",
 "title":"A Peach, Seville (George Henry Hall)",
 "palette":["#C3803A","#7E3F0F","#6C443C"],
 "medium":"oil on canvas","year":1866,"classification":"Painting","to":"reject"}
```

Both rejects and the pick arrive that way. That is why "ochre-and-brown oil still
life" and "pale colored-pencil landscape" are available to the model at all.

Also checked at this step, because iteration 1's second blocker lived here: the
board is **still a deal board after the agent turn** on all four runs
(`view=deal-board`), and the human's pick is still on it. Shots:
`e2e2-11-step4-instruction-typed.png`,
`e2e2-12-step4-agent-note-names-the-reject.png`.

### Step 5 — `compare_artworks`

It exists, it resolves, and it is a room. From `e2e-deterministic.mjs` on the
deployed build:

```
PASS  compare_artworks resolves
PASS  the two-up is on screen as a room —
      {"present":true,"askedBy":"agent","question":"Which one holds the wall better?",
       "choices":[{"id":"…144846","side":"left","label":"Choose The Dawn of Creation"},
                  {"id":"…69344","side":"right","label":"Choose Desert Sunset"}],
       "box":{"top":0,"left":0,"w":1440,"h":1000},"portalled":true,"chromeVisible":[]}
PASS  the two-up is at the top of the viewport, not below the fold
PASS  nothing else is on screen while the two-up is open — still visible: nothing
PASS  choosing closes the two-up
PASS  the winner becomes a human pick — {"id":"…144846","by":"human","onBoard":true}
PASS  the loser becomes a human reject — {"id":"…69344","by":"human","onBoard":true}
FAIL  choosing sends a human turn to the agent immediately —
      0 POST(s) to /public-agent/turn in the 3s after the click
      — resolveCompare() records the choice for the *next* turn instead
```

**Choosing resolves to pick/reject. It does not send a turn.** The brief's step 5
asks for both. The information is not lost — `e2e-extras.mjs`, which refuses the
agent route at the edge so nothing is billed, shows the choice riding the next
turn verbatim:

```json
"compareChoice":{"winner":{"id":"…50295","title":"Peaceful Valley (Alexander Helwig Wyant)"},
                 "loser":{"id":"…184224","title":"Vicinity of Morestal (François-Auguste Ravier)"},
                 "question":"Which one holds the wall better?"}
```

and the flags it laid down ride with it, with palette and medium attached. So the
gesture reaches the agent; it reaches it late. The integration lane left this
deliberately, on the argument that firing a model call on every compare click
would burn the demo's best beat against a 40-call budget. I am reporting it, not
arguing with it: **on camera, a compare answered in silence needs the next
utterance to make it visible.**

Shots: `e2e2-13-step5-compare-two-up.png`, `e2e2-14-step5-after-choosing.png`.

### Step 6 — the deal animates and the picks hold

Run 4, board to board:

```
STEP 6 — the deal animates board to board —
  19 distinct layouts across 132 frames (a jump cut is 4–5; the first redeal measured 14)
STEP 6 — the picks visibly hold position, to the pixel —
  [{"id":"…50825","dxPage":0,"dyPage":0,"dxBoard":0,"dyBoard":0}]
```

Every board-to-board redeal measured tonight on a **full twelve-card board**, all
fourteen of them, in order:

```
16  19  21  22  22  22  24  24  24  25  25  27  28  28
```

A jump cut is 4–5, so the worst of the fourteen is more than three times a cut.
The first redeal after a text search measures **3, 4, 4, 6, 12, 14 or 18**,
depending on how much of the masonry has to rearrange — sometimes a cut,
sometimes half a deal, never the clean thing. (The 3 is run 2, and is a
mis-measurement, not a bad deal — §5.) **Film the second.**

`e2e2-09-step6-deal-midflight.png` is the board 380 ms after the works changed:
newcomers still arriving, the pick frame-lit and stationary.
`e2e2-10-step6-deal-settled-twelve-and-tray.png` is the settled board — twelve
cards on one screen, two rejects in the tray at the left edge.
`e2e2-deal-on-nga-search.webm` is twelve seconds of it.

---

## 4. The finding that most affects filming: the board runs out

`scripts/demo/e2e2-redeal-reliability.mjs`. Flag one pick and two rejects, then
press Enter over and over, and after each deal compare three things that must
agree: `board.order` (what the agent is told is on the table), the ids actually
rendered in the deal grid (what a viewer sees), and the confirmed rejects (none
of which may be in either).

**`still life fruit`, ten rounds:**

```
round  1   4 layouts · 12 cards · order 12 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
round  2  22 layouts · 12 cards · order 12 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
round  3  24 layouts · 12 cards · order 12 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
round  4  22 layouts · 12 cards · order 12 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
round  5  22 layouts · 12 cards · order 12 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
round  6  22 layouts ·  9 cards · order  9 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
round  7  27 layouts ·  1 cards · order  1 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
round  8   3 layouts ·  1 cards · order  1 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
round  9   1 layouts ·  1 cards · order  1 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
round 10   1 layouts ·  1 cards · order  1 · rejects on board 0 · tray 2 · picks held 1 · model calls 0
```

**`warm landscape` — the query the filming URL uses — eight rounds, same shape:**

```
round  1   4 layouts · 12 cards      round  5  28 layouts · 12 cards
round  2  24 layouts · 12 cards      round  6  24 layouts · 11 cards
round  3  25 layouts · 12 cards      round  7  29 layouts ·  1 cards
round  4  28 layouts · 12 cards      round  8   3 layouts ·  1 cards
```

By round 7 the board is a single work — the human's pick, alone, with "1 / 1
WORKS" in the chrome. Rounds 8 onward do not change at all: Enter is a dead key.
Shots: `e2e2-15-redeal-05-last-full-board.png`,
`e2e2-16-redeal-07-board-collapsed-to-one.png`.

**This is not the vector index running out of art, and it is not query-specific.**
The mechanism is arithmetic, in `apps/api/src/routes/search.ts`:

```ts
const candidatePool = Math.min(Math.max(topK * EXEMPLAR_CANDIDATE_MULTIPLIER, 20), MAX_SEARCH_RESULTS);
const queryResult = await vectorize.query(centroid, { topK: candidatePool, … });
const candidates = queryResult.matches
  .map(…)
  .filter((candidate) => !blocked.has(candidate.id));
```

`EXEMPLAR_CANDIDATE_MULTIPLIER` is 6 and `MAX_SEARCH_RESULTS` is 100, so a
twelve-card deal asks Vectorize for a **fixed pool of about 66** nearest
neighbours of the centroid and *then* removes everything already seen. The
web side sends everything already seen —
`excludeIds: [...alreadyDealt, ...previousOrder]` in `redeal.ts` — and the
centroid does not move while the pick set is unchanged, so the same ~66 works
come back every round and each round strikes 12 of them out. 66 ÷ 12 ≈ 5.5, which
is exactly where the board starts to thin.

**What it means for filming:** you have about five clean redeals per pick set in
one tab. That is enough for a take. It is not enough to rehearse and then shoot in
the same tab, and it is not enough for a judge who sits and presses Enter. Reload
between takes; a fresh page resets `alreadyDealt`.

**What it does not mean:** the loop is not wrong. In all 18 rounds, across both
queries: **zero rejects ever appeared on the board, the rendered board matched
`board.order` every single time, the human's pick was held every single time, and
zero model calls were made.**

I did not fix this. It is in reserved API code, it is a behaviour change with a
scoring consequence, and the brief says to report rather than fix. The fix is
small — the candidate pool needs to grow with the exclusion list rather than being
fixed at `topK × 6` — but it is the fix phase's to make, and it needs a test.

---

## 5. Run 2, and why its three failures are mine and not the product's

Run 2 came back with the two rejects apparently still on the board, an empty
tray, fifteen elements answering to `[data-artwork-id]` where twelve works were on
screen, and a deal measuring **3 distinct layouts** — a jump cut where the money
shot should be. That would have been the most important finding in this report if
it were true, so it is worth saying exactly how it was disposed of rather than
waving at it.

**Three candidate explanations, and they are not the same bug.** Run 2 was the
only run of the four where the agent, unprompted, also wrote an exhibition
(`set_exhibition`, `write_labels` → `POST /api/public-labels`) and asked for the
salon view. So: (a) the extra elements are a second rendering somewhere and the
harness counted both; (b) an exhibition statement pushes the board below the fold
so the deal happens off camera; (c) the deal genuinely stops animating once an
exhibition is on the page.

**(c) and (b) were tested and are false.** `scripts/demo/e2e2-run2-repro.mjs`
reproduces the state through the debug driver with no model involved — set the
same exhibition, ask for salon, flag, redeal:

```
PASS  CONTROL — with no exhibition on the page the deal animates — {"layouts":24,"frames":147}
PASS  set_exhibition applied (the thing run 2 did and runs 1 and 3 did not)
PASS  the deal board survives set_view("salon") with an exhibition on the page —
      {"present":true,"topInViewport":144,"height":650,"viewport":900,"scrollY":602}
PASS  WITH AN EXHIBITION ON THE PAGE — does the deal still animate? —
      27 distinct layouts across 149 frames (control measured 24)
PASS  the board is on camera when the deal runs — {"topInViewport":144,"scrollY":602}
```

**(a) is true, and it is my fault.** `[data-artwork-id]` is too loose on this
page. Three different things carry it: the result cards, the reject tray, and
`NoteSwatches` — the little palette strips hung under the wall label, one per
confirmed flag (`apps/web/app/components/board/note-swatches.tsx:71`). The
fifteen elements were 12 cards + 3 swatches, and the census proves it: the three
extras were exactly the three flagged ids, each carrying `data-flag` but
**`data-flag-by: null`**, which no result card ever has.

The second-order consequence is the one that actually broke the run. My harness
captured the pre-Enter id list at step 2 and waited for it to change. Laying a
flag inserts a swatch, so the list had *already* changed before Enter was pressed
— `waitForFunction` returned in **43 ms** on a deal that had not started, and the
board was then read 1.5 s later, mid-flight, still showing the works on their way
out and a tray that had not filled yet. The 2.6 s layout-sampling window closed
before the deal began, which is the 3 layouts.

Fixed in `e2e2-loop.mjs`: one precise selector
(`[data-testid="deal-board-grid"] [data-artwork-id], .paillette-card[data-artwork-id]`,
minus `.lt-tray`) used everywhere, the id list read immediately before the key,
and a longer settle before reading. Run 4 is that script, and scores **22/22**.
The 18-round reliability run, written with the correct selector from the start,
never once saw a reject on the board.

I am leaving run 2's raw output committed
(`iteration-2/run2.log`, `iteration-2/run2-loop.json`) and the shot
`e2e2-20-run2-board-read-mid-deal.png`, because "a harness measured this and was
wrong" is worth being able to check.

**This is a harness fault, not a product one, and I want to be clear that I am
not asserting it away: three separate scripts now measure the same thing three
different ways and agree.**

---

## 6. Voice — what it adds, and what cannot be proven here

The typed loop is proven first and independently; nothing below is load-bearing
for it. `scripts/demo/e2e2-voice.mjs` — **10/10, 0 model calls** (the agent route
is refused at the edge, so what the page *tried* to send is evidence without
anything being billed).

**What this machine actually has:**

```json
{"SpeechRecognition":"function","webkitSpeechRecognition":"function",
 "speechSynthesis":"object","voices":0,"mediaDevices":"function"}
```

This corrects something iteration 1 and the checked-in `e2e-extras.mjs` both say.
Headless Chromium **does** expose a `SpeechRecognition` constructor — the API is
there and the mic control is on screen. What is missing is the audio: Chrome
performs recognition by streaming to a Google service, there is no microphone on
this box, and there are **0 synthesis voices installed**, so nothing can be spoken
back either.

**Pressing the mic on a machine with no microphone.** Push-to-talk is a hold, so
the harness presses, holds 2.5 s, releases:

```
while held:      {"label":"Listening — release to send","pressed":"true"}
after release:   {"listening":"false","barValue":"","barDisabled":false,
                  "anyVisibleError":[]}
uncaught errors: []
```

The control enters the listening state, says so, and on release **nothing lands
and nothing is reported.** No error, no "we could not hear you", no visible
failure. That is a real observation for filming and for a judge on a locked-down
laptop: a push-to-talk that goes quiet is indistinguishable from one the user got
wrong. Shots: `e2e2-17-voice-bar-idle.png`,
`e2e2-18-voice-mic-held-no-microphone.png`.

**Everything after the transcript works, and is the same code path as typing.**
Delivering the words the way the recogniser's final result delivers them:

```
PASS  a transcript lands in the editable field, verbatim and editable
PASS  the field the transcript landed in is editable, not a read-only receipt —
      {"readOnly":false,"disabled":false}
PASS  committing the transcript sends exactly the same turn a typed instruction does —
      {"text":"I want something to hang above the sofa in my living room. Warm, not busy,
        nothing grim.","flagsDelta":[],"selection":[],"hovered":null,
        "compareChoice":null,"exhibitionEdits":[]}
```

Shot: `e2e2-19-voice-transcript-in-editable-field.png`.

### Plainly: what remains unproven on this machine

- **Real speech recognition.** No microphone, no audio to stream to Google.
  Nothing here shows that a spoken sentence becomes a transcript.
- **Real speech out.** 0 voices installed; `speechSynthesis` exists but has
  nothing to speak with. The "spoken only after voice input" rule is therefore
  untested end to end.
- **The grace bar under real conditions** — the 1.2 s countdown between a final
  transcript and the send. Its inputs are simulated here.
- **A real WebMCP host.** Chromium 141 has no `document.modelContext` of its own;
  the page's own spec-shaped host stands in and passes.

**A spoken take must be filmed on a real machine with a microphone**, and nothing
in this report should be read as evidence that it will work there.

---

## 7. Everything else observed

1. **The note swatches do not say whose flag they draw.** `NoteSwatches` renders
   `data-artwork-id` and `data-flag` but not `data-flag-by`, so a strip shows
   that a work was flagged without showing by which hand — the one place on the
   page where the two-colour contract is not carried. Evidence is the run-2
   census (§5), which caught three swatches with `data-flag-by: null`. My ink
   script's assertion about this was **vacuous** — no swatches were on the page
   in that run, and `[].every()` is true — and I would rather say so than let a
   green line stand for a check that did not happen.

2. **Two colours of ink, measured off computed styles.** `e2e2-ink.mjs`, with a
   human `P` by keyboard and an agent `flag_artworks` through the driver:

   ```
   --ink resolves to #e6e3dc on the human's card and #5ec8d8 on the agent's
   human: box-shadow "rgb(230, 227, 220) 0px 0px 0px 1px, …", outline-style none
   agent: outline 1px dashed, data-flag-provisional="true"
   ```

   The human's confirmed mark is a solid ring drawn with `box-shadow`; the
   agent's proposal is a dashed outline in cyan. Note for anyone re-measuring:
   reading `outline` alone reports the human's mark as absent, because the
   human's mark is not an outline. My first pass got this wrong.

3. **Three assertions in the checked-in `e2e-extras.mjs` now fail because the
   product changed, not because it broke**, and none of them is a defect:
   `no prompt bar without a host` (the bar now renders for everyone, which was
   the critique's tenth blocking item), `headless Chromium exposes no
   SpeechRecognition` (it does — §6), and `the mic control is feature-detected
   away` (recognition exists, so correctly it is not). I did not edit that
   script; it belongs to another lane and the fix phase should decide.

4. **The agent chooses a board size, and it is not always twelve** — 8, 12, 10,
   12 across four runs of the same instruction. Twelve is what the deterministic
   redeal produces. §4's "deal 12 cards, not 60" is a property of Enter, not of
   the agent's first board.

5. **`data-flag-by` is on the card and correct.** Where §3 step 2 shows
   `by: null` in the raw output, that is the swatch being read first in DOM
   order, not a missing attribute — the corrected read at step 4 shows
   `{"id":"…50825","flag":"pick","by":"human","provisional":"false"}`.

6. **Cold-load latency was not a problem tonight.** The integration lane warned
   that a fresh deploy can take 30 s on first load. Staging had been deployed for
   some time; every page load here was well inside its timeout. Whoever films a
   *fresh* deploy should still warm the page before rolling.

7. **No uncaught page errors**, in any run, in any harness.

---

## 8. The harness

Five new scripts, all checked in under `scripts/demo/`, all re-runnable, none
requiring anything not on this box:

```sh
export PLAYWRIGHT_CORE=$PWD/node_modules/.pnpm/playwright-core@1.56.1/node_modules/playwright-core/index.mjs

node scripts/demo/e2e2-preflight.mjs          https://paillette-stg.berlayar.ai /tmp/pre    # 0 model calls
node scripts/demo/e2e2-loop.mjs --full        https://paillette-stg.berlayar.ai /tmp/run    # 8–12 model calls
node scripts/demo/e2e2-redeal-reliability.mjs https://paillette-stg.berlayar.ai /tmp/rel 10 # 0
node scripts/demo/e2e2-run2-repro.mjs         https://paillette-stg.berlayar.ai /tmp/repro  # 0
node scripts/demo/e2e2-voice.mjs              https://paillette-stg.berlayar.ai /tmp/voice  # 0
node scripts/demo/e2e2-ink.mjs                https://paillette-stg.berlayar.ai /tmp/ink    # 0
```

`scripts/demo/capture.mjs` (the PR #71 harness) was already on this branch as
`fea0286`; I did not need to cherry-pick it. I did not use it this iteration —
`e2e2-loop.mjs` drives the same typed path and additionally measures the
network, the geometry and the animation, which is what the claims in this report
rest on. `capture.mjs` remains the right tool for producing footage rather than
evidence, and its own header is honest that its `--speak` flag reproduces the
post-transcript path only.

`node agent-drive.mjs …` is not on this branch and was not used; the in-page
agent under `?webmcp-debug` is what drives everything here.

---

## 9. What a person should look at, in order

`docs/night/shots/`:

| | |
| --- | --- |
| `e2e2-01-preflight-agent-renders-under-debug-flag.png` | 25 tools, the bar, focus on BODY |
| `e2e2-02-preflight-no-flag-at-all.png` | what a judge gets cold: host claimed, bar present |
| `e2e2-03-preflight-deal-on-nga-search.png` | the deal board on the *product* page, 12 + tray |
| `e2e2-04-cold-load-no-query.png` | an empty search page — the board can only come from the agent |
| `e2e2-05-step1-sofa-instruction-typed.png` | the sentence in the bar, typed, voice untouched |
| `e2e2-06-step1-board-and-note.png` | **step 1: a board, and a note on the wall** |
| `e2e2-07-step2-flagged-XXP.png` | two rejects and a pick, human ink |
| `e2e2-08-step3-redeal-no-model-call.png` | **step 3: Enter on an empty bar, 0 model calls** |
| `e2e2-09-step6-deal-midflight.png` | **380 ms in: newcomers arriving, the pick stationary** |
| `e2e2-10-step6-deal-settled-twelve-and-tray.png` | twelve on one screen, rejects in the tray |
| `e2e2-11-step4-instruction-typed.png` | the second instruction |
| `e2e2-12-step4-agent-note-names-the-reject.png` | **step 4: the note naming what was thrown out** |
| `e2e2-13-step5-compare-two-up.png` | **step 5: the two-up as a room, nothing else on screen** |
| `e2e2-14-step5-after-choosing.png` | winner picked, loser rejected, room closed |
| `e2e2-15-redeal-05-last-full-board.png` | the fifth redeal — the last full board |
| `e2e2-16-redeal-07-board-collapsed-to-one.png` | **the seventh: "1 / 1 WORKS"** |
| `e2e2-17-voice-bar-idle.png` | the bar with the push-to-talk control |
| `e2e2-18-voice-mic-held-no-microphone.png` | "Listening — release to send", on a box with no microphone |
| `e2e2-19-voice-transcript-in-editable-field.png` | a transcript in the editable field |
| `e2e2-20-run2-board-read-mid-deal.png` | §5: the harness reading the board mid-flight |
| `e2e2-21-two-colours-of-ink.png` | §7: a human pick in graphite beside an agent's dashed cyan proposal |
| `e2e2-22-run2-repro-deal-with-exhibition.png` | §5: the deal running with an exhibition on the page, 27 layouts |
| `e2e2-deal-on-nga-search.webm` | 12 s of the deal on the product page |

Machine-readable, every number above:
`docs/night/e2e-evidence/iteration-2/`.

### The URL to film

```
https://paillette-stg.berlayar.ai/nga/search?webmcp-debug
```

No query. Type the sofa sentence; `X`,`X`,`P`; click the board; Enter; Enter
again — **that second Enter is the shot**. Reload before the next take.

---

---

# Iteration 1

Everything below was run against **https://paillette-stg.berlayar.ai** on
2026-09-04, from `night/integration`. `apps/` and `packages/` on this branch are
**byte-identical** to the commit staging was deployed from (`e8c248e`) —
`git diff --name-only e8c248e..HEAD` touches only `docs/` and `scripts/demo/`.
So the page under test is the page that is deployed.

Three scripts produce all of it, and all three are checked in and re-runnable:

```sh
export PLAYWRIGHT_CORE=$PWD/node_modules/.pnpm/playwright-core@1.56.1/node_modules/playwright-core/index.mjs
node scripts/demo/e2e-deterministic.mjs https://paillette-stg.berlayar.ai /tmp/e2e-det   # 0 model calls
node scripts/demo/e2e-agent.mjs         https://paillette-stg.berlayar.ai /tmp/e2e-agent 3
node scripts/demo/e2e-extras.mjs        https://paillette-stg.berlayar.ai /tmp/e2e-extras # 0 model calls
```

Raw output is committed under `docs/night/e2e-evidence/`; screenshots are
`docs/night/shots/e2e-*.png`, numbered in the order a person should flip
through them.

---

## Verdict

**No — the loop as written in §9 is not filmable today. Three things block it,
and none of them is the headline beat.**

The headline beat *is* filmable and is now proven on the deployed build against
the real 63,253: **Enter on an empty bar redeals from the human's flags, with
the picks nailed to their slots, with a measured deal animation, and with zero
requests to any model.** The whole deterministic half of the loop — cold load,
`X`,`X`,`P`, two redeals, a compare, a choice — made **four API requests in
total**, none of them to the agent route. That claim is not taken on faith
anywhere in this report.

The typed agentic trigger also works: the sofa sentence typed into the bar,
voice untouched, fires the agent every time, and its note names the *content* of
what was thrown out on three runs out of three.

What blocks filming:

1. **The compare two-up renders ~1,700 px below the fold.** On `/nga/search`
   the overlay is `position: fixed; inset: 0` but a GSAP tween has left
   `transform: translate(0px, 0px)` on the results `<section>`, which makes that
   section the containing block for fixed positioning. The overlay resolves to
   **1216 × 4566** inside the section instead of the viewport, so the two works
   sit at y ≈ 2530 and the human sees a question floating over the search
   results with nothing to choose between. §7.3 and triage item 8 call this
   "the demo's best ten seconds"; right now it is ten seconds of nothing.
   Diagnosis and one-line cause in §5.1. Shot: `e2e-08-compare-BROKEN-viewport.png`.

2. **The agent can take the board out of the deal view, and does.** `set_view`
   for `salon`/`atlas`/`table` is answered in `ResultsLayout` **before** the
   check for whether a deal put these works on the table, so a board dealt into
   salon has no pinned picks, no FLIP and no deal grid. The API system prompt
   actively tells the agent to *"choose the layout with set_view when it
   helps"* — and on the very first cold run of the sofa instruction it chose
   `salon`. The money shot is one model decision away from not existing.
   Shots: `e2e-11`, `e2e-12`, `e2e-16`.

3. **Twelve cards do not fit on screen.** The deal grid on `/nga/search` is
   1984–2055 px tall. At 1440 × 900 **four** of the twelve cards are fully
   visible at the best scroll position; at 1920 × 1080, **five**. §4's "twelve
   cards, so every move reads on video" is not true of the product page. There
   is also **no reject tray** — `DealResults` calls `DealBoard` without the
   `tray` prop, so rejects disappear rather than sliding to the left edge as
   §7.1 describes.

Two further things that are true and worth knowing before a take: the first
redeal after a text search is a **jump cut**, not a deal (5 distinct layouts;
the second measures 25), and a cold agentic instruction takes **35 seconds**
from Enter to a board on screen.

Nothing about the *spoken* path was proven here, and cannot be — see §7.

---

## 1. The two things to check first

### 1.1 The in-page agent renders under `?webmcp-debug`. No cherry-pick needed.

The mount-order race that `928b5dc` fixes is **not present on the deployed
build**, and `928b5dc` was **not** cherry-picked. Measured on staging:

```
webmcp-debug registers tools                        21 tools
in-page agent bar renders under ?webmcp-debug       count=1
focus is on BODY at cold load (culling keys live)   BODY
```

The 21 names, read off `window.__paillette_webmcp.tools()`:

```
list_collections search_artworks search_by_image search_by_color browse_collection
lookup_artwork get_search_quota describe_artwork get_view_context set_results
show_artwork set_view flag_artworks search_by_exemplars redeal compare_artworks
create_collection add_to_collection index_zip index_folder get_index_status
```

The integration lane's claim that `night/review`'s two ordering fixes already
arrived via `night/shared-state` holds up in the browser.

One caveat for anyone writing a harness: registration is **not** synchronous
with `document.modelContext` existing. A first probe that waited for
`document.modelContext` and then immediately read `tools()` got `[]`. Wait on
`tools().length > 0`, which is what all three scripts here do.

### 1.2 The deal animation is on the real page — with the caveats above

`/night/deal` is deployed (HTTP 200) but nothing here was measured on it.
Everything below is `/nga/search` against the live NGA index.

Board-to-board on the product page, sampling every card's bounding box once per
animation frame across the redeal and counting distinct layouts:

| | distinct layouts | frames |
| --- | --- | --- |
| first redeal (masonry → board) | **5** | 212 |
| **second redeal (board → board)** | **25** | 205 |

A jump cut measures 4–5. So the first redeal is a cut and the second is a deal —
exactly as the integration lane warned. `e2e-06-deal-midflight-386ms.png` is a
screenshot taken 386 ms after the board changed: newcomers mid-arrival, the pick
still frame-lit in slot 0. Video: `docs/night/shots/e2e-deal-on-nga-search.webm`.

The pick's position, measured board to board on the real page:

```
board-to-board: the pick holds its slot in the deal grid  {"page":{"dx":0,"dy":0},"board":{"dx":0,"dy":0}}
board-to-board: the pick moves zero pixels on the page    {"page":{"dx":0,"dy":0},"board":{"dx":0,"dy":0}}
```

Repeated at three configurations, tracking slot offset inside
`[data-testid="deal-board-grid"]`:

| | pick slot before | pick slot after | grid height | cards fully visible |
| --- | --- | --- | --- | --- |
| 1440 × 900 | `0,0` | `0,0` | 1984 px | **4** of 12 |
| 1920 × 1080 | `0,0` | `0,0` | 1984 px | **5** of 12 |
| 1440 × 900, `prefers-reduced-motion` | `0,0` | `0,0` | 1984 px | 4 of 12 |

The first redeal moves the pick 1046 px down the document — that is the masonry
becoming a board, and there is no slot for it to have held.

---

## 2. The typed loop, step by step

### Step 1 — the instruction that needs no coaching

Typed into `input[aria-label="Ask the agent"]`, voice untouched, on a cold
`/nga/search` with no query. Driven by `scripts/demo/capture.mjs` (cherry-picked
from PR #71 as `fea0286`; `PLAYWRIGHT_CORE` had to be set by hand — see §6.1).

> "I want something to hang above the sofa in my living room. Warm, not busy,
> nothing grim."

The board came back with a written note. Verbatim, from the wall label:

> **"Warm, quietly composed pictures—fruit, flowers, and sun-softened places—with
> room for a living room to breathe."**

Tool sequence and timings, from `beats.json` (`docs/night/e2e-evidence/capture-beats.json`):

```
 1077ms  type       "I want something to hang above the sofa in my living room…"
 4684ms  tool       list_collections    ok
 6717ms  tool       get_search_quota    ok
10949ms  tool       search_by_color     running
14826ms  tool       search_by_color     ok
15507ms  tool       search_by_color     running
18932ms  tool       search_by_color     ok
20227ms  tool       search_artworks     running
23613ms  tool       search_artworks     ok
24400ms  tool       search_artworks     running
28645ms  tool       search_artworks     ok
31670ms  tool       set_view            ok      <-- "salon"
35020ms  tool       set_results         ok      <-- 12 works, with the note
```

**35 seconds from Enter to a board.** Four searches — two by colour ("rust",
"amber"), two by text — merged into one board of twelve. That is the behaviour
§3 of the brief asks the system prompt to carry, and it carries it.

It also chose `set_view: "salon"`, which is where blocker 2 comes from. Shot:
`e2e-16-capture-harness-agent-chose-salon.png`.

### Step 2 — `X` on two works, `P` on one

Hovering each card and pressing the key. Every mark lands, human-owned, not
provisional:

```
X sets reject on open-access-art:nga:50295   {"flag":"reject","by":"human","provisional":"false"}
X sets reject on open-access-art:nga:184224  {"flag":"reject","by":"human","provisional":"false"}
P sets pick   on open-access-art:nga:144846  {"flag":"pick","by":"human","provisional":"false"}
flagging fires no model call                  3 requests during flagging, none to the agent route
```

`get_view_context` reports them, with titles resolved
(`docs/night/e2e-evidence/get_view_context.json`):

```json
{
  "picks":   [{"id":"…144846","title":"The Dawn of Creation","artist":"Samuel Jackson","by":"human","onBoard":false}],
  "rejects": [{"id":"…50295","title":"Peaceful Valley","artist":"Alexander Helwig Wyant","by":"human","onBoard":false},
              {"id":"…184224","title":"Vicinity of Morestal","artist":"François-Auguste Ravier","by":"human","onBoard":false}],
  "provisional": [],
  "exemplars": {"positive":["…144846"],"negative":["…50295","…184224"]}
}
```

The flags survive a redeal and are still there for the agent turn three steps
later — verified in §2.4, where the same three titles arrive in the turn payload
after a deterministic redeal has already run on them.

**A hazard worth knowing before a take.** `P`/`X`/`U` are correctly suppressed
while a text field holds the caret. Pressing Enter *inside* the utterance bar
leaves the caret there, so the next `X` types the letter `x` into the bar
instead of flagging the card under the cursor — and the Enter after that sends
`"xx"` to the model as an instruction. I hit this with my own driver and traced
it (`window.fetch` stack, body `{"messages":[{"role":"user","content":"xx"}]}`).
It is not reachable if you drive the way a person would — hover, press keys,
press Enter with nothing focused, which is what `isBareBoardEnter` exists for —
but one click in the bar arms it, and nothing on screen says so. Escape blurs
the field and disarms it.

### Step 3 — Enter on an empty bar, and the no-model-call proof

This is the claim the submission rests on, so it is asserted against the
recorded network log rather than against behaviour. **Every request the page
made during the entire deterministic run** — cold load, three flags, two
redeals, a compare, a choice — is four lines
(`docs/night/e2e-evidence/deterministic-network.json`):

```
  855ms  GET   /api/public-search/nga/quota
  856ms  POST  /api/public-search/nga/text        <-- the initial text search
 3111ms  POST  /api/public-search/nga/exemplars   <-- Enter #1, on the empty bar
 7520ms  POST  /api/public-search/nga/exemplars   <-- Enter #2, nothing focused
```

There is no fourth kind of request. `/api/public-agent/turn` appears **zero**
times. Asserted negatively in both directions:

```
the utterance bar is empty before Enter                       ""
Enter on an empty bar makes NO model call                     0 requests to /public-agent/turn; 12 requests total in the window
Enter on an empty bar hits the deterministic exemplar engine  POST /api/public-search/nga/exemplars
the pick survives the redeal                                  pick=…144846  board=12 works
both rejects leave the board                                  ✓
the redeal renders the deal board, not the browsing masonry   data-testid="deal-board-grid" present
redeal latency                                                1992ms from Enter to a changed board
Enter with nothing focused (bare board) redeals, NO model call 0 model calls; 1 exemplar call
```

Both paths were exercised: Enter with the caret in the empty bar
(`isEmptyUtteranceBar`) and Enter with nothing focused (`isBareBoardEnter`).
Both redeal, both are silent to the model.

It also works with **no host at all** — no `?webmcp-debug`, no prompt bar, which
is what an ordinary visitor gets (`e2e-17-no-host-deterministic-redeal.png`):

```
no prompt bar without a host                              count=0
P and X still flag with no agent on the page              [{"flag":"reject"},{"flag":"pick"}]
Enter on the bare board redeals, with no agent anywhere    POST /api/public-search/nga/exemplars
the deal board renders for a visitor with no agent         ✓
```

### Step 4 — does the note refer to the *content* of what was rejected?

Three runs, each a fresh browser context: text search → `X`,`X`,`P` → Enter on
the empty bar (deterministic redeal, 0 model calls) → the sofa sentence typed
into the bar. Three model calls per run, all 200. Full record in
`docs/night/e2e-evidence/agent-runs.json`.

The same two works were rejected every time — *Peaceful Valley* (Wyant) and
*Vicinity of Morestal* (Ravier) — and the same one picked, *The Dawn of
Creation* (Samuel Jackson).

**All three notes, verbatim:**

> **Run 1.** "Warm, spare, and luminous: a quiet horizon-led hang, leaving the
> darker pastoral mood behind."

> **Run 2.** "You said warm and calm; you kept the luminous dawn and rejected the
> darker landscapes—following the light."

> **Run 3.** "You said warm and calm; you picked a glowing horizon and rejected
> the darker landscapes—following that light."

Three for three name what the rejected works *were like* — "the darker pastoral
mood", "the darker landscapes" — not merely that something was rejected. Two of
the three also name the said/chose gap explicitly. That is §9's third bullet,
met, on real NGA works.

Two honest deductions from the same three notes:

- **The agent misquotes the human in two of three.** "You said warm **and
  calm**" — the sentence typed was "Warm, not busy, nothing grim." Nobody said
  calm. It is a small thing and it is in the load-bearing sentence of the
  submission, twice.
- **The description is generic.** "the darker landscapes" is true of both
  rejects but could have been produced from the titles alone. It is content, not
  bookkeeping, so it passes the check as written — but it is not the
  *"these are all horizon-line pictures"* that §6 hopes for.

Per-run measurements:

| run | typed → quiet | model calls | view after | cards | picks held | page errors |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 13.8 s | 3 | deal-board | 12 | 1 | none |
| 2 | 17.5 s | 3 | deal-board | 12 | 1 | none |
| 3 | 12.0 s | 3 | deal-board | 12 | 1 | none |

All three kept the deal board, because once flags exist the prompt tells the
agent to `redeal` rather than `set_results`, and `redeal` does not touch the
view. The salon problem only bites when the agent is dealing a board from
nothing — which is step 1.

The gesture payload the page sent, verbatim from the first request body of every
run:

```json
{"text":"I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.",
 "flagsDelta":[
   {"artworkId":"…50295","title":"Peaceful Valley (Alexander Helwig Wyant)","to":"reject"},
   {"artworkId":"…184224","title":"Vicinity of Morestal (François-Auguste Ravier)","to":"reject"},
   {"artworkId":"…144846","title":"The Dawn of Creation (Samuel Jackson)","to":"pick"}]}
```

Note the flags are still in the delta **after** a deterministic redeal already
consumed them. That is `submitHumanTurn`'s `peekTurn` doing what its comment
says: a redeal reports gestures without spending them. Verified, not assumed.

### Step 5 — `compare_artworks`

It exists, it resolves, and choosing does the right thing to the flags. It is
also **the one step that is not filmable**.

```
compare_artworks resolves                            {"ok":true,"comparing":[…2 works…]}
the two-up is on screen as a room                    2 choices, data-asked-by="agent"
the agent's question is set between the two works    "Which one holds the wall better?"
choosing closes the two-up                           ✓
the winner becomes a human pick                      {"flag":"pick","by":"human","provisional":"false"}
the loser becomes a human reject                     {"flag":"reject","by":"human","provisional":"false"}
```

But the overlay is not where it should be. Measured on the deployed page at
1440 × 900:

```json
{"viewport":{"w":1440,"h":900},
 "overlay":{"x":112,"y":474,"w":1216,"h":4566},
 "position":"fixed",
 "works":[{"y":2573,"h":368,"inViewport":false},
          {"y":2526,"h":464,"inViewport":false}]}
```

Both artworks are off screen. The human sees the question and nothing else —
`e2e-08-compare-BROKEN-viewport.png`. §5.1 has the cause.

**And choosing does not send a turn.** The brief's P4 says *"The click is sent
as a human turn"*. It is not:

```
FAIL  choosing sends a human turn to the agent immediately
      0 POST(s) to /public-agent/turn in the 3s after the click
      — resolveCompare() records the choice for the *next* turn instead
```

This is deliberate and documented in `turn.ts` (*"It does not fire a turn. Flags
never trigger the agent — Enter is the beat — or the board thrashes under the
human's hands while they are still deciding."*), and I think the build is right
and the brief is loose. The choice does arrive, on the next turn. Proven by
intercepting the next request body, with the agent route refused at the edge so
no model call was spent (`docs/night/e2e-evidence/compare-turn-payload.json`):

```json
"compareChoice":{
  "winner":{"id":"…50295","title":"Peaceful Valley (Alexander Helwig Wyant)"},
  "loser":{"id":"…184224","title":"Vicinity of Morestal (François-Auguste Ravier)"},
  "question":"Which one holds the wall better?"}
```

So: **resolves to pick/reject — yes. Sends a turn — no, it rides the next
one, by design, and that is verified.**

### Step 6 — the deal animates and the picks hold

Covered in §1.2 with numbers. Short version: **yes, on `/nga/search`, on the
second redeal**, 25 distinct layouts across 205 frames, pick displacement zero
pixels in both the page and the grid. First redeal is a cut. Four to five of the
twelve cards are on screen at once.

---

## 3. What the scripts scored

```
scripts/demo/e2e-deterministic.mjs      33 passed, 1 failed   (the failure is step 5's "sends a turn", §2.5)
scripts/demo/e2e-extras.mjs              8 passed, 2 failed   (both failures are §7 — headless speech)
scripts/demo/e2e-agent.mjs               3 runs, 3 model calls each, 0 page errors
```

No page errors (`pageerror`) were raised in any run, on any route, at any point.

---

## 4. Model-call budget, actually spent

The anonymous cap is 40 model calls per client per hour, keyed on IP, and this
VM is one client. This session spent roughly **13**: about four for the cold
capture run, nine for the three agent runs. Every other check in this report was
built to cost nothing — `e2e-deterministic.mjs` never touches the agent route,
and `e2e-extras.mjs` refuses it at the edge with a fulfilled 503 so the request
body can be read without being billed.

An afternoon of rehearsal will still exhaust the hour. Budget three or four
calls per typed instruction.

---

## 5. The three blockers, precisely

### 5.1 The compare overlay is trapped inside the results section

`CompareView` is `fixed inset-0 z-50`. That only means "the viewport" if no
ancestor establishes a containing block. One does:

```
apps/web/app/routes/galleries.$galleryId.search.tsx:1813
  timeline.fromTo(resultsAreaRef.current, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0 }, 0.08)
```

GSAP tweens `y` on the results `<section class="mt-8">` and leaves the transform
on the element when it finishes. Read off the deployed page:

```
inline:   "translate: none; rotate: none; scale: none; transform: translate(0px, 0px); opacity: 1; visibility: inherit;"
computed: "matrix(1, 0, 0, 1, 0, 0)"
```

`matrix(1,0,0,1,0,0)` is not `none`, so that section becomes the containing
block for every `position: fixed` descendant — and `CompareView` is mounted
inside it, from `ResultsView`. No CSS rule is involved; walking the ancestors
for transform/filter/perspective/will-change/contain found exactly one culprit
and it is this one.

Two obvious repairs, neither of which I made because this is not the fix phase:
clear the transform when the tween completes (`clearProps: 'transform'` or
`gsap.set(el, {clearProps:'transform'})` in an `onComplete`), or portal the
overlay to `document.body`. The portal is the safer of the two — it survives
anyone adding another transform later.

The same trap explains why the overlay measured 1216 × 2253 in one run and
1216 × 4566 in another: it is sized to whatever the results section happens to
be that moment.

### 5.2 `set_view` outranks the board

`ResultsLayout` (`galleries.$galleryId.search.tsx:5140-5171`) answers `table`, then
`salon`, then `atlas`, and only then asks whether a deal put these works on the
table. Verified by calling `set_view` through the debug bridge with a dealt
board on screen:

```
set_view "salon":   deal board does NOT render   (deal-board-grid present=false)
set_view "atlas":   deal board does NOT render   (deal-board-grid present=false)
set_view "masonry": deal board renders           (deal-board-grid present=true)
```

Meanwhile `apps/api/src/routes/agent.ts` tells the model:

> "Choose the layout with set_view when it helps: atlas when you want to show
> how a cross-section relates, salon for a curated hang, table for comparing
> catalogue fields."

"Salon for a curated hang" is a fair description of what the sofa prompt asks
for, so the agent picking salon is the prompt working, not the model
misbehaving. On the first cold run of the demo instruction it picked salon and
the board lost its pins and its animation.

Whoever fixes this has to choose between three things — put the deal-board check
first, drop `salon`/`atlas` from the prompt's menu, or teach salon and atlas to
preserve pinned slots. That is a product call, not a bug fix, which is why it is
reported rather than patched.

### 5.3 The board is taller than the screen, and has no tray

`DealResults` calls `DealBoard` with `items`, `preservedIds`, `size` and
`renderCard`, and nothing else — no `tray`, no `marks`, no height constraint
(`galleries.$galleryId.search.tsx:5232`). `DealBoard`'s grid is `h-full
auto-rows-fr`, so with no bounded container the rows size to the cards: 562 px
tall each, grid 1984–2055 px, four rows of four. Consequences:

- 4 of 12 cards fully visible at 1440 × 900; 5 at 1920 × 1080.
- No `.lt-tray` in the DOM at all, so a reject does not slide to a visible tray
  as §7.1 promises — it exits left and is gone.

Both are real gaps against the brief's visual direction, and both are in the
call site rather than in `DealBoard`, which supports the tray fine.

---

## 6. The harness

### 6.1 `capture.mjs`

Cherry-picked from `webmcp/voice-activity-capture` as `fea0286`. It drives the
in-page agent, records video and writes `beats.json`, and it worked — §2.1 is
its output.

Two of the brief's §7b defects are **still open** on this branch:

- **Item 2, the hardcoded path, is not fixed.** `PLAYWRIGHT_CORE` defaults to
  `/Users/erniesg/.npm/_npx/…`. It has an env-var override, so setting
  `PLAYWRIGHT_CORE` by hand was enough to run it here, but out of the box the
  script still only starts on one machine. The fallback to
  `~/.cache/ms-playwright` that §7b asks for does not exist.

- **Item 3, `--speak` truncation, is not fixed.** Reproduced exactly, by
  replaying the script's own delivery loop against the deployed page and reading
  the field back before Enter:

  ```
  the three interim chunks: ["I want something to hang above",
                             "the sofa in my living room.",
                             "Warm, not busy, nothing grim."]
  what the field holds at Enter: "Warm, not busy, nothing grim."
  instruction length 88 / field length 29
  VERDICT: TRUNCATED — the agent would receive only this
  ```

  The cause is one line: each chunk is written with `setter.call(el, part)`
  rather than being appended, so the field holds only the last third. The
  interim array is built correctly and then thrown away.

  This does **not** affect anything else in this report — every agent run above
  used the typed path, and `"instruction in the bar: {chars:88, verbatim:true}"`
  is asserted on all three.

### 6.2 `agent-drive.mjs`

`node agent-drive.mjs …` is not on this branch and does not exist anywhere on
this VM (`find ~ -name agent-drive.mjs` finds nothing). `scripts/demo/e2e-agent.mjs`
does that job here.

---

## 7. Voice — what remains unproven on this machine

Headless Chromium on this VM **does** expose `webkitSpeechRecognition` as a
function, contrary to the assumption in `capture.mjs`'s header, and the
push-to-talk button therefore renders:

```json
{"SpeechRecognition":"function","webkitSpeechRecognition":"function",
 "speechSynthesis":"object","voices":0,"mediaDevices":"function"}
```

Holding Space with nothing focused calls `recognition.start()` — instrumented
and observed. Nothing comes back: no `onresult`, no `onerror`, no `onend`, no
text in the field, no grace bar, no visible error. The control returns to idle
and the page carries on. So the failure is silent and harmless, but it is a
failure.

`speechSynthesis` exists with **zero voices installed**, so the "spoken only if
the human's last turn was spoken" half would also produce nothing audible here.

**Unproven on this machine, and not provable on it:**

- that a spoken utterance lands in the editable field
- the 1.2 s grace bar draining and committing after a real release
- Esc discarding a real transcript
- the agent's note being spoken back after a voice turn
- anything about proper nouns, autocomplete or deictic chips under real speech

All of it has to be filmed on a real machine with a microphone. The typed loop
is complete without it, which is the point of §5b, and that part is proven above.

---

## 8. Everything else observed, for the fix phase

1. **The note appears twice** — once as the wall label above the board, once
   inside the activity panel. Visible in `e2e-13`, `e2e-14`, `e2e-15`.
   Unchanged from the integration lane's §5.1.

2. **The activity panel covers the left edge of the board**, which is where the
   pinned pick sits. It is dismissible now and the dismissal sticks, but it
   opens by default on the first tool call, so it is in every un-curated shot.

3. **`"warm landscape"` and `"golden light"` return zero works** on staging;
   `"sunset landscape"` returns 30 and `"storm at sea"` returns 4. Whoever
   films should test the query first — the obvious ones for this demo are empty.

4. **A cold agentic instruction is 35 seconds.** With a board and flags already
   on screen it is 12–19 s. The first shot of the film is the slowest one.

5. **The agent misquotes the human** ("you said warm and calm") in two of three
   notes. §2.4.

6. **`prefers-reduced-motion` was only spot-checked.** The pick held slot `0,0`,
   but it was already in slot 0, so this does not test the integration lane's
   §5.4 concern that reduced motion collects picks at the front. A pick that
   starts at slot 5 is the case to check.

7. **No page errors anywhere.** Across every run in this report, `pageerror`
   fired zero times.

---

## 9. What a person should look at

`docs/night/shots/`, in order:

| | |
| --- | --- |
| `e2e-01-cold-load-text-search.png` | 30 works, focus on BODY, keys live |
| `e2e-02-flags-XXP.png` | two rejects and a pick, in graphite |
| `e2e-03-redeal-1-masonry-to-board.png` | Enter #1 — the cut |
| `e2e-04-redeal-2-board-to-board.png` | Enter #2 — the board |
| `e2e-05-deal-before.png` | the board before the deal |
| `e2e-06-deal-midflight-386ms.png` | **386 ms in: newcomers arriving, pick still framed in slot 0** |
| `e2e-07-deal-settled.png` | settled |
| `e2e-08-compare-BROKEN-viewport.png` | **the question, and no pictures** |
| `e2e-09-compare-full-page.png` | the same overlay, full-page — the works are 1,700 px down |
| `e2e-10-after-choice.png` | winner picked, loser rejected |
| `e2e-11-set_view-salon-no-board.png` | **a dealt board in salon: no pins, no deal grid** |
| `e2e-12-set_view-atlas-no-board.png` | the same in atlas |
| `e2e-13/14/15-agent-note-run{1,2,3}.png` | the three notes on the wall |
| `e2e-16-capture-harness-agent-chose-salon.png` | the cold sofa run, where the agent chose salon |
| `e2e-17-no-host-deterministic-redeal.png` | the loop with no agent and no debug flag |
| `e2e-18-headless-no-speech.png` | the mic button that does nothing here |
| `e2e-deal-on-nga-search.webm` | 22 s: flags, cut, flags, deal |

Machine-readable: `docs/night/e2e-evidence/`.
