# Visuals lane — report

Branch `night/visuals`, cut from `origin/deploy-nga-open-access`. Section 7 of
the brief.

**Read this section first if you are writing the submission.** The rest of the
document backs it up.

- The **search page restyle is on the real page** and is what a visitor to
  `/nga/search` sees: charcoal light-table ground, hairline chrome, one serif
  and one mono, works as the only saturated thing on screen.
- **The provenance ink now lands on the shared-state lane's tiles.** That lane
  landed mid-run writing a different attribute vocabulary than this one styles
  against, so the ink was rendering on nothing. It is bridged and verified —
  23 browser assertions against their exact markup, in both themes. This is the
  claim "two hands on one board" depends on, and it is now true on the real
  page **once the branches are merged**.
- **This lane's own deal board, compare room and ledger live in a demo harness
  at `/night/deal`**, not in the product. The harness is real and driven by a
  checked-in script, but it uses a fixed 40-work fixture, not the 63,253-work
  collection.
- **Do not claim this lane's deal animation or ledger appear in the product.**
  The compare room that ships is the shared-state lane's component wearing this
  lane's styling, not this lane's `TwoUpCompare`.
- Nothing here has been merged. Every claim above is "after a human integrates
  two branches that both edit `galleries.$galleryId.search.tsx`".

---

## Checks, exactly as they ran

| | |
| --- | --- |
| `pnpm --filter web test` | **66 files / 677 tests, all passing** |
| `pnpm --filter web typecheck` | **fails — one error, pre-existing, not this lane's** |
| `node scripts/drive-deal-keyboard.mjs` | **21 assertions, passing, 3 consecutive runs** |
| `node scripts/verify-ink-contract.mjs` | **23 assertions, passing** |
| `pnpm --filter api test` | **not run — this lane touched no API code** |

The typecheck error, in full:

```
app/components/webmcp/agent-activity-panel.tsx(153,9):
  error TS6133: 'runningEntry' is declared but its value is never read.
```

It exists at `25ae39b`, the commit this lane started from. The file is clean in
git and the brief forbids this lane touching it because a human is editing it
locally. It is a one-line deletion for whoever owns it. It is the only error
typecheck reports.

Test baseline from the brief is 59 files / 593 tests. This lane's branch is at
66 / 677.

---

## The thing that changed this round: the ink was not connected

The shared-state lane landed on `lanes/shared-state` and
`lanes/shared-state-new`. Both write flag state onto the result tiles, and both
use a **different attribute vocabulary** than this lane had been styling
against — `.paillette-card` not `.lt-slide`, `data-flag-by` not `data-hand`,
`data-flag-provisional="true"` not `data-provisional`.

Their source says the provenance hooks are *"drawn entirely in CSS, with no
JavaScript here needing to know which colour the agent got"*. They were right
that it is this lane's job. It just did not exist yet, so:

**Nothing on the real search page carried an attribute this lane's CSS matched.
The provenance ink rendered on nothing at all.** "Two hands visible in every
state" — the claim the entire palette exists to make, and one of the five items
in section 9's definition of done — would have been false on the only page a
visitor sees, while every unit test stayed green.

It is bridged from this side, additively, in `tailwind.css`. Both vocabularies
work in any combination, so the merge can land either way. No file belonging to
another lane was edited.

Also styled, because they arrived on the light table in the old white palette:
their flag badge and its three one-letter buttons, their wall label, their
deal-error line, and their compare overlay — which is the one wired to compare
state, so it is the one that ships. It came as a translucent near-black scrim
with each work in a bordered box; it is now the opaque ground with the boxes
off and the question in the serif.

`docs/night/shots/30-flag-lane-markup.png` shows all six flag states on their
tile markup plus the wall label, so an integrator can judge the merged result
without resolving a conflict first.

Two mistakes made writing this, both invisible to tests and caught only by
reading computed styles in a browser:

- The bridge was silently **purged**. Tailwind content-scans `@layer components`
  and drops classes it cannot find in this branch's source — and every class
  here is defined in the *other* branch. It survived only where a selector
  shared a rule with an `lt-` class. It now lives outside the layer.
- The human default has to be declared **before** the agent rule. Both are one
  class of specificity, so on a tile carrying `paillette-card` *and*
  `data-flag-by="agent"` the later rule wins. Backwards, it painted every agent
  mark in graphite — exactly the failure the palette exists to prevent.

---

## Where this lane actually is against the brief's triage

Section 8 lists ten items. Four are this lane's.

| # | Item | State |
| --- | --- | --- |
| 5 | Provenance ink | **Done, and now actually connected** to the flag lane's tiles. Verified in a browser, both themes. |
| 6 | The deal animation | **Done in the harness.** Not on `/nga/search`. |
| 8 | Compare two-up | **Ships as the flag lane's component in this lane's styling.** This lane's own `TwoUpCompare` stays in the harness. |
| 9 | Ledger filmstrip | **Built and tested. Not wired into any page.** |

Items 1–4 (flags state, gestures-as-turn, `search_by_exemplars`, `redeal`)
belong to the shared-state lane and have now landed on their branches, though
not on this one — the two branches both edit
`galleries.$galleryId.search.tsx` and a human integrates.

Item 6 still stops at the harness. Putting the twelve-card deal on the product
grid means replacing the masonry layout's rendering with `DealBoard` and
feeding it `preservedIds`, and that is a change to the board's *logic*, which
this lane was told to style rather than edit. It is the one piece of section 7
that did not reach the product.

---

## What is demonstrably true

Each of these is checked by `scripts/drive-deal-keyboard.mjs`, which drives a
real browser against a running dev server and exits non-zero on any failure. It
was run three times in a row with identical results.

1. A card can hold focus, and is reachable by pressing Tab alone.
2. `P` picks the focused card, `X` rejects it, `U` clears it.
3. Nothing fires when no card is targeted, or while the human is typing into a
   field, or under Cmd/Ctrl.
4. `C` opens the compare room; an arrow key answers it and closes it.
5. **Picks keep their exact slot index through a redeal** — asserted by
   comparing slot number and title before and after, not by eye.
6. Both inks are on screen at once after the agent proposes and the human
   answers, read from computed styles rather than from class names.
7. Over three consecutive redeals the board still deals twelve, never deals the
   same work twice, and picks survive.

And by `scripts/verify-ink-contract.mjs`, which loads the real compiled
stylesheet in a real browser, injects the exact markup the shared-state lane
emits, and reads back computed styles — 23 assertions, all passing:

8. A human pick is framed in graphite; an agent pick is framed in the agent
   ink; **the two are actually different values**, not just different classes.
9. An agent's unconfirmed mark is dashed, in the agent's ink, and its flag
   button is outlined rather than filled.
10. An unflagged tile wears no ink at all — their `none` and `false` sentinels
    are inert rather than accidentally matching.
11. A reject desaturates the picture and not the card, so an agent's reject
    stays distinguishable from a human's.
12. The wall label takes the ink of whoever wrote it, so a board the *human*
    redealt is not annotated in the agent's colour.
13. Their compare overlay is the opaque light-table ground rather than a scrim,
    with the boxes off the works and the question in the wall serif.
14. All of the above holds in the light theme, where every token flips.
15. This lane's original `data-hand` / `data-provisional` vocabulary is
    unregressed, and a tile carrying both class names and their attributes
    still reads correctly — which is what a merge will actually produce.

Separately verified by script:

- **The words that narrated the mechanism are gone.** A script loads the page,
  walks the loop and greps the rendered text for eight banned strings across
  five states. All clean. With no flags set there is now **no wall label at
  all** rather than a sentence explaining that there is nothing to say.
- The utterance bar renders with a transparent background, no border, no corner
  radius, EB Garamond, graphite text and a graphite focus rule — read from
  `getComputedStyle`, not assumed.

Reduced motion is captured as a second full set of screenshots taken in a
browser context with `prefers-reduced-motion: reduce`, so "it degrades cleanly"
is a picture and not a promise. With the preference set there is no animation
and picks are collected at the front of the board instead.

---

## What shipped

### On the real page (`/nga/search`)

The light-table restyle. Charcoal `#1a1a1d` rather than black, so the dark
passages of a painting have an edge to sit against. Cards are slides with a
mount, a well and real shadow. Sort, view and search-mode controls became
hairline rails whose selected segment is marked by ink and a single underline
instead of a filled pill. One serif for wall labels and for the human's own
words wherever they appear; one mono for catalogue data. The page previously
carried fuchsia and cyan accents, which put three saturated colours on screen
competing with the paintings.

The utterance bar is now one graphite rule under the words, in the same serif
as the search field above it.

Light theme is not regressed — it is a paper light table with lit slides.

### Components, complete and tested, proven in the harness

**The deal** (`deal-board.tsx`, `deal-plan.ts`). Twelve cards. On a redeal picks
do not move, rejects slide left into a tray that stays on screen, newcomers
arrive from the right on a 15 ms stagger. 420 ms, ease-out, no overshoot. The
continuity is a layout result rather than an animation one: held ids are pinned
to the slot they already occupied, so the delta is zero and nothing animates.
The picks are never anywhere else. Framer Motion was already a dependency.

**Provenance ink** (`provenance.ts`, tokens in `tailwind.css`). Graphite for the
human, one cyan for the agent, dashed while the agent's mark is unconfirmed.
Graphite is achromatic on purpose, so the single coloured thing on screen always
means the agent. A reject desaturates the *image*, never the card — filtering
the card would drain the colour out of the agent's ink too, and an agent's
reject would stop being distinguishable from a human's.

**Two-up** (`two-up-compare.tsx`). Two works at scale on the wall ground, hung
on one centre line with labels on one baseline, the question in the serif
between them, and nothing else on screen — no toolbar, no title bar, no visible
close button. The keyboard is the interface; the close control is clipped to one
pixel until focused.

**The ledger** (`ledger-filmstrip.tsx`). One frame per turn along the bottom
edge, each a six-thumbnail miniature captioned in the ink of whoever took the
turn. Clicking restores that board. Frames are data — ids and a string — not
screenshots.

**The culling keys** (`use-culling-keys.ts`). Lightroom's `P`/`X`/`U`/`C`, acting
on the card under the cursor or holding focus.

---

## Bugs found by running it, not by testing it

Worth recording because all four were invisible to a green test suite.

1. **The keyboard path was dead.** `LightTableCard` rendered a *disabled* button
   whenever it had nothing to open, which took every card out of the tab order.
   Any board that was not also click-to-open could not be culled by keyboard at
   all. There was even a test asserting this: its name said "is not a button
   when there is nothing to open" and its body required a disabled button, which
   is still a button and is not focusable. The name was right.
2. **Hydration.** `usePrefersReducedMotion` read the media query in a `useState`
   initialiser, so for anyone who actually has the preference set the client's
   first render disagreed with the server and React discarded the markup — the
   one path built for people who asked for less motion was the one path throwing
   away its own HTML. Caught by a console listener in the capture script.
3. **Contrast.** The token block documented four ratios and three were wrong,
   measured against the ground while the text sits on the lighter slide.
   `--ink-human-faint` was shipping at 4.05:1 under a comment claiming 4.6:1 and
   requiring 4.5:1. Raised; worst case is now 5.0:1.
4. **Tailwind precedence.** The `lt-` classes sat after `@tailwind utilities` and
   silently beat every utility, which put the search submit button under the
   field instead of inside it. Moving them into `@layer components` fixed the
   class of bug rather than the instance.

`aria-modal="true"` on the compare room was also a false claim until this round:
without a focus trap, Tab walked out into the grid behind it, which is still
focusable and now invisible.

---

## What I cut, and why

- **Named-axis atlas, drag-to-reorder, real-scale salon** — instructed. The
  atlas and table views inherited the ground and the fonts and were not
  redesigned.
- **Wiring the ledger into `/nga/search`.** The activity panel it would replace
  is off-limits, and this lane should not unilaterally decide it gets hidden.
  Built, tested, left as a one-element change. The brief's instruction stands:
  if the ledger lands, hide the activity panel rather than showing both.
- **A visible dismiss control in two-up.** Escape, a click on the ground, and a
  focus-revealed button. A visible × would be the only chrome on a screen whose
  entire argument is that there is none.
- **Naming what a compared pair has in common.** The harness pairs on the
  fixture's `motif` field, but that is the *spotlight a work was drawn from*,
  not a description of it — two works out of "The Feast of the Gods" are both
  Madonnas. A label reading "Both are The Feast of the Gods" is false about the
  pictures under it, so the agent asks the plain optometrist's question instead.

---

## What is still wrong

1. **The twelve-card deal is not in the product.** The animation — the piece
   the brief calls the money shot — exists only at `/night/deal`. Putting it on
   the product grid means replacing the masonry rendering with `DealBoard`,
   which is a change to the board's logic rather than its styling, and this
   lane was scoped to style. It is the one item of section 7 that did not
   reach the real page.
2. **The ledger is not wired into any page**, by choice — see "What I cut".
3. **We built three things twice.** The shared-state lane has its own culling
   keys, compare overlay and flag badge; this lane has `useCullingKeys`,
   `TwoUpCompare` and `lt-mark`. Theirs are wired to real state and should win.
   Mine are worth reading only for the typing guard (which also suppresses on
   `role=textbox|combobox|searchbox` and `contenteditable`) and the two-up
   focus trap. An integrator should delete one set, not merge both.
4. **Nothing is merged.** Both lanes edited `galleries.$galleryId.search.tsx`.
   Every claim about the real page is conditional on that merge going well, and
   `scripts/verify-ink-contract.mjs` is the check that says whether it did.
5. **120 occurrences of the old palette remain** in the search route — the
   settings drawer, the image-search panel, the colour rail, most error states.
   They do not break; they flip correctly in light theme through a
   compatibility shim. They are still wearing fuchsia, which is a third colour
   on a page arguing there are two.
6. **That shim is a pile of `!important` selectors** matching Tailwind class
   names. It predates this lane and is what keeps the untokenised chrome
   working. It should die when item 2 is done.
7. **The site header, the utterance bar and the flag lane's controls are
   restated from CSS, not fixed at source.** Both belong to other lanes, so `tailwind.css` overrides them scoped
   to `.lt-ground`. This works and leaves those components unchanged elsewhere,
   but it is an override block that will rot if they change.
8. **Quieting the signup CTA was a product decision made by a visuals lane.** A
   solid white button was the loudest thing on screen after the works, so it is
   now hairline-outlined. Someone should confirm that.
9. **Keyboard movement between cards is Tab only.** There is no arrow-key
   navigation across the grid, so reaching card twelve takes twelve Tabs.
10. **The atlas view is untouched** beyond ground and fonts.
11. **Their compare puts the question above the works**, where the brief asks
    for it between them. That is a one-line JSX move in their file, which this
    lane did not make.

### Do not misread the screenshots

- The search shots are captured against a **stubbed search endpoint** — the real
  one needs a bearer token a dev server does not have. The stub replaces the
  transport only; everything below the fetch is the real page. The fixture sets
  no `source` field, so the table view's Source column reads "National Gallery
  Singapore" for NGA works. **That is a capture artefact, not a data bug.**
- Those shots prove nothing about **retrieval quality**. The ranking is the
  fixture's order, not the search engine's.
- The utterance bar appears in those shots only because the capture **stubs the
  presence of `document.modelContext`** so the bar renders. It does not make the
  agent work, and the shot is not evidence that it does.
- The harness's redeal scores works by shared `motif`, a stand-in for Rocchio
  over CLIP. It demonstrates the *interaction*, not the retrieval.

---

## Hooks needed from the shared-state lane

**They have landed, and the ink now speaks their vocabulary as well as this
lane's.** Nothing further is needed from them for the ink to work. Full detail
in `docs/night/visuals-notes.md`.

What still needs a human at merge time:

- **Run `node scripts/verify-ink-contract.mjs` after merging.** It is the only
  check that catches the two vocabularies drifting apart again, because jsdom
  does not run the cascade and neither lane imports the other.
- **A `data-flag` with no `data-flag-by`** falls back to graphite and silently
  reads as the human's mark.
- **Pick one of each duplicated component** rather than shipping both.
- If `DealBoard` is ever put on the product grid: `preservedIds` takes the
  human's picks specifically, and `tray={[]}` differs from `tray={undefined}` —
  an empty array reserves the gutter, `undefined` omits it. A culling board must
  pass an array from its first deal, or the gutter appearing mid-session drags
  every held pick sideways.

---

## Reproducing any of this

```sh
pnpm --filter web dev --port 5211

node scripts/drive-deal-keyboard.mjs http://localhost:5211   # 21 assertions
node scripts/verify-ink-contract.mjs  http://localhost:5211  # 23 assertions
node scripts/capture-board-shots.mjs  http://localhost:5211  # board, both motion prefs
node scripts/capture-search-shots.mjs http://localhost:5211  # the real page
node scripts/capture-deal-video.mjs   http://localhost:5211  # the deal, moving
```

`/night/deal` is the live harness for the deal, two-up, the ledger and the keys.

## Where to look, in one minute

1. `docs/night/shots/deal-animation.webm` — the thesis; a still cannot carry it.
2. `docs/night/shots/03b-ink-detail.png` — two hands, no legend.
3. `docs/night/shots/24-two-up-light-theme.png` — the ten-second beat.
4. `docs/night/shots/22-ledger-detail.png` — the chat, replaced.
5. `docs/night/shots/30-flag-lane-markup.png` — the ink on the flag lane's
   tiles, which is the one that reaches the product.
