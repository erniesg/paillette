# Activity lane — report

Branch `night/activity`, cut from `night/integration` at `51f389d`. Section 7
item 4 of the brief: the agent's presence is a glyph, not a transcript.

**The submission lane may describe anything under "Demonstrably true".** Every
line there is asserted by a script anyone can re-run against the running app, or
is a screenshot in `docs/night/shots/activity/`. Anything under "What is still
wrong" must not be claimed.

---

## 1. In one paragraph

The agent activity panel is gone. In its place: five character cells in the
agent's ink, in the corner of the page, nearly invisible when nothing is
happening and moving while a tool runs — and the motion says *which kind* of
tool, so searching does not look like describing does not look like redealing.
Click it and it opens on the real tool traffic: every call in order, with the
JSON that went in, the JSON that came back, and how long it took. That log is
the honest answer to "how was WebMCP implemented", and it is thirty seconds of
watching rather than a paragraph of claiming.

---

## 2. Re-running the evidence

```sh
pnpm --filter web dev --port 5222 --strictPort            # one shell

node apps/web/scripts/capture-activity-shots.mjs http://localhost:5222 \
     docs/night/shots/activity                            # 32 checks + 29 PNGs
```

The capture script is a verifier as well as a camera. It drives the real
`/nga/search` with the real tools registered on `document.modelContext`, calling
them the way a host does through `window.__paillette_webmcp.call`, and exits
non-zero on any failure. **32 checks, all passed.**

The cross-lane harnesses, all run against this branch on the same server:

| Harness | Owner | Result on this branch |
| --- | --- | --- |
| `voice-loop-verify.mjs` | voice | **33 checks, 0 failures** |
| `verify-plain-browser.mjs` | shared-state | **all checks passed** |
| `verify-culling-loop.mjs` | shared-state | **all checks passed** |
| `verify-failure-paths.mjs` | shared-state | **all checks passed** |
| `verify-agentless-loop.mjs` | shared-state | **all checks passed** |
| `integration-walkthrough.mjs` | integration | **32 passed, 1 failed** |

That one failure — *"each pick is in the same place on screen as before"* — is
**pre-existing and not this lane's**. It was reproduced on `51f389d`, the commit
this branch starts from, by checking `apps/web/app` out at that commit and
re-running the same script: identical failure, identical numbers. It is the
known gap the visuals lane recorded, that the twelve-card `DealBoard` is not on
the product grid, so a pick keeps its index in the board order but not its
coordinates in the masonry layout.

---

## 3. What shipped

### 3.1 The glyph

Five cells, `·····`, in `--ink-agent`. The dotted field is always there; a mark
moves through it while a tool runs.

**It is text.** One string swapped per frame in `"IBM Plex Mono"` — the house
catalogue face — not an SVG and not a CSS animation. The frames are written to
the text node directly rather than through React state, because a running call
means a frame every 110–340ms and nothing else on the page reads the current
frame. There is no re-render while the glyph animates.

**Six motions, derived from the tool that is running.** Not one spinner:

| kind | tools | what the motion is |
| --- | --- | --- |
| `scan` | `search_artworks`, `search_by_image`, `search_by_color`, `search_by_exemplars`, `browse_collection`, `lookup_artwork`, `list_collections` | a head with a wake travelling the field and coming back — **traversal** |
| `look` | `describe_artwork`, `show_artwork` | a bloom opening and closing on the spot — **attention, going nowhere** |
| `deal` | `redeal`, `set_results`, `set_view` | discrete bars arriving left to right and staying — **accretion** |
| `mark` | `flag_artworks`, `compare_artworks` | a slow seesaw, tipping one way then the other — **weighing** |
| `build` | `create_collection`, `add_to_collection`, `index_zip`, `index_folder`, `get_index_status` | two marks converging on one — **collection** |
| `read` | `get_view_context`, `get_search_quota` | one low breath — **barely there, because it barely is** |

`docs/night/shots/activity/09-frames-contact-sheet.png` is all six frame tables
rendered in the real font at the real size, which is the fastest way to judge
whether the claim holds.

Pace is part of the meaning: `mark` runs at 260ms against `scan`'s 110ms,
because a judgement that strobed would read as panic rather than deliberation.
`read` runs at 340ms and is the quietest, which is right for the thing the agent
does most often.

A test asserts the six frame tables share **no frame at all**. Without it, two
kinds could silently converge and the whole across-the-room claim would become
false with nothing to catch it.

**Glow and settle.** Running: full agent ink, opacity 1, a text-shadow in
`--ink-agent-soft` and `--ink-agent-wash`. Idle: `--ink-agent-faint` at 0.5.
Light comes up in **120ms** and dies away over **420ms** — the settle is that
decay, eased, nothing bouncy. The unknown tool defaults to `read`: guessing
quiet is the cheaper mistake.

**Failure is a resting state, not an alarm.** When the newest call came back an
error the field becomes `··×··` in the failure tone at *idle* weight, so it
reports rather than nags. It clears the moment something runs again. Because
every Paillette tool answers `{ok:false,error:{…}}` rather than throwing, a
returned refusal counts: a stale id rests as a cross, not as a success.

**Provenance.** Everything in this surface is the agent's ink and never the
human's graphite, resolved through `--ink-agent*` with a literal fallback, so it
flips with the theme. Verified in the light theme by reading computed styles:
`rgb(10, 95, 107)` for the agent, `rgb(154, 47, 28)` for a failure, measured at
5.9:1 against the paper ground.

### 3.2 `prefers-reduced-motion`

Honoured by **changing the mark, not by freezing a frame** — a frozen sweep and
a frozen bloom can be the same picture. Each kind has its own still:

```
scan   ▅▃▁··     a directional wake
look   ·███·     a wide steady block
deal   ▌▌▌▌▌     five separate cards
mark   █···█     two poles
build  ··█··     one converged point
read   ·▁▁▁·     a low flat rule
idle   ·····     the field
error  ··×··
```

A test asserts those are all distinct from each other and from idle. The
capture script asserts, in a real browser context with the preference set, that
the mark **does not change over 1.2 seconds** and that it is the still belonging
to its kind. CSS transitions are switched off under the media query too, so the
state change is instantaneous rather than a crossfade.

### 3.3 The log

Collapsed by default. Nothing the agent does opens it.

- Every call **in order, oldest at the top**, the way a log reads, following the
  tail like a terminal — but only while the reader is already at the tail.
  Someone who scrolled up to read an earlier call is reading it.
- Each row: **tool name** in the agent's ink, **arguments as JSON**, **result
  summary**, **duration** right-aligned in tabular figures.
- **Running** calls carry a solid agent-ink rule down the left edge and `···`
  where the duration will go. No second clock — the glyph already says
  something is in flight.
- **Errors** carry the failure rule and the message the tool actually wrote,
  including refusals that were returned rather than thrown.
- **Click a row** for the full arguments and the captured result, pretty-printed.
  This is the part a judge should be shown.
- A gap of more than ten seconds between calls draws a heavier rule: one
  operation ended and another began. A mark, not a heading.
- 120 entries of session history, which survives collapsing and reopening.

**Before anything has run**, the log shows the tool surface instead of an empty
box explaining that it is empty: `document.modelContext · 21` and the names,
read from the registry rather than copied out of the source, so it is what is
genuinely registered.

### 3.4 What was cut from the old panel, and why

| Was | Now |
| --- | --- |
| A header reading **"Agent activity"** | nothing. The glyph is the label. |
| **"WebMCP connected"** status pill | nothing. Without a host there is no glyph at all — that is the same fact, drawn. |
| A **× close button** | nothing. Clicking the glyph closes it; so does Escape. |
| **"No tool calls yet. Ask your agent to search this collection."** | the registered tool surface. An empty state that lectures is what §5b bans. |
| A **mini-board of the works the agent pinned** | nothing. Both `/nga/search` and `/try` already render `agentResults` on their own grids; this was the same twelve pictures twice. |
| The **agent's note, repeated** under that mini-board | nothing. The board renders it as a wall label. Two lanes reported the same sentence appearing twice on screen. |
| A **figure of the focused artwork** | nothing. Both routes render `state.focused` themselves. |
| **The panel reopening on every tool call** | it never opens itself. |
| Yellow `#fbbf24`, purple `#a855f7`, green `#4ade80` chrome | the two house inks and one failure tone. |

The **consent gate survives**, because it is load-bearing rather than
decorative: `create_collection` and `add_to_collection` park on a promise
`requestConfirmation` returns, and deleting the surface would hang the tool.
That is still the one thing that opens the log by itself.

---

## 4. Demonstrably true

Each line is asserted by `capture-activity-shots.mjs` unless marked.

### On the real page, with the real tools

- The glyph **rests on `·····`** with no panel open and no visible text anywhere
  saying what it is.
- Opening it before anything has run lists **21 tools** on
  `document.modelContext`.
- `search_artworks`, `describe_artwork` and `redeal` each put the glyph into
  `running` with the **right kind** (`scan`, `look`, `deal`), and each paints
  **more than one distinct frame** — 5, 4 and 6 observed respectively.
- **Every frame observed on the live glyph appears in the frame table** the
  contact sheet is drawn from. This is what makes the contact sheet evidence
  rather than a transcription.
- It **settles back to the field** when the last call finishes.
- `create_collection` puts it into `build` and **opens the log by itself**,
  because that is where consent is given.
- `flag_artworks` with an id the page has never loaded — a refusal that was
  returned, not thrown — **rests as `··×··`**.
- A ten-call session renders **ten rows**, at least one drawn as a failure.
- A row **expands onto its arguments and its captured result**.
- **Closing it hides it; reopening it holds the whole session** — the row count
  is identical before and after.
- In the light theme the agent's ink and the failure tone are **different
  computed values** on paper.
- On a browser with **no WebMCP at all** there is no glyph, no panel, nothing —
  `.pa-activity` does not exist in the document.

### Under `prefers-reduced-motion: reduce`

- For `scan`, `look` and `deal`: the mark **does not change over 1.2 seconds**,
  and it **is the still belonging to that kind**.
- The three stills are **different strings** from one another.

### Pinned by unit tests

`app/lib/webmcp/__tests__/activity-glyph.test.ts` (19),
`activity-format.test.ts` (14), `summarise.test.ts` (9),
`activity-panel-state.test.ts` (5),
`app/components/webmcp/__tests__/agent-activity-panel.test.tsx` (17) — **64 new
tests**.

- Every one of the 21 registered tools maps to a kind.
- The six motions share no frame; the six stills are all distinct; no kind holds
  a single frame for its whole cycle; `mark` is paced slower than `scan`.
- With several calls in flight the glyph follows the **most recently started**
  one, and stays running while an older call settles.
- An **aborted** call is not a failure. A **returned** refusal is.
- Rendering: the cells actually change on a timer, and actually stop — asserted
  by advancing two seconds after settle and finding the text unchanged.
- Searching and describing share **no frame at all** on the rendered component,
  not only in the table.
- History survives collapse; Escape closes; a turn of three calls does not open
  anything.
- `previewJson` survives a cycle, a BigInt, a function, a 9,000-character base64
  string and a 40-element array, and caps the whole payload at 2,500 characters.

---

## 5. Numbers, exactly

| Command | Baseline at `51f389d` | This branch |
| --- | --- | --- |
| `pnpm --filter web test` | 80 files · **912 passed** · 1 file failed | 84 files · **972 passed** · 1 file failed |
| `pnpm --filter web typecheck` | **1 error** | **1 error** |
| `npx eslint` over the changed files | — | clean |

Both remaining failures are the **same pre-existing one**: `worker.ts` imports
`./build/server/index.js`, a build artifact that only exists after
`pnpm --filter web build`. It fails on a clean checkout of the base commit for
the same reason, and it is what breaks both the typecheck and
`__tests__/worker-cache-control.test.ts`.

`pnpm --filter api test` was not run: this lane touched no API code.

---

## 6. Where to look, in one minute

1. `docs/night/shots/activity/09-frames-contact-sheet.png` — the six motions
   side by side. The whole argument, in one picture.
2. `08-log-row-expanded.png` — a real `search_artworks` call with its arguments
   and its result. This is the "how was WebMCP implemented" shot.
3. `01b-idle-glyph.png` next to `03-scan-2.png` — quiet, then working.
4. `07b-log-detail.png` — a turn's worth of traffic, two failures included.
5. `12-no-host.png` — an empty corner, which is what a browser without WebMCP
   gets.
6. `10-reduced-scan.png` / `10-reduced-deal.png` — the same states without
   motion.

---

## 7. What I cut, and why

- **A count on the glyph.** Concurrency is real — three calls can be in flight —
  but a number stamped on a five-cell mark is a caption, and captions are what
  this replaced. The count is on the button as `data-running` for a test to read
  and in the log for a person. The glyph shows the newest call's kind.
- **A live elapsed timer on running rows.** The glyph already says something is
  in flight; a second clock is a second thing to read. Running rows show `···`.
- **A tooltip on the glyph.** §5b, explicitly.
- **Prose anywhere.** No sentence in this surface narrates the mechanism. The
  only words that ship are the tool names, the JSON, the tools' own summaries
  and error messages, `arguments` / `result` as field labels, and
  `Approve` / `Decline` on the consent gate — all of which are the data or the
  control, not commentary about it.
- **A visible close control.** The glyph is the toggle and Escape works.
- **Wiring the ledger filmstrip.** The brief's triage item 9 says the ledger
  replaces the chat and, failing that, hide the activity panel rather than show
  a chat. The ledger exists on `night/visuals`, built and tested and not wired
  into any page. This lane did the second half of that instruction properly
  rather than shipping both; if an integrator lands the ledger, the glyph and
  the log should still stay, because they answer a different question.
- **A staging deploy.** Other lanes are working against the same environment.

---

## 8. What is still wrong

1. **The glyph is a fixed overlay in the lower-left corner.** It is 69×33 px
   including its hit padding — measured, not estimated — but it is still on top
   of the board rather than in the layout. The open log is up to
   `min(460px, 100vw-24px)` wide and `min(58vh, 520px)` tall and does cover the
   left of the board while it is open. That is now only ever the human's choice,
   or a consent gate.
2. **The log's history is capped at 120 calls.** Raised from 40, but a long
   rehearsal will still roll off the top. Nothing warns you when it does.
3. **`flag_artworks` and `get_view_context` have never been photographed
   animating.** Neither touches the network, so both settle in about a
   millisecond and cannot be held open — their motion is on the contact sheet,
   which is drawn from the frame table rather than from observation. The table
   is cross-checked against live observation for the four kinds that *can* be
   held, so it is the same table; but "someone has watched `mark` seesaw on a
   real page" is not something this report can claim.
4. **The captured result is a snapshot, not the object.** `previewJson` clips
   strings at 240 characters, arrays at 12 elements, depth at 6, and the whole
   payload at 2,500 characters. Cuts are named in the output (`… 28 more`) so a
   clipped payload never reads as a complete one, but the expanded row is not a
   substitute for a devtools network panel.
5. **The consent gate's detail line is still a sentence.** It is the one place
   words are load-bearing — someone is agreeing to something and has to be told
   what — but it is prose in a surface whose argument is that there is none.
6. **The glyph does not show concurrency.** Three calls in flight look exactly
   like one. Deliberate, and it is a real loss of information at the glyph
   level.
7. **Nothing about the log is keyboard-navigable beyond Tab.** Rows are buttons
   and focusable in order, and Escape closes, but there are no arrow keys and no
   focus trap. It is a disclosure, not a dialog, so this is defensible rather
   than right.
8. **The `read` motion is nearly unobservable in practice.** `get_view_context`
   returns in about 14ms, so its 340ms frame never advances — the glyph flashes
   one frame and settles. The kind is correct and the still is correct; the
   *motion* only exists for a slow connection.
9. **Nothing persists.** Refresh and the session's log is gone, like every other
   piece of state on this page.
10. **The log is complete only where `execute` is ours to wrap.** Instrumentation
    lives in `registry.instrument`, which wraps the `execute` of every tool
    handed to the host — so anything that runs that function is logged. Checked
    rather than assumed: reproducing exactly what `agent-prompt.tsx`'s own local
    `callTool` does (`getTools()`, then `tool.execute`) put a row in the log, so
    **in-page prompt-bar turns are logged** under `?webmcp-debug`. An earlier
    draft of this report said the opposite; it was wrong.

    What is genuinely untested is a **real** WebMCP host. On Chrome 152
    `getTools()` returns descriptors with no `execute`, per `docs/HANDOFF.md`, so
    the host must call `executeTool` — which invokes the instrumented function we
    registered, and should therefore log. Should, not does: **no tool call has
    ever been observed reaching this log from a real host.** Everything in §4 was
    driven through the debug harness.

---

## 9. Files this lane touched

```
apps/web/app/lib/webmcp/activity-glyph.ts             new — kinds, frames, state machine
apps/web/app/lib/webmcp/activity-format.ts            new — JSON rendering, defensively
apps/web/app/components/webmcp/activity-glyph.tsx     new — the animated cells
apps/web/app/components/webmcp/agent-activity-panel.tsx   rewritten — glyph + log
apps/web/app/lib/webmcp/store.ts                      +detail/+error, no self-opening, 120 entries
apps/web/app/lib/webmcp/summarise.ts                  the culling tools' results
apps/web/app/components/webmcp/webmcp-bridge.tsx      capture the payload; refusals are failures
apps/web/app/lib/webmcp/__tests__/{activity-glyph,activity-format,summarise,activity-panel-state}.test.ts
apps/web/app/components/webmcp/__tests__/agent-activity-panel.test.tsx
apps/web/scripts/capture-activity-shots.mjs           new — 21 checks, 29 PNGs
apps/web/scripts/{voice-loop-verify,integration-walkthrough}.mjs   the panel control they clicked is gone
```

`registry.ts` is **unchanged**. The instrumentation hook it already exposed
(`onExecute.onStart` / `onSettle`) carried everything this lane needed; the
richer events were assembled in the bridge from what the observer already
receives, so no tool semantics moved.

---

## 10. For whoever integrates

- **`panelDismissed` is gone from `WebMcpState`.** It existed only to fight the
  panel reopening itself, and nothing reopens itself now. `setPanelOpen` is a
  plain setter.
- **`settleActivity` takes an optional fourth argument.** Existing three-argument
  calls behave exactly as before.
- **`ActivityStatus` is unchanged.** A returned `{ok:false}` still settles as
  `'ok'`, because that is the truth about `execute` — the new `error` field is
  what says it failed. Anything reading `status` to decide "did this work" was
  already wrong and still is.
- **The styles are a `<style>` element inside the component**, using
  `.pa-activity-*` selectors and the `--ink-agent*` / `--lt-*` tokens with
  literal fallbacks. Nothing was added to `tailwind.css`, so this cannot collide
  with the visuals lane at merge.
- **If the ledger filmstrip lands**, keep both. The ledger is the conversation
  record — one frame per turn, restorable. The log is the mechanism — one row
  per tool call, with the payload. They answer different questions and the brief
  asks for both.
- **The one thing worth doing on a machine with the Chrome flag** is §8 item 10:
  drive a tool from a real host and confirm the row appears. Everything in this
  report was driven through `?webmcp-debug`. The instrumentation is on the
  `execute` we hand the host, so it should hold — but "should" is not what the
  ground rules ask for, and this is the only claim in the lane that rests on
  reading the code rather than watching it.
