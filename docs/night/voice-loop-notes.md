# Voice lane — requests for other lanes

Written by the voice lane. Everything here is a request against a file another
lane owns, or an observation about one. Nothing in this document has been acted
on outside `agent-prompt.tsx` and `app/lib/voice/**`.

---

> **Update, later round.** The shared-state lane landed `hovered`, `selection`,
> flags, the board and `redeal`, and that branch is now merged into this one.
> Item 1 below is resolved for `hovered`; item 2 still stands. A new item 5
> records the one gap that blocks plural deixis.

## 1. `hovered` and `selection` on `get_view_context` — RESOLVED

Asked for in an earlier round; the shared-state lane landed both, plus flags and
the board. `get_view_context` now returns `hovered`, `selection`, `flags`,
`board` and `compare`.

One correction to how it was asked for: the store keeps `hovered` as a bare id
string and `selection` as `string[]`, not as records. The scene reader in
`app/lib/voice/deixis.ts` originally only understood objects and so silently
bound nothing. It now takes either, resolving ids through the session index, and
tests cover both shapes. Nothing further is needed from that lane.

What resolves today:

| Phrase | Resolves? | Against |
| --- | --- | --- |
| "this one" / "that painting" while pointing | yes | `hovered` |
| "this one" with a work open | yes | `openArtwork` |
| "the left one" / "the second one" / "the last one" | yes | board order |
| "these two" / "both of these" | **no** | needs a selection — see item 5 |

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

## 5. Nothing in the UI ever calls `setSelection` — RESOLVED

Fixed by the shared-state lane in `47ac14b`: shift-click on a card now calls
`toggleSelection`, in a capture handler so a plain click still opens the work.

**Plural deixis works as a result.** Verified in the browser: shift-click two
cards, type "something between these two", and the chip resolves to both with
their thumbnails, and the turn carries the selection with titles.

One consequence for this lane, fixed here: a selection persists until it is
cleared, so it is routinely older than the sentence being spoken. Singular
deixis no longer lets a multi-selection block a hover — "this one" while
pointing means the card, not the set picked out three turns ago.

## 6. The activity panel sits on top of the utterance bar

At 1280×900 on `/nga/search`, `agent-activity-panel.tsx` overlaps the prompt
bar and the deictic chips underneath it. Not touched — a human is editing that
file — but it is in shot for any recording at that size.

---

## 7. `autofocus` on the search field kills P/X/U/C on a fresh page — for the grid/search lane

**This would have wrecked a take.** Measured in Chromium on `/nga/search`:

```
focus on load          : INPUT ph="search by feeling, era, subject..."
picks after P (focused): []
focus after a click    : BODY
picks after P (blurred): ["nga-1"]
```

The search input in `galleries.$galleryId.search.tsx` carries `autofocus`.
`board-keyboard.ts` correctly ignores bare letters while a text field has focus
— it must, or typing "p" into the search box would flag a work instead of
typing. The two are individually right and jointly fatal: load the page, hover a
card, press `P`, and nothing happens.

One click anywhere neutral fixes it for the rest of the session, so it is a
precondition rather than a defect in the keys. But it is invisible, and the
first thing anyone filming will do is load the page and press P.

**The ask, for whoever owns the search route:** drop `autofocus` from that
input, or blur it when the pointer enters a card. Either makes the keys work
from a cold load.

Not touched here: it is another lane's file and the fix has UX consequences for
people who come to the page to type a query.

Worth knowing: this lane's verification script appeared to pass P and X before
this was understood, because a turn in flight disables the utterance bar and the
browser moves focus to `body` as a side effect. The script now clicks the board
first and asserts focus is not in a field, so the precondition is explicit
rather than accidental.

## 8. The compare two-up has no Escape

`compare-view.tsx` closes on choosing a work or on the "Neither — close"
button, but nothing handles `Escape`. It is a `role="dialog"` with
`aria-modal="true"`, where Escape is the expected dismissal, and while it is
open it covers the page and intercepts pointer events.

Not a blocker — the close button is there and visible — and forcing a decision
may well be deliberate. Noting it because it cost this lane a confusing
half-hour of a verification run timing out against an invisible modal.

---

## 9. A failed redeal is completely silent — for the shared-state lane

`installBoardKeyboard` takes `onTurn` and `onError`, and the comment on them
says "reports every redeal the keyboard triggers, for surfacing failures". But
`useBoardKeyboard` in `flag-controls.tsx:52` installs with no options at all:

```ts
export const useBoardKeyboard = () => {
  useEffect(() => installBoardKeyboard(), []);
};
```

Measured: pick a work, press Enter on an empty bar, have `/exemplars` return
500. The board does not change and **nothing appears anywhere on the page**. No
uncaught error either — it is caught and dropped. On camera that is
indistinguishable from a dead key, and it is section 9's headline beat.

This matters more than most failure paths because the redeal is the one thing
the brief says must be demonstrated, and it depends on a network call.

**The ask:** pass something through. Even

```ts
installBoardKeyboard({
  onTurn: (outcome) => { if (outcome.kind === 'redeal' && !outcome.result.ok) show(outcome.result.error); },
  onError: (e) => show(e),
});
```

would turn silence into an answer. Not touched here: it is your component, and
you have a `verify-failure-paths.mjs` of your own that could assert it.

What *does* hold up, checked in the same sweep: leaning on Enter five times
fires exactly one redeal, and Enter with nothing flagged at all calls neither
backend and raises nothing.

## 10. The activity panel covers the board and re-opens itself

Noted before as overlapping the utterance bar; it is worse than cosmetic. The
panel is absent on a cold load and appears the moment the agent does anything,
as a fixed overlay across the lower-left. While open it **intercepts clicks on
the cards underneath** — Playwright cannot shift-click a card behind it, and
neither can a person. Collapsing it works, but the next agent action brings it
back.

This lane's verification script now runs its selection checks before the first
agent turn to stay out of its way. For filming, either collapse it between
beats or keep the works being flagged out of the lower-left.
