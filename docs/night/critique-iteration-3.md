# Critique — iteration 3

Written 2026-09-04, 08:51–09:20 UTC, against `night/integration` at `164c416`
and the deployed staging build (web `9b056c22`, api `8a017206`).

I did not take any report on faith. Everything below that is stated as fact was
either re-measured by me in a browser against staging in the last thirty
minutes, or read out of the repository's own code and evidence files. Where a
report and its own evidence disagree, I say so and name both.

**Verdict: FAIL.** Not because the night failed — the mechanism at the centre of
this build is genuinely the best argument for WebMCP I have seen anyone make —
but because the single gesture the brief names as the definition of done is a
silent no-op on the deployed build, and the agent that is supposed to narrate it
has been returning `429` to every turn for the last hour.

---

## What I ran myself

Five probes against `https://paillette-stg.berlayar.ai`, all through the real
page, all headless Chromium, all typed:

| probe | what it did | result |
| --- | --- | --- |
| `probe-rejects-only` | `X` on two cards, Enter on the empty bar | **0 requests, board unchanged 30→30, no note, no error** |
| `probe-negatives` | `search_by_exemplars` with and without `negativeIds` | rankings differ — the negative term is real |
| `probe-share` | `set_exhibition` → click **Copy link** → open the URL in a virgin context | **200, `h1` correct, 4/4 images decoded, 0 localStorage keys** |
| `probe-agent` | typed the sofa instruction, waited 40 s | **`429 AGENT_UNAVAILABLE`** |
| `probe-words` | counted visible non-artwork text on a settled board | **49 words, none of it helper prose** |

Plus `pnpm --filter web test`: **97 files / 1198 tests, all passing.** The
integration report's numbers are correct.

---

## 1. Is this still delegation wearing a costume?

**Half of it escaped, and the half that did not is the half the brief cares
most about.**

The escape is real and I can point at it. Press `P` on two works, press Enter on
an empty bar, and the board redeals: one POST to
`/api/public-search/nga/exemplars`, eleven image GETs, nothing else. Picks hold
their exact pixel position board-to-board (`780,192 → 780,192`), rejects slide
into a visible tray, newcomers arrive, and the FLIP passes through 14–25
intermediate layouts rather than cutting. No model is involved at any point. The
agent's `redeal` tool goes through the same route with the same code path and
the same `by` field flipped. That is not an agent using a website. That is one
mechanism with two operators, and the route comment on
`api.public-search.$orgId.exemplars.ts` is true in code, not just in copy.

**But the loop only runs on picks.** `redeal.ts:176`:

```js
const exemplars = getExemplars();
if (exemplars.positive.length === 0) {
  return fail('NO_EXEMPLARS', 'Nothing has been picked yet, so there is no direction to deal in.', …);
}
```

I confirmed live on staging: two `X` presses and Enter on an empty bar issues
**zero network requests**, leaves the board **byte-identical**, and shows
**nothing at all**. `turn.ts:284` catches `NO_EXEMPLARS` and returns
`{ kind: 'noop' }`; `runRedeal` returns from `fail()` before it ever reaches
`setDealError`, so the one error surface the page has — *"The deal didn't run;
your flags are unchanged."* — never fires.

And it is worse when the agent is the one asking. In the e2e lane's own recorded
transcript (`e2e-evidence/iteration-3/notes.json`, ordering A, run 1, message
17), the model called `redeal` on the human's flags and got back:

```json
{"ok":false,"error":{"code":"NO_EXEMPLARS",
 "message":"Nothing has been picked yet, so there is no direction to deal in."}}
```

It then fell back to four fresh `search_artworks`/`search_by_color` calls of its
own invention and `set_results` on the result. **The human's two rejects had
exactly zero causal influence on the board that came back**, and the agent wrote
a confident sentence over the top of it. That is delegation wearing a costume,
in the most literal sense available: the costume is a sentence.

The fix is small and it is the highest-value change available tonight. When
there are no picks, the *unflagged works currently on the board* are perfectly
good implicit positives — that is exactly what Lightroom's cull does, and it is
what the human means. Rank by `cos(x, mean(board \ rejects)) − 0.5·max_j cos(x,
neg_j)` and "I can tell you what I don't want without being able to say what I
do" becomes a working gesture. No search box on the internet takes that input.
It is the most WebMCP-shaped thing in the build and it currently does nothing.

---

## 2. Does the "gestures outrank words" moment actually happen?

**It has happened, three times, on real works. It does not happen on the current
build, and one of the two places the e2e report says it did is not supported by
that report's own evidence file.**

The genuine article, from `docs/night/e2e-evidence/agent-runs.json` — iteration
1, deployed staging, real NGA ids, `X X P` then the sofa sentence:

> **Run 1.** "Warm, spare, and luminous: a quiet horizon-led hang, leaving the
> darker pastoral mood behind."
> **Run 2.** "You said warm and calm; you kept the luminous dawn and rejected
> the darker landscapes—following the light."
> **Run 3.** "You said warm and calm; you picked a glowing horizon and rejected
> the darker landscapes—following that light."

Those are grounded. Two of three name the said/chose gap in the exact shape the
thesis promises. The rejects were *Peaceful Valley* and *Vicinity of Morestal*;
"the darker landscapes" is a fair description of both. The iteration-1 critique's
complaint — that the payload was three title strings and the model was guessing
from artist names — has since been fixed: `get_view_context` and the turn
payload now carry `palette`, `medium`, `year` and `classification` per flagged
work, which I read back off staging myself.

**On the current build, five notes came back and none of them names what was
thrown out.** Ordering A:

> "A quieter second hang: honeyed landscapes and simple still lifes, kept clear
> of drama and visual clutter."
> "Brighter, friendlier warmth: fruit, flowers, and open ground with clean,
> restful compositions."

Those are exactly the plausible-sounding generic line the brief warns about.
They would fit any board. And now I know *why*, and it is not the reason the
e2e report gives. The report blames `agent-prompt.tsx:396` — the gesture payload
is sent only on `turn === 0`, so five requests later the sentence naming the
rejects is out of context. That is true and it should be fixed. But it is
secondary: the model called `get_view_context` again on the nudge turn
(request 6), and that result — which carries the full flag record, palettes and
all — stays in `historyRef` for the rest of the turn. The model had the rejects.
What it did not have was a board derived from them, because `redeal` had just
refused. It wrote a sentence about the board it could see, because the board it
could see was one it had built from scratch.

**The reporting failure.** The e2e report §4 quotes ordering B as:

> Run 1 note: "Soft light, simple forms, and warm colour for an easy, welcoming
> wall." · Run 2 note: "Warm light, open space, and softened colour…" · Run 3:
> none — 429.

`docs/night/e2e-evidence/iteration-3/notes-B.json` records all three runs as
`"note": null` with `{"status":429,"body":"…AGENT_UNAVAILABLE…"}`, and
`e2e3-08-note-B1.png` shows *"The shared daily agent budget for this site is
spent."* in red on the page. The report says "five notes came back"; its
evidence supports two. This is the exact failure mode the owner names — a claim
outrunning the evidence — and it is in the section of the report that the
submission narrative depends on most. It has to be corrected before anything is
written from it.

So: the moment is real, it has been filmed once, and it cannot be reproduced
today. Until it is reproduced on this build, three times, with the rejects
quoted next to the notes, the submission may not claim it.

---

## 3. Would a judge who opened staging cold reach the good part?

**No, and the first obstacle is the homepage.**

`https://paillette-stg.berlayar.ai/` is a different product's marketing page. Its
own text, verbatim:

> *"AI-powered multimodal search and management platform for galleries
> worldwide"* · *"Powerful Features"* · *"Everything you need to manage and
> discover art"* · 🔍 Multimodal Search · 📊 Metadata Management · 🎨 Embedding
> Projector · 🖼️ Frame Removal · 🌏 Multi-Language · 🔌 Public API

Six emoji feature cards. Nothing on that page mentions an agent, a board, flags,
or an exhibition, and nothing links to `/nga/search`. A judge who types the
staging URL into a browser lands on a generic SaaS template and has no path to
the thing being submitted. If the Devpost link points at `/nga/search` this is
survivable; if it points at the root it is fatal, and either way the root page
actively argues against the submission's own thesis.

`/nga/search` cold is much better — floating works, a serif *"search by feeling,
era, subject…"*, a charcoal ground. But two problems.

**There are two text fields on one screen.** The big serif search field and the
"Ask the agent" bar, both live, with different jobs. §5 of the brief is
categorical: *"One field, two inputs. Text is the ground truth. There is nothing
to switch because there is one field."* The build has two, and a cold judge will
type the sofa sentence into the wrong one. Once a query is active the search
field collapses to a chip and the problem goes away — but the cold state is the
one a judge meets first.

**Nothing on a cold board says the keys exist.** In fairness, the design's answer
is right: `P X U` render as a corner badge on hover, which is Lightroom's own
answer and needs no legend. And when a flag is confirmed, a hairline `↵` appears
under the bar in the human's ink — a mark, not a sentence. That is good, and the
explanatory sentence *"Enter on the empty bar redeals the board from your
flags"* is correctly `sr-only`, off screen where it costs nothing. My first
probe caught it in `innerText` and I was wrong to count it; the discipline here
is real.

The problem is not discoverability of the key. It is that the most natural thing
a curious person does — reject the ones they dislike and press Enter — is the
one path that silently does nothing (§1).

---

## 4. Do the visuals hold up?

**The exhibition page and the compare room, yes, unreservedly. The board,
competently, with one frame-ruining defect.**

The shared exhibition page is the best-looking thing in the build. I opened one
cold myself today: `Everything the Light Left Behind` / `The Hour Before`, EB
Garamond at display size on charcoal, a hairline rule down the statement, works
alternating left and right with catalogue data set small in mono beside them,
a colophon that counts its own agent-written labels from the data rather than
asserting a number. It is quiet and it is confident and it would not embarrass
anyone. `share-cold-open.png`, `40-exhibition-page.png`.

The two-up room is genuinely a room — full-bleed at the viewport origin, the
agent's question set in serif between the works, nav and chrome gone,
`data-compare-open` on the root, a "Neither" door at the bottom. Ten good
seconds. `e2e2-13-step5-compare-two-up.png`.

The board is where it thins out.

- **The note is bisected by the sticky search toolbar.** In
  `e2e3-01-after-instruction.png` — the only frame in the whole night that has
  the agent's wall label and its board together — the sentence *"Warm light,
  open breathing room, and gentle domestic colour for an easy living-room
  hang."* is sliced through horizontally by the toolbar sitting on top of it.
  Iteration 2 failed this submission because the note and the board could not
  be on screen together; `fb24929` fixed the geometry, and the one surviving
  frame of the result has the sentence cut in half. This is the money shot and
  it is currently unusable.
- **The cards are mostly empty.** Each tile is a wide charcoal rectangle with a
  small thumbnail floating at the top and a caption at the bottom; the picture
  occupies perhaps a fifth of its own card. The brief says the works should be
  the only saturated thing on screen, and they are — there is just not much of
  them. I checked `01-deal-fresh.png` from the visuals lane and the harness has
  the same proportions, so this is the intended reading (a slide on a light
  table) rather than a regression. It is defensible. It also means the board
  reads as roughly seventy percent dark grey, and against a field of entries
  that is closer to austere than to striking.
- **The provenance ink is real and it is subtle.** Graphite hairline frame and a
  lift on a human pick, cyan `rgb(94,200,216)` and dashed for the agent's, the
  rejects greyed in a narrow tray at the left edge. Verified off computed style,
  not class names. It works; you have to be looking.
- **The ledger filmstrip does not exist.** No `.pa-ledger` or anything like it in
  the deployed DOM. Triage item 9 permitted this — *"if it will not land, hide
  the activity panel entirely rather than show a chat"* — and that is exactly
  what was done, correctly. But §7.5 must not be described in the submission.

---

## 5. Is the WebMCP story real?

**Yes. This is the strongest part of the submission and it is the part the
reports undersell.**

25 tools on `document.modelContext`, computed from
`PAILLETTE_TOOL_NAMES.length` and asserted by a registry test rather than
repeated in prose — which matters, because the number has been wrong in three
places twice already.

I audited the board-changing ones for an agent-only path and did not find one:

| tool | the human's own way |
| --- | --- |
| `flag_artworks` | `P` / `X` / `U` on the hovered card, or the corner badge |
| `redeal` | Enter on an empty bar — same function, same route, `by` flipped |
| `search_by_exemplars` | the engine behind both of the above |
| `compare_artworks` | `C` (`board-keyboard.ts:156`), pairing selection or hover-with-first-pick |
| `set_exhibition` / `write_labels` | the title, statement and labels are editable fields on the page |
| `annotate_atlas` | regions renamable and dissolvable in place |

And the agent's flags arrive **dashed and provisional**, not counted by the
deterministic redeal until the human confirms them. That is the detail that
makes "two operators, one board" true rather than rhetorical: the agent can
disagree in the human's own currency without being able to act unilaterally.

The activity log is the honest answer to *"how was WebMCP implemented"* and it
is better than a paragraph could be. `e2e3-01b-activity-log.png` shows the seven
calls that produced a board — name, arguments, duration, result count, remaining
quota — as an inspectable list a judge can open themselves. It does not
self-open mid-turn, which is the difference between a log and a chat.

The one honest asterisk: `write_labels` calls the model server-side, so it is
not an operation the human performs *identically* — they type their own label
instead. That is fine and it should be said that way rather than glossed.

---

## 6. Is the interface too wordy?

**No. This complaint has been answered, and I checked it properly rather than
eyeballing it.**

On a settled board after a typed instruction and a redeal, the visible text that
is not the artwork's own catalogue data is **49 words**, and here is all of it:

> Paillette · About · Log in · Create account · 🎤 · ↵ · 12 works · Copy link ·
> "warm landscape" · Sort: Relevance Colour Newest Artist Title · View: Masonry
> Salon Atlas Table · Settings 30/20 · End of results · *Experimental search,
> not an official catalogue; verify important details with linked source
> records.*

Twelve of those words are sort and view options — ordinary product chrome for a
collection search. There is **no helper text, no tooltip restating a control, no
onboarding copy, no empty state that lectures, and nothing narrating what the
agent is doing.** The two sentences that do explain the mechanism are both
`sr-only`, deliberately, with the reasoning written in the source. The share
button's own word changes and changes back instead of raising a toast; the
"working" state is a dimmed colour rather than the word "Copying…". This is
disciplined work and it should be credited.

Three residual offenders, all outside the board:

1. The homepage (§3) — every word of it.
2. **"539 FREE SEARCHES LEFT"** in a pill in the middle of the search hero. A
   quota readout is the mechanism narrating itself, in the most prominent slot
   on a cold page.
3. The disclaimer sentence in the footer — thirteen words, probably legally
   wanted, and the only prose left on the working page. I would leave it.

The design does not need a legend. `P X U` on hover after one second of use is
exactly the standard the brief set.

---

## 7. Does the whole loop work by typing alone?

**Yes, and I proved it again today by accident: every probe I ran was typed, in
headless Chromium, with no microphone on the machine.**

The typed sofa instruction alone fires the agent — five POSTs, no coaching, no
other interaction. `P`/`X`/`U`/`C`/Enter are keyboard. The share control is a
click. Nothing in the loop is gated on speech. Headless Chromium *does* expose
`webkitSpeechRecognition`, so the mic button renders and is simply ignored;
the turn dispatches as channel `text`.

Real speech recognition and speech-out remain unproven on this VM and cannot be
proven here — Chrome ships the audio to Google's service and there is no
microphone. That is correctly reported by every lane and it is not blocking,
because text is the primary path and the primary path works.

---

## 8. The single weakest thing a judge would notice first

**They press `X` on two pictures they don't like, press Enter, and nothing
happens.**

No movement, no message, no network request. They will assume the app is broken
and they will be right to. Everything else on this list is a defect; that one is
the demo dying in the first fifteen seconds, on the most natural gesture in the
product, at the exact spot the brief calls the headline beat.

Second place, only because it is more likely to be understood as an outage than
as a bug: the agent has answered `429 AGENT_UNAVAILABLE` to every turn for the
last hour, and I reproduced it at 09:00 UTC. `apps/api/wrangler.toml` sets
`AGENT_MODEL_CALLS_PER_HOUR = "600"` in `[env.staging]` but never sets
`OPENAI_DAILY_CALL_LIMIT`, so `parseLimit` falls through to
`DEFAULT_OPENAI_DAILY_CALL_LIMIT = 500` (`apps/api/src/utils/openai.ts:35`) — a
**site-wide** KV counter, one key per UTC date, incremented by every lane,
harness and visitor, resetting only at 00:00 UTC. The capfix lane raised one of
the two ceilings.

One thing the e2e report did not check, which narrows the diagnosis: I called
`POST /api/public-labels` directly and it also fails
(`LABELS_FAILED — The label writer could not be reached`). Every OpenAI-backed
route on the worker is down together, which is consistent with either branch but
means the curation half is equally unfilmable right now. Set the limit, redeploy
the api, and call one turn; if it still 429s, it is the key and it is the
owner's call.

---

## 9. Does the curation half actually work?

**Yes — the labelling half convincingly, the re-selection half only partly.**

I read the three by-hand batches rather than the summary tables, and the labels
are genuinely contextual. The best pair in the evidence, on one Bruegel print,
same works, same call, only the statement changed
(`verify-contextual-labels.mjs`, run against deployed staging by default):

> **Weather at Sea** — "The paired portraits bring weather into the exhibition
> through their Dutch titles, which name fair weather and a good hostess.
> Against the show's exposed seascapes, the close, hatched ovals suggest weather
> as something named, remembered, and shared between people."
>
> **Leaving** — "The two faces turn toward one another from separate oval
> frames, held close by the print's paired arrangement yet unable to meet. In an
> exhibition about leaving, that gap makes the portraits read like an exchange
> suspended at the point of parting."

Those are not the same sentence with adjectives swapped. Both are grounded in
the same physical fact about the print — two heads in separate ovals — and each
reads that fact through its own theme. The Du Maurier drawing turns three
independent times across batch 2 and the stereoscopic card turns from "maritime
labor legible through interruption" to "a record with a missing center". The
script exits non-zero if two labels come back identical. This is real, and it is
the clearest answer in the whole build to *"what can people and agents do
together that was hard before"* — nobody can write your exhibition for you, and
you cannot write it without the collection.

Three further things hold up:

- **The human's sentence survives verbatim**, marked `by: "human"`, `theirs:
  true`, in every run of every batch. An agent write onto a held field is parked
  as a proposal.
- **Committing the statement edit is itself the turn.** Batch 3 handed all three
  corrections over with nothing typed at the prompt bar at all, which is a much
  stronger demonstration than typing "again".
- **The title follows the correction.** *Weather at Sea* → *Before Leaving* /
  *The Hour Before* / *After the Door Closes*, 3/3. That was found broken in
  batch 2 and fixed.

And the honest accounting the lane did on itself is a credit to it: batch 1's
harness scored 3/3 on a criterion that only checked "the statement survived and
some tool was called", and the lane replaced it with one that requires a work
still hanging to carry a *different* label. Batch 3 run 3 is reported
**inconclusive** rather than passed or failed, with the reasoning. That is the
standard the e2e report's §4 did not meet.

**What does not work.** Re-*selection*. Integration's staging run reported the
correction turn as `2 works; 0 new, 2 dropped` — the board shrinks rather than
being re-selected. Curation's own batches are mixed (run 1 added one, run 2
dropped one, run 3 added three). The likely cause is named honestly in both
reports: `MAX_TURNS = 8` and a drafting turn routinely spends 5–6 of them
searching, so the correction turn runs out of budget before it can repopulate.
§5c asks for *"re-selects and re-labels"*; re-labels is excellent and re-selects
is currently closer to a deletion. I am not calling this blocking, because the
load-bearing half — the labels — is the half that proves the feature is not
decorative, and it is 3/3 twice over. But do not claim re-selection in the
submission text without a fresh run behind it.

One documentation drift to fix: `curation-report.md` §4 says *"Nothing is stored
on a server"* and describes `/exhibition?e=…` as the mechanism. That was true of
the curation lane and is no longer true of the merged build, where
`share-link.tsx` POSTs to `/api/exhibitions` for a seven-character code and only
falls back to the self-contained link. The layering is good design; the report
describing it is now wrong.

---

## 10. Is there a shareable exhibition page that survives a cold open?

**Yes, and I verified the whole chain myself today rather than inheriting it.**

`set_exhibition` with four works → click the real **Copy link** control → read
the URL off the real clipboard → open it in a browser context that has never
seen Paillette:

```
copied  : https://paillette-stg.berlayar.ai/e/dfbA3tE   (43 chars)
cold    : HTTP 200 · h1 "The Hour Before" · 4 <img> · 4 decoded (naturalWidth > 0)
          localStorage keys read: 0 · 114 words on the page
```

This closes the one gap the integration report left open — it had verified the
*read* path on three existing codes but explicitly not the creation of a new one
on this deploy. It works. Codes are seven characters from a base62 alphabet with
the ambiguous glyphs removed, rows live in D1 independently of the worker, the
loader re-fetches every record by id server-side so there is no session to
hydrate, and malformed codes 404 rather than half-drawing a show.

It is also designed, not merely functional (§4). The one thing that would make a
judge's version of this better than mine: with `write_labels` dead, my show had
no wall labels, and the page without them is noticeably barer than
`share-cold-open.png`. That is the 429 again, not the page.

Two admitted gaps worth carrying forward but not blocking: nothing has been
pasted into a real Slack or WhatsApp to see the unfurl card render (only curl
against the tags and the image), and the per-label provenance is colour-only, so
a colour-blind visitor cannot tell which hand wrote which label. A dashed rule
would fix the second without adding a word.

---

## 11. What would make this win that nobody has built yet

Three, in descending order of how much they change how the submission reads.
All are achievable tonight and none needs new server-side ML.

### A. Make a rejection sufficient on its own

This is blocker 2 and it is also the best idea available, which is why it is
first. Right now the product's position is *"tell me what you like and I will
find more"*, which is Rocchio and which everyone has. Make `X` alone work and
the position becomes *"you don't have to know what you want — you only have to
know what you don't"*, and the board moves anyway. Treat the unflagged works on
the current board as implicit positives; keep the negative term exactly as it
is. Then the demo's opening beat is a person rejecting three pictures without
typing a single word and watching sixty-three thousand works reorganise around
their distaste. No search box takes that input. No chat takes it either. It is
the most defensible answer to *"what is difficult or impossible before"* in the
whole build, and it is currently a `return fail(…)`.

### B. Draw the disagreement instead of writing it

The "gestures outrank words" moment is currently a *sentence*, which means its
credibility rests entirely on the model, which is exactly why it keeps coming
back generic. Make it structural. When the agent's provisional `flag_artworks`
lands on a work the human has already flagged the other way, let both marks
render on the same card: the human's graphite `X` and the agent's dashed cyan
`P`, in the same corner, at the same time. A card wearing two contradicting
marks is a picture of two operators disagreeing that needs no prose, cannot be
hallucinated, and survives a judge trying it themselves with the model turned
off. It is a CSS rule and permission for a provisional flag to coexist with a
confirmed one — and it turns the riskiest claim in the submission into the one
frame in the video that cannot be faked.

### C. Put the declined pile on the shared page

§6 promises the artifact includes *"a considered-and-declined pile"*, and the
tray on the board is exactly that — and it dies with the tab. The share payload
already carries ids and the renderer already resolves every id server-side, so
carrying the rejects costs a field and a `<section>`. At the foot of the
exhibition, under one word, a small greyed contact sheet of what was thrown out.

That is the difference between publishing a gallery and publishing an argument.
Every other entry's output will be a list of things a model liked. This one
would ship with its own negative space attached — the shape of somebody's taste,
which is the only thing on the page neither party could have produced alone.

---

## What the fix phase should do, in order

1. Set `OPENAI_DAILY_CALL_LIMIT` in `[env.staging]`, redeploy the api, call one
   turn, and record the status. Nothing agentic can be judged until this is
   done, including the labels.
2. Make a rejects-only redeal deal (§1). Then Enter after two `X` presses moves
   the board, and the agent's `redeal` stops silently falling back to a search
   of its own invention.
3. Send the gesture payload on every request of a turn, not only `turn === 0`
   (`agent-prompt.tsx:396`).
4. Re-run the note check three times with 2 and 3 both fixed, and put the
   rejected works' titles, media and palettes next to each note in the report so
   the grounding can be read rather than asserted.
5. Correct §4 of the e2e report so it says only what `notes-B.json` supports.
6. Move the note clear of the sticky search toolbar, or drop the toolbar's
   stickiness while a note is on screen.
7. Point the submission link at `/nga/search`, and if there is any time left,
   replace the homepage hero with the board.

## What is already good enough to stop working on

The deterministic redeal and its animation. The two-up room. The activity log.
The share chain and the exhibition page's typography. The contextual labels. The
restraint — 49 visible words, no helper text, marks instead of captions. The
test suite: 97 files, 1198 tests, green, roughly double the baseline, nothing
deleted or skipped to get there.

None of that is the reason this is a FAIL. The reason is that the one gesture
the brief calls non-negotiable does nothing, and the narrator that would cover
for it has been offline for an hour.
