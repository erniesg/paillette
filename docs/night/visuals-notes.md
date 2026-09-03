# Visuals lane — notes for the other lanes

What this lane needs from other people's files, and what it deliberately did
not touch. Written because the shared-state lane and this one were editing in
parallel and the seam between them is an attribute contract rather than a
shared component.

---

## 0. Read this first — your lane landed and we speak different words

`lanes/shared-state` and `lanes/shared-state-new` are both on the remote now,
and they write a **different vocabulary** for the same four facts than the one
section 1 below describes. Nothing was broken by that, but nothing worked
either: your tiles carry `data-flag-by`, my CSS matched `data-hand`, so the
provenance ink rendered on nothing at all on the real page.

**That is fixed from this side.** `tailwind.css` now understands both, in any
combination, so it does not matter which way the merge lands or which of your
two branches wins. You do not need to rename anything.

| your name | my name | what it is |
| --- | --- | --- |
| `.paillette-card` | `.lt-slide` | the tile |
| `data-flag="pick\|reject\|none"` | `data-flag="pick\|reject"`, absent when unset | what was decided |
| `data-flag-by="human\|agent\|none"` | `data-hand="human\|agent"` | who decided it |
| `data-flag-provisional="true\|false"` | `data-provisional`, present when true | not yet confirmed |
| `data-provenance` on the wall label | `data-hand` | who wrote the note |

Also now styled against your class names: `.paillette-flag-badge`,
`.paillette-flag-button`, `.paillette-wall-label`, `.paillette-deal-error`,
`.paillette-compare`, `.paillette-compare-work`. They were arriving on the
light table wearing the old white/near-black palette.

`node scripts/verify-ink-contract.mjs` proves it — 23 assertions that load the
real stylesheet in a real browser, inject your exact markup, and read back
computed styles. **Run it after the merge.** It is the only check that can
catch this class of break; jsdom does not run the cascade and neither lane
imports the other.

### Three things worth knowing

- **We built the same thing twice.** Your `useBoardKeyboard` and my
  `useCullingKeys`; your `CompareView` and my `TwoUpCompare`; your `FlagBadge`
  and my `lt-mark`. Yours are wired to real state, so **keep yours** — mine
  were built when nothing set a flag. Mine are worth reading only for the
  typing guard (mine suppresses on `role=textbox|combobox|searchbox` and
  `contenteditable` as well as the obvious tags) and for the two-up focus trap.
- **Your compare puts the question above the works; the brief asks for it
  between them.** That is a one-line JSX move in your file — the `<p>` into the
  middle of the works row — and I have not touched your file to do it. Styled
  as-is, it still reads as a wall label.
- **A `data-flag` with no `data-flag-by`** falls back to graphite and will
  silently read as the human's mark. If the agent flagged it, say so.

---

## 1. The attribute contract — the original form

Still supported, and still what `DealBoard` and `LightTableCard` emit. If you
are writing a new tile, either vocabulary works.

The whole of provenance ink is CSS keyed on DOM attributes. Set them on the
tile and the frame, the badge, the desaturation and the pulse follow. There is
no component to import and no file of mine you have to edit.

Set these on the element that already carries `class="lt-slide"` — in the
search route that is the `<article>` in `ResultCard`, around line 5335:

| Attribute | Values | Means |
| --- | --- | --- |
| `data-flag` | `pick` \| `reject` \| absent | what was decided |
| `data-hand` | `human` \| `agent` | who decided it — this picks the ink |
| `data-provisional` | present \| absent | the agent's mark, not yet confirmed |
| `data-agent-active` | present \| absent | the agent is touching this card now |

Notes on the edges, because they are the parts that go wrong:

- `data-hand` is what selects the ink. **A `data-flag` with no `data-hand`
  falls back to graphite**, i.e. it will silently read as the human's mark. If
  the agent flagged it, you must say so.
- `data-provisional` only draws differently when `data-hand="agent"`. A human's
  own mark is never provisional — they made it, so there is nobody left to
  confirm it. `provenanceAttributes()` in
  `app/components/board/provenance.ts` already enforces that if you want to
  generate the attributes rather than write them by hand.
- Present-but-empty is the convention (`data-provisional=""`), not
  `="true"`. In React, `data-provisional={cond ? '' : undefined}`.
- Rejects desaturate **the image**, never the card, because filtering the whole
  card drains the colour out of the agent's ink along with the painting and an
  agent's reject becomes indistinguishable from a human's. That only works if
  the `<img>` is inside an element with `class="lt-slide-well"`. It already is
  in the search route.

Accessibility is not carried by the attributes. `markLabel()` in
`provenance.ts` returns the sentence a screen reader needs; put it in an
`sr-only` span next to the badge, as `LightTableCard` does.

### `preservedIds`

`DealBoard` (`app/components/board/deal-board.tsx`) takes
`preservedIds?: readonly string[]` and pins those ids to the slot index they
already occupied, so a held card measures a layout delta of zero and does not
animate. Pass the human's picks. It is the human's picks specifically — a
redeal is not allowed to overrule a decision the human already made.

If you pass the agent's provisional picks in there too, provisional marks will
pin the board, which is probably wrong: they have not been confirmed.

### The culling keys — reuse this rather than rewriting it

`app/components/board/use-culling-keys.ts` binds Lightroom's `P`/`X`/`U`/`C` to
whichever card the human is pointing at. It is presentational in the sense that
it owns no state — you give it a target id and a callback.

```ts
useCullingKeys({
  targetId,                    // card under the cursor, or holding focus
  onFlag: (id, flag) => {},    // flag is 'pick' | 'reject' | null (U clears)
  onCompare: () => {},         // C; omit it and C does nothing
  enabled: !compareIsOpen,     // off while a modal owns the keyboard
});
```

Two things it already handles that are easy to miss and expensive to get wrong:

- **It stays out of the way while the human is typing.** The utterance bar and
  the board share one keyboard. Without the guard, typing "explore" into the bar
  picks and rejects things behind it. Inputs, textareas, selects,
  `contenteditable` and `role=textbox|combobox|searchbox` all suppress it.
- **It leaves Cmd/Ctrl/Alt alone**, because Cmd-P is print and Ctrl-U is view
  source.

The target has to be able to hold focus, or the keyboard path silently dies.
`LightTableCard` now carries `tabIndex={0}` and an accessible name for exactly
this reason — if you build your own tile, do the same.

### The tray

`DealBoard` takes `tray?: readonly T[]`. **Passing `[]` and passing `undefined`
mean different things and the difference is load-bearing.** An array — even
empty — reserves the gutter. `undefined` omits it entirely.

A board in the culling loop must pass an array from its very first deal. The
moment the gutter appears mid-session it shifts the whole grid sideways and
every "held" pick moves with it, which is the exact promise the deal exists to
keep. Measured in a browser: 27–108px of sideways drift.

---

## 2. The ledger — for whoever wires up the page

`app/components/board/ledger-filmstrip.tsx` is finished, tested and **not wired
into the real page**. Wiring it in is one element:

```tsx
<LedgerFilmstrip
  frames={frames}          // LedgerFrame[]
  activeId={activeFrameId} // which board is currently on the table
  onRestore={restoreTurn}  // put that board back
/>
```

`LedgerFrame` is `{ id, hand, caption?, works, pickIds? }` and `works` is
anything with `{ id, thumbnailUrl?, imageUrl? }`. It carries only what the
strip draws — deliberately. Whatever you need in order to *restore* a board
(ids, flags, notes) should live in a record you keep beside the frames, not as
a field added to `LedgerFrame`. `app/routes/night.deal.tsx` does exactly this
and is the worked example.

Two behaviours worth knowing before you wire it:

- **Flagging is not a turn.** Flags trigger nothing — the redeal is the beat —
  so recording a frame per `P` press fills the strip with identical boards. The
  harness records on redeal, agent proposal, confirmation and compare answer.
- **The caption is one line and it clips.** It is a wall label for a turn. A
  caption that wraps to three lines is a message, and a strip of messages is a
  chat, which is the thing this replaces.

**If the ledger lands, hide `agent-activity-panel.tsx` rather than showing
both.** The brief is explicit that a chat transcript is worse than nothing, and
two records of the same session side by side is worse than either.

I did not touch `agent-activity-panel.tsx` — a human is editing it locally.

---

## 3. Two-up — for the lane building `compare_artworks`

`app/components/board/two-up-compare.tsx` is the presentation only. It does not
know what `compare_artworks` is, does not decide who won, and never touches
flag state.

```tsx
<TwoUpCompare
  works={pair}             // readonly [Work, Work] | null — null closes it
  question={question}      // one sentence, set in the asking hand's ink
  hand="agent"             // who asked; defaults to agent
  onChoose={(winner, loser, index) => {/* your call */}}
  onDismiss={() => {/* closed without answering */}}
/>
```

`onChoose` reports **a gesture**, not a decision. Turning "the human clicked
the left one" into a pick and a reject is yours; the winner/loser naming is a
convenience, not a policy. That is what keeps the two lanes separable.

It renders `position: fixed` over everything, so render it last and outside any
`overflow: hidden` container.

One thing learned the hard way and worth passing on: **do not put the reason
the pair is similar into the question unless you can substantiate it.** The
demo harness pairs on the fixture's `motif` field, but `motif` is the
*spotlight a work was drawn from*, not a description of it — two works out of
"The Feast of the Gods" are both Madonnas. A label reading "Both are The Feast
of the Gods" is false about the pictures under it, and a viewer who catches one
false label stops believing the rest of them.

---

## 4. Files this lane touched outside its own components

- `app/tailwind.css` — all tokens and light-table CSS. Owned by this lane.
- `app/routes/galleries.$galleryId.search.tsx` — restyle only. No logic, no
  state, no data flow changed. If you are editing this file for flags, the
  conflict surface is class names on `ResultCard` and `SalonResults`.
- `app/routes/night.deal.tsx` — the demo harness. Owned by this lane.
- `scripts/capture-board-shots.mjs`, `capture-search-shots.mjs`,
  `capture-deal-video.mjs`.

**Not touched:** `app/lib/webmcp/**`, `agent-prompt.tsx`, `speak-button.tsx`,
`agent-activity-panel.tsx`.

`app/components/site/public-shell.tsx` hard-codes a near-black header band and
a solid-white signup button. Both are wrong on the light table, and both are
restated from `tailwind.css` scoped to `.lt-ground` rather than by editing that
file — the header is unchanged on every other page. If site chrome ever gets
proper tokens, delete that block.
