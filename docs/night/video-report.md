# The record phase — what is in the film, and how it got there

`docs/night/video/paillette-demo.mp4` · **2:52.5** (172.47 s) · 1440 × 900 ·
30 fps · h264 + AAC · 15.9 MB.

Everything in the picture was captured headlessly by a real Chromium against
**`https://paillette-stg.berlayar.ai`**, the deployed staging build, on
2026-09-04 between 16:22 and 16:40 UTC. No fixtures, no stubs, no
`?webmcp-debug` on any route, and **`/night/deal` was never opened**. The eight
routes filmed are in `beats.json` and are all `/nga/search` variants plus one
`/e/MKwsxHy`.

Across the whole shoot: **0 refusals, 0 uncaught page errors**, 14 model calls,
27 NGA searches.

---

## The thing to decide first: this film is not the VO script

I was pointed at `docs/webmcp-vo-script-final.md`. **I did not shoot it**, and
that is the largest judgement call in this phase, so it goes at the top.

That script describes a different film — point at a collection, upload a zip,
watch indexing climb, get suggestions, run *estuary at dusk*, open a work and
have it **read out loud**, then scale to 63,253 and finish with the sofa prompt.
Three of its cues are on the shot list's own **"Do not film"** table, and the
reasons there are evidence, not taste:

| VO cue | Why it is not in the film |
| --- | --- |
| Cue 2–4 · upload, indexing, suggestions | Shot list: *"Throat-clearing. Nothing in it is unique to WebMCP."* |
| Cue 6 · "have that read out loud" | Shot list: the read-aloud control renders **only** on a work with a stored caption, most NGA rows have none, and **"No audio has ever been produced from this build by anybody."** Filming a claim nobody has ever seen work is the one thing the brief forbids outright. |
| Ending · "your eyes **and ears**" | Rests on the same unproven read-aloud. |

So I shot `docs/night/shot-list.md`, which is written against the iteration-5
evidence and the critique's verdict, and whose strongest beat — *say one thing,
do another* — the VO script does not contain at all. The verdict calls that beat
**"the eleven seconds the video should open with"**.

**The owner should delete one of these two documents.** They describe different
products and the VO script would have put an unshippable claim on camera.

---

## Every beat, and whether it is live

**All eight scenes are live.** Nothing was reproduced, simulated or replayed.
Four **held graphics** carry text that is archived rather than filmed, and each
is flagged below.

| # | Beat | Source | Live? | What it shows |
| --- | --- | --- | --- | --- |
| 1 | Cold open | `b1-cold-open` | **live** | The sofa sentence typed into the utterance bar; the agent's board and cyan label; `X`,`X`,`P`; the redeal under a new label |
| 2 | Enter on an empty bar | `b2-empty-bar` | **live** | The armed bar, Enter, the deal. `pickHeldPx: 0`, `modelCallsAfterEnter: 0` |
| — | The request log | `cards/c2-request-log.png` | **graphic** | Set from this take's own wire log |
| 3 | Say one thing, do another | `b3-said-chose` | **live** | Three warm picks, a request for "cool and blue and severe", and the board following the hands |
| 4 | Scale | `b4-board-hold` + `c4-scale` | **live + graphic** | A held board; `63,253 works · National Gallery of Art · CC0` |
| 5 | The show leaves the tab | `b5-share` + `c5-two-labels` | **live + graphic** | The published exhibition, opened cold; the same work under two statements |
| 6 | Without looking | `b6-keyboard` | **live** | 23 Tabs, no mouse, the focus ring landing on a flag control, and `X` |
| 7 | WebMCP, on screen | `b7-tool-surface`, `b7-log-live` | **live** | Five dots; `document.modelContext · 25` and all 25 names; a log row expanded into request and response |
| — | The two hands | `cards/c7-keys.png` | **graphic** | `flag_artworks P·X·U`, `redeal ↵`, `compare_artworks C` |
| 8 | Co-curator | `b1-cold-open` + `c8-end` | **live + graphic** | The agent's board at half speed; the end card |

### There is no spoken-input beat, and nothing was reproduced with `--speak`

The brief anticipated one and asked me to label it. **I did not shoot one.**
`grep -i "speak\|mic\|speech\|voice" scripts/demo/film/shoot.mjs` returns
nothing: every sentence in this film was typed character-by-character with
`input.type()`. The shot list's own note — *"no shot in this list requires
speech"* — held.

The film therefore **makes no voice claim of any kind**. The narration never
mentions the microphone or read-aloud, and the end card's *"everything you can't
see"* is carried by Beat 6, the keyboard and screen-reader beat, which is filmed
and real.

---

## What the agent actually said on camera, checked word by word

The two agent sentences in the film are unscripted model output. I looked both
up in the live collection rather than trusting the take.

**Beat 1** — *"Following your pick's ochre-and-umber watercolor; leaving behind
the road drawing and Renoir's vase."*

| Named | Actually | ✓ |
| --- | --- | --- |
| "your pick's … watercolor" | `nga:184224` *Vicinity of Morestal*, Ravier — **watercolor** and fabricated charcoal | ✓ |
| "the road drawing" | `nga:69461` *Wooded Landscape with a **Road***, de Vadder — classification **Drawing** | ✓ |
| "**Renoir's** vase" | `nga:61382` *Flowers in a **Vase***, **Auguste Renoir** | ✓ |

**Beat 3** — *"You asked for cool blue severity, but picked three warm oil
landscapes with umber, gold, and brown palettes; following the picks."* The
three picks were *Peaceful Valley* (Wyant, **oil on canvas**), *The Haystack and
the Moon* (Cazin, **oil on canvas**) and *Sunset on the River* (Daubigny, **oil
on wood**). Three, warm, oil, landscapes. No wrong word.

Both were verified by querying the deployed search API for the flagged ids.

---

## What I cut, and why

- **S13/S14 — the exhibition being written and corrected live.** The verdict
  measured the correction turn at **1 success in 4** on this deploy, with one
  run leaving weather labels under a wall text reading *"It is not about
  weather"*. The shot list's 🚫 says set the card from archived text instead.
  The film shows the **result** on the published page and states the claim on a
  graphic whose text I diffed against `crit5/show-x4-before.json` and
  `show-x4-after.json` — **verbatim, both labels**.
- **S08** (no-agent-on-the-page insert) and **R01** (the compare room) — no
  room. R01 is the best-composed screen in the product and it is still on the
  floor.
- **Cue `7c`** ("Flag artworks is P and X…"). Generated, in
  `narration/7c.wav`, unused — it read the keys card aloud while the card said
  it better. 21 of the 22 generated cues are in the mix.
- **Any beat where the agent marks the board.** `flag_artworks` and
  `compare_artworks` were chosen by the model **0 times in 508 recorded tool
  calls**; every demonstration in the reports went through the debug console.
  The film never shows or claims it. The keys card's line is *"THE LOOP HAS NO
  AGENT-ONLY PATH"* — a statement about what the human can reach, which is
  true — and deliberately not *"the agent disagrees with you"*, which is not.
- **The word "twelve."** It is 12 cards in most runs but not guaranteed of the
  agent's first board, so no cue names a count.

## Defects the film had to be composed around

- **The human's own Enter deletes the agent's sentence and the board slides up
  56 px** (e2e §6.1, verdict's *weakest*). Beat 2 spends Enter #1 before the
  cut starts and films **Enter #2**, which has no label before or after, so
  nothing collapses. Measured on the take: `pickHeldPx: 0`. The film shows the
  picks genuinely holding still — it does not dodge the defect, it films the
  transition where the defect is not present, which the shot list mandates.
- **The chrome** — `Log in`, `Create account`, `SORT`, `VIEW` — is above every
  dealt board. It is in frame. Nothing can be done about that in an edit.

---

## What I changed this session

The clips, narration and first cut were already on disk when I picked this up,
untracked and with no report. I verified them rather than re-shooting, and
changed three things:

1. **`ZOOM.glyph` 600×375 → 360×225.** The five dots are drawn at ~15% alpha;
   at the old 2.4× I extracted the frame and could not count them. At 4× they
   read. It is a tighter crop of the real frame — I did **not** brighten the
   glyph, because that would misrepresent the UI.
2. **Added `ZOOM.tools`** for the `document.modelContext · 25` panel, which had
   no zoom at all. Its 25 names set ~11 px at full frame — gone for anyone not
   watching full-screen. This is the shot that answers *"how did you implement
   WebMCP"*; it is now legible downscaled.
3. **Added `scripts/demo/film/beats.mjs`**, which derives
   `docs/night/video/beats.json` from the per-scene JSONs. It merges and does
   not measure.

Two fields in the clip JSONs look alarming and are **harness reporting gaps,
not missing footage**: `b7-tool-surface.names: []` (it scraped a `<style>`
element) and `b7-log-live.expanded: null`. I extracted the frames — the panel
shows all 25 names and the log row **is** expanded into full request and
response. Worth fixing in the harness; it does not affect the film.

## The harness defects the brief named — both already fixed, both verified

- **The hardcoded `/Users/erniesg/…` playwright path.** Gone.
  `resolveBrowserDriver()` honours `PLAYWRIGHT_CORE`, then tries three
  specifiers, then the pnpm virtual store and the npx cache. No `/Users/`
  anywhere in `scripts/demo/`.
- **`--speak` truncation.** Fixed at the cause: interim recogniser results are
  cumulative, and the loop was writing each chunk over the last, so 88
  characters arrived as the final 29. It now sends the running total **and
  asserts** `inputValue()` equals the whole instruction before pressing Enter,
  throwing if not. Not exercised by this film, which never uses `--speak`.

Also confirmed before shooting: the deal animation runs on **`/nga/search`
against the real 63,253**, not only at `/night/deal` — 15–27 distinct
grid-relative layouts against a jump cut's 4–5.

---

## Artifacts

```
docs/night/video/
  paillette-demo.mp4        the cut
  beats.json                per-shot record: route, wire, model calls, usage
  edit.json                 the timeline — every segment, speed and cue offset
  clips/<scene>/            .mp4 + .webm + final.png + the take's own JSON
  narration/               22 cues + cues.json (voice, model, direction, text)
  cards/                   the seven held graphics
  work/                    per-segment renders, kept so a re-cut needs no re-run
scripts/demo/film/
  shoot.mjs  cut.mjs  narrate.mjs  cards.mjs  beats.mjs  preflight.mjs
```

Re-cut without re-shooting: `node scripts/demo/film/cut.mjs`. It refuses to
write a film with overlapping cues, narration running past the picture, or a
runtime over 180 s.

Narration is OpenAI `gpt-4o-mini-tts`, voice **sage**, one file per cue so a
single line can be redone without re-rendering. 128.8 s of speech in 172.5 s —
**25% silence**, and it is placed on the deal animation and the three keypresses
rather than spread evenly.

---

## What the owner should consider refilming

Not the spoken-input beat — there isn't one. In priority order:

1. **Nothing, if the deadline is now.** No beat is broken or dishonest.
2. **Beat 7's glyph**, on a real machine at a real window size. It is truthful
   and it is still five nearly-invisible dots on charcoal; a human deciding
   framing live would do better than a crop can.
3. **A voice take**, *only* if the submission wants a voice claim. It needs a
   real microphone and it would need the read-aloud control confirmed on a work
   that actually has a stored caption first. Today the film claims nothing here
   and loses nothing by it.
4. **The exhibition correction (S13/S14) live**, if the 1-in-4 correction turn
   gets fixed. Showing the wall text being overruled beats asserting it on a
   card.

## Is this good enough to submit?

**Yes — with one decision left to the owner.**

What it has: every frame from the deployed build against the real collection;
the two claims the submission rests on shown rather than asserted — Enter on an
empty bar dealing with **zero model calls, 13 ms to the vector index**, and the
board **following the hands over the mouth**; both agent sentences verifiable
word by word; the WebMCP surface — 25 tools, arguments, answers, timings — on
screen and legible; a keyboard-only beat with no mouse events at all; and a
published URL that still resolves and needs no account. It is 2:52.5, inside
the ceiling. It says nothing about voice, nothing about the agent proposing,
and nothing about a work count.

Where it is weaker: **Beat 5 asserts on a card what it cannot yet demonstrate
live.** The card's text is archived verbatim from a real run and the evidence is
committed, so it is honest — but it is the one beat where a judge is told rather
than shown, and if they try the correction themselves they will likely hit the
3-in-4 failure. If anything gets cut for time or risk, cut Beat 5.

The decision left over is the one at the top: **`docs/webmcp-vo-script-final.md`
and this film disagree about what the product is.** The film is the one backed
by the iteration-5 evidence. The script should be retired or rewritten to match
before it reaches a submission form, or the written and filmed pitches will
contradict each other in front of the same judge.
