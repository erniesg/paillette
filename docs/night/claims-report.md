# The leg nobody had run

Two lines in `room-report.md` §10 sat under **do not say**. This lane went to
move them. One moved; the other did not, and is restated more precisely below.

**The claim:** *the groups an agent names on the board become the rooms a
stranger walks through* — with a language model choosing to call
`annotate_atlas` because a person typed an ordinary sentence, not because a
script reached through `window.__paillette_webmcp.call`.

**Result: demonstrated, and it was already partly true before I changed
anything.** The brief expected the model would simply never call the tool, the
way it never called `flag_artworks` across 508 calls. That is not what happens.
It calls it unprompted in four runs out of six. The other times it does
something stranger and worse, which is what the fix is for.

---

## 0. The thing that passed once and then failed

Reported last round as **26 of 26, twice**. Re-run this round on deployed
staging, `room-demo-path.ts` against `/e/WfW8emn` **failed**:

```
FAIL 22. PAGE returns to the plain URL
     expected https://paillette-stg.berlayar.ai/e/WfW8emn
     got      https://paillette-stg.berlayar.ai/e/WfW8emn?v=room
```

It then failed again on a solo re-run, and passed on the one after. Counted
properly: **two failures in seven pre-fix walks tonight**, both at step 22, both
on this code. Load correlates but does not cleanly separate them — the failures
were at 7 and 9 fps and the pass immediately after was at 8 — which is what a
race that is marginal at this latency looks like, rather than a clean threshold.
(My first write-up of this said "three failures in six walks". It was two in
seven. The error was in my favour and is the kind this round exists to catch.)

**It is the harness, not the page,** and the measurement says so rather than my
judgement. A probe that clicks PAGE and polls the URL for thirty seconds, five
times:

```
attempt 1: url arrived after 2245ms   .exhibition-work=12  canvas=0
attempt 2: url arrived after  957ms   .exhibition-work=0   canvas=1
attempt 3: url arrived after 2257ms   .exhibition-work=0   canvas=1
attempt 4: url arrived after 2211ms   .exhibition-work=12  canvas=0
attempt 5: url arrived after 1700ms   .exhibition-work=0   canvas=0
```

The navigation **always arrives — never once did it fail to** — but it takes
957 to 2257 ms, and the script asserted the URL after a flat
`waitForTimeout(1500)`. Three of those five attempts are over the bet. The sleep
was simply short. This is the same defect the
merge report §6.5 found and fixed in `section-9` — *"a bet on how long twelve
staggered cards take"* — still present one file over, and it had been quietly
inflating a headline number.

The probe also caught a second bet hiding behind the first: at the instant the
URL flips, the canvas is often still up and no work has drawn, so
`the flat page is intact` was reading a count that was about to be right.

Both are now conditions rather than sleeps (`waitForURL`, then wait for the
first work to be visible). Nothing is weakened: the URL still has to be exactly
the plain one and the flat page still has to have works on it.

After the change, **12 of 12 walks pass** — three serial, three run in parallel
at 5 to 8 fps (the load band both failures happened in), the five matrix cells,
and the one-room show. No failure of any step since.

**What this costs the room lane's claims.** "26 of 26" and the matrix's "9 of 9"
were run against a script that could fail this step under load, so those numbers
were real runs but a flakier check than they read as. Nothing about the product
changed and no assertion was weakened — the URL is still required to be exactly
the plain one. The honest statement is that the walk passes reliably and that
until tonight the harness could lose a race the page was winning.

## 1. What was actually run for Job A

`scripts/demo/agent-rooms.mjs`, committed. Two typed turns into the agent bar,
nothing driven through the debug handle in either leg:

1. *"Build me a show about the coast — a dozen works, half of them working
   harbours and half of them empty shores."*
2. *"Split these into two rooms: the working harbour and the empty shore."*

`annotate_atlas` is read out of the model's own `tool_calls` in the response
from `/api/public-agent/turn` — the same way `agent-marks.mjs` and `census.mjs`
read them, off the wire. `?webmcp-debug` is loaded so the board and the show can
be *read back* for the census; nothing in the first leg is driven through it.
The human then presses the page's own Copy link control, and the short code is
walked by `scripts/room-demo-path.ts`.

Every census is in `docs/night/claims-evidence/`.

## 2. Which of the three claims this is

A tool call the harness made, a tool call that followed a nudge from the page,
and a tool call the model chose unprompted are three different things. Across
five runs on deployed staging:

| run | build | split turn called | nudge first? | published |
| --- | --- | --- | --- | --- |
| 1 | pre-fix | `get_view_context, set_exhibition, write_labels` | — | `/e/vdtNJVm` — **0 regions** |
| 2 | pre-fix | `get_view_context, set_view, annotate_atlas` | **no** | `/e/yXWeAum` — Working Harbour / Empty Shore |
| 3 | pre-fix | `get_view_context, get_exhibition, set_view, annotate_atlas` | **no** | `/e/XwH8aJZ` — The Working Harbour / The Empty Shore |
| 4 | post-fix | `…, set_exhibition, write_labels` → **nudge** → `set_view, annotate_atlas` | **yes** | `/e/WfW8emn` — Working Harbour / Empty Shore |
| 5 | post-fix | `get_view_context, set_view, annotate_atlas, …` | **no** | `/e/kaxeFU4` — Working harbour / Empty shore |
| 6 | post-fix, **neutral brief** | `get_view_context, get_exhibition, set_view, annotate_atlas, …` | **no** | `/e/dAH4peu` — The working harbour / The empty shore |

- **Chosen unprompted, with no page intervention of any kind: runs 2, 3, 5 and
  6 — four of six.** `nudges` is empty in all four, so no post-condition of any
  kind fired; the model read the board, moved it to atlas view of its own
  accord, and named two regions with a note on each.
- **Chosen after the page put the turn back to work: run 4** — one of six.
  Still a real result, and the room follows the show's own groups either way,
  but it is not the same sentence and is not written as one.
- **Not chosen at all: run 1** — one of six, on the build that had no
  post-condition to catch it. Every run since the post-condition landed has
  published named rooms, whether or not the page had to ask.

**No `annotate_atlas` call in this lane was made by the harness.** The only
script that does that is `room-agent-path.ts`, which this lane did not run.

Every published record above is live and can be checked by anyone:

```
/e/vdtNJVm  works=12 labelled=12 regions=[]
/e/yXWeAum  works=12 labelled=12 regions=['Working Harbour', 'Empty Shore']
/e/XwH8aJZ  works=12 labelled=12 regions=['The Working Harbour', 'The Empty Shore']
/e/WfW8emn  works=12 labelled=12 regions=['Working Harbour', 'Empty Shore']
/e/kaxeFU4  works=12 labelled=0  regions=['Working harbour', 'Empty shore']
/e/dAH4peu  works=12 labelled=12 regions=['The working harbour', 'The empty shore']
```

`kaxeFU4` carries no labels because that run met the ten-an-hour `write_labels`
limit. Walked, it is 26 of 26 like the others: both rooms are named, the walk
between them works, and the page handles the blank wall deliberately rather than
badly — clicking a work still opens its panel with the catalogue line and no
empty rule where a label would be, which is a step the walk asserts. So the
limit costs the wall text and nothing else. It is still the one code here not to
film, because there is nothing to read on the wall.

### Did it group, or just cut the board in half? (My harness nearly hid this)

Reading the four `annotate_atlas` calls back against the board they were made
on, every one of them splits it at exactly the same place:

```
before run 2   Working Harbour    board positions [0,1,2,3,4,5]
               Empty Shore                        [6,7,8,9,10,11]
before run 3   The Working Harbour                [0,1,2,3,4,5]
               The Empty Shore                    [6,7,8,9,10,11]
after  run 1   Working Harbour                    [0,1,2,3,4,5]
               Empty Shore                        [6,7,8,9,10,11]
after  run 2   Working harbour                    [0,1,2,3,4,5]
               Empty shore                        [6,7,8,9,10,11]
```

A clean first-half / second-half cut, four times out of four. That is not the
model being lazy — it is **my brief having done the work for it.** The first
typed turn says *"a dozen works, half of them working harbours and half of them
empty shores"*, and the board comes back already assembled that way; the
`set_results` notes say so in the model's own words — *"Six harbours at work
face six shores where the coast falls quiet."* By the time the second turn asks
for two rooms, the two rooms are already the two halves of the board.

So these runs demonstrate that the model **chooses the tool and names the
groups**. On their own they do not demonstrate that it re-examines twelve works
and decides which belongs where, because it never had to.

**So the test was run again with a brief that does not pre-sort.** Same split
sentence, but the first turn only says *"Build me a show about the coast — a
dozen works."* The board came back mixed, in the model's own words — *"A coast
of cliffs, working harbours, boats, and shifting weather"* — and the split turn
then produced this, with no nudge:

```
The working harbour   n=5   board positions [5, 6, 9, 10, 11]
   "Boats, docks, and built edges turn water into a place of work and passage."
The empty shore       n=7   board positions [0, 1, 2, 3, 4, 7, 8]
   "Rock, weather, light, and open water dominate these unpeopled margins."
```

**Uneven and interleaved.** Five against seven, and neither group is a
contiguous stretch of the board. What that rules out is the thing worth ruling
out: no positional rule — no first half, no alternating, no split at any single
index — produces that partition, so the assignment has to have been made per
work against what each picture is. (What the model did internally is not
something this evidence can speak to; the output is.) Each group also carries a
reason the model wrote for it. Published as `/e/dAH4peu`, walked 26 of 26, and
the visitor arrives in *The working harbour* and walks through to *The empty
shore*. The same show walks 5 of 5 matrix cells as well.

That is the claim at full strength, and it is the run to cite: the model chose
the tool, chose how many groups, chose the names, and chose the membership.

## 3. Run 1, which is the finding worth having

It is not the model failing to understand. It understood perfectly and answered
in the wrong medium. It retitled the show **"The Working Harbour / The Empty
Shore"**, wrote a statement opening *"This exhibition is divided into two rooms
at the edge of land"*, and wrote twelve wall labels beginning *"In the Working
Harbour…"* — calling `set_exhibition` and `write_labels` and never
`annotate_atlas`. The division was complete, articulate and entirely in prose.
`regions` stayed `[]`.

That show is still published, and walking it is the whole point:

```
CODE=vdtNJVm room-demo-path.ts
  12 works, 12 labels, no named regions → 1 room(s)
  8. the visitor starts in the first room     null
```

A stranger who opens that link walks **one unnamed room**, through a show whose
own statement tells them there are two. Nothing on the page and nothing in the
turn says anything is wrong: every sentence the model wrote was about two rooms.

## 4. The fix

`apps/web/app/lib/webmcp/unnamed-rooms.ts`, wired into `finishTheJob` in
`agent-prompt.tsx` beside the two checks already there.

Deliberately not a prompt change: the system prompt does not mention
`annotate_atlas` anywhere, and adding a sentence to it is the move that already
failed twice on `flag_artworks`. So it is a post-condition checked against the
state the tools actually wrote, run when the model thinks it has finished, which
can put the turn back to work.

**It chooses nothing.** It never sees a title, a statement or a subject — only
which ids are hanging and whether `regions` is empty. How many groups there are,
what they are called and which work belongs in which stay entirely the model's,
and a test asserts the nudge contains neither of the two room names the human
typed.

The trigger is narrow on purpose. A missed ask leaves things as they are today;
a false one interrupts a turn that was never about grouping — and the sentence
that would trip it most easily is the commonest one on this page, *"build me a
room about storms at sea"*. A bare "room" never counts. Both strings
`e2e-correction.mjs` types were checked against it and neither trips it, so
Job B below measures §5c and not this change.

**Both checks were made to fail on purpose first.**

- Against the unpatched function — the world as it was, where no such check
  exists and nothing is ever asked for — **13 of 24 failed**. The 11 that passed
  are the negative cases, which pass trivially when the answer is always "no";
  they pin the false-positive boundary and do not carry the fix.
- Unwired from the turn loop, the wiring test reads
  `AssertionError: expected '' to contain 'annotate_atlas'` — no nudge at all.

Run 4 is that fix working on the exact defect it was written for: the model did
what run 1 did — retitled the show *"Two Coasts"*, wrote a statement opening
*"These two rooms divide the coast by what it asks of people"*, wrote the labels
— and moved to end the turn with `regions` empty. The page put it back to work
and it then called `set_view` with atlas and `annotate_atlas` with two named
regions of its own choosing.

The harness now records **where** a nudge landed in the census — how many tool
calls had been chosen when it arrived — so the ordering behind "the page put it
back to work and *then* it called the tool" is on the record rather than taken
on trust.

## 5. The whole chain, walked

```
CODE=yXWeAum   26 of 26   Working Harbour / Empty Shore   (chosen unprompted)
CODE=WfW8emn   26 of 26   Working Harbour / Empty Shore   (chosen after a nudge)
```

Both re-run this round on deployed staging after the step-22 fix; `WfW8emn`
three times. Both assert the room count, both room names, and the walk from the
first room through the doorway into the second — names that came out of the
model's own `annotate_atlas` arguments and were never typed by the harness.

And the same show across the five visitor conditions, `room-demo-matrix.ts`
against `/e/WfW8emn` — the code the model named:

```
  ok   desktop                              26 steps
  ok   phone, touch only                    26 steps
  ok   reduced motion                       26 steps
  ok   no speech APIs                       26 steps
  ok   phone + reduced motion + no speech   26 steps
  5 of 5 cells green
```

So the rooms the model named are walkable by mouse, by touch alone, with
reduced motion, with no speech APIs at all, and with all three at once.

**Regression check on the neighbouring post-condition.** `agent-marks.mjs`,
2 of 2 runs re-run on the current build: the model chose `flag_artworks`, three
provisional marks each time, all of them on the board, none off it. The
blockers lane's central fix is undisturbed by this lane.

## 6. Job B — the §5c rate, measured

`scripts/demo/e2e-correction.mjs` on deployed staging: a show is drafted from a
typed instruction, the human clicks the statement and rewrites it in their own
words, the agent re-selects and re-labels around the correction, and the show is
published from the page's own share control.

**Pacing, because the limit is the thing that makes this delicate.** A
correction run spends four or five `write_labels` calls, and the cap is ten an
hour keyed on a **fixed wall-clock hour** (`floor(Date.now() / 3_600_000)`), not
a rolling window — which is worth knowing, because it means the budget refills
at the top of the hour rather than sixty minutes after you spent it. Three runs
back to back is twelve to fifteen calls, so the third measures the limit instead
of the feature. Runs 1 and 2 were taken in one clock hour and stopped there
deliberately — **nine of ten calls used, none refused** — and run 3 in the next.
Starting a run forty-three seconds before the hour is not far enough into the
next bucket; see below.

| | added | dropped | relabelled | unlabelled | titleChanged | statementIsTheirs | `write_labels` | refused |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run 1 | 8 | 9 | 3 | **0** | yes | yes | 4 | **0** |
| run 2 | 0 | 6 | 6 | **0** | yes | yes | 5 | **0** |
| run 3 | 11 | 8 | 4 | **0** | yes | yes | 4 | **0** |

Published, counted from the published record rather than from the DOM:

```
/e/fP3rNvf  11 works, 11 with a label,  "Before the Door Closes"
/e/mxP9fHA   6 works,  6 with a label,  "The Room That Remains"
/e/rJjWvei  15 works, 15 with a label,  "The Hour Before"
```

**Three of three on every criterion.** Every work on every published page
carries a wall label. Every title moved off the weather and onto the leaving,
which is the correction the human typed. Every run kept the human's statement
verbatim. Against the critique's roughly 1 in 4, that is the change — but see
§9 before quoting a rate off three runs.

The three also show the §5c work being done in different proportions, which is
worth knowing before filming: run 1 mostly **exchanged** the show (8 in, 9 out),
run 3 **grew** it (11 in, 8 out, ending at fifteen works), and run 2 added
nothing at all and **rewrote the whole wall** (0 in, 6 out, all 6 survivors
relabelled). All three are correct responses to "it is not about weather, it is
about leaving"; they do not look the same on camera.

### The fourth run, which measured the limit instead

There was an earlier attempt at run 3, started at 18:59:17 — forty-three seconds
before the hour. Its drafting turn's `write_labels` fired at about 18:59:47,
inside the bucket that already had ten calls in it, and came back
`LABELS_RATE_LIMITED`. So it drafted twelve works with **no labels at all**, and
the correction then dropped all twelve and hung three:

```
drafted   12 works, unlabelled 12
correction  added 3, dropped 12, relabelled 0, unlabelled 0
published /e/PEBhgSw — 3 works
```

It is discarded and not counted above. `relabelled 0` there means "there were no
labels to change", not "the agent relabelled nothing" — which is exactly the
misreading the instrumented `labelCalls` exists to prevent, and the reason the
refusals are quoted rather than the counts trusted. It is recorded here because
a run that looks like a feature failure and is actually a quota failure is the
single easiest way to misreport this number.

`unnamed-rooms` did not fire in either run, as intended — the nudges recorded in
both are the title gap from `unfinished-show`.

## 7. Gates, quota, and what this lane cost

```
pnpm --filter web build       ✓
pnpm --filter web typecheck   ✓
pnpm --filter web lint        ✓  clean
pnpm --filter web test        ✓  109 files / 1429 tests
pnpm --filter api test        ✓   46 files /  867 tests
```

Baseline was 108 files / 1383 tests. The difference is one new file and
forty-six tests, all of them mine: forty-three in `unnamed-rooms.test.ts` and
three wired into `agent-prompt.test.tsx`. The api suite is untouched.

**NGA public search quota: 146 at the start of this lane, 206 at the end — 60
spent.** It was not reset, raised or otherwise touched. The counter is reserved
before the cache lookup, so every one of those sixty is a request this lane
made, not a provider call: six `agent-rooms` runs at four or five searches each,
four `e2e-correction` runs at three or four, and two `agent-marks` runs.

At that rate the remaining 794 is roughly eighty more evidence runs, which is
not the binding constraint. **The `write_labels` cap is** — ten an hour, two
correction runs, and a third that publishes a blank wall.

---

## 8. What may now be claimed, and the evidence for each

**1. A person types an ordinary curator's sentence, and the model decides by
itself to name the groups on the board.**
Six runs on deployed staging, `annotate_atlas` read out of the model's own
`tool_calls` in the response from `/api/public-agent/turn`. Four of the six
chose it with no intervention of any kind — `nudges` empty in the census.
Evidence: `docs/night/claims-evidence/rooms-*.json`. Nothing in the harness
calls the tool: `agent-rooms.mjs` makes exactly two `__paillette_webmcp` calls
and both are reads (`get_view_context`, `get_exhibition`).

**2. It chooses the membership, not only the names.**
Run 6, on a brief that deliberately did not pre-sort the board: five works
against seven, at board positions `[5,6,9,10,11]` and `[0,1,2,3,4,7,8]` —
uneven and interleaved, with a written reason for each group. No positional rule
produces that. This is the run to cite; runs 2–5 used a brief that had already
split the board in half, and on their own they show only that it names groups.

**3. The groups it names become the rooms a stranger walks.**
The human presses the page's own Copy link; the short code is opened cold.
`/e/dAH4peu`, `/e/yXWeAum`, `/e/XwH8aJZ` and `/e/WfW8emn` each walk **26 of
26** in `room-demo-path.ts`, which asserts the room count, both room names and
the walk through the doorway from the first room into the second — the names
coming from the published record, so a wrong name fails rather than passes. All
published records are live and can be fetched by anyone.

**4. It works for a visitor who is not on a desktop.**
`room-demo-matrix.ts` re-run as one sweep over everything this lane published —
the five visitor conditions on `/e/dAH4peu` plus a desktop walk of `yXWeAum`,
`XwH8aJZ`, `WfW8emn` and `vdtNJVm`: **9 of 9 cells green**, 26 steps apiece.
Desktop, phone by touch alone, reduced motion, no speech APIs, and all three at
once. `/e/WfW8emn` separately walked 5 of 5 conditions earlier in the round.

**5. When the model answers the request in prose instead, the page refuses to
let the turn end, and the model then names the groups itself.**
Run 4: it retitled the show *"Two Coasts"*, wrote a statement opening *"These
two rooms divide the coast by what it asks of people"*, wrote the labels, and
moved to end the turn with `regions` empty. The nudge is recorded in the census
with the position it arrived at, and `set_view`/`annotate_atlas` follow it.
**Word this as the page catching it, not as the model choosing it.**

**6. The prompt was not touched.** The system prompt mentions `annotate_atlas`
zero times and "region" zero times — checked by grep, not by memory. Every group
in every run was composed by the model.

**7. §5c: a correction the human types in their own words changes the show, and
the published page is fully labelled.**
Three unthrottled runs — `write_labels` 4, 5 and 4 calls, **none refused** —
with per-run numbers in §6. All three: `unlabelled 0`, title changed, statement
kept verbatim. The published pages carry a wall label on **every** work
(11/11, 6/6, 15/15), counted from the published record. A fourth attempt was
throttled and is reported and discarded rather than folded in.

## 9. What still may not be claimed, and why

**"The agent always names the groups when asked."** It does not. Four of six
runs unprompted; one needed the page to put the turn back to work; one — on the
build with no post-condition — published a show whose statement announces two
rooms and which a stranger walks as one. Do not give a success rate off six
runs; say it usually does it and that the page now catches it when it does not.

**Any reliability figure for the post-condition itself.** It has been observed
firing and being obeyed **exactly once**. That one observation is clean and is
the exact defect it was written for, but one is not a rate. Nothing here
supports "the page always catches it".

**That the agent divides a show without being asked.** Every run asked, in a
second typed sentence. No run shows the model volunteering regions on its own,
and the prompt never suggests it — so an unprompted division is not evidence
this lane has.

**More than two rooms.** Every run asked for two and produced two. The planner's
handling of three or more named regions is not exercised anywhere in this lane.

**That the check understands grouping requests in general.** `asksForRooms` is a
regex over English phrasings, probed across thirty-three sentences. Phrasings
outside that set will be missed, and a miss is silent: the turn simply ends
undivided, exactly as it did before this existed. It is a safety net with known
holes, not comprehension.

**A general §5c rate.** Three runs is three runs. They were paced around the
labelling limit precisely so that they measure the feature rather than the
quota, and all three succeeded on every criterion — but "3 of 3" is not a
percentage, and the honest sentence is "it worked every time we ran it cleanly
tonight, three times", not "it works 100% of the time". The critique's 1-in-4
was measured on a different build and is not a like-for-like baseline; what can
be said is that the failure it described — published pages with no wall label —
did not happen in any clean run here.

**That a session can do many of these an hour.** `write_labels` allows ten calls
an hour on a fixed wall-clock hour, and a correction run spends four or five.
That is **two correction runs an hour**, and the third will publish a blank
wall. `/e/kaxeFU4` in §2 is what that looks like and is the one code here that
should not be filmed.

**Everything room-report §10 already forbids stands unchanged** — works at real
size, any frame rate, "runs well on a phone", 60 fps, audio, and the agent
putting a visitor in the room. This lane touched none of them. The fps numbers
printed by the walks above are SwiftShader on four vCPUs and are not a
measurement of anything a visitor would see.

**"26 of 26" was, until tonight, a flakier number than it read as.** See §0. The
walks are reliable now; a reader of the earlier reports should know the harness
could lose a race the page was winning.
