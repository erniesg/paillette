# Submission draft — lane report

What this lane produced, what is demonstrably true of it, and what is not. The
submission can be written from this file without opening the code.

**This lane writes. It does not build.** No file outside `docs/` was edited. The
only things run against the product were checked-in harnesses and read-only
browser probes, plus one three-call agent turn to capture a frame that did not
exist.

---

## 1. What shipped

Four documents, plus one screenshot pair and two evidence files captured tonight.

| | |
| --- | --- |
| `docs/webmcp-vo-script-v2.md` | Timecoded voiceover, ten beats, ≈2:58. Per beat: the shot, the page and instruction that reproduces it, and the evidence tier of every claim. |
| `docs/webmcp-devpost-v2.md` | The four judged questions in prose. Real tool names and argument shapes in Q4. |
| `docs/night/shot-list.md` | 25 shots plus two in reserve. Per shot: what is on screen, what is said, the exact page and query, headless-capturable, exists today, model-call cost. |
| `docs/night/submission-evidence.md` | Every claim mapped to its source and tier, plus the WANTED, ABSENT list. |
| `docs/night/shots/50-note-with-swatches.png`, `51-…-in-context.png` | **New.** The agent's note with the swatches it wrote from — the frame the whole submission turns on, which did not exist before tonight. |
| `docs/night/e2e-evidence/note-swatches.json`, `note-swatches-inverted.json` | The raw record behind those, including the run that failed and why. |

The originals — `docs/webmcp-vo-script-final.md` and
`docs/webmcp-devpost-fields.md` — are untouched, deliberately, so the two
framings can be compared. Each new file states at the top what changed and why.

---

## 2. Demonstrably true

### 2.1 The frame that did not exist, and now does

The strongest beat in the film is the agent naming what the human threw away,
with the swatches it read drawn underneath. Through two iterations of e2e, the
mechanism was proven in the DOM and **no committed screenshot framed it** — the
negative-control shots are salon views with the wall label out of frame, and both
iteration-2 note shots are scrolled past it.

Captured tonight on the deployed build, `/nga/search?q=warm landscape`, three
flags by keyboard and one typed instruction, **3 model calls, 0 page errors**:

> **"You said warm; you kept the bone-and-umber etching and rejected the darker,
> greener palettes — following the picks."**

The three strips under it, from `note-swatches.json`:

| | work | leading swatches | the word it earned |
| --- | --- | --- | --- |
| pick | *A Rocky Pond* | `#EBD8BC` `#907F6A` `#695943` | "bone-and-umber" |
| reject | *Environs de Cremieu* | `#B89E81` `#644F3F` `#F4E8D6` | — |
| reject | *Flying Shadows* | `#47502B` `#9A8B57` | "darker, greener" |

Nothing was staged. The flags were the first three cards on the board. The
sentence also carries the said/chose gap — *"You said warm… following the
picks"* — which is §3 of the brief, on real NGA works rather than a fixture
corpus.

### 2.2 An inversion on one work, archived

Better evidence than the negative control, and nobody had noticed it was in the
tree. Berthe Morisot, *Landscape*, `open-access-art:nga:52306`, colored pencils,
palette `#D4C7A2 #B6A385 #9A886C`. In `iteration-2/run3-loop.json` it is
`"to":"pick"`; in `run4-loop.json` it is `"to":"reject"`:

> *picked* — "You kept the pale ochre pencil landscape and rejected the darker
> peach palette — following its quiet, airy warmth."
>
> *rejected* — "Following your warm oil-on-wood fruit pick and moving away from
> the pale colored-pencil landscape you rejected."

Same work, same palette, described the same way, moved to the other side of the
sentence. **This supersedes the negative-control pair** the earlier draft used,
which survived only as a console transcript because its JSON was overwritten
before archiving. The scripts and the Devpost now cite the archived pair.

### 2.3 Verified first-hand against the deployed build

27 checks, listed with their raw output in `submission-evidence.md` §1. Headless
Chromium, **no `?webmcp-debug`**, zero model calls except where noted. The load-
bearing ones:

- **25 tools** on `document.modelContext`, all names read off.
- The utterance bar renders **without** the debug flag; `window.__paillette_webmcp` absent.
- **Enter on an empty bar: one POST to `/api/public-search/nga/exemplars`, zero to any model route.** Twice.
- The dealt board: `{"cards":12,"fullyVisible":12,"gridHeight":724,"viewport":1000}`. Reject tray present, 2 items, after both redeals.
- Compare two-up opened with `C`: `{"box":{"x":0,"y":0,"w":1440,"h":1000},"portalled":true,"chromeVisible":[]}` — zero model calls.
- `.lt-enter-armed` absent before the first flag, `↵` after; the sentence exists once, `sr-only`.
- Activity glyph `·····`, 68 × 33 px, at rest with no agent. Clicking it opens `document.modelContext · 25` and all 25 names — **zero model calls.**
- **Keyboard-only flagging works**: 23 Tabs from cold load reach a control whose accessible name is `"Pick Environs de Cremieu (P)"`; `x` flags it `by: "human"`; `aria-pressed` follows.
- `/e/MKwsxHy` opens cold: `<h1>` *Everything the Light Left Behind*, colophon `4 of 6 labels written by an agent`, **0 localStorage keys read**, real Open Graph tags on the NGA's own IIIF endpoint.
- `/exhibition` with no payload: `302 → /nga/search`.
- `warm landscape` returns **30**. Zero `pageerror` across every run.

---

## 2.4 The critique's blocking item 1 is wrong, and here is the measurement

The iteration-2 critique fails the submission on this:

> *"The agent's note and the board it describes cannot be on screen together …
> the deal grid starts at y=814 and is 650px tall, so the note-plus-board stack
> needs 1464px of a 900px viewport."*

**It does not. The stack starts at y=479, so it needs 985px, not 1464.** The
critique took the grid's document-bottom coordinate as a height. Measured on the
deployed build, with a real wall label installed through the `redeal` tool's
`note` argument — **zero model calls**:

| viewport | label below the nav? | cards fully visible | cards partly visible |
| --- | --- | --- | --- |
| 1440 × 900 | **yes**, at y=114 | **8** of 12 | **12** of 12 |
| 1920 × 1080 | yes | 8 of 12 | 12 of 12 |
| 1600 × 1200 | yes | 8 of 12 | 12 of 12 |
| 1440 × 1400 | yes | **12** of 12 | 12 of 12 |

The frame is committed: **`docs/night/shots/54-note-and-board-1440x900.png`** —
the note in the agent's ink, its three swatch strips beneath it, then two full
rows of the board with the pick frame-lit in slot 0 and the reject tray at the
left margin. Raw numbers in `e2e-evidence/note-and-board-geometry.json`.

The critique reached the right *neighbourhood* by the wrong route, and the real
obstacle is smaller and much more fixable than a layout redesign:

**291 px sits between the agent's sentence and the board it describes**, and
most of it is chrome nobody asked for:

```
swatches end            y=523
  INPUT   34px  y=555   ← the exhibition title field, empty
  TEXTAREA 27px y=601   ← the exhibition statement field, empty
  "12 works · Copy link"      y=650
  results header + sort/view toolbar
deal grid begins        y=814
```

Two **empty form fields** — the ones the critique saw as "orphan vertical
hairlines drawing beside nothing" — sit between the agent's sentence and the
board. That is §5b's complaint in its purest form: chrome for a thing nobody has
started doing yet, in the one gap where the film needs none. **Collapse the
exhibition head until someone actually curates and the frame goes from 8 of 12
to 12 of 12 at 1440 × 900.** The sticky chrome above (57 px header + 102 px
search bar = 159 px) is the other half.

I am not fixing either — this lane writes. But the fix is ~60 px of empty
inputs, not the redesign the verdict implies, and the fix lane should know that
before it starts.

**Two things the critique got right and I confirm from the same frames.** Works
occupy roughly 40–60% of their tile with dead charcoal to the right and below;
and long titles clip mid-word without an ellipsis — *"A Young Couple Seated near
a Massive Rock"* is cut in `54-note-and-board-1440x900.png`.

---

## 3. One defect found, and one I got wrong

### 3.1 The rate-limit error — **I was wrong, and here is the correction**

While capturing the inverted frame the turn came back
`429 AGENT_RATE_LIMITED`, the board did not change, and no note appeared. I
grepped `apps/web/app` for `AGENT_RATE_LIMITED`, found nothing, and wrote that
the page shows nothing at all when the budget runs out — calling it the most
likely way a take gets wasted.

**That was wrong on both counts.** The grep failed because the UI renders
`error.message`, not the error *code*; and my capture script only queried for
the wall label, so it never looked where the error actually is.

Established properly, by fulfilling the agent route with the exact production
429 body — **zero model calls, because the request never leaves the browser**:

```
alerts: [{"text":"You have used this hour’s shared agent budget. Try again shortly.",
          "visible":true}]
```

`agent-prompt.tsx:965` renders it as `<p role="alert">` in the entry list
directly under the utterance bar, in red, carrying the server's own sentence.
The screenshot shows it plainly under the typed instruction. **The product
behaves correctly and the message is a good one.**

What survives as useful for filming is much smaller: the budget failure is
visible and legible, so probe it with one throwaway instruction before rolling
and you will know. The scripts have been corrected; the earlier wording is gone
from all four documents rather than softened.

I am recording this at length because a claim the build does not support is the
worst outcome of the night, and I nearly shipped one — from a grep, without
opening the file it pointed at.

### 3.2 The swatch strips do not say whose flag they draw

`NoteSwatches` renders `data-artwork-id` and `data-flag` but not `data-flag-by`,
so a strip shows *that* a work was flagged and not by which hand — the one place
on the page where the two-colour provenance contract is not carried. Read off
the component, and independently found by the e2e lane (iteration 2 §7.1).
Invisible in the film; a real gap in the design.

### 3.3 One thing that is correct and worth knowing

**A deterministic redeal produces no wall label**, so the swatch strips only ever
appear beside an agent note. That is right — the human's own redeal should not
narrate itself — but it means the frame in §2.1 cannot be captured without
spending model calls, which is why it went uncaptured for two iterations.

---

## 4. The two mid-run constraints, applied

### Text first

Audited beat by beat. **Every beat is typed or keyed. Nothing in the spine needs
a microphone.** The agentic trigger fires from typing alone — four times in e2e
iteration 2, once more tonight. The one shot that touches speech is the
read-aloud button, it is marked BUILT-UNVERIFIED, and the script carries the cut
line if it does not render. Table in `webmcp-vo-script-v2.md` §4.

### Cut the words

The spoken script went from ~350 words to **280** — 1:52 of speech in a 2:58
film, so a third of the runtime is silence. What went:

- *"Committing the correction is the turn"* — narrating the mechanism. The board changing says it.
- *"Same function, either hand. The loop has no agent-only path."* — the three tool/key pairs on screen enact it; saying it too is a caption on a mark. The precise wording stays in the Devpost, where prose is the medium.
- *"…and a line at the bottom saying how many of them an agent wrote"* — the card is the line. Read it once.
- Beat 3 lost half its length once the frame existed. The swatches do the work the second sentence was doing.

*"Twelve come back"* also went, but for being **wrong** rather than long — the
agent's first board measured 8, 12, 10 and 12 across four runs. Twelve is a
property of Enter, not of the agent's first board. That is the better reason.

Nothing was made cryptic to be short. Every beat still names its subject.

---

## 5. Corrected this round

The build moved under the earlier draft. Everything below was wrong in it and is
right now:

| Was | Is |
| --- | --- |
| Cold instruction "35 s" | **42–59 s** across four runs |
| "Twelve come back" on the agent's first board | 8, 12, 10, 12 — the number belongs to Enter |
| "Enter makes zero model calls" (twice, first-hand) | **27 redeals across five harnesses, zero POSTs**, counted off the wire |
| Deal "22 layouts / 339 frames" | **fourteen board-to-board redeals: 16 19 21 22 22 22 24 24 24 25 25 27 28 28** |
| First redeal "5 layouts" | 3–18, depending on how much masonry has to move |
| The note+swatches frame "does not exist" | it exists — `shots/50-note-with-swatches.png` |
| Negative-control pair, transcribed from a console | retired; replaced with archived JSON on both sides |
| Beat 1 "verify the deal board on the day" | `view=deal-board` on all four iteration-2 runs |

---

## 6. Still true, still unverified

Unchanged from the earlier draft, and all of it marked in the script:

- **Read-aloud.** `SpeakButton` is real and needs no agent or account, but it
  renders only where a work has a stored caption. A cold NGA work opened tonight
  offered `["Laurent de La Hyre","Public metadata","Copy"]` — **no read-aloud
  control.** Headless Chromium here has **0 voices**; no audio has ever been
  produced from this build. Find a captioned work before filming, or cut the beat
  and the second half of the end card.
- **The whole spoken path.** Push-to-talk enters *"Listening — release to send"*
  and on release nothing lands and nothing is reported. Must be shot on a real
  machine.
- **`prefers-reduced-motion` with a pick starting at slot 5.**
- **The clipboard fallback**, never seen in a real browser.
- **`describe_artwork`'s human path** — no "generate a description" control was
  found; the two-operator table does not claim one.

---

## 7. What I cut, and why

- **Any use of the negative-control pair.** Its JSON was overwritten. Better
  evidence exists.
- **"The agent sees the pictures."** It sees four hex swatches, a medium, a year
  and a classification. `lookup_artwork` and `describe_artwork` were called
  **zero** times across every recorded run in both iterations.
- **"Labels are written from the image."** Twelve of twelve in the A/B were
  written from the catalogue.
- **"No agent-only API."** Two tools have no human path. The script says *"the
  loop has no agent-only path"*, which is checkable.
- **A percentage for the note behaviour.** Four runs is not a rate. The text says
  *four for four named content, three of four named the work*.
- **The ledger filmstrip.** Built and tested, imported only by `/night/deal`.
  It is not on the product page and must not be filmed as one.
- **A total test count in the Devpost**, which is qualified rather than asserted:
  the reports give 59/593 → 68/737 → 91/1112 → 91/1115 → 94/1171 for web across
  the night as different lanes merged.

---

## 8. Checks

This lane edited nothing outside `docs/`, so these are a regression check on the
merged tree rather than on its own work. `apps/` and `packages/` on this branch
are **byte-identical to `origin/night/integration`** (`git diff --name-only
origin/night/integration HEAD -- apps packages` is empty), so these numbers
describe the tree the e2e lane measured.

| | Brief's baseline | This tree |
| --- | --- | --- |
| `pnpm --filter web typecheck` | — | **clean** — *after a build; see below* |
| `pnpm --filter web test` | 59 files / 593 tests | **91 files / 1115 tests, all pass** |
| `pnpm --filter api test` | 41 files / 770 tests | **44 files / 815 tests, all pass** |

The brief's baseline predates the `night/curation`, `night/activity`,
`night/review` and `night/sharing` merges. The api figure matches the
integration lane's iteration-2 number exactly.

**Typecheck needed a build first.** In a freshly installed worktree it fails
with `worker.ts(2,24): error TS2307: Cannot find module './build/server/index.js'`
— `apps/web/worker.ts` imports the Remix server build, which is a build artifact.
`pnpm --filter web build` then `typecheck` exits **0**. Not a regression; worth
knowing, because a clean checkout will report a false failure.

**One earlier run had a file fail to collect** on a Vite transform error, with
all 1113 tests in the other 90 files passing. It did not reproduce: the final
clean run is **91 files / 1115 tests, all pass**, matching the integration
lane's iteration-2 figure exactly. Intermittent, never a failing test — only a
collect — and not caused by this lane, which touched no source.

### 8.1 The demo path, run repeatedly

`docs/night/verify-demo-path.mjs` — new, and under `docs/` deliberately, because
`scripts/demo/` belongs to the e2e lane. It runs §9's reachable bullets three
times in fresh tabs and then does the things nobody scripts. **Zero model calls
by construction.** Raw: `docs/night/e2e-evidence/demo-path.json`.

It covers what the e2e harnesses do not: `U` (which no earlier harness pressed),
flags surviving an in-page search, and three failure paths.

**64 checks, 0 failures, three runs, no flakiness.** Every run identical. The
load-bearing rows, verbatim:

```
ok  U clears a flag it set                          {"flag":"none","by":"none"}
ok  get_view_context returns the flags, with
    visual facts attached                           {"picks":1,"rejects":2,
                                                     "palette":["#B89E81","#644F3F","#F4E8D6","#DCB17F"],
                                                     "medium":"watercolor and graphite on laid paper"}
ok  the flags survive the human running a
    different search                                {"picks":1,"rejects":2,"modelCalls":0}
ok  Enter on an empty bar makes NO model call       {"modelCalls":0,"exemplarCalls":1}
ok  the board is twelve and all twelve are
    on screen                                       {"cards":12,"fullyVisible":12,
                                                     "rejectsOnBoard":0,"gridHeight":724,"tray":2}
ok  the pick holds its slot, to the pixel           before {"dx":0,"dy":0} after {"dx":0,"dy":0}
ok  C opens the two-up as a room                    {"box":{"x":0,"y":0,"w":1440,"h":1000},
                                                     "askedBy":"human","chromeVisible":0}
ok  the agent's flag lands provisional and
    dashed, beside the human's solid one            human: box-shadow rgb(230,227,220) 0 0 0 1px,
                                                            outline none, provisional false
                                                    agent: outline dashed, by agent, provisional true
```

That is **§9 bullets 1, 2 and 5 met, three times over, at zero model cost**.
Bullet 3 is met by the e2e lane's four runs plus tonight's capture (§2.1).
Bullet 4 — a real voice utterance — is not reachable on this machine and is
reported as skipped rather than passed.

Worth singling out, because it is the two-colour ink contract measured off
computed styles rather than asserted: the human's confirmed mark is a **solid
ring drawn with `box-shadow`** and the agent's proposal is a **dashed outline**.
Reading `outline` alone would report the human's mark as absent.

**The failure paths all behave well.** Every one returns a structured error with
a hint rather than throwing or opening an empty view:

```
flag_artworks    on an unresolvable id  → {"ok":false,"error":{"code":"ARTWORK_NOT_IN_SESSION",
   "message":"None of those ids have been loaded by this page.",
   "hint":"Search or read get_view_context first, then flag ids from what came back."}}
compare_artworks on stale ids           → ARTWORK_NOT_IN_SESSION, both ids named. No empty room opens.
lookup_artwork   on a stale id          → {"ok":false,"error":{"code":"INVALID_INPUT",…}}
```

**And the empty state is silent, correctly.** Enter with no flags at all: the
page does not blank, no error appears, the `↵` affordance is correctly absent,
and **not one request is made**. Pressing the headline key before it means
anything costs nothing and says nothing, which is the right answer.

**First run: 27 failures, and all 27 were mine.** Recorded because the brief says
to establish this by reproducing rather than assuming, and because the e2e lane
made the same class of mistake and said so. Two harness bugs:

1. `window.__paillette_webmcp.call()` resolves to **the tool's own object**, not
   an MCP `{content:[{text}]}` envelope. Parsing it as an envelope gave `{}` for
   every `get_view_context`, which cascaded into eleven downstream assertions.
2. I tested "the flags survive a different search" with `page.goto`. **A
   navigation is a reload**, and flags are documented in-memory page-session
   state that a reload loses. So the harness destroyed the state and then
   reported correct behaviour as a defect. It types into the search field now.

Both fixed; the corrected run is the one in `demo-path.json`.

## 9. For whoever picks this up

The three things that would most improve the submission, in order, are all in
`submission-evidence.md` §4 and none of them is a doc:

1. **Widen the exemplar candidate pool** so Enter does not go dead after five
   redeals — because the `↵` affordance now invites a judge to sit and press it.
   Diagnosed precisely in e2e iteration 2 §4.
2. **Two agent turns in a fresh budget hour** to frame the inversion. The text is
   archived on both sides; only the picture is missing.
3. **`data-flag-by` on the swatch strips**, so the two-colour contract holds
   everywhere it is drawn.

The evidence file is the working surface. If a claim in the script ever stops
being true, it is because a row in `submission-evidence.md` changed — fix the row
first, then the sentence.
