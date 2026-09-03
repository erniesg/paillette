# Voice lane — report

Branch `night/voice-loop`, cut from `deploy-nga-open-access`. Section 5 of the
brief: make voice a reason the project exists rather than a gimmick, and make
the boundary between speaking and typing disappear.

**The submission lane may only describe what is under "Demonstrably true".**
Everything under "Cannot be verified on this machine" is built and tested at the
logic level but has never met a real recogniser, because this machine cannot run
one.

---

## Files touched

| File | |
| --- | --- |
| `apps/web/app/components/webmcp/agent-prompt.tsx` | rewritten around push-to-talk |
| `apps/web/app/lib/voice/recognition.ts` | new — recogniser detection, transcript reading, error copy |
| `apps/web/app/lib/voice/utterance.ts` | new — composition rules, grace timing |
| `apps/web/app/lib/voice/deixis.ts` | new — scene reading, referent binding, chip segmentation |
| `apps/web/app/lib/voice/speech-channel.ts` | new — the symmetric channel rule |
| `apps/web/app/lib/voice/__tests__/*` | new — 55 tests |
| `apps/web/app/components/webmcp/__tests__/agent-prompt.test.tsx` | 6 tests → 27 |
| `docs/night/voice-loop-notes.md`, `voice-loop-report.md` | new |

Nothing outside that list was edited. `tools.ts`, `store.ts`, the result tiles,
the layout components and `agent-activity-panel.tsx` are untouched — verify with
`git diff --stat 44b2c7d..HEAD`.

`speak-button.tsx` is at `app/components/artwork/speak-button.tsx`, not under
`webmcp/` as the brief had it. It was **not modified**; the new speech-out
channel deliberately yields to it rather than coordinating with it.

## Tests and typecheck — exactly what happened

```
pnpm --filter web test
  Test Files  1 failed | 62 passed (63)
  Tests       667 passed (667)

pnpm --filter web typecheck
  app/components/webmcp/agent-activity-panel.tsx(153,9): TS6133 'runningEntry' unused
  worker.ts(2,24): TS2307 Cannot find module './build/server/index.js'
```

- **667 passed, 0 failed.** Baseline before this lane: 591 passed / 59 files.
  This lane adds 4 files and 76 tests. (The brief cites 593; the two-test
  difference is `worker-cache-control.test.ts`, which never collected here.)
- **The one failing *file*, `__tests__/worker-cache-control.test.ts`, was
  already failing before this lane touched anything.** It imports
  `./build/server/index.js`, which only exists after `pnpm build`. Same cause as
  the `worker.ts` typecheck error. Not mine, not fixed.
- **Both typecheck errors are pre-existing and outside this lane.**
  `agent-activity-panel.tsx` is the file a human is editing locally, so it was
  left alone. Both reproduce on the base commit `44b2c7d`.
- `npx eslint` over `app/lib/voice` and `app/components/webmcp`: clean. It was
  not clean on the base commit — the inherited recogniser stub tripped
  `no-this-alias` — and that is fixed.

---

## What is demonstrably true

### Step 1 — what already existed, checked before writing anything

Commit `fab3ccb9` was mostly as the brief described. Verified against the code:
`interimResults = true`, `continuous = false`, interim text written into the
input, submit on the final result, and `onerror` copy for `not-allowed` and
`no-speech`, with six tests.

Two of the brief's guesses about what was missing were wrong, and one was right:

- **The pulsing listening indicator already existed** (`animate-pulse` dot plus
  the word "listening"). It did not survive `prefers-reduced-motion`, which is
  fixed — `motion-reduce:animate-none`, with the word and a steady dot carrying
  the meaning.
- **The interim/final contrast was genuinely missing.** Interim text was written
  into the input looking exactly like something the human had typed, so there
  was no moment on camera where the words stopped being a guess.
- A third problem the brief did not name: **interim text overwrote the field**
  (`setInput(live)`), so speaking after typing destroyed what was typed.

### Step 2 — push-to-talk with a grace bar

- Hold the mic control (pointer, or Space/Enter held on it when focused) or hold
  **Space anywhere on the page** when no text field has focus.
- Release does **not** send. It starts a 1.2 s countdown drawn as a thin line
  draining left to right under the field, with `role="progressbar"` and a live
  `aria-valuenow`.
- Click into the field during it → the countdown stops and waits. Enter → sends
  now. Esc → the field goes back to exactly what it held before the utterance.
- Esc works from wherever focus is, not just the field. Release does not move
  focus into the field, so binding Esc there meant the advertised escape did not
  work from the state a human is actually in after speaking.
- The bar is driven from the clock, not a CSS animation, so there is nothing to
  disable under `prefers-reduced-motion` and the same number is assertable. A
  text line states the whole contract in words for anyone who cannot see a
  two-pixel line move.

`continuous` changed from `false` to `true`, and the existing test assertion was
updated accordingly. This is required by push-to-talk, not a stylistic change:
with `continuous = false` the recogniser ends the turn at its own first silence,
so "something warm… for above the sofa" arrives as "something warm". Push-to-talk
means the human owns the sentence boundary.

### Step 3 — one field, two inputs

- The mic writes into the single utterance bar. There is no second field and no
  mode.
- Speech **extends** typed text (`"warm landscape"` + spoken `"without people"`
  → `"warm landscape without people"`). It never replaces it and never moves
  focus.
- Typing takes ownership of every word in the field, spoken ones included — the
  fix for "any in us in here" when you meant Inness is to click the word and
  retype it, and the retyped text is what gets sent.
- Settled words are white; words still being heard are grey, inside the same
  field. Implemented as a mirror layer under a transparent input.

**Checked in real Chromium, not just jsdom** (jsdom has no layout, so no test
could have caught this). Font, size, family, padding, border width and
line-height are identical between the mirror and the input, the boxes are
pixel-identical, and overlaying the input's own text in red on the mirror showed
the glyphs in exact register. That check found a real bug: on a long utterance
the input scrolls its text to follow the caret and the mirror did not, so at
404px of scroll the field showed the opening words in white with every grey
provisional word off the right-hand edge — i.e. it broke precisely when someone
speaks at length, which is the shot. The mirror now translates by the input's
scroll offset; re-verified in the browser.

### Step 4 — deixis

Deictic phrases are bound to records before the turn is sent, and drawn during
the countdown as a chip with the thumbnail inline.

Resolves today, against real page state:

| Phrase | Binds to |
| --- | --- |
| "this one", "that painting", "more like this" | the open artwork |
| "the left one", "the second one", "the last one", "the right picture" | board order |
| "these two", "both of these" | the selection — **see the caveat below** |

Precedence is selection → hover → open dialog: the more deliberate the gesture,
the more likely it is the subject.

**What it will not do:**

- `it` and `them` are not treated as pointing at anything. "Make it brighter" is
  not a gesture, and a resolver that guessed there would be wrong far more often
  than right.
- Anything it cannot bind is stated on screen — "Could not tell what 'these two'
  means — nothing is selected" — and passed to the model as unresolved. It never
  picks a plausible referent to avoid looking uncertain.

The human's sentence goes to the model verbatim with the bindings appended
underneath, ids included, so the next tool call can use them.

### Step 5 — the symmetric channel rule

- The note is always displayed. It is **spoken only if the human's last turn was
  spoken.** A turn counts as spoken if the mic put any words into it, including
  one the human then corrected by hand.
- One sentence, never more.
- Interrupted by a new utterance or by a click anywhere.
- It will not start while `speechSynthesis` is already busy, which is how it
  stays off a caption read-aloud from `speak-button.tsx`. That one is a button
  somebody pressed on purpose, so it outranks a note the agent volunteered.
  Deferring rather than cancelling into it also means the listener is never left
  guessing which of two voices they are hearing.
- Absent `speechSynthesis`, everything behaves identically minus the sound.

### Reduced motion

The only decorative animation added anywhere is the listening pulse, and it
carries `motion-reduce:animate-none`. The grace bar is a countdown readout
rather than decoration and keeps draining, because removing it would remove the
human's ability to see when the agent will act — the thing the brief calls the
feature. It is paired with a text line saying the same thing.

---

## Cannot be verified on this machine

Headless Chromium cannot do real speech recognition — Chrome ships the audio to
Google's service. **Everything below is exercised against a stubbed recogniser
and must be checked on a real machine before filming.**

1. **That a real recogniser produces usable interim results at all.** The whole
   two-contrast field assumes a steady stream of interim text. Never observed
   here.
2. **Flush timing on release.** On a real machine the flush often lands a few
   hundred milliseconds after you let go. Two failure modes were found by
   reasoning and fixed: a tap that heard nothing no longer puts a countdown on
   screen, and a sentence that lands within 700 ms of release starts its
   countdown then rather than sitting in the field waiting for an Enter nobody
   knows they owe. The 700 ms figure is a guess. **Watch this specifically.**
3. **Whether 1.2 s is the right grace.** Chosen because the brief specifies it,
   not because it was tried on anyone.
4. **Whether `continuous = true` behaves as expected across a long pause.** Some
   Chrome builds end the session on their own regardless. If that happens, the
   words captured so far are kept and the countdown starts on release — degraded,
   not broken — but it has not been seen happen.
5. **`onerror` codes in the wild.** The `not-allowed` / `no-speech` / `aborted`
   copy is driven by string literals no real recogniser has produced here.
6. **Speech synthesis actually speaking.** jsdom has no voices. The channel
   logic is fully tested; that Chrome says the sentence is not.
7. **Microphone permission flow.** Never triggered.

Also unverified, though for a different reason: **the deictic chip's thumbnail
has never loaded a real image.** The markup and layout were checked in Chromium
with a placeholder swatch.

---

## What was cut, and why

**Step 6, artist/title autocomplete — cut.** There is no catalogue-facet
endpoint to draw names from. The `facet` parameter in `tools.ts` is a *search
restriction* ("match within the artist field"), not a source of artist names, and
nothing on the page enumerates them. Building it would mean either a new API
route — another lane's files — or fuzzy-matching spoken word-runs against the
artists currently on the board, which needs a phonetic matcher. "Any in us in
here" against "Inness" is a hard match for anything simple, and a name-fixer
that is right most of the time is exactly the kind of feature that ruins a take.
The brief's own rule applies: a flaky feature costs more than a missing one.

The half of step 6 that matters most does ship: **click the word and retype it**
works, because typing takes ownership of spoken text rather than losing it. It
is tested, using "any in us in here" → "Inness" as the case.

**An autocomplete dropdown in the utterance bar — cut for a second reason.** It
would need Enter and Esc, and both are already spoken for by the grace bar. Two
meanings for Enter in one field is precisely the ambiguity this lane exists to
remove.

**The `webmcp/voice-activity-capture` capture harness — not cherry-picked.** Its
`--speak` flag reproduces the recogniser's *final-result* path, which is the one
path the unit tests already cover directly and cheaply. It would not have
exercised interim results, flush timing, or synthesis, which are the parts that
are actually uncertain.

---

## Things the next person should know

- **Space is now a global hold-to-talk key** while `AgentPrompt` is mounted, and
  its keydown is `preventDefault`ed so the page does not scroll. Guarded against
  firing inside inputs, textareas, selects and contenteditables, and against
  Meta/Ctrl/Alt chords. It does not collide with the brief's `P`/`X`/`U`/`C`.
  If the grid wants Space, this lane can move to another key — nothing depends
  on which one it is.
- **`get_view_context` has no `hovered` and no `selection`**, so plural deixis
  and hover-pointing report themselves unresolved. The scene reader already
  accepts every plausible spelling of both, so they light up with no edit here.
  Details in `docs/night/voice-loop-notes.md`.
- **`agent-prompt.tsx` has a local `callTool` that cannot reach a real WebMCP
  host**, duplicating `registry.ts`'s host-aware one. Pre-existing; left alone
  deliberately rather than swapping the agent loop's execution path while other
  lanes edit the tools it calls. Written up in the notes.
- The deixis resolver reads the **store** rather than calling
  `get_view_context`, because the tool's summary drops `thumbnailUrl` and is
  async. Same data.

## Against the brief's definition of done

> A voice utterance lands in the editable field; the note is spoken only after
> voice input.

The first half is true and tested. The second half is true and tested **at the
logic level** — `speechSynthesis.speak` is called with one sentence after a
spoken turn and not called after a typed one. That Chrome then makes a sound has
not been observed on this machine.
