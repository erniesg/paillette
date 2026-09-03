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

What is left is the no-host case. Two options, your call:

- subscribe to `bridgeAttached` from the store instead of checking once on
  mount, so the bar appears whenever a host turns up; or
- render the bar unconditionally — the loop that matters (Enter on an empty
  bar) never touches `document.modelContext` at all, so it works with no host.
  Only the agent path needs one.

## What I need from nobody, but you should know

- `speak-button.tsx` untouched.
- `agent-activity-panel.tsx` untouched.
- The board renders through the existing `agentResults` channel, so a redeal
  the *human* ran shows up on the canvas the same way an agent board does. I
  removed the `origin !== 'agent'` guard on it, which was a no-op before
  because nothing else ever wrote that field.
