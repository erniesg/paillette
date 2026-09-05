# The room — what shipped, what it cost, and what it cannot do

A walkable 3D gallery is now one of the ways an exhibition can be shown. It is
**off by default** and stays off until somebody asks for it. Everything below
was measured on this branch rather than estimated; where a number could not be
obtained honestly, it says so instead.

---

## 1. What shipped

**A room built from the exhibition.** The count decides the scale, `order` is
the route, and `regions` are rooms. Works hang the way a gallery is walked — in
on the south side, up the west wall, across the far wall, back down the east —
so the sequence the curation settled on is the sequence you meet, and the last
work is the one nearest the door you came in by. Rooms chain into an enfilade
with a doorway you can see and walk through. Museum numbers, not invented ones:
works get 1.5–2.5 m of wall each and hang to a centre line 145 cm off the floor,
raised only when a work would otherwise have its foot below it.

**The template selector, from the first commit rather than bolted on.** `?v=room`
on both `/e/:code` and `/exhibition?e=…`. Absent by default, so a link pasted
into a chat and opened cold lands on the page that has always worked. Two words
in the catalogue mono on the line the work count already occupies — the page had
no controls at all before this and now has the fewest it can have and still let
somebody choose.

**Walking is teleport-and-look.** Click the floor and you arrive; click a
picture and you stand in front of it; drag to look; arrow keys or WASD to step
and to turn. Turns always snap and there is no camera bob for anyone, not only
for people who asked for less motion. Touch works: tapping a work opens its wall
label. So does the keyboard alone.

**The focused view is the existing label and the existing read-aloud.** It
renders `page.works[].label` — the *published* value — in real DOM type, with
the same provenance ink the flat page uses, and `SpeakButton` rather than a
second read-aloud built for the room.

**Wall text on the entrance wall.** The title and statement are painted where a
gallery puts them: behind you, to be read once when you turn round, rather than
pinned to the corner of the screen for six rooms.

**A texture budget that gives memory back.** Every work holds a small texture
for the whole visit; six near or focused works hold a large one; walking away
disposes it. Two tiers and two pools, one stated ceiling.

**Nothing on screen explains any of it.** No crosshair, no compass, no key
telling anybody that arrow keys walk, no caption saying you can move.

---

## 2. Which library, and why

**Plain `three` 0.180, behind two `import()` boundaries.** Measured:

| chunk | raw | gzip | who downloads it |
| --- | --- | --- | --- |
| `exhibition-view` (the flat page) | 4.98 kB | **1.96 kB** | everyone |
| `room-view` | 7.58 kB | 3.49 kB | only on `?v=room` |
| `room-scene` | 14.03 kB | 6.04 kB | only on `?v=room` |
| `three.module` | 704.88 kB | **181.18 kB** | only on `?v=room` |

The flat page's own chunk went from 1.08 kB to 1.96 kB gzipped — the capability
check and two links — and fetches nothing else unless somebody clicks ROOM. That
is the whole justification for a 181 kB dependency existing in a repo whose
central artefact is a link somebody opens cold: **the default path never pays
for it.** Verified against the build graph: `three.module` is imported by
`room-scene` and by nothing else, and `room-scene` is only ever reached through
a dynamic import.

Plain three rather than React Three Fiber, for two reasons that are about this
scene specifically:

- The scene is **built once from a plan and then mutated by a visitor walking
  around it.** There is no tree of components whose props change, so a
  reconciler has no diff to earn its size on. R3F is ~30 kB gzipped on top of
  three, and drei — which is where the convenience actually lives — is far more.
- Every `dispose()` stays in plain sight. §5 of the handoff is *bounding a
  cache*, and the thing that makes that hard is a library-managed texture cache
  you have to fight to evict from. Here the eviction is thirty lines of
  arithmetic in `~/lib/room/texture-budget.ts` with seventeen tests on it.

The cost of the choice is real and worth naming: the scene is 1,153 lines —
842 of them code and the rest prose — of imperative setup, teardown and input
handling that R3F would have shortened, and the WebGL context lifecycle had to
be got right by hand, which it was not the first time (see §7).

---

## 3. How many dimension strings actually parsed

**Zero. Out of sixty sampled records, and it is not the parser's fault.**

The handoff says "the NGA records physical dimensions (`62.5 × 96.8 cm` and the
like)". That is true of the NGA's own open data. It is **not** true of what has
been ingested into this deployment. Sixty records were sampled from the public
browse endpoint and fetched individually from the staging API:

```
records sampled:            60
a dimensions field present: 60
parsed to a real size:       0
shapes seen: { "height": null, "width": null, "depth": null, "unit": null } × 60
```

Every record carries the structured `dimensions` object; every value in it is
null. The ingest scripts (`scripts/open-access-art-*.mjs`) never populate it —
`dimensions` appears in them only as an embedding vector width. No record
sampled carried a `dimensions_text` field in any position the page builder
looks. Two obvious upstream sources were tried and neither is a route back:
`https://api.nga.gov/art/objects/138648` returns 404, and fetching the object
page at `nga.gov` yields no metric measurement to a plain `curl` — the IIIF
image service on `api.nga.gov` works, but it serves pixels, not centimetres.

**So the strongest argument for this feature existing is the one thing it cannot
currently demonstrate on real data.** Every work in every screenshot below is
hung at the declared fallback size, and that is visible rather than hidden: the
fallback is *one* constant — 0.42 m², about 65 × 65 cm at the picture's true
aspect — so a wall of identically sized works reads correctly as a wall of works
nobody recorded the size of. Per-work guesses scaled from pixel dimensions would
have produced a tidier wall that quietly asserted facts the catalogue never had.

What did ship, and is tested:

- `parseDimensions` handles both shapes a catalogue writes, prefers `overall`
  over a framed measurement, converts cm/mm/m/in, and **refuses** far more than
  it reads. `24 5/8 x 38 1/8 in.` does not parse and must not: a regex loose
  enough to find `8 x 38` in it would hang a drawing at three metres and nothing
  downstream could tell that apart from a measurement.
- The whole path — catalogue field → parser → metres → planner — is exercised in
  `app/lib/room/__tests__/real-scale.test.ts`, which hangs a Whistler-sized
  etching (20.3 × 13.3 cm) beside a Salon machine (386 × 515 cm) and asserts the
  painting comes out 38× wider, gets more wall, is raised until it clears the
  floor, and pushes the ceiling above 3.86 m. The day a collection arrives with
  dimensions, the behaviour is already pinned.
- `dimensions` is now carried through `buildExhibitionPage` on every work, so
  nothing has to be re-plumbed when that day comes.

The one place the room deliberately does *not* preserve real scale is the
focused view, where a print and a history painting are framed at the same size
on screen — because what that beat is for is the label and the surface. The size
is what the room already said, on the way in.

---

## 4. The texture budget, measured

A texture on the GPU is not a JPEG: four bytes a pixel plus a third again for
the mip chain. **Thirty works at the 1400 px width the flat page serves is
224 MiB of video memory** — that arithmetic is a test, and it is the number the
whole module exists for.

| | |
| --- | --- |
| stated ceiling | **96 MiB** |
| base tier, every work, resident for the visit | 384 px on the long side |
| near tier, six works at a time | 1400 px on the long side |
| label plates, eight at a time, own pool | 384 × 192 |
| worst case, all caps at once | **79.7 MiB** — a test asserts it is under the ceiling |

Observed, walking a thirty-work show with the arrow keys and sampling every
level-of-detail tick:

```
peak texture bytes             70.4 MiB
high-resolution textures held  6
```

Per-shot, from `docs/night/shots/room/measurements.json`:

| show | texture | near | GL textures live |
| --- | --- | --- | --- |
| 1 work | 7.5 MiB | 1 | 4 |
| 6 works | 47.0 MiB | 6 | 12 |
| 30 works, first room | 59.4 MiB | 6 | 29 |
| 30 works, third room | 65.7 MiB | 6 | 38 |
| 6 works on a phone viewport | 47.0 MiB | 6 | 7 |

96 MiB is not a comfortable round number: a 2018-class phone with 3 GB of RAM
gives a tab a few hundred megabytes for everything, and WebGL contexts on iOS
are killed well before the system runs out. The count is what binds in practice
and the byte ceiling is the backstop for a show of unusually tall works.

Two things had to change to make the ceiling true rather than aspirational, and
both are in §7.

---

## 5. Frame rates — and why you should not trust these numbers

**This machine has no GPU a browser will use.** It is a VM with a virtio-pci
display device, and Chromium falls back to software rasterisation in every
configuration tried:

```
default (no flags)  ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader driver)
--enable-unsafe-swiftshader   … SwiftShader driver
--use-gl=egl --ignore-gpu-blocklist --enable-features=Vulkan   … SwiftShader driver
```

So every frame rate here is **SwiftShader, on four vCPUs, in headless
Chromium**, and it says nothing about a laptop or a phone. What was measured:

| | fps |
| --- | --- |
| 1 work | 31 |
| 6 works, 1440 × 900 | 24–31 |
| 30 works, 1440 × 900 | 23–29 |
| 6 works, 390 × 844 at DPR 3 | 20–24 |

**The handoff asked for 60 fps on a laptop and something honest on a mid-range
phone. I cannot give either number.** What can be said is that these are
*software-rendered* figures and the scene is about as cheap as a scene gets:
every material is `MeshBasicMaterial`, there are no lights, no shadow maps and
no post-processing, and a thirty-work show is **59 unlit quads** — twenty room
surfaces, thirty pictures, up to eight label plates and one panel of wall
text. The
work a GPU would be asked to do is trivial; the reason SwiftShader manages
20–30 fps at all is that there is almost nothing to rasterise. Anyone with real
hardware can reproduce these numbers with `scripts/room-checks.ts`, and that is
the honest position rather than quoting a figure I did not see.

**What degrades, and how:**

| condition | behaviour | verified |
| --- | --- | --- |
| no WebGL context | flat page, no canvas in the DOM, ROOM never offered | precondition printed: context creatable `false` |
| `navigator.deviceMemory` < 2 GB | ROOM never offered, no switch at all | precondition printed: `deviceMemory` reads `1` |
| JavaScript off | six works render, ROOM never offered | 6 `.exhibition-work` elements |
| sustained fps < 40 | pixel ratio drops to 1, once, and never climbs back | oscillating between two ratios looks worse than sitting at the lower one |
| `prefers-reduced-motion` | movement is instant, not slowed | same 3.10 m walk: no-preference eases over several frames, `reduce` arrives INSTANT |
| image server unreachable | walls, doorways, wall text and label plates; no pictures | `empty.png` |

All of these were also checked against the deployed staging build, not only
locally.

---

## 6. Screenshots

In `docs/night/shots/room/`. Every one was reached by the actions a visitor
performs — open a URL, click the word ROOM, drag to look, click or tap a
picture, press arrow keys. Nothing was posed by calling into the scene.

| file | what it is |
| --- | --- |
| `page-six.png` | the flat page, which is what a bare link opens |
| `six.png` | six works, from the door |
| `six-wall-text.png` | turned round: the title and statement on the entrance wall |
| `six-focused.png` | a work clicked, filling the view, with its wall label in real type |
| `one.png` | one work — the smallest room the planner will build |
| `thirty.png` | thirty works, first room, doorway open onto the second |
| `thirty-second-room.png` | the second room, walked to on the keyboard |
| `thirty-third-room.png` | the third |
| `regions-first.png` | "The Working Harbor" |
| `regions-second.png` | "The Empty Shore" — the same show, one wall later |
| `empty.png` | **the empty case**: the room with nothing hung in it |
| `phone-page.png`, `phone-six.png`, `phone-focused.png` | 390 × 844 at DPR 3 |
| `degraded-no-webgl.png` | `?v=room` on a browser that cannot make a context |
| `staging-e-code.png` | the real short link, on staging |

**The named-shot problem was taken seriously**, because the handoff says it has
gone wrong here twice. The script asserts what each filename claims before
writing it: the scene publishes which room the visitor is standing in and how
far past its threshold, and a shot named for a room throws unless the visitor is
in that room and at least 2.5 m inside it. It caught `thirty-second-room` being
a photograph of the *third* room on its first run, and then caught the corrected
version standing in a doorway. The region shots assert the room's **name**, not
just its index.

`empty.png` is the room with the image server blocked. That is not a contrived
state — it is exactly what a visitor sees when `api.nga.gov` is unreachable —
and it is the most useful reading of "the empty case" for a page whose loader
404s on a show with no works.

---

## 7. What was wrong, and how it was found

The scene compiled, typechecked and passed its tests on the first run and was
still substantially broken. Everything here was found by opening the page and
looking at it.

1. **The room drew into a dead canvas.** Teardown ends with
   `forceContextLoss()`, which is not optional — without it a visitor toggling
   between page and room hits the browser's cap on live contexts. But a lost
   context is lost for that *canvas element*, permanently, and React reuses the
   element across effect runs. One re-run and every later scene rendered
   nothing, silently, with one console line as the only clue. The effect now
   owns the element. Measured after: three mounts, three scenes, no leak.
2. **A `?v=room` link downloaded the whole flat hang first** — eighteen requests
   to the image server for pictures nobody would see, because the capability
   check answered "no" before it had run. It answers `unknown` now.
3. **The label plates were evicting every picture**, on a loop, because eight
   plates and six pictures shared six slots. Blurry pictures with crisp labels
   beside them.
4. **Portrait works cost double.** 1600 px *wide* returned a 384 × 514 record at
   1600 × 2144: 18.3 MB against a landscape's 10. Bounded by the longer side
   now — and the tier came down to 1400 px, because at 1600 the worst case
   genuinely did not fit inside 96 MiB and a ceiling that only holds for
   landscapes is not a ceiling.
5. **Clicking a picture turned you away from it.** The yaw facing a wall is
   `atan2(n.x, n.z)`, not its negation. In a screenshot this looked almost like
   a nice shot of the wall text.
6. **Clicking the floor did nothing for 95% of the screen.** The destination had
   to be walkable or the click was refused, and from the door of a five-metre
   room almost every floor pixel projects past the far wall's standoff. It
   marches now and stops where the building does.
7. **The doorway had a solid box in it** — an enfilade rendered as a far wall
   with a black rectangle in the middle.
8. **Fog at 8–46 m never engaged**, so a door three metres away and a wall nine
   metres beyond it drew at identical values and the second room read as a flat
   wall with six works on it.
9. **62° vertical on an upright phone is a 31° horizontal keyhole**, and a 3.8 m
   ceiling over a 65 cm etching is an atrium.
10. **A dead control shipped to staging.** With WebGL disabled, `?v=room`
    rendered the flat page with the word ROOM above it — a link that could do
    nothing, on the one path the whole degradation story is about. The switch
    was offering whichever template the URL had asked for. Now ROOM is offered
    when a room can be drawn and at no other time.

### Checks that were not checking

The handoff warns that two tests here recently passed by asserting the absence
of something that never existed. Three more of mine did the same, and all three
are recorded because they are the interesting failures:

- **`addInitScript(fn)` serialises `fn.toString()`**, and in a TypeScript file
  that is esbuild's output, which can reference helpers the page does not have.
  The script threw on injection, silently, so the "no WebGL" and "1 GB device"
  checks were measuring an ordinary browser while reporting passes. Both are
  source strings now, and both **print the precondition they depend on** —
  context creatable `false`, `deviceMemory` reads `1` — so a setup that fails to
  apply can never read as a pass again.
- **The reduced-motion probe clicked a floor point outside the walkable set**,
  so nothing moved in either condition and both "passed".
- **The first "never evicts the base tier" test admitted thirty textures under a
  ceiling that fitted them all**, so it needed no eviction and survived an
  eviction loop deliberately rewritten to consider the base tier. It squeezes
  now.

**Every invariant in this lane was broken on purpose and confirmed to fail**
before being trusted. Ten mutations, all caught: the default template flipped to
`room`; the doorway corridor removed (the sealed-boxes bug); the north wall
ignoring its doorway; an east-wall picture facing out of the room; the slot
margin negated so works may touch; the base tier made evictable; eviction made a
no-op; the dimension parser's unit requirement dropped; the switch offering the
current template again; the switch offering the room before the check answers.
Two genuine bugs were found this way rather than by reading: the structured
dimension path silently assuming centimetres for a `null` unit, contradicting
its own comment, and the eviction test above.

---

## 8. What I cut, and what is left undone

**Music: cut.** Off by default with one control is easy; sourcing a track whose
licence I can state in the repo is not, and the handoff is explicit that an
unlicensed track is a real problem rather than a nice touch. I did not find
something good enough with provenance I could verify, so there is none. Silence
in a gallery is correct.

**`set_view` was not extended, deliberately.** The handoff asks whether the
agent should choose the exhibition's presentation too. The room lives on the
*public exhibition page*, which the agent is not on: it operates the working
board, and it cannot navigate the browser of a stranger who opened a shared
link. Making `set_view` claim to cover the exhibition template would be a tool
description that outruns what the tool can do, which is worse than the tool not
covering it. The template is a property of the URL the visitor holds, and the
visitor is the one who chooses. The agent's existing `annotate_atlas` regions do
reach the room, which is the real connection between the two.

**Regions do not survive `/e/:code`.** They travel in the self-contained link
(`/exhibition?e=…`) as positions rather than ids — measured at **70 characters**
of URL for two named regions over a twelve-work show, against 180 characters for
the ids alone — and the room reads them. The stored exhibition has no column
for regions, and adding one is an API and D1 migration this lane did not take
on. A short link renders the same show as one enfilade chunked by count, which
is the correct thing to do with a show that never said how it was grouped.

**Not attempted:** VR/WebXR; frames or mounts on the works; footsteps or any
audio; a minimap; multiple visitors; saved positions; a light model of any kind.

**Known rough edges:**

- The room takes its palette from the app theme, so light mode is a white cube.
  That is defensible — it is the other room a museum builds — but it has had far
  less attention than the charcoal one.
- The global `ThemeToggle` from `root.tsx` floats over the canvas bottom-right.
  It is pre-existing chrome on the exhibition page and out of scope here, but it
  is more visible over a full-bleed room than over a scrolling page.
- The pixel-ratio step-down is one-way by design. On a device that is briefly
  busy at load it will drop to DPR 1 and stay there for the visit.
- `atWidth` only rewrites IIIF URLs. A collection whose images are not IIIF gets
  its full-size image in both tiers, and the budget accounting will be honest
  about the cost but cannot reduce it.

---

## 9. Verification

```
pnpm --filter web build       ✓
pnpm --filter web typecheck   ✓  (clean; run after build, as the handoff notes)
pnpm --filter web test        ✓  104 files / 1311 tests
pnpm --filter web lint        ✓  one pre-existing error in components/board/deal-board.tsx
                                 (a rule this repo does not configure); none in new code
```

Baseline at the start of this lane was 97 files / 1204 tests. This lane adds
seven test files and 107 tests and regresses nothing.

Deployed to **staging only** (`paillette-stg.berlayar.ai`), twice, and verified
against the deployed build rather than only locally. Production untouched. The
API was not modified, so `apps/api` was not deployed.

Reproduce the numbers:

```
pnpm --filter web exec tsx scripts/room-demo-links.ts    # mint the demo shows
ROOM_LINKS="$(…)" pnpm --filter web exec tsx scripts/room-checks.ts
ROOM_LINKS="$(…)" pnpm --filter web exec tsx scripts/room-shots.ts
```

Live: <https://paillette-stg.berlayar.ai/e/MKwsxHy> opens the page;
<https://paillette-stg.berlayar.ai/e/MKwsxHy?v=room> opens the room.
