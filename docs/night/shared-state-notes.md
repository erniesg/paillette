# shared-state → voice lane: two small changes in `agent-prompt.tsx`

I did not touch `agent-prompt.tsx`. Everything below already works without it;
these changes make it *better*, and neither is required for the demo.

## What already works with no change to your file

**Enter on an empty prompt bar redeals.** `installBoardKeyboard()` (mounted from
the results grid) listens on `document` in the capture phase, matches
`input[aria-label="Ask the agent"]` with an empty value, calls
`preventDefault()`, and runs the deterministic redeal. Your form's submit
handler never fires — and even if the capture listener were removed, your
`if (!instruction || busy) return;` already makes an empty submit a no-op, so
the two cannot both run. Nothing to do.

Tested in `apps/web/app/lib/webmcp/__tests__/board-keyboard.test.ts`.

## Change 1 — carry the gestures on every turn (now optional)

**Update: this is already working, from the outside.**
`apps/web/app/lib/webmcp/turn-bridge.ts` wraps `window.fetch` and attaches the
`turn` payload to `POST /api/public-agent/turn` on the first request of each
turn. It is installed from the WebMCP mount and it is deliberately written to
disappear: **if the body already carries `turn`, it passes straight through.**

So doing the change below costs you nothing and lets me delete a monkey-patch.
If you do it, tell me and I will remove the shim — or just delete
`turn-bridge.ts` and its test yourself, since the guard makes the two safe to
run side by side in the meantime.

In your `run(instruction)`, on the **first** request of a turn only:

```ts
import { prepareTurn, toTurnPayload } from '~/lib/webmcp/turn';

// once, before the loop starts — prepareTurn drains the journal, so calling it
// per iteration would report the same gestures repeatedly
const turn = toTurnPayload(prepareTurn(instruction));
```

then in the fetch body:

```ts
body: JSON.stringify({ messages: historyRef.current, tools, turn }),
```

Send `turn` on the first request only; subsequent tool-result turns should omit
it. The field is optional server-side, so sending nothing is safe.

What the model then receives, appended after the conversation:

> Since the last turn the human picked *Lumber Schooners at Evening*, and
> rejected *Two Women*. These are gestures, not words. If they contradict what
> was typed, follow the gestures and say plainly that you are doing so.

Shape and behaviour are pinned in
`apps/api/tests/routes/agent-turn.test.ts`.

## Change 2 — a cleaner hook for the bar (optional, 30 seconds)

I match the bar by its accessible name, which is stable but is not *yours*. Add
`data-utterance-bar` to the input and the selector prefers it:

```tsx
<input data-utterance-bar aria-label="Ask the agent" … />
```

If you rename the aria-label without adding this, Enter-on-empty stops
redealing and there is no error — the test
`recognises the bar by its accessible name` is what would catch it.

## If you take over the keyboard entirely

Delete `useBoardKeyboard()` from `ResultsView` in
`apps/web/app/routes/galleries.$galleryId.search.tsx` and call
`submitHumanTurn(text)` from your submit handler instead. It returns
`{kind: 'redeal' | 'agent' | 'noop'}` — hand `kind: 'agent'` to your existing
loop and it will do the right thing for both cases. Do not have both paths
live at once.

## One thing in your file that I could not fix from mine

`AgentPrompt` returns `null` unless `getModelContext()` is truthy when it
mounts. In a plain browser with no WebMCP host and no `?webmcp-debug`, there is
no prompt bar at all — and therefore no Enter-on-empty-bar, which is the
headline of the submission.

I fixed the half of this that was mine: the debug harness used to install its
stub host from an effect, and effects run child-first, so your mount check ran
before the stub existed and `?webmcp-debug` showed a page with 21 registered
tools and no bar. It now claims `document.modelContext` as its module loads,
and the bar renders. Verified in Chromium.

**Update — the loop no longer depends on you fixing this.** Enter now falls
back to the board when there is no bar to press it in, guarded so it never
takes Enter from a focused button, link or summary, and only when there is a
pick to deal from. Verified in a plain browser with no host and no debug flag:
`apps/web/scripts/verify-plain-browser.mjs`, 13 checks.

The agent path still needs a host, so the bar question is still worth
answering, and it is still yours. Two options:

- subscribe to `bridgeAttached` from the store instead of checking once on
  mount, so the bar appears whenever a host turns up; or
- render the bar unconditionally — the deterministic loop never touches
  `document.modelContext`, so only the agent path needs one.

## Two more things, one each

**Voice lane — the agent's reply is now usually empty, on purpose.** The note
above the board is the sentence; repeating it as the reply put the same words
twice on one screen, which is the owner's standing complaint. The system prompt
now says: add a sentence the note does not say, or say nothing. Eight of nine
live runs produced an empty reply; the ninth restated the note.

That matters to you because the symmetric-speech rule needs something to speak.
**Speak the note, not the reply** — it is on the shared store at
`agentResults.note` and in `get_view_context` as `board.note`, and it is
guaranteed to be one sentence. If you speak `message.content` you will often
speak nothing at all.

**Whoever owns `agent-activity-panel.tsx` — it is showing a chat.** With the
note now rendered as a wall label above the board, the panel repeats it
underneath a mini-board and a list of tool calls, so the same sentence is on
screen twice. Brief triage item 9: *"Ledger filmstrip; if it will not land,
hide the activity panel entirely rather than show a chat."* I have not touched
the file. A screenshot of the duplication is at `/tmp/sofa-run-1.png` if it is
still there; re-create it with `apps/web/scripts/verify-sofa-run.mjs`.

## Before anyone films this

The anonymous agent route allows **40 model calls per client per hour**, and one
typed instruction costs two or three — the loop reads the view, acts, then
answers. So it is about fifteen instructions an hour, and a rehearsal session
will run it out. Two of my own verification runs died that way before I traced
it. The page does say why, in the prompt bar, so it is not silent; it is just
fatal to a take.

Enter on an empty bar is not affected — it never reaches that route. I have a
check that proves the whole culling loop still works while the agent is
hard-refusing (`apps/web/scripts/verify-agentless-loop.mjs`), which is worth
knowing if the shoot goes long.

## What I need from nobody, but you should know

- `speak-button.tsx` untouched.
- `agent-activity-panel.tsx` untouched.
- The board renders through the existing `agentResults` channel, so a redeal
  the *human* ran shows up on the canvas the same way an agent board does. I
  removed the `origin !== 'agent'` guard on it, which was a no-op before
  because nothing else ever wrote that field.
- The "assembled by the agent" caption above the board is gone. It was a word
  doing an ink's job, and it was simply wrong once a human redeal could put a
  board there. `data-provenance="human"|"agent"` is on the wall label
  (`.paillette-wall-label`) for whoever inks it.
- The flag badge is now quiet until its card is hovered, focused or flagged —
  thirty-six letters stamped over a twelve-card board read as a toolbar.
  `data-quiet` is on `.paillette-flag-badge` if you want to take it further.
- A failed deal marks the page: `[data-deal-error="REDEAL_FAILED"]`, one
  sentence, and `dealing` is on the store while a deal is in flight if you want
  to show motion instead.
