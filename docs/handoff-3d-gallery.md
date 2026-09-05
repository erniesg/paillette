# Handoff — a walkable room as one way to show an exhibition

Self-contained. Paste this whole file to a fresh agent; it should need to ask
nothing before starting.

---

## 1. Where this sits

Paillette makes an art collection searchable by what its pictures *look like*
rather than by what a catalogue records. A person and an agent cull a collection
together — the human flags works with `P` / `X` / `U`, the agent re-deals around
those flags — and what settles becomes an **exhibition**: a title, a statement,
a wall label per work, and optionally named regions. That exhibition gets a short
URL and is shared.

- Repo `erniesg/paillette`, branch to cut from: **`night/integration`**
- Staging **https://paillette-stg.berlayar.ai** — deploy freely. Production never.
- Live example: **https://paillette-stg.berlayar.ai/e/MKwsxHy**
- 25 tools are registered on `document.modelContext`; the agent operates the same
  page the human does, through those tools. There is no agent-only path, and
  that symmetry is the project's central claim. Do not break it.

**Your job:** add a walkable 3D room as one of the ways an exhibition can be
shown, chosen by the person looking at it.

---

## 2. What already exists

### The exhibition object

`apps/web/app/lib/webmcp/exhibition.ts`:

```ts
ExhibitionState = {
  title:     ExhibitionField        // { current, proposed }
  statement: ExhibitionField
  labels:    Record<artworkId, ExhibitionField>
  order:     artworkId[]
  withdrawn: artworkId[]
  regions:   Region[]               // named groupings, ≤60 chars each
  updatedAt: number
}
```

`LABEL_MAX_CHARS` is 320, `REGION_LABEL_MAX_CHARS` is 60. The `current` /
`proposed` split is provenance: what the human wrote is theirs, and the agent may
only propose an alternative. **Whatever you build must respect that** — a room
that quietly renders the agent's proposal as though the human had accepted it is
a bug, not a rendering detail.

### The renderer and routes

- `apps/web/app/components/exhibition/exhibition-view` — the current renderer
- `apps/web/app/routes/exhibition.tsx` and the short link `/e/:code`
- Works are IIIF images: arbitrary aspect ratios, and the URL takes size
  parameters, which matters for §5.

### Dependencies

`framer-motion` 11 and `gsap` 3.15 are present. **There is no 3D library yet** —
that is your call, and it is a real one. React Three Fiber fits a Remix/React
codebase; plain Three.js is fewer abstractions and fewer surprises. Justify what
you pick in your report, and weigh bundle size: this page is shared as a link and
opened cold by people who did not ask for a 3D download.

### What the house style is

Charcoal ground, one serif for wall labels and curatorial text, one mono for
catalogue data, hairline chrome. **The works are the only saturated thing on
screen.** Terse: no helper text, no tooltip restating a control, nothing on
screen explaining what the interface is. If something needs a caption, the design
is wrong.

---

## 3. The idea worth building

Two things make this more than a gimmick. If you only have time for the first,
that is fine.

### 3.1 The room is built from the exhibition, not chosen from a menu

You asked for the construction to be dynamic, and the exhibition already carries
the structure to do it honestly:

- **`regions` are rooms.** The agent groups works and names the groups —
  *"The Working Harbor"*, *"The Empty Shore"*. That mapping is free and it means
  the architecture carries the argument rather than decorating it.
- **`order` is the route.** The sequence the curation settled on is the path a
  visitor walks. Do not shuffle it.
- **Count decides scale.** Six works is one small room; twelve wants four walls;
  thirty wants an enfilade of rooms or a long gallery. Derive it.

Compose a few good archetypes rather than generating noise. Three or four room
shapes that combine well will read as architecture; a procedural mesh will read
as a video game level. A useful constraint: works want roughly 1.5–2.5m of wall
each, and museums hang to a centre line about 145cm from the floor. Real
constraints produce rooms that feel right without anyone knowing why.

### 3.2 Real scale — the thing a flat page cannot do

The NGA records physical dimensions (`62.5 × 96.8 cm` and the like). **Hang works
at their true size.** On a web page every work is the same size as every other
work; in a room a print is small and a history painting is enormous, and that is
a fact about the art that a screen has been hiding.

This is the strongest argument for the feature existing.

**But be careful:** dimension strings do not always parse, and a half-parsed
dimension is worse than none. Parse strictly, fall back to a sensible default
size for anything you cannot read, and say in your report how many of the demo
set actually parsed. Never invent a size to make a wall look tidy.

---

## 4. Requirements

### Template choice — this is the frame for everything else

The room is **one way to see an exhibition, not the way**. The person viewing
chooses. Whatever selector you add must:

- survive the short link, so a shared URL opens in the view it was shared in
- default to a flat view, not the room — a 3D scene is a poor first impression on
  a weak device, and a shared link should never open into something that will not
  run
- degrade honestly: no WebGL, low-power device, or a browser that cannot cope →
  the flat view, with no dead control and no apology on screen

`set_view` exists as a tool but governs the *results grid* (masonry / salon /
atlas / table), which is a different surface. Decide whether the agent should be
able to choose the exhibition's presentation too — if you extend a tool, extend
that one rather than inventing a parallel concept, and keep its description
honest about what it now covers.

### Walking

- An avatar the visitor moves through the space.
- **Prefer teleport-and-look or click-to-move over smooth first-person
  locomotion.** Smooth locomotion in a first-person camera makes a meaningful
  number of people motion sick, and this is an art site, not a shooter. If you do
  offer smooth movement, offer it alongside and not as the only option.
- Touch has to work. A shared link is opened on phones.
- `prefers-reduced-motion` is not optional here and means more than slowing
  transitions: snap turns rather than swung ones, no camera bob, no forced
  movement.

### Focused view

Approach a work — or click it — and it fills the view with its wall label. That
beat is the point of the whole thing: the label was written *for this show*, and
in a room it arrives when you stand in front of the picture, which is when a
label is meant to arrive.

`describe_artwork` already produces a caption and there is an existing read-aloud
path. Wire the focused view to them rather than building a second one.

### Music

Optional, **off by default**, one control, and it stops when the tab is hidden.

Only CC0 or explicitly licensed audio, with the licence recorded in the repo. Do
not ship anything whose provenance you cannot state. If you cannot find something
good and clearly licensed, ship without it — silence in a gallery is correct, and
an unlicensed track is a real problem rather than a nice touch.

---

## 5. The hard part: texture memory

This is where a build like this usually dies. Thirty works at full IIIF
resolution is hundreds of megabytes of texture and it will crash a phone.

IIIF URLs take size parameters, so the fix is available: load a small texture for
every work, and swap to a larger one only for what is near or focused. Free the
large ones when the visitor walks away. Budget explicitly, measure it, and put
the number in your report.

Target 60fps on a laptop and something honest on a mid-range phone. If the phone
number is bad, say so rather than shipping a slideshow.

---

## 6. Ground rules

- **Verify before asserting.** Every number in this repo's docs was checked
  against code. If you cannot verify something, say so rather than softening it.
  Two tests in this project recently passed because they asserted the absence of
  a thing that never existed — when you add a check, make it fail on purpose
  first, and say that you did.
- `pnpm --filter web typecheck` and `pnpm --filter web test`; add
  `pnpm --filter api test` if you touch the API. Report exactly what passed. The
  baseline is around 91 files / 1115 web tests — do not regress it. Note that
  `typecheck` needs `pnpm --filter web build` first, or `worker.ts` fails on a
  missing server build; that error is environmental, not yours.
- Deploy staging: `pnpm --filter web deploy:staging`, and from `apps/api`,
  `npx wrangler deploy --env staging`. **Never production.**
- Take screenshots into `docs/night/shots/room/` so a human can judge it without
  running anything, and include the empty case, a six-work show and a thirty-work
  show.
- Commit in coherent pieces explaining *why*. **No Claude or Anthropic
  attribution anywhere** — no `Co-Authored-By`, no robot emoji, no "generated
  with" footer. Hard rule from the owner.
- Write `docs/night/room-report.md`: what shipped, which library and why, how
  many dimension strings parsed, the texture budget you measured, the frame rates
  you actually saw and on what, what degrades and how, and what you cut.

## 7. Triage

A flaky feature is worse than a missing one. In order:

1. A room that renders an exhibition of any size, walkable, with labels
2. The template selector, surviving the short link, defaulting to flat
3. Focused view wired to the existing label and read-aloud
4. Real scale from parsed dimensions
5. Texture LOD and a measured budget
6. Regions as separate rooms
7. Music

The owner pushes back hard and is usually right. When a line is called bad, the
fault is normally abstraction, or a claim that outruns the evidence.
