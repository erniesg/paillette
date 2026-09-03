# Voice lane — report

Branch `night/voice-loop`. Sections 5 and 5b of the brief: make voice a reason
this project exists rather than a gimmick, make the boundary between speaking
and typing disappear, and keep text as the primary path.

**The submission lane may describe anything under "Demonstrably true".** Those
claims come from a script anyone can re-run against the running app. Anything
under "Not verifiable here" is built and unit-tested but has never met a real
microphone, and must not be claimed.

---

## Re-running the evidence

```sh
pnpm --filter web dev --port 5199 --strictPort     # one terminal
node apps/web/scripts/voice-loop-verify.mjs        # another
```

**33 checks** against the real page in real Chromium — real board, real store,
real tools, real keyboard, real component — with only the network fixtured, so
it is deterministic and needs no API key. Exits non-zero on any failure. Three
consecutive clean runs while writing this.

**The port is pinned deliberately.** Other lanes run dev servers on this VM and
5173 is first-come. For part of tonight this script was verifying the
*shared-state lane's checkout*, and the results looked entirely plausible,
because all the shared code behaves identically and only this lane's own
component was quietly the old one. Anything in this report that predates the
port being pinned was re-run afterwards.

---

## What this round found

### 0. The shared-state lane moved, and this branch took it

Nine further commits merged (`bdafd28`), three of which land on this lane's
claims: **selection is now wired**, so plural deixis works; the failure paths
are hardened; and `turn-bridge.ts` attaches gestures from outside the bar. That
shim and this lane's wiring were built for the same gap in parallel — it passes
through untouched when the body already carries `turn`, which the bar now
always does. **Verified on the wire: the payload appears exactly once**, not
twice. The shim is inert and its author says it can be deleted.

### 1. The gesture payload was never sent (the important one)

`toTurnPayload` was called by nobody. The shared-state lane had built the
gesture half of a turn; the API route was already rendering it into English
behind its "when the human's words and their gestures conflict, follow the
gestures and say so" rule. But **no typed turn ever carried it**, and the
utterance bar is the only thing that sends a turn. So the model only ever saw
the words.

That made triage item 2 — *gestures-as-turn payload, non-negotiable* —
unreachable, and section 9's third bullet impossible: the agent cannot refer to
the content of what was rejected if it is never told what was rejected.

Now wired. Flags travel with the sentence carrying **titles rather than ids**,
which is what lets the agent name what it dropped. Drained exactly once before
the loop, and sent only on the first pass.

### 2. `P`/`X`/`U`/`C` do nothing on a freshly loaded page

Measured, not inferred:

```
focus on load          : INPUT ph="search by feeling, era, subject..."
picks after P (focused): []
focus after a click    : BODY
picks after P (blurred): ["nga-1"]
```

The search field carries `autofocus`. `board-keyboard.ts` correctly ignores
bare letters while a text field has focus — it must, or typing "p" into the
search box would flag a work. Individually right, jointly fatal: load the page,
hover a card, press `P`, nothing happens.

**One click anywhere neutral fixes it for the session.** It is a precondition,
not a broken key — but it is invisible, and loading the page and pressing P is
the first thing anyone filming will do. The fix belongs to the search route
(`autofocus`), so it is written up in `voice-loop-notes.md` rather than changed
here.

Worth stating plainly: this lane's own script *appeared* to pass `P` and `X`
before this was understood, because a turn in flight disables the utterance bar
and the browser moves focus to `body` as a side effect. The script now clicks
the board first and asserts focus is not in a field.

---

## Demonstrably true

Every line is asserted by the verification script unless marked otherwise.

### Deixis, singular and plural

- **"more like this one"** binds to the pointed-at work and draws a chip with
  its thumbnail — typed, with the mic absent entirely.
- **"something between these two"** binds to a shift-click selection and draws
  both thumbnails, with no "2 works" caption: the pictures say two.
- A stale multi-selection no longer blocks a singular referent. A selection
  persists until cleared, so it is routinely older than the sentence; someone
  saying "this one" while pointing means the card.
- The referent survives the cursor leaving the card.
- What cannot be bound is marked, not guessed.

### Text first (section 5b)

- **A typed instruction alone fires the agent.** No microphone involved.
- **A typed turn is silent.** Nothing spoken.
- **The lane degrades to a plain text box.** No `SpeechRecognition` → no mic
  button, no hotkey. No `speechSynthesis` → no sound. Nothing else changes.

### The loop, keyboard-only

- `P` records a human pick, `X` a human reject, `U` clears, and `hovered` is
  reported to `get_view_context` — after the focus precondition above.
- `C` opens the two-up; **one click answers it**, the winner becomes a pick,
  the loser a reject, and the two-up closes.
- **Enter on an empty bar redeals from human flags with zero model calls.**
  Picks hold their index across two consecutive redeals; rejects leave.
- **The next typed turn carries the gestures**, with titles
  (`reject:Salt Marsh (Martin Johnson Heade)`), and carries the answered
  compare choice rather than firing a turn of its own.
- Flags placed through the debug harness are recorded as *agent* flags,
  provisional, and correctly ignored by the deterministic redeal.

### The agent's note refers to what was rejected — section 9, third bullet

Checked by hand on **three runs against the real model** (`gpt-5.6-terra`),
using the route's own `SYSTEM_PROMPT` read out of
`apps/api/src/routes/agent.ts` and a turn payload captured off the wire from
this lane's own dev server after the sofa prompt and two `X` presses:

> "You said warmer; you picked Lane's amber harbor glow and rejected the cooler,
> quieter dusk landscape and dark fallen tree…"

> "You said warmer; you've picked Lane's amber evening light and rejected the
> softer, duskier alternatives…"

> "You said warmer, and your pick confirms you want amber evening light rather
> than the cooler, grayer calm of the rejects."

Three for three referred to the **content** of the rejects, not their ids, and
all three opened by naming the gap between the words and the gestures. Two were
one sentence; one was two.

**How this differs from the real thing:** the request was assembled the way the
worker assembles it rather than by running the worker, which needs D1, KV and R2
bindings. The prompt text and the payload are the real ones; the HTTP plumbing
around the model call is not.

### The utterance bar

- Hold the mic, or hold Space outside a text field, to talk.
- Release does not send. A 1.2 s line drains under the field; click in to edit,
  Enter to send now, Esc to restore exactly what the field held. Esc works from
  wherever focus is.
- Interim words grey, settled words white, one field. Verified in Chromium:
  identical font metrics, and the mirror tracks the input's scroll so a long
  sentence does not come apart.
- `continuous = true`, `interimResults = true` on the real recogniser object.
- Speech extends typed text rather than replacing it; typing takes ownership of
  spoken words.
- After a **spoken** turn the note is spoken back, one sentence, once.

### Two colours of ink — section 9, last bullet

Within this component: a graphite rule on the human's turn, a coloured rule on
the agent's note, no labels on either. Confirmed by screenshot. The human's
sentence renders with the painting inside it.

### Failure paths

- A 500 surfaces the service's message and frees the field.
- A non-JSON reply says *"The agent service replied with something unreadable
  (HTTP 200)"* rather than `Unexpected token '<'`.
- A four-second turn disables the field and mic while in flight, and returns
  both after.
- A deictic phrase pointing at an unresolvable id is marked, not guessed.
- Leaning on Enter five times during a slow redeal fires **exactly one**
  redeal, not five.
- Enter on an empty bar with nothing flagged at all calls neither backend and
  raises nothing.
- No uncaught page errors in any of these.

**One failure path is genuinely broken, and it is not in this lane's files.**
A redeal whose backend refuses is completely silent: the board does not change
and nothing appears anywhere on the page. `installBoardKeyboard` accepts
`onTurn` and `onError` for exactly this, but `useBoardKeyboard` in
`flag-controls.tsx` installs with neither, so the failure is caught and dropped.
On camera it is indistinguishable from a dead key — and it is section 9's
headline beat, which depends on a network call. Written up with a suggested
patch in `voice-loop-notes.md`; not changed here because it is another lane's
component and they are actively working failure paths.

---

## Cutting the words (section 5b)

Audited against Lightroom's culling view — no helper text at all, a rejected
frame simply dims, keypress feedback is transient — and the museum wall label,
which gives artist, title, date, medium and never explains why the work is
hung. You know what a label refers to from where it is.

| Was | Now |
| --- | --- |
| "Hold the mic, or hold Space, to talk." | nothing — the control becomes a pulsing "listening" when held |
| "Sending in a moment — click in to edit, Enter to send now, Esc to discard." | the draining bar; kept only as a screen-reader status |
| `"this one" =` before each chip | nothing — the picture is the statement |
| "Could not tell what 'these two' means — nothing is selected." | the phrase in a dashed amber outline beside the solid chips |
| `→ search_artworks` tool lines | nothing — the board shows the work landing; tool calls live in the activity panel |
| "you" on every human turn | a graphite rule, against the agent's coloured one |

Under the field there are now two marks and no sentences: a solid chip with a
thumbnail for what bound, a dashed outline holding the human's own words for
what did not. The one place words were kept is a visually hidden
`role="status"` announcing the countdown — not helper text, but the accessible
rendering of an otherwise purely visual control.

---

## Not verifiable here — do not claim these

Headless Chromium cannot do real speech recognition; Chrome ships the audio to
Google. The script installs a fake recogniser, which makes the plumbing real in
a real browser but not the speech.

1. **That a real recogniser produces usable interim results.** The two-contrast
   field assumes a steady stream of them. Never observed.
2. **Flush timing on release.** Two failure modes were reasoned about and fixed
   — an empty tap shows no countdown, and a transcript landing within 700 ms of
   release starts the countdown then. **The 700 ms is a guess. Watch it.**
3. **Whether 1.2 s is the right grace.** The brief's number, not a tested one.
4. **Whether `continuous = true` survives a long pause** in real Chrome.
5. **`onerror` codes in the wild.**
6. **That Chrome actually says the sentence.** `speechSynthesis.speak` is
   verifiably called with one sentence after a spoken turn and not after a typed
   one. No audio has been produced on this machine.
7. **Microphone permission flow.** Never triggered.

A genuinely spoken take must be filmed on a real machine.

---

## Cut or missing

**Artist/title autocomplete — cut.** No catalogue-facet endpoint exists to draw
names from; `facet` is a search *restriction*, not a source of names. It would
need a new API route or a phonetic matcher, and a name-fixer that is right most
of the time ruins takes. The valuable half ships: click the word and retype it.

**Plural deixis now works** — this changed late. The shared-state lane wired
shift-click selection, and "something between these two" resolves to both works
with their thumbnails, with the selection riding the turn. Earlier drafts of
this report said not to claim multi-select; that is out of date.

**Hover-deixis has an order.** Caret in the bar first, *then* point. The
reverse loses the hover, because focusing the bar scrolls the card out from
under the cursor. The last hover is now carried for the length of one
utterance, so the referent survives the cursor moving away — but the pointing
gesture must happen while the field has focus.

**A dropdown autocomplete — cut on principle.** It would need Enter and Esc,
both already spoken for by the grace bar.

---

## Checks, exactly as they ran

```
pnpm --filter web test      Test Files  1 failed | 71 passed (72)
                            Tests       819 passed (819)

pnpm --filter api test      Test Files  43 passed (43)
                            Tests       791 passed (791)

pnpm --filter web typecheck
  app/components/webmcp/agent-activity-panel.tsx(153,9): TS6133 'runningEntry' unused
  worker.ts(2,24): TS2307 Cannot find module './build/server/index.js'
```

- **819 web tests pass, 0 fail.** This lane's own suite is 96 tests across 5
  files; the rest of the increase is the shared-state merges. **791 API tests pass** — run because the merge brought API changes;
  this lane wrote none of them.
- **The one failing web test *file* was already failing before this lane
  touched anything.** `worker-cache-control.test.ts` imports
  `./build/server/index.js`, which exists only after `pnpm build` — same cause
  as the `worker.ts` typecheck error. Both reproduce on the base commit
  `44b2c7d`, verified by checking out a worktree there.
- **Both typecheck errors are pre-existing and outside this lane.**
  `agent-activity-panel.tsx` is human-edited, so it was left alone.
- `npx eslint` over `app/lib/voice`, `app/components/webmcp` and
  `apps/web/scripts`: clean.

`night/shared-state` is merged into this branch as one labelled merge commit
(`e89aa84`), because section 9's headline beat spans both lanes and could not be
wired or demonstrated from either alone. Cherry-pick this lane's commits instead
if preferred.

---

## For whoever integrates

- **`autofocus` on the search field disables the grid keys from a cold load.**
  The single most likely thing to spoil a take. Notes item 7.
- **The compare two-up has no Escape** — it closes on a choice or the "Neither
  — close" button. It is `aria-modal` and covers the page. Notes item 8.
- **Space is a global hold-to-talk key** while the bar is mounted, keydown
  prevented so the page does not scroll. Guarded against text fields and
  modifier chords; no collision with `P`/`X`/`U`/`C`. Easy to move.
- **`agent-prompt.tsx` has a local `callTool` that cannot reach a real WebMCP
  host**, duplicating the host-aware one in `registry.ts`. Pre-existing, left
  alone deliberately.
- **The activity panel overlaps the utterance bar** at 1280×900. Another lane's
  file, untouched, but it will be in shot.
- `sampleResults` still drops `thumbnailUrl`, so chips read the store rather
  than `get_view_context`.

## Against the brief's definition of done

| | |
| --- | --- |
| `P`/`X`/`U`/`C` and Enter work; flags persist; `get_view_context` returns them | **yes**, after one click to move focus out of the autofocused search field |
| Enter on an empty bar redeals from human flags, picks in place, no LLM call | **yes**, verified and re-runnable |
| The agent's redeal note refers to the content of what was rejected, three runs | **yes**, three real-model runs; request assembled as the worker does rather than by running the worker |
| A voice utterance lands in the editable field; the note is spoken only after voice | **yes**, with a fake recogniser and no audio produced on this machine |
| Two colours of ink visible in every state | **yes within this component**; the board's ink is the shared-state lane's |

### One more thing the submission must not say

The demo path has **two preconditions that are invisible and not this lane's to
fix**: the search field's `autofocus` makes `P`/`X`/`U`/`C` dead until you
click once, and the activity panel re-opens on every agent action and
intercepts clicks on the cards beneath it. Both are in `voice-loop-notes.md`
with the files and the fixes. Neither is a defect in the keys or in the bar, but
either will make a take look broken.
