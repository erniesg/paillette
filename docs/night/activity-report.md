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

node apps/web/scripts/verify-definition-of-done.mjs http://localhost:5222 6  # section 9, 6 takes
                                                                            # (cycles 3 viewport/theme configs)
node apps/web/scripts/verify-activity-log.mjs   http://localhost:5222        # 53 checks
node apps/web/scripts/capture-activity-shots.mjs http://localhost:5222 \
     docs/night/shots/activity                                               # 32 checks + 30 PNGs
```

Both drive the real `/nga/search` with the real tools registered on
`document.modelContext`, calling them the way a host does, and exit non-zero on
any failure. `verify-activity-log` is the unhappy paths; `capture-activity-shots`
is a camera that also checks what it is photographing.

**Every harness on this branch, run three consecutive times:**

| Harness | Owner | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- | --- |
| `verify-definition-of-done.mjs` | this lane | **43/43** | **43/43** | **43/43** |
| `verify-activity-log.mjs` | this lane | **53/53** | **53/53** | **53/53** |
| `capture-activity-shots.mjs` | this lane | **32/32** | **32/32** | **32/32** |
| `voice-loop-verify.mjs` | voice | **0 failures** | **0 failures** | **0 failures** |
| `verify-plain-browser.mjs` | shared-state | **pass** | **pass** | **pass** |
| `verify-culling-loop.mjs` | shared-state | **pass** | **pass** | **pass** |
| `verify-failure-paths.mjs` | shared-state | **pass** | **pass** | **pass** |
| `verify-agentless-loop.mjs` | shared-state | **pass** | **pass** | **pass** |
| `integration-walkthrough.mjs` | integration | **32 pass / 1 fail** | **32 / 1** | **32 / 1** |

That one failure is the same one every time — *"each pick is in the same place
on screen as before"* — and it is **pre-existing and not this lane's**. It was
reproduced on `51f389d`, the commit this branch starts from, by checking
`apps/web/app` out at that commit and re-running the same script: identical
failure, identical coordinates. It is the gap the visuals lane recorded, that
the twelve-card `DealBoard` is not on the product grid, so a pick keeps its
index in the board order but not its position in the masonry layout.

Nothing in this lane is flaky across those runs. Every number above is the same
on all three.

---

## 2b. Section 9, run as one continuous take

This lane's own harnesses only prove this lane's surface. The brief's definition
of done spans four lanes, and the harnesses that cover it each test a slice with
their own fixtures and reset between sections. **A filmed take does not reset.**
`verify-definition-of-done.mjs` drives one page from a cold load through every
beat, in the order a camera would see them, and prints a verdict per bullet —
because "37 checks passed" does not tell anyone whether bullet three is safe to
point a lens at.

**43 checks per take. Sixteen takes run in total: ten consecutive at one size,
then six cycling three configurations. No failure and no variance in any of
them.**

A run cycles **1500×1000 dark**, **1280×800 dark** — the size where the voice
lane found the old panel overlapping the utterance bar — and **1440×900 light**,
where every design token flips. So no bullet below is proven in only one
configuration.

| §9 bullet | Verdict | What was actually observed |
| --- | --- | --- |
| `P`/`X`/`U`/`C` and Enter work; flags persist; `get_view_context` returns them | **PASS** 8/8 | `P` picks the hovered card, `X` rejects, `U` clears, `C` opens the two-up and one click answers it — and the flags survive the human running a different search |
| Enter on an empty bar redeals from human flags, picks in place, **no LLM call** | **PASS** 7/7 | reaches `/exemplars` once, `/public-agent` **zero** times, deals **12**, the pick is first in the board order *and* the first card actually rendered, board marked as the human's move |
| the agent's redeal note refers to the content of what was rejected | **PARTIAL** 5/5 | the precondition holds: after the sofa prompt and two `X` presses the turn carries the rejects the human just made, **each with a title rather than an id**. The model half is not run here — see below |
| a voice utterance lands in the editable field; the note is spoken only after voice | **PARTIAL** 12/12 | the typed turn is **silent**; then, in the same session, holding the mic lands interim words in the field as they arrive, releasing does **not** send, a grace bar drains, the words stay editable while it does, the turn commits, and the note is spoken back **exactly once**. Plus: with `SpeechRecognition` deleted entirely, no mic is drawn and a typed instruction alone still fires the agent. No real recogniser — see below |
| two colours of ink visible in every state | **PASS** 11/11 | both marks on screen at once and **different resolved values**; the human's filled and solid, the agent's outlined and **dashed**; each equal to the theme's own `--ink-human` / `--ink-agent`; the confirmed pick carrying the hairline frame in that ink; the activity glyph in the agent's ink. **Checked in both themes** — graphite is `rgb(230,227,220)` on the charcoal table and `rgb(23,22,26)` on the paper one |

**Why bullet 4 is stronger here than anywhere else.** The typed turn and the
spoken turn happen in *the same session*, so "spoken only after voice" is a
contrast that was observed rather than two claims asserted in two scripts. What
is still missing is only the speech itself.

**The take's one invisible precondition, stated because it will spoil a shot.**
The search field carries `autofocus`, and a bare letter is correctly ignored
while a text field has focus. So on a cold load `P` does nothing until one click
lands somewhere neutral. The script does that click as step one rather than
pretending it is unnecessary. Whoever films this should know it.

### The two halves this script does not run, and why

- **The model.** Checking that the note refers to the *content* of the rejects
  needs a live model, and a stub answering with a sentence about rejects would
  be the script grading its own homework. The API worker on this VM **is**
  reachable and does have a key — `POST /api/public-agent/turn` answers
  `NO_TOOLS` rather than an auth error, which means the route and the key are
  both there. It was **deliberately not run**: the anonymous budget is 40 model
  calls per client per hour, shared across everyone on this machine, three sofa
  runs cost roughly nine, and another lane had that worker up and may have been
  rehearsing against it. The evidence for this bullet already stands at **9 live
  runs in the shared-state report and 3 in the voice report**; a fourth
  confirmation was not worth spoiling someone's takes for.
- **The recogniser.** Headless Chromium cannot do real speech recognition —
  Chrome ships the audio to Google. The take installs a fake recogniser and a
  recording synthesiser before the page's script runs, so the *plumbing* is real
  in a real browser: a real component, a real field, a real grace bar, a real
  turn. **The speech is not.** No recogniser has run and no audio has been
  produced on this machine. A genuinely spoken take must be filmed on a real
  one, and nothing in the submission should say otherwise.

### Four false alarms, recorded because each looked like a defect first

Every one was the script's fault, not the product's, and each is the kind of
thing that would have cost someone a morning:

1. **"the board dealt eight."** A ten-work fixture, and a redeal excludes the
   picks, the rejects and everything already dealt. Fixture defect.
2. **"the rejects were not named by title."** The assertion pattern-matched a
   `reject:Title` serialisation the payload does not use; it sends
   `{artworkId, title, to}`. The titles were there all along.
3. **"the two hands render in the same colour."** The check read
   `.paillette-flag-badge`, which is a layout wrapper inheriting body colour —
   so it compared two identical values and reported that the provenance ink,
   the thing the whole palette exists for, was broken. **It is not.** The mark
   is the pressed button *inside* the badge. Read that and the human is filled
   graphite with a solid border, the agent outlined cyan and dashed.

4. **"a confirmed pick has lost its hairline frame in the light theme."** It has
   not. The assertion carried the dark theme's graphite, `rgb(230,227,220)`, as
   a literal — and in the light theme graphite is `rgb(23,22,26)`. The frame was
   there the whole time. The check now paints a probe with `var(--ink-human)`
   and reads it back, so it compares against whatever the theme resolved.

Two of those are worth repeating for anyone else writing an ink check:

- Assert on `.paillette-flag-button[aria-pressed="true"]`, never on
  `.paillette-flag-badge` — the badge is a layout wrapper and inherits body
  colour, so both hands read identical.
- **Never hardcode a token value.** Resolve it through the browser. Every ink
  token flips between themes, and a literal turns a passing build into a
  reported defect in exactly the half of the checks nobody runs by default.

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
- **Click a row** for the full arguments, an arrow, and the captured result.
  This is the part a judge should be shown. There are no field labels on those
  two blocks: a wall label gives artist, title, date and medium and never names
  the fields, because position says which is which, and a REPL prints what went
  in, an arrow, and what came back. Same principle, one character.
- A gap of more than ten seconds between calls draws a heavier rule: one
  operation ended and another began. A mark, not a heading.
- 120 entries of session history, which survives collapsing and reopening and a
  client-side navigation. When a session runs past that, the top of the log says
  **`… 15 earlier`** — a count, because a truncated list that says nothing reads
  as a complete one.
- **Reaching for anything else closes it.** The log is opaque and it sits over
  the lower-left of the board, which is where the cards are. A pointer going
  down outside it closes it, in the capture phase and preventing nothing, so the
  click still lands where it was aimed — no gesture is spent dismissing, and
  there is one fewer control to find. A pending confirmation is exempt.

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

### The unhappy paths, driven in a browser

All from `verify-activity-log.mjs`. **53 checks, three consecutive clean runs.**

- **A slow connection.** A call held open for nine seconds: the glyph is still
  animating four seconds in rather than having given up, the row shows `···` and
  no duration while it is in flight, and when it lands the duration it reports
  is **9.0s** — the real one, not a rounding of zero.
- **Cancellation is not failure.** An aborted call rests the glyph at **idle**,
  is logged with status `aborted`, and is **not** drawn in the failure ink.
- **Ids that no longer resolve**, across six tools — `show_artwork`,
  `describe_artwork`, `search_by_exemplars`, `flag_artworks`,
  `compare_artworks`, `lookup_artwork`. Every one renders as a failure carrying
  **the message that tool actually wrote**, asserted by matching the row text
  against the error the call returned, not against a fixed string. So the log
  shows *"No artwork "ghost-1" has been loaded by this page."* rather than
  *"error"*.
- **`redeal` with nothing picked** refuses with `NO_EXEMPLARS` and is drawn as a
  failure rather than as a successful call that did nothing.
- **A backend answering 503** reaches the log as a readable failure, and the
  glyph rests as one.
- **Three calls in flight at once**: the glyph counts three, plays the newest
  one's motion, three rows are marked running simultaneously, and none is left
  marked running when they settle.
- **A 60-work result** is captured capped at 2,535 characters rather than pasted
  whole.
- **A client-side navigation** — asserted to be client-side and not a reload,
  via a marker on `window` — leaves the glyph mounted and the session intact,
  14 rows before and 14 after.
- **130 calls into a 120-call buffer**: exactly 120 rows, `… 24 earlier` at the
  top, and the newest call still the last row.
- **Reaching for a card beside the open log** closes the log *and* flags the
  card — the click is not spent on the dismissal.
- **Keyboard**: Enter on the focused glyph opens the log, Escape closes it.
- **No uncaught page errors** in any of it.

### A host shaped like Chrome's

**Read the caveat first.** The Chromium on this VM is **141**, and
`await LanguageModel` aside, it exposes **no `document.modelContext` at all** —
checked directly, with and without `--enable-features=WebMCPTesting`. So nothing
in this lane has met a real WebMCP host, and nothing here should be described as
if it had.

What *can* be said: the debug harness is not spec-shaped in the one way that
matters. It hands the page's own tool objects back out of `getTools()`, `execute`
included. `docs/HANDOFF.md` records that a real host does not — Chrome 152
returns **descriptors**, and running one means
`executeTool(toolObject, JSON.stringify(args))`, an object and a JSON string.

So `verify-activity-log.mjs` installs a host with exactly that contract before
any of the page's script runs, which is where a real one would be, and asserts:

- the page registers **21 tools** with it rather than falling back to a stub;
- `getTools()` returns descriptors and **none of them carries `execute`**;
- `executeTool(descriptor, '{"query":"driven by the host"}')` runs the tool;
- **the log records that call, with the arguments the host sent**;
- passing a *name* instead of the object fails with *"not of type
  RegisteredTool"*, the way Chrome fails.

That is a simulation of the documented contract, not Chrome. It closes the gap
as far as this machine allows and no further.

### Text first

No part of this surface touches speech. `grep -niE
"speech|speak|recogni[sz]|microphone|utterance|voice"` across
`activity-glyph.ts`, `activity-format.ts`, `activity-glyph.tsx`,
`agent-activity-panel.tsx`, `summarise.ts` and both capture scripts returns
**nothing**. Every check in this report was driven by typed calls and clicks;
none of it degrades if `SpeechRecognition` is absent, because none of it looks.

### Under `prefers-reduced-motion: reduce`

- For `scan`, `look` and `deal`: the mark **does not change over 1.2 seconds**,
  and it **is the still belonging to that kind**.
- The three stills are **different strings** from one another.

### Pinned by unit tests

`app/lib/webmcp/__tests__/activity-glyph.test.ts` (19),
`activity-format.test.ts` (14), `summarise.test.ts` (9),
`activity-panel-state.test.ts` (7),
`app/components/webmcp/__tests__/agent-activity-panel.test.tsx` (21) — **70 new
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
- History survives collapse; Escape closes; a pointer down outside closes but a
  pointer down inside does not; a pending confirmation cannot be dismissed by
  clicking away; a turn of three calls does not open anything.
- 130 calls into a 120-call buffer leaves 120 rows and `… 10 earlier`, and
  nothing is dropped until the buffer is genuinely full.
- The expanded row carries a `→` marked `aria-hidden`, and the words
  "arguments" and "result" appear in the accessible tree but **not** in anything
  painted.
- `previewJson` survives a cycle, a BigInt, a function, a 9,000-character base64
  string and a 40-element array, and caps the whole payload at 2,500 characters.

---

## 5. Numbers, exactly

| Command | Baseline at `51f389d` | This branch |
| --- | --- | --- |
| `pnpm --filter web test` | 80 files · **912 passed** · 1 file failed | 84 files · **978 passed** · 1 file failed |
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
- **The words `arguments` and `result`** above the two JSON blocks in an
  expanded row. They were a legend for something position already says. Replaced
  with one `→`; the words survive only in the accessible tree.
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

1. **Cards underneath the open log cannot be clicked.** That is true of every
   overlay ever drawn, and the log now closes the moment the pointer goes down
   anywhere outside it — so a click *beside* it is never lost. But while it is
   open it is opaque, up to `min(460px, 100vw-24px)` wide and `min(58vh, 520px)`
   tall, and the cards it covers are unreachable until it closes. The glyph
   itself is 69×33 px including hit padding, measured.
2. **The log's history is capped at 120 calls.** A long rehearsal still rolls
   off the top. It now says how many it dropped, so the record is honest about
   being partial — but the dropped calls are gone, not paged.
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
10. **No tool call has ever reached this log from a real WebMCP host**, because
    there is no real host on this machine to try. The Chromium available here is
    **141** and exposes no `document.modelContext`, with or without
    `--enable-features=WebMCPTesting` — checked directly, not inferred from the
    version number.

    Two things narrow the gap and neither closes it. Reproducing exactly what
    `agent-prompt.tsx`'s own local `callTool` does put a row in the log, so
    in-page prompt-bar turns are logged. And a host implementing Chrome 152's
    documented contract — descriptors out of `getTools()`,
    `executeTool(object, jsonString)` in — also logs, with the arguments it sent.
    But that host is one this lane wrote from `docs/HANDOFF.md`. **Someone with
    the Chrome flag should run one tool and look.** It is the only claim in the
    lane resting on the documentation rather than on the browser.
11. **`agent-prompt.tsx` cannot reach a real host at all**, per the voice lane:
    its local `callTool` calls `tool.execute` on whatever `getTools()` returns,
    and a real host returns descriptors with no `execute`. That is pre-existing,
    is not this lane's file, and is a bug in the prompt bar rather than in the
    log — but if it bites, the in-page agent stops working before the log has
    anything to miss.

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
apps/web/scripts/capture-activity-shots.mjs           new — 32 checks, 30 PNGs
apps/web/scripts/verify-activity-log.mjs              new — 53 checks, the unhappy paths
apps/web/scripts/verify-definition-of-done.mjs        new — section 9 as one take, verdict per bullet
apps/web/scripts/{voice-loop-verify,integration-walkthrough}.mjs   the panel control they clicked is gone
```

`registry.ts` is **unchanged**. The instrumentation hook it already exposed
(`onExecute.onStart` / `onSettle`) carried everything this lane needed; the
richer events were assembled in the bridge from what the observer already
receives, so no tool semantics moved.

---

## 10. For whoever integrates

- **`panelDismissed` is gone from `WebMcpState`**, and `activityDropped` is new.
  The first existed only to fight the panel reopening itself, and nothing
  reopens itself now; `setPanelOpen` is a plain setter. The second counts what
  rolled off the end of the bounded activity buffer.
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
  open `/nga/search`, run one tool from the host, open the glyph, and check the
  row is there. Two minutes. It is the only claim in the lane resting on
  `docs/HANDOFF.md` rather than on a browser.
- **Run `node apps/web/scripts/verify-activity-log.mjs` after merging.** It is
  the check that catches the log and the board fighting over the same corner of
  the screen, which is how the panel this replaced went wrong in the first
  place, and jsdom cannot see it.

---

## 11. For the submission lane

Four sentences that are safe to write, each backed by something in §4:

- *The agent's presence on the page is a five-character mark in the corner,
  quiet when nothing is happening, and the way it moves says which kind of tool
  is running — searching, describing, dealing, weighing.* Backed by the contact
  sheet and by 53 browser checks.
- *Click it and it opens on the live tool log: every call in order, with the JSON
  that went in, the JSON that came back, and how long it took.* Backed by
  `08-log-row-expanded.png` and the tests.
- *That log is how the WebMCP implementation is shown rather than described —
  the tools are registered on `document.modelContext` and called against the page
  in front of you.* Backed by the registered-tool listing and the spec-shaped
  host check, **with the caveat in §8 item 10**.
- *Nothing about it depends on speech, and it degrades to nothing at all on a
  browser without WebMCP.* Backed by the grep in §4 and by `12-no-host.png`.

And one about the loop as a whole, which §2b backs:

- *Every beat of the definition of done runs end to end in a browser, in
  shooting order, sixteen takes without a single failure — including the
  headline one: press Enter on an empty bar and the board redeals from your own
  picks with no model call at all.* Backed by `verify-definition-of-done.mjs`,
  which asserts the agent route is called **zero** times, across two viewport
  sizes and both themes.

**Do not write** that this has been seen working in Chrome with the WebMCP flag.
It has not. **Do not write** that the deal animation appears on the product
grid — that is the visuals lane's, and it does not. **Do not write** that the
agent's note was verified against a live model on this branch — it was not; that
evidence is the shared-state and voice lanes', and §2b says why it was not
repeated here.
