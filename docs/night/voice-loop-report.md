# Voice lane — report

Branch `night/voice-loop`. Section 5 and 5b of the brief: make voice a reason
this project exists rather than a gimmick, make the boundary between speaking
and typing disappear, and keep text as the primary path.

**The submission lane may describe anything under "Demonstrably true" — those
claims are checked by a script anyone can re-run against the running app.**
Anything under "Not verifiable here" is built and unit-tested but has never met
a real microphone, and must not be claimed.

---

## How to check any of this yourself

```sh
pnpm --filter web dev                          # one terminal
node apps/web/scripts/voice-loop-verify.mjs    # another
```

Twenty-one checks against the real page in real Chromium — real board, real
store, real tools, real keyboard, real component — with only the network
fixtured so the run is deterministic and needs no API key. Exits non-zero on any
failure. Run three times consecutively while writing this: 21/21 each time.

---

## This round merged the shared-state lane

`night/shared-state` is merged into this branch, as one clearly labelled merge
commit (`e89aa84`). Section 9's headline beat — *Enter on an empty bar redeals
from human flags with no LLM call* — could not be wired or demonstrated from
either branch alone: the redeal engine is theirs, the utterance bar is this
lane's. Building against the real interface rather than guessing at it is the
only reason the verification above exists. The integrator can cherry-pick this
lane's commits instead if they prefer.

---

## The two bugs that mattered most

Both were invisible to unit tests and both were found only by running the app.

**1. The utterance bar never rendered.** On `/nga/search` in an ordinary
browser, `AgentPrompt` returned `null` — always. It decided once, at mount,
whether the page had a `document.modelContext`; the bridge installs that about
half a second later (measured: mount ~100 ms, bridge 833 ms), so the check lost
every time.

Everything this lane has built sat inside that `null`: push-to-talk, the grace
bar, the deictic chips, speech out. So did section 9's headline beat, because
`board-keyboard.ts` finds the bar by `input[aria-label="Ask the agent"]` and
there was no such element on the page. jsdom sets `modelContext` before anything
mounts, so the race does not exist in tests and 82 passing tests said nothing.
Inherited from `fab3ccb`, but it is this lane's file and this lane's feature it
silently deleted. Now derived from the store's `bridgeAttached` flag.

**2. Deixis only worked if you were talking.** The chip resolution was gated on
a pending *voice* utterance, which made pointing a feature of the microphone —
backwards, since the cursor is always there. It also could not read the store's
`hovered`/`selection`, which are bare id strings, not objects. Both fixed;
"this one" now resolves for a typed utterance with the mic absent entirely.

---

## Demonstrably true

Every line below is asserted by the verification script.

### Text first (section 5b)

- **A typed instruction alone fires the agent.** Type "something warm for above
  the sofa", press Enter, the turn goes to the model and the note comes back.
  No microphone involved at any point.
- **A typed turn is silent.** Nothing is spoken. The symmetric channel rule
  holds in the direction that matters most for anyone who never touches voice.
- **Deixis works by typing.** With the mic absent, "more like this one" binds to
  the pointed-at work and renders a chip with its thumbnail.
- **The whole lane degrades to a plain text box.** No `SpeechRecognition` → no
  mic button, no hotkey, identical behaviour otherwise. No `speechSynthesis` →
  no sound, everything else unchanged.

### Section 9's headline beat

- **Enter on an empty bar redeals from human flags with no model call.** `P` on
  a hovered card records a human pick, `X` a human reject, Enter on the empty
  bar runs the exemplar search and makes **zero** calls to the agent route.
- **Picks hold their index across a redeal** (verified across two consecutive
  redeals: index 0, then 0). **Rejects leave the board.**
- Flags placed through the debug harness are correctly recorded as *agent*
  flags, provisional, and are correctly ignored by the deterministic redeal —
  which counts human flags only.

### The utterance bar

- Hold the mic control, or hold Space anywhere outside a text field, to talk.
- Release does not send. It starts a 1.2 s countdown drawn as a thin line
  draining under the field. Click in to edit, Enter to send now, Esc to restore
  the field to exactly what it held before. Esc works from wherever focus is.
- Interim words are grey, settled words white, in one field. Verified in
  Chromium: identical font metrics, and the mirror tracks the input's scroll so
  a long sentence does not come apart.
- `continuous = true`, `interimResults = true` on the real recogniser object.
- Speech extends typed text rather than replacing it; typing takes ownership of
  spoken words (the fix for "any in us in here" → Inness is to retype it).
- After a **spoken** turn the note is spoken back, one sentence, once.

### Failure paths

Checked by returning real failures to the running page:

- A 500 surfaces the service's message and frees the field.
- A non-JSON reply — an edge error page — says *"The agent service replied with
  something unreadable (HTTP 200)"*. It used to print
  `Unexpected token '<', "<html>nope</html>" is not valid JSON` on screen.
- A four-second turn disables the field and the mic while in flight and returns
  both afterwards.
- A deictic phrase pointing at an id the session cannot resolve is marked, not
  guessed.
- No uncaught page errors in any of the above.

---

## Cutting the words (section 5b)

Audited against Lightroom's culling view, which carries no helper text at all —
a rejected frame simply dims, and keypress feedback is a transient overlay that
fades — and the museum wall label, which gives artist, title, date, medium and
never explains why the work is hung there. You know what a label refers to from
where it is.

Removed:

| Was | Now |
| --- | --- |
| "Hold the mic, or hold Space, to talk." | nothing — the control turns into a pulsing "listening" when held |
| "Sending in a moment — click in to edit, Enter to send now, Esc to discard." | the draining bar; the sentence survives only as a screen-reader status |
| `"this one" =` before each chip | nothing — the picture is the statement |
| "Could not tell what 'these two' means — nothing is selected." | the phrase in a dashed amber outline, beside the solid chips that resolved |
| `→ search_artworks` tool lines | nothing — the board shows the work landing; tool calls live in the activity panel |
| "you" on every human turn | a graphite left rule, against the agent's coloured one |

The result under the field is two marks and no sentences: a solid chip with a
thumbnail for what bound, a dashed outline holding the human's own words for
what did not. Terse rather than cryptic — you see your own phrase either
wearing a picture or not.

**The one place words were kept** is a visually hidden `role="status"` region
announcing the countdown. That is not helper text; it is the accessible
rendering of a control that is otherwise purely visual.

---

## Not verifiable here — do not claim these

Headless Chromium cannot do real speech recognition; Chrome ships the audio to
Google's service. The verification script installs a fake recogniser, which
makes the *plumbing* real in a real browser but not the speech.

1. **That a real recogniser produces usable interim results.** The two-contrast
   field assumes a steady stream of them. Never observed.
2. **Flush timing on release.** A real recogniser often flushes a few hundred
   milliseconds after you let go. Two failure modes were reasoned about and
   fixed — an empty tap no longer shows a countdown, and a transcript landing
   within 700 ms of release starts the countdown then. **The 700 ms is a guess.
   Watch this specifically.**
3. **Whether 1.2 s is the right grace.** It is the brief's number, not a tested
   one.
4. **Whether `continuous = true` survives a long pause** in a real Chrome. Some
   builds end the session anyway; the degraded path keeps the words and starts
   the countdown on release, but it has not been seen happen.
5. **`onerror` codes in the wild.** The `not-allowed` / `no-speech` / `aborted`
   copy is driven by strings no real recogniser has produced here.
6. **That Chrome actually says the sentence.** `speechSynthesis.speak` is called
   with one sentence after a spoken turn and not after a typed one — verified.
   Audio has never been produced on this machine.
7. **Microphone permission flow.** Never triggered.

A genuinely spoken take must be filmed on a real machine. Everything after the
transcript is capturable headlessly.

---

## What is cut or missing

**Artist/title autocomplete — cut.** There is no catalogue-facet endpoint to
draw names from; `facet` is a search *restriction*, not a source of names.
Building it needs a new API route (another lane's files) or a phonetic matcher
over on-screen artists, and a name-fixer that is right most of the time is
exactly the sort of thing that ruins a take. The valuable half ships: click the
word and retype it, because typing takes ownership of spoken text.

**Plural deixis cannot resolve, because nothing on the page can select.**
`setSelection` exists in the store and is reported by `get_view_context`, but it
is **called from no UI anywhere in the app** — shift-click multi-select was
never wired. So "these two" and "both of these" always report themselves
unresolved. The resolver is written and unit-tested and will work the moment
something selects. Do not claim multi-select in the submission.

**Hover-deixis has an order to it.** Put the caret in the bar first, *then*
point at a card. The reverse — point, then reach for the field — loses the
hover, because focusing the bar scrolls the card out from under the cursor. The
last hover is now carried for the length of one utterance, so the referent
survives the cursor moving away, but the initial pointing gesture still has to
happen while the field has focus. Worth knowing before filming.

**A dropdown autocomplete in the bar — cut on principle.** It would need Enter
and Esc, both already spoken for by the grace bar.

---

## Checks, exactly as they ran

```
pnpm --filter web test
  Test Files  1 failed | 66 passed (67)
  Tests       749 passed (749)

pnpm --filter api test
  Test Files  43 passed (43)
  Tests       791 passed (791)

pnpm --filter web typecheck
  app/components/webmcp/agent-activity-panel.tsx(153,9): TS6133 'runningEntry' unused
  worker.ts(2,24): TS2307 Cannot find module './build/server/index.js'
```

- **749 web tests pass, 0 fail.** This lane's own suite is 91 tests across 5
  files. The lane began the night at a 591-test baseline; the rest of the
  increase is the shared-state merge.
- **The one failing web test *file*, `worker-cache-control.test.ts`, was already
  failing before this lane touched anything.** It imports `./build/server/
  index.js`, which exists only after `pnpm build`. Same cause as the `worker.ts`
  typecheck error. Both reproduce on the base commit `44b2c7d`; verified by
  checking out a worktree at that commit and running the same commands.
- **Both remaining typecheck errors are pre-existing and outside this lane.**
  `agent-activity-panel.tsx` is the file a human is editing locally, so it was
  left alone.
- A third typecheck error appeared when the two lanes met — `document.body
  .append(input)` in `board-keyboard.test.ts`, clean on the shared-state branch
  and failing in the combined tree. Fixed with `appendChild`, which is identical
  for one element. Another lane's file, touched only because otherwise every
  branch carrying both lanes fails typecheck.
- `npx eslint` over `app/lib/voice` and `app/components/webmcp`: clean.
- API tests were run because the merge brought API changes; this lane wrote none
  of them.

---

## For whoever integrates

- **Space is a global hold-to-talk key** while the bar is mounted, with its
  keydown prevented so the page does not scroll. Guarded against firing inside
  inputs, textareas, selects and contenteditables, and against modifier chords.
  It does not collide with `P`/`X`/`U`/`C`. Easy to move if the grid wants it.
- **`agent-prompt.tsx` has a local `callTool` that cannot reach a real WebMCP
  host**, duplicating the host-aware one in `registry.ts`. Pre-existing; left
  alone deliberately rather than changing the agent loop's execution path while
  other lanes edit the tools it calls.
- **The activity panel overlaps the utterance bar** at 1280×900 on
  `/nga/search`. Not this lane's file (`agent-activity-panel.tsx`, human-edited)
  and not touched, but it will be in shot.
- `sampleResults` in `tools.ts` still drops `thumbnailUrl`, so the chips read
  the store directly rather than `get_view_context`. Same data, plus pictures,
  and synchronous. Details in `voice-loop-notes.md`.

## Against the brief's definition of done

> A voice utterance lands in the editable field; the note is spoken only after
> voice input.

Both halves are true and verified in a real browser, with the caveat that the
recogniser is a fake and no audio has been produced on this machine.

> Enter on an empty bar redeals from human flags with picks in place and no LLM
> call. Demonstrate this.

Demonstrated, and re-runnable: `node apps/web/scripts/voice-loop-verify.mjs`.
