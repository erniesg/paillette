# Visuals lane — report

Branch `night/visuals`, cut from `origin/deploy-nga-open-access`. Section 7 of
the brief.

**Read this section first if you are writing the submission.** The rest of the
document backs it up.

- Everything this lane built lives on a **demo harness at `/night/deal`**, not
  on the product page at `/nga/search`. The harness is real, runs in a browser
  and is driven by a checked-in script — but it is a harness, and it uses a
  fixed set of 40 works instead of the 63,253-work collection.
- The **search page restyle is on the real page** and is the one visual change a
  visitor to `/nga/search` would actually see.
- **Do not claim the deal animation, the compare room or the ledger appear in
  the product.** They are components with tested interfaces, proven in a
  harness, waiting on flag state from the shared-state lane.

---

## Checks, exactly as they ran

| | |
| --- | --- |
| `pnpm --filter web test` | **66 files / 677 tests, all passing** |
| `pnpm --filter web typecheck` | **fails — one error, pre-existing, not this lane's** |
| `node scripts/drive-deal-keyboard.mjs` | **21 assertions, passing, 3 consecutive runs** |
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

## Where this lane actually is against the brief's triage

Section 8 lists ten items. Four are this lane's.

| # | Item | State |
| --- | --- | --- |
| 5 | Provenance ink | **Done.** On the real page and the harness. |
| 6 | The deal animation | **Done in the harness.** Not on `/nga/search` — needs flag state. |
| 8 | Compare two-up | **Done in the harness.** Component is complete and separable. |
| 9 | Ledger filmstrip | **Built and tested. Not wired into any page.** |

Items 1–4 (flags state, gestures-as-turn, `search_by_exemplars`, `redeal`)
belong to the shared-state lane and **had not landed on this branch** when this
was written — nothing sets `data-flag`, nothing passes `preservedIds`. That is
why 6, 8 and 9 stop at the harness: the presentation is finished, the state it
presents is not this lane's to build.

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

1. **The deal, the ledger and two-up are not in the product.** This is the
   biggest gap and it is a dependency, not an oversight. They need flag state
   and `preservedIds` from the shared-state lane.
2. **120 occurrences of the old palette remain** in the search route — the
   settings drawer, the image-search panel, the colour rail, most error states.
   They do not break; they flip correctly in light theme through a
   compatibility shim. They are still wearing fuchsia, which is a third colour
   on a page arguing there are two.
3. **That shim is a pile of `!important` selectors** matching Tailwind class
   names. It predates this lane and is what keeps the untokenised chrome
   working. It should die when item 2 is done.
4. **The site header and the utterance bar are restated from CSS, not fixed at
   source.** Both belong to other lanes, so `tailwind.css` overrides them scoped
   to `.lt-ground`. This works and leaves those components unchanged elsewhere,
   but it is an override block that will rot if they change.
5. **Quieting the signup CTA was a product decision made by a visuals lane.** A
   solid white button was the loudest thing on screen after the works, so it is
   now hairline-outlined. Someone should confirm that.
6. **Keyboard movement between cards is Tab only.** There is no arrow-key
   navigation across the grid, so reaching card twelve takes twelve Tabs.
7. **The atlas view is untouched** beyond ground and fonts.

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

Full contract, including the edges that will go wrong, is in
`docs/night/visuals-notes.md`. In short:

- `data-flag` / `data-hand` / `data-provisional` / `data-agent-active` on the
  element carrying `class="lt-slide"`. **A `data-flag` with no `data-hand` falls
  back to graphite and silently reads as the human's mark.**
- `preservedIds` on `DealBoard` — the human's picks specifically.
- `tray={[]}` and `tray={undefined}` differ: an empty array reserves the gutter,
  `undefined` omits it. A culling board must pass an array from its first deal,
  or the gutter appearing mid-session drags every held pick sideways.

---

## Reproducing any of this

```sh
pnpm --filter web dev --port 5211

node scripts/drive-deal-keyboard.mjs http://localhost:5211   # 21 assertions
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
