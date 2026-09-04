# End to end — the demo loop on a deployed build, driven by typing

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
