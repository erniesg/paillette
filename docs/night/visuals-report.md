# Visuals lane — report

Branch `night/visuals`, cut from `origin/deploy-nga-open-access`. Section 7 of
the brief.

Screenshots of everything below are in `docs/night/shots/`. They are captured
headlessly from a real dev server by `scripts/capture-board-shots.mjs` and
`scripts/capture-search-shots.mjs`, so what is in the PNG is what the browser
painted.

---

## Checks

| | |
| --- | --- |
| `pnpm --filter web test` | **65 files / 658 tests, all passing** |
| `pnpm --filter web typecheck` | **fails — one error, pre-existing, not mine** |

The typecheck error is:

```
app/components/webmcp/agent-activity-panel.tsx(153,9):
  error TS6133: 'runningEntry' is declared but its value is never read.
```

It is present at `25ae39b`, the commit this lane started from, in a file that
is clean in git and that the brief forbids this lane from touching because a
human is editing it locally. It is a one-line deletion for whoever owns that
file. **It is the only error typecheck reports** — nothing this lane wrote or
changed contributes one.

Test counts, for the record: the brief's baseline is 59 files / 593 tests. HEAD
was already at 62 / 630 when this session started (an earlier session on this
same lane had added the board). This session took it to 65 / 658 — three new
files, 28 new tests.

---

## What shipped

### 1. The deal — the money shot

`app/components/board/deal-board.tsx`, `app/lib/board/deal-plan.ts`.

Twelve cards. On a redeal, picks do not move, rejects slide left into a narrow
tray that stays on screen, newcomers arrive from the right on a 15 ms stagger.
420 ms, `cubic-bezier(0.22, 1, 0.36, 1)`, no overshoot.

The continuity is a *layout* result rather than an animation one, which is the
part worth knowing. `planDeal` pins held ids to the slot index they already
occupied, so a held card renders in the same grid cell, Framer Motion measures
a delta of zero, and animates nothing. The picks do not "animate back to where
they were" — they are never anywhere else. Framer Motion was already a
dependency; nothing was added.

- `docs/night/shots/deal-animation.webm` — the loop. A still cannot carry
  this; "the picks stayed" is a claim about two frames.
- `05-deal-midflight.png` — caught 180 ms in, newcomers still arriving.
- `06-deal-settled.png`, `01-deal-fresh.png`.

**Reduced motion:** with `prefers-reduced-motion: reduce`, no animation, and
picks are collected at the front instead — see `06-deal-settled-reduced.png`,
where the picks occupy the leading slots. Every board shot has a `-reduced`
twin captured in a second browser context with the preference set; the
light-theme shots are captured once.

### 2. Provenance ink

`app/components/board/provenance.ts`, tokens in `app/tailwind.css`.

Graphite for the human, one cyan for the agent, dashed while the agent's mark
is unconfirmed. Applied to flags, tile frames, ledger captions, the compare
question, and a pulse on cards the agent is touching.

`03b-ink-detail.png` is the crop that shows the whole vocabulary at once: a
solid graphite frame and badge (human pick), a dashed cyan frame and badge with
a desaturated image (agent's unconfirmed reject), side by side. No legend.

Two decisions that carry weight:

- **Graphite is achromatic on purpose.** The human's mark is not "a colour", it
  is the absence of one, so the single coloured ink on screen always means the
  agent.
- **A reject desaturates the image, never the card.** Filtering the whole card
  drains the colour out of the agent's ink along with the painting, and an
  agent's reject becomes indistinguishable from a human's — the one distinction
  the palette exists to make.

The whole thing is CSS keyed on DOM attributes (`data-flag`, `data-hand`,
`data-provisional`, `data-agent-active`), not a component. See the hooks
section below.

### 3. The light table

`app/tailwind.css`, applied to `galleries.$galleryId.search.tsx`.

Charcoal `#1a1a1d`, not black — a black page makes the dark passages of a
painting dissolve and leaves every work floating in nothing. Cards are slides
with a pale mount, a well, and real shadow. Chrome is hairlines: the sort, view
and search-mode controls stopped being filled pills and became hairline rails
whose selected segment is marked by ink and one underline.

One serif (EB Garamond) for wall labels and the human's own words wherever they
appear; one mono (IBM Plex Mono) for catalogue data. The page previously had
fuchsia and cyan accents, which put three saturated colours on screen competing
with the paintings and cost the agent's ink its meaning.

- `11-search-masonry.png`, `12-search-salon.png`, `13-search-table.png`
- `14-search-light-theme.png` — light theme is not regressed; it is a paper
  light table with lit slides. Also `07-deal-light-theme.png`,
  `23-ledger-light-theme.png`, `24-two-up-light-theme.png`.

### 4. Two-up as a room

`app/components/board/two-up-compare.tsx`. `20-two-up.png`,
`24-two-up-light-theme.png`.

Two works at large scale on the wall ground, the question in the serif between
them like a wall label, and nothing else on screen at all — no toolbar, no
title bar, no visible close button. Hung on one centre line with labels on one
baseline, because two works centred individually read as two loose pictures
rather than a pair being compared.

The keyboard is the interface, since there is no chrome to click: left and
right answer, Escape leaves, and a real labelled close button sits clipped to
one pixel until a keyboard focuses it. The camera sees an empty wall; a
keyboard user gets a working control.

It reports a **gesture** — which side was clicked — and never touches flag
state. See the hooks section.

### 5. The ledger

`app/components/board/ledger-filmstrip.tsx`. `21-ledger.png`,
`22-ledger-detail.png`.

A thin strip along the bottom edge, one frame per turn, each a six-thumbnail
miniature of the board captioned in the ink of whoever took the turn. Clicking
a frame restores that board. Frames are data — a handful of ids and a string,
reusing thumbnails the board already loaded.

`22-ledger-detail.png` is the one to look at: six frames, the first three
sharing a board and the last three visibly diverging, captions alternating
graphite and cyan. Nothing had to *say* the board drifted.

Six thumbnails rather than twelve, because at 100px a full board is a texture.
The works that did not fit are counted in the caption and in the accessible
name.

**It is built but not wired into the real page.** That is deliberate — the
activity panel is off-limits, so wiring is left as a one-element change. See
the hooks section.

---

## Two bugs found and fixed on the way

Both were found by looking rather than by a failing test, which is worth
saying out loud.

**Hydration.** `usePrefersReducedMotion` read the media query in a `useState`
initialiser, so for anyone who actually has the preference set, the client's
first render said `true` while the server had rendered `false`. React logged a
mismatch and discarded the server markup — the one path built for people who
asked for less motion was also the one path throwing away its own HTML. Caught
by the capture script's console listener during the reduced-motion run. Now
`useSyncExternalStore` with an explicit server snapshot, and there is a test
that renders through `renderToString` to hold it.

**Contrast.** The token block documented four contrast ratios and three were
wrong, because they were measured against `--lt-ground` while almost all of the
text sits on `--lt-slide`, which is lighter and therefore worse.
`--ink-human-faint` was shipping at 4.05:1 while the comment directly above it
claimed 4.6:1 and said the line had to clear 4.5:1 — and `.lt-catalogue` uses
that token at 10px, so the smallest text on the board was the only text
failing. Raised `faint` to 0.58 and `soft` to 0.7; worst case is now 5.0:1 and
6.5:1. Verified numbers are in the comment, along with which surface they were
measured on.

A third, smaller one: the `lt-` classes were plain CSS after
`@tailwind utilities`, so every one of them silently beat every utility. That
put the search submit button under the field instead of inside it, with no
warning. Moving the block into `@layer components` fixes the class of bug
rather than the instance; verified against the built stylesheet.

---

## Hooks this lane depends on

**None of them exist yet on this branch.** I checked
`galleries.$galleryId.search.tsx` and `app/lib/webmcp/`: nothing sets
`data-flag`, nothing passes `preservedIds`. Everything above is styled against
the contract, so nothing here was blocked and nothing here blocks that lane.

The full contract, with the edges that will go wrong, is in
`docs/night/visuals-notes.md`. In short:

- **`data-flag` / `data-hand` / `data-provisional` / `data-agent-active`** on
  the element carrying `class="lt-slide"`. A `data-flag` with no `data-hand`
  falls back to graphite and will silently read as the human's mark.
- **`preservedIds`** on `DealBoard` — the human's picks specifically.
- **`tray={[]}` vs `tray={undefined}`** are different: an empty array reserves
  the gutter, `undefined` omits it. A culling board must pass an array from its
  first deal or the gutter appearing mid-session drags every held pick
  sideways.

---

## What I cut

- **Named-axis atlas, drag-to-reorder, real-scale salon** — as instructed. The
  existing atlas and table views were left on the same tokens but not
  redesigned.
- **Wiring the ledger into `/nga/search`** — the activity panel is off-limits
  and this lane should not be the one to decide it gets hidden. Built, tested,
  and left as a one-element change.
- **A visible dismiss control in two-up.** Escape, a click on the ground, and a
  focus-revealed button. A visible × would have been the only piece of chrome
  in a screen whose entire argument is that there is none.

---

## What still looks bad

Honestly, and in the order I would fix it.

1. **The search page's secondary chrome is not tokenised.** 120 occurrences of
   `white/…`, `text-white`, `fuchsia-`, `cyan-` and friends remain in that
   file. The surfaces you see first — ground, cards, rails, search field,
   result bar, agent note — are done. The settings drawer, the image-search
   panel, the colour-sort rail and most error states are not. They do not
   *break*: they still flip correctly in light theme via the
   `.themeable-surface` compatibility shim in `tailwind.css`. They are just
   still wearing the old palette, and the fuchsia in the settings drawer is a
   third colour on a page whose argument is that there are two.

2. **That light-theme shim is a pile of `!important` selectors** matching on
   Tailwind class names (`[class~='bg-white/[0.04]']`). It predates this lane
   and I did not remove it, because it is what keeps the untokenised chrome
   working. It should die when item 1 is done.

3. **The atlas view is untouched.** It inherited the ground and the fonts and
   nothing else.

4. **The two-up hover dims the opposite work** rather than lighting the hovered
   one, so the screen never gains brightness. I think this is right, but it is
   subtle enough that it may read as nothing happening.

5. **The site header is restated from CSS, not fixed at source.**
   `public-shell.tsx` hard-codes a near-black band and a solid-white signup
   button, both wrong on this ground. Rather than edit shared site chrome I
   overrode them from `tailwind.css` scoped to `.lt-ground`. It works and the
   header is unchanged elsewhere, but it is an override block that will rot if
   that component changes. Note this also *quiets the signup CTA* on the search
   page — a deliberate call, since a solid white button was the loudest thing
   on screen after the works, but it is a product decision made by a visuals
   lane and someone should confirm it.

### One thing not to misread in the screenshots

The search shots are captured against a stubbed search endpoint (the real one
needs a bearer token a dev server does not have), and the fixture does not set
a `source` field. So the table view's Source column reads "National Gallery
Singapore" for NGA works. **That is an artefact of my capture fixture, not a
data bug in the page.** The stub replaces the transport only; everything below
the fetch is the real page. What these shots do not prove is retrieval quality
— the ranking is the fixture's order, not the search engine's.

---

## Where to look, in one minute

1. `docs/night/shots/deal-animation.webm` — the thesis.
2. `docs/night/shots/03b-ink-detail.png` — two hands, no legend.
3. `docs/night/shots/24-two-up-light-theme.png` — the ten-second beat.
4. `docs/night/shots/22-ledger-detail.png` — the chat, replaced.

`/night/deal` on a dev server is the live harness for all four.
