# Voice lane — requests for other lanes

Written by the voice lane. Everything here is a request against a file another
lane owns, or an observation about one. Nothing in this document has been acted
on outside `agent-prompt.tsx` and `app/lib/voice/**`.

---

> **Update, later round.** The shared-state lane landed `hovered`, `selection`,
> flags, the board and `redeal`, and that branch is now merged into this one.
> Item 1 below is resolved for `hovered`; item 2 still stands. A new item 5
> records the one gap that blocks plural deixis.

## 1. `get_view_context` has no `hovered` and no `selection` — RESOLVED

Deixis resolution ("this one", "these two", "the left one") needs to know what
the human is pointing at. Today `get_view_context`
(`apps/web/app/lib/webmcp/tools.ts:869`) reports:

- `openArtwork` — from `state.focused`, the artwork dialog someone opened
- `humanResults.visible` / `agentResults.visible` — the board, in order
- `humanSearch`, `indexedCollection`, `page`

It does **not** report `hovered` or `selection`, and `WebMcpState`
(`apps/web/app/lib/webmcp/store.ts`) carries neither.

So what resolves today, and what does not:

| Phrase | Resolves? | Against what |
| --- | --- | --- |
| "this one" / "that painting" | yes | the open artwork (`focused`) |
| "the left one" / "the second one" / "the last one" | yes | board order |
| "these two" / "both of these" / "those three" | **no** | needs `selection` |
| "this one" while merely hovering a card | **no** | needs `hovered` |

The unresolved cases are reported to the human ("Could not tell what 'these
two' means — nothing is selected") rather than guessed at, so nothing is
silently wrong; they are just less useful than they should be.

**The ask:** add `hovered` (a single work) and `selection` (an ordered array) to
the store, and surface them on `get_view_context`.

**No coordination needed on naming.** `readScene` in
`apps/web/app/lib/voice/deixis.ts` already reads, defensively:

- `hovered`, `hoveredArtwork`
- `selection`, `selected`, `selectedArtworks`
- `openArtwork`, `focused`, `focusedArtwork`
- `agentResults.items` / `.visible`, `humanResults.items` / `.visible`,
  `visible`, `board`

and unwraps a `{ artwork: {...} }` envelope at any of them. It needs `id` on
each record and will use `title`, `artist` and `thumbnailUrl`/`imageUrl` when
present. Whichever of those spellings you pick, deixis lights up with no edit on
this side. Tests already cover both the store shape and the
`get_view_context` shape (`app/lib/voice/__tests__/deixis.test.ts`).

## 2. `sampleResults` drops `thumbnailUrl` — for the shared-state lane

`sampleResults` (`tools.ts:860`) projects each work down to
`{ id, title, artist, year, similarity }`. `AgentArtworkSummary` has
`thumbnailUrl` and it is dropped.

Consequence: an agent reading `get_view_context` cannot show the human a picture
of what it thinks they meant. The deictic chips in the prompt bar therefore read
the store directly rather than calling the tool — same data, but with the
thumbnail, and synchronous, so the chip is up the instant the human lets go of
the mic.

**The ask, if it is cheap:** add `thumbnailUrl` to `sampleResults`. It is one
line and it makes the view context self-sufficient. Not a blocker — the voice
lane works without it.

## 3. Space is now a global hold-to-talk key — for whoever owns grid shortcuts

`AgentPrompt` binds `keydown`/`keyup` on `window` for `code === 'Space'` while
it is mounted, and calls `preventDefault()` on the keydown (otherwise the page
scrolls every time somebody speaks).

It is guarded: it does not fire when the event target is an `input`,
`textarea`, `select` or anything `contenteditable`, and it ignores Meta/Ctrl/Alt
chords. The brief's grid keys — `P` / `X` / `U` / `C` — do not collide.

If the grid wants Space for something (a preview toggle, say), say so and this
lane will move to a different hold key. Nothing else about push-to-talk depends
on which key it is.

## 4. `agent-prompt.tsx` has its own `callTool`, which cannot reach a real host

Observation, not a request — and it predates this lane's work.

`registry.ts:341` exports a `callTool` that tries `document.modelContext
.executeTool(tool, JSON.stringify(args))` first and falls back to the page's own
registered implementation. That is the path that works against a real WebMCP
host, per `docs/HANDOFF.md` §4: `getTools()` returns descriptors and none of
them carry `execute`.

`agent-prompt.tsx:121` defines a *second*, local `callTool` that only knows two
paths: the `?webmcp-debug` harness, and `tools.find(...).execute(...)`. Against
a real host the second path finds a descriptor with no `execute` and throws
`No tool "x" on this page.`

In practice this does not bite: the in-page agent is for visitors who did **not**
bring a host, and where one exists it drives the page itself. It was left alone
deliberately — swapping the agent loop's tool execution mid-run, while other
lanes are editing the tools it calls, is not a trade worth making tonight. But
the two functions should become one, and `registry.callTool` is the right
survivor.

---

## 5. Nothing in the UI ever calls `setSelection` — for whoever owns the grid

`setSelection` exists in `store.ts`, `get_view_context` reports `selection`, and
`board-keyboard.ts` reads it to decide what `C` compares. But a grep across
`apps/web/app` finds **no caller anywhere in the application** — shift-click
multi-select was never wired up.

Consequences beyond this lane:

- Plural deixis — "these two", "both of these", "those three" — can never
  resolve. It is written and unit-tested and lights up the moment something
  selects; today it correctly reports itself unresolved.
- `resolveComparePair` falls back to hovered-plus-first-pick for `C`, so
  two-up never gets its unambiguous "compare exactly these two" path.

One `onClick` with `event.shiftKey` on the card would close both.

## 6. The activity panel sits on top of the utterance bar

At 1280×900 on `/nga/search`, `agent-activity-panel.tsx` overlaps the prompt
bar and the deictic chips underneath it. Not touched — a human is editing that
file — but it is in shot for any recording at that size.
