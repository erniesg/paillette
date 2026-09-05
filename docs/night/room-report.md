# The room — what shipped, what it cost, and what it cannot do

A walkable 3D gallery is now one of the ways an exhibition can be shown. It is
**off by default** and stays off until somebody asks for it. Everything below
was measured on this branch rather than estimated; where a number could not be
obtained honestly, it says so instead.

**For the submission lane.** Sections 1, 6 and 10 are the ones to write from.
§1 is what is demonstrably true, §10 is what is *not* — read it before claiming
anything. The single claim to avoid is "works are hung at their real size":
the code does it, no record in this deployment has a size to hang at, and §3 is
the honest number. The safe headline is that **the person opening a shared link
chooses how to see the show, and one of the choices is walking through it**.

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

**Named groupings become separate rooms, over both kinds of link.** A show that
says "these six are the working harbour and these six are the empty shore" is
walked as two rooms with a doorway between them. This works over `/e/:code` —
the link people actually share — and it needed no database migration; the
regions ride inside the hang's own JSON column, and a show with no groupings is
stored byte-for-byte as it always was.

**What the agent names, the visitor walks.** `annotate_atlas` is the tool an
agent uses to say "these six are the working harbour"; those groups become the
rooms. Run end to end and checked in as `scripts/room-agent-path.ts`: the agent
deals twelve works, writes the show, writes a label per work, names two groups;
the human presses Copy link; the short code that comes back opens as two named
rooms you can walk between. See §10 for exactly how much of that is
demonstrated and how much is not.

**Text first.** Nothing in the room needs a voice. Verified in a browser with
every speech API deleted before the page loads: the room draws, a work is
clickable, the label reads, and the read-aloud is simply *absent* rather than
present and dead.

**Nothing on screen explains any of it.** No crosshair, no compass, no key
telling anybody that arrow keys walk, no caption saying you can move, and no
control captioned with a sentence. The read-aloud is a ▶ on the accession line
in the catalogue ink — a wall label carries an audio-guide symbol, not a
paragraph about listening. There is a test that the focused panel renders no
string the room invented for itself.

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

| show | texture | at full resolution |
| --- | --- | --- |
| 1 work | 7.5 MiB | 1 |
| 6 works | 47.0 MiB | 6 |
| 12 works in two named rooms | 51.8 MiB | 6 |
| 30 works, first room | 59.4 MiB | 6 |
| 30 works, third room | 65.7 MiB | 6 |
| 6 works on a phone viewport | 47.0 MiB | 6 |
| the full demo path, end to end | 31.0 MiB | 4 |

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
| context lost mid-visit | falls back to the flat page; ROOM disappears with it | lost on purpose in a browser: flat page shown, six works, ROOM not offered |
| image server unreachable | walls, doorways, wall text and label plates; no pictures | `empty.png` |
| one work's image fails | a blank plate at the fallback size, the same mark the flat page draws | the flat page and the room agree about what the show contains |
| no speech synthesis | the read-aloud is absent; everything else is unchanged | every speech API deleted before load: room draws, label reads, zero controls, no errors |
| a slow connection, visitor leaves | textures still in flight are disposed on arrival | six page/room round trips mid-load: still draws, 51.8 MiB, no leak |
| a slow image server | the room is a room before it is a hang | canvas up in 1.5 s; **walkable 3.40 m before a single picture arrives**; pictures then arrive |
| a code that does not exist, or is not a code | 404, and no canvas is ever created | the room never turns a missing show into a blank scene |
| a corrupt self-contained payload | 404 | |
| a show with no labels at all | the focused panel shows the catalogue line and no empty rule | found by publishing one from the agent path by accident |
| a phone held upright | the whole visit completes by touch alone | 26 of 26, and see the caveat below |

All of these were also checked against the deployed staging build, not only
locally.

### The phone, honestly

The full twenty-six-step visit completes on a 390 × 844 viewport with touch as
the only input, including with reduced motion and with every speech API
removed. But a phone held upright has a **horizontal field of about 42°**,
against a desktop's 87°, and that is physics rather than a setting: the room's
vertical field is already widened to the 80° limit to compensate, and widening
further starts bending the room.

What that means in practice: **on a phone you see roughly one work at a time
and you have to look around.** Deep in a wide room you can be facing the gap
between two works. That is also true in a real gallery standing close to a
wall, but it is worth saying before somebody films a phone and is surprised.

One change came out of it. Walking used to stop 0.95 m from a wall — arm's
length — and on a phone that put the visitor nose-first into bare plaster with
a picture just off each edge of the screen. It stops at 1.4 m now, which makes
the two verbs mean different things: **walking gets you around the room,
clicking a work gets you up to it.** A test holds that walking can never
already put you closer than the focused view would.

It is not a guarantee that a work is always in frame. A first attempt at that
test was written and then deleted: a 42° field in a nine-metre room cannot
promise it, and the standoff that would force it leaves the smallest rooms with
no interior at all. Tuning constants until a test passes, when the test encodes
a property the design does not have, is backwards.

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
| `shortcode-regions-first.png` | the same, from a **published short code** rather than a self-contained link |
| `shortcode-regions-second.png` | and its second named room |
| `empty.png` | **the empty case**: the room with nothing hung in it |
| `phone-page.png`, `phone-six.png`, `phone-focused.png` | 390 × 844 at DPR 3 |
| `degraded-no-webgl.png` | `?v=room` on a browser that cannot make a context |
| `degraded-context-lost.png` | the context taken away mid-visit, falling back to the page |
| `agent-board.png` | the board after the agent has dealt, labelled and named two groups — the state that becomes the two rooms |
| `one-work-room.png` | the smallest room the planner will build |
| `three-named-rooms.png` | a three-room enfilade from three named regions |
| `unlabelled-focus.png` | the focused panel on a show with no labels: catalogue line, accession, the read-aloud mark, and no empty rule |
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

### Found in a later round, by running the whole visit rather than each beat

The three above are from the first pass. These came from running the *sequence*
end to end, which is a different kind of bug: each beat worked alone and they
did not compose.

11. **Closing a wall label teleported the visitor back across the room.**
    Focusing was modelled as an excursion — go and look, then return to where
    you were. In a gallery you walk over to a picture and you are then *there*.
    It also produced a stranger symptom, which is how it was caught: the room
    the scene reported standing in changed while a work was focused and changed
    back a second later.
12. **A key pressed during a glide did nothing.** `step` and `turn` wrote the
    camera directly while the frame loop was still interpolating an earlier
    move, which overwrote them a frame later. For about half a second after
    clicking the floor, or after closing a label, the room ignored the
    keyboard — indistinguishable from a dropped keypress.
13. **The demo script raced the thing it was checking**, asserting a walk had
    happened while an unfinished glide was still carrying the visitor. Worth
    recording alongside the product bugs: a check that races its subject is the
    same failure as a check that asserts nothing.
14. **Publishing sent `regions: []` on every show.** Caught by a test that
    already existed. Not harmless — a payload change on the common path — and
    the gap that let it through was that nothing asserted what a *grouped*
    board publishes.

### Found by running it as somebody other than a desktop

15. **Walking parked a phone visitor nose-first into bare plaster.** Tapping
    the floor walks as far along that line as the building allows, and the
    building allowed arm's length. Fine at a desktop's 87° horizontal field;
    at a phone's 42° it is 0.78 m of wall, less than the gap between two hung
    works, so the visitor arrived at the far wall with a picture just off each
    edge of the screen. It looks like an empty room. Walking stops 1.4 m short
    now.
16. **The title swallowed taps.** Both masthead children took pointer events,
    and the `h1` is set 22 rem wide — on a 390 px screen a patch of what looks
    like room was an unclickable heading. A title is not a control.
17. **Two of the three phone "failures" were the script**, and that is worth
    recording because the first pass blamed the product. It tapped a pixel to
    give the canvas the keyboard, and on a phone that pixel is the title; and
    it used arrow keys at all, which a phone does not have. A phone visitor
    walks by tapping the floor and does it in two taps.
18. **The demo path could only prove the show it was written against.** Its
    assertions named one exhibition's regions, so pointing it at any other show
    failed on the region names rather than on anything real — which is a
    harness that cannot be reused, not a passing test. It reads each show's own
    structure now. Nothing was broken by this; it is recorded because "the
    check only works on the fixture" is the quiet way a suite stops meaning
    anything.

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

**Regions now survive both kinds of link.** In the self-contained link
(`/exhibition?e=…`) they travel as positions rather than ids — measured at
**70 characters** of URL for two named regions over a twelve-work show, against
180 for the ids alone. Over `/e/:code` they are stored inside the hang's own
JSON column, which is why this needed **no D1 migration**: the column is TEXT
holding JSON and one route is its only writer, so a row holds either
`[ …works ]` or `{ works, regions }`, the reader accepts both, and a show with
no groupings is stored byte-for-byte as it always was. Six regions maximum.

**Not attempted:** VR/WebXR; frames or mounts on the works; footsteps or any
audio; a minimap; multiple visitors; saved positions; a light model of any kind.

**One wordiness decision I made and did not act on**, recorded so it can be
overruled with the reasoning rather than re-derived. The show's title appears
twice while the room is open: small in the top-left, and large on the entrance
wall behind you. That is a duplication, and cutting the overlay would be the
stricter reading of "prefer a mark or a position over a word" — a museum does
not print the show's title on your retina while you walk; it is at the door.

I kept it, because the visitor starts facing *away* from the wall text, so on
first paint a cold-opened room would have no name anywhere on screen. Terse is
not the same as cryptic, and an unnamed room is cryptic. The alternative that
resolves both — the title fading once the visitor first moves, the way you walk
past entrance signage — is new behaviour rather than removed words, and this
round was for hardening. If the overlay reads as chrome to the owner, deleting
`.exhibition-room-title` is a two-line change and nothing else depends on it.

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
pnpm --filter web test        ✓  105 files / 1325 tests
pnpm --filter api test        ✓   46 files /  867 tests
pnpm --filter web lint        ✓  one pre-existing error in components/board/deal-board.tsx
                                 (a rule this repo does not configure); none in new code
```

Baselines measured on this branch before the lane started: **web 97 files /
1204 tests, api 46 files / 857 tests.** This lane adds nine web test files and
121 web tests, ten api tests, and regresses nothing. (The night brief quotes
web 59/593 and api 41/770; those numbers do not match this repository at any
point in this lane, so the measured baselines are used.)

Deployed to **staging only** (`paillette-stg.berlayar.ai`) — web four times,
api once — and every claim above re-checked against the deployed build rather
than only locally. Production untouched.

**The demo path, as a script.** `scripts/room-demo-path.ts` is the whole visit
in twenty-five steps, every one an action a visitor performs — open the short
link cold, click ROOM, walk on the keyboard into the second named room, click a
picture, read its label, press Escape, click PAGE — with every claim asserted
rather than described. It throws on the first thing that is not true.

Run three times locally and three times against deployed staging: **25 of 25
each time, no flakes** — 26 of 26 on a show that has labels, since one step only
applies then. Peak on the walk: 31.0–48.5 MiB of texture, four to six works at
full resolution, 22–26 fps under SwiftShader.

**And across the conditions a visitor arrives in, and the shapes a show can
be.** `scripts/room-demo-matrix.ts` runs the whole visit nine ways:

| cell | what it is |
| --- | --- |
| desktop | 1440 × 900, mouse and keyboard |
| phone, touch only | 390 × 844 at DPR 3, taps and drags, no keyboard |
| reduced motion | `prefers-reduced-motion: reduce` |
| no speech APIs | every speech API deleted before the page loads |
| all three at once | the most constrained visitor |
| 1 work, 1 room | the smallest building the planner will make |
| 24 works, 2 rooms | the largest show a short code can carry |
| 23 works, 3 named rooms | a three-room enfilade |
| 6 works, 0 labels | a show nobody wrote labels for |

The expectations are read from each published show — works, labels, regions,
and how many rooms that implies — rather than hardcoded to one demo, so the
same twenty-six steps run against any code.

Against deployed staging, two rounds: **18 of 18 cells green.** The unlabelled
show scores 25, not 26, because one step only applies to a show that has
labels.

```
PAILLETTE_ORIGIN=https://paillette-stg.berlayar.ai CODE=Gt7HNyF \
  SHAPES=ULfYaHK,3HTKkN5,Cc5KKWJ,toztyWt ROUNDS=2 \
  pnpm --filter web exec tsx scripts/room-demo-matrix.ts
```

One of those shapes exercised the failure the prompt asks about without being
asked to: the three-region show was published with twenty-four ids and came
back with **twenty-three works**, because one no longer resolves in the
catalogue. The region that named it lost a member, kept its name, and the show
still built three rooms.

```
PAILLETTE_ORIGIN=https://paillette-stg.berlayar.ai CODE=u4G4Gkv \
  pnpm --filter web exec tsx scripts/room-demo-path.ts
```

**And the path in front of it.** `scripts/room-agent-path.ts` publishes a show
the way the app does — the agent's tools, then the human's share button — and
prints the code for the script above to walk. Chained, the pair covers
`annotate_atlas` through to a stranger walking two named rooms. Run twice from
scratch: 26 of 26 both times.

```
pnpm --filter web exec tsx scripts/room-agent-path.ts   # prints a fresh code
CODE=<that code> pnpm --filter web exec tsx scripts/room-demo-path.ts
```

Reproduce the numbers:

```
pnpm --filter web exec tsx scripts/room-demo-links.ts    # mint the demo shows
ROOM_LINKS="$(…)" pnpm --filter web exec tsx scripts/room-checks.ts
ROOM_LINKS="$(…)" pnpm --filter web exec tsx scripts/room-shots.ts
```

Live: <https://paillette-stg.berlayar.ai/e/MKwsxHy> opens the page;
<https://paillette-stg.berlayar.ai/e/MKwsxHy?v=room> opens the room.

---

## 10. For the submission lane: what may and may not be claimed

### Safe to say — demonstrated, on deployed staging, repeatedly

- **The person who opens a shared exhibition link chooses how to see it.** Two
  words on the page; the room is the one you have to ask for. A cold link
  always opens the flat page.
- **The room is built from the exhibition, not chosen from a menu.** The number
  of works decides the size of the room, the curation's order is the route you
  walk, and named groupings become separate rooms with a doorway between them.
- **A shared short link carries all of that**, including the named rooms.
- **Walking, clicking a picture, and reading its wall label all work by mouse,
  by touch, and by keyboard alone** — and with no speech APIs present at all.
  The whole visit was run nine ways, twice, on deployed staging — desktop,
  phone with touch only, reduced motion, no speech, all three at once, and four
  different shapes of show from one work to twenty-four. **18 of 18.**
- **A device that cannot draw a room is never offered one**, and never told
  why; it simply gets the page that has always worked. Same for a context the
  browser takes away mid-visit.
- **Thirty works stay inside a 96 MiB texture ceiling**, with a measured peak
  of 70.4 MiB across every run and never more than six works at full
  resolution.
- **The room adds nothing to what a normal visitor downloads.** The flat page's
  own chunk is 1.99 kB gzipped; the 181 kB 3D library is behind two dynamic
  imports and is fetched only by someone who asked for the room.
- **The groups an agent names on the board become the rooms a stranger walks
  through.** Demonstrated end to end, twice from scratch, on freshly published
  short codes — with the limit in the next section. **That limit is now gone:
  `claims-report.md` runs the same path from a typed sentence, with the model
  choosing `annotate_atlas` itself.**

### Do not say

- **"Works are hung at their real size."** The code does this and it is tested,
  but **no record in this deployment has a size to hang at** — all sixty
  sampled carry an empty `dimensions` object. Every work in every screenshot is
  at one declared fallback size. If real scale is mentioned at all it has to be
  as a capability waiting on data, never as something visible in the demo.
- **Any frame rate.** This machine has no GPU a browser will use; every number
  is SwiftShader on four vCPUs. There is no laptop or phone measurement.
- **"Runs well on a phone."** The whole visit *completes* on a phone-sized
  viewport by touch alone — but a portrait phone has a ~42° horizontal field,
  so you see about one work at a time and must look around. Nobody has run it
  on actual phone hardware. Say "it works on a phone", not "it is good on a
  phone", and do not film one without looking at §5 first.
- **"60 fps."** Not measured, on anything.
- **Music, or audio of any kind.** There is none.
- **That the agent can put a visitor in the room.** It cannot; the template is a
  property of the URL the visitor holds. What the agent *does* reach is the
  regions, which become the rooms.
- **"The agent decides how to lay the room out" — not as demonstrated here.**
  `room-agent-path.ts` drives `annotate_atlas` through
  `window.__paillette_webmcp.call`, the developer's back door. That proves the
  tool works and that its effect survives publishing, sharing and being opened
  cold by a stranger. It does *not* prove a language model chose to call it:
  the leg from a typed instruction to a tool call belongs to the culling lane,
  and this lane never ran it. Phrase it as "when the show names its groups,
  the room follows" rather than as the agent doing it live, unless the culling
  lane has evidence for the first leg.

  > **Superseded — see `claims-report.md` §1–5.** That first leg has since been
  > run. Typed into the agent bar with nothing driven through the console, the
  > model chose `annotate_atlas` in two runs of three, and the codes it
  > published walk as its own two named rooms, 26 of 26, twice. The third run
  > is why `unnamed-rooms` now exists. This bullet stands as the record of what
  > was true when the room lane wrote it; it is no longer the limit.

### The one-line version

> A shared exhibition can be read as a page or walked as a room, and the room is
> built out of the show itself — its order becomes the route, and the groups the
> curation named become the rooms you walk between.

### If a demo is filmed

`scripts/room-demo-path.ts` is the exact sequence, and it passes 25 of 25 on
staging. In human terms: open `https://paillette-stg.berlayar.ai/e/u4G4Gkv`,
click **ROOM**, hold the up arrow to walk through the doorway into *The Empty
Shore*, click a picture, read the label that appears bottom-left, press
**Escape**, click **PAGE**.

Two things to know before filming: the room takes several seconds to load its
textures, so give it about eight; and the first thing on screen is the room you
are standing in, not the show's title — the title and statement are painted on
the wall *behind* the camera, which is where a gallery puts them and which you
have to turn around to see.
