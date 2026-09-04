# Critique — iteration 5

Written 2026-09-04, against `night/integration` at `944e94d`, and against
**https://paillette-stg.berlayar.ai** (web `579886d4`, api `9995af12`) — the
same deploy the iteration-5 integration and e2e reports were written against.

**Everything numbered below that is attributed to me was measured by me, in a
real browser, on that deploy, tonight.** Six typed loop runs, four exhibition
runs, one word census, seven published exhibition pages opened cold. The probes
are in `~/.local/state/rucksack/scratch/crit5/`. I changed no source code.

**Verdict: FAIL**, and the shape of the failure is different from iteration 4's.
The mechanism is now *better than the reports claim* — I found a behaviour
nobody has recorded that is the best thing in the build — and the two halves
that the reports claim most confidently are the two that do not hold up when a
stranger drives them.

---

## 0. The structural fact that explains most of this

**There was no fix phase between iteration 4's verdict and this critique.**
`pipeline.log` goes `14:14:34 verdict: FAIL (iteration 4)` → `=== iteration 5 ===`
→ integrate (14:14–14:41) → e2e (14:41–15:12) → critique. The only application
code that changed in that window is two commits, both of which were *nice-to-have*
items in iteration 4's verdict:

```
7dd250c fix(search): the caret lets go of the catalogue field once a board is dealt
4e79c6c fix(compare): Escape leaves the two-up without answering it
```

Both are real fixes and I verified both myself (§2, §7). But all four of
iteration 4's **blocking** items are untouched, and two of them the integration
report says so in its own words (§6.2, §6.3). `apps/api/src/routes/agent.ts` has
not been edited since iteration 3. `MAX_TURNS` is still 8.

So a fair reading of this iteration is: it was a measurement pass, and a good
one. The e2e lane in particular did the single most valuable thing anyone has
done tonight — it caught itself nearly publishing the opposite of the truth on
the central claim, and wrote down the method that settles it. That is the right
instinct. It just was not a *fixing* pass, and the punch list has not moved.

---

## 1. Is this still delegation wearing a costume?

**No. It genuinely got past it, and I can point at the behaviour.**

Two things happen here that a search box and a chat window cannot both do, and I
ran both myself tonight from a cold browser with no debug flag:

**The loop runs with the model switched off.** Silence-gated — I waited until
`/api/public-agent/turn` had been quiet for 20 s, then timed everything from the
keypress:

```
NO-MODEL-CALL: modelCallsAfterEnter=0  exemplarCalls=1  firstExemplarAt=+29ms
```

Three human picks, Enter on an empty bar, one POST to the Rocchio engine 29 ms
later, twelve cards deal. Zero to any model. That is the brief's §3 claim —
"the agent is not the mechanism; it is a second operator of the same mechanism"
— demonstrated off the wire. The e2e lane got the same result 4/4 with a better
harness than mine.

**And the agent then reads a board the human's hands made without it.** This is
the part that stops it being delegation: the human's gestures are the input and
the agent's language is the output, which is the inverse of "ask → search →
receive". Verbatim from my own runs, unedited:

> "Following the pick: the pale amber watercolor flower holder, not the darker
> oil still life or peach."

> "Following the pale watercolor meadow: the darker gold oil landscapes were
> rejected."

So: the answer to question 1 is yes, and it is not close. **But it is only half
the thesis.** §P1 says "the agent flags so it can *disagree* in the same currency
the human uses". That half has never happened. See §5 and blocking item 1.

---

## 2. Does the "gestures outrank words" moment actually happen?

**Yes — and it is better than anything in the reports, because nobody tested
it.** This is the most important finding in this critique.

Every note quoted in every e2e report is a *reject-naming* note: the human threw
out two warm works, and the agent named them. That is grounding, and it is real
— I confirmed it 4/4 in my own runs and read the palettes and media off the wire
to check every adjective. But it is **not** the behaviour §3 calls "the clearest
thing in the build that is genuinely impossible elsewhere." That behaviour is the
*conflict*: words say one thing, hands say another, and the agent follows the
hands and says so. **No report tonight tested it.** So I did.

Protocol, `probe-conflict2.mjs`: type an instruction that returns a warm board;
press `P` on three warm works; then type *"I want something cool and blue and
severe. Nothing warm."* — so the turn arrives with cool words and three warm
picks. Two runs, cold contexts, typed, no coaching:

**Run c2.** Picked *Harvesters by Firelight*, *An Indian Encampment at Sunset*,
*Clouds at Sunset*. The agent's wall label:

> **"You said blue, but picked three amber-brown sunset drawings and paintings;
> following the picks."**

**Run c3.** Picked *A Corner of the Artist's Room, Rue Terre Neuve, Meudon*,
*Harvesters by Firelight*, *An Indian Encampment at Sunset*:

> **"You asked for blue, but picked three ochre-and-amber watercolors;
> following the picks."**

Both grounded — three sunsets, amber-brown, and c2's "drawings and paintings" is
correct on the mixed media. (One caveat worth writing down: c3's "watercolors" is
a guess about medium that I could not confirm for all three. c2's phrasing is the
safer one and it is the one to film.)

**And the board obeyed the gestures, not the words.** `c2-gapnote.png`: the three
picks hold positions 0–2 with graphite hairline frames, and the nine newcomers
are *Clouds at Dawn*, *Marsh Landscape at Twilight*, *Landscape with Storm*,
*Vicinity of Morestal* — amber and dusk, not blue. The engine followed the picks
while the words asked for the opposite, and the sentence above the board says
exactly that.

**This is the video.** It is one screen, it takes eleven seconds, and it is the
only moment in the build that no search box and no chat window can produce,
because neither has both signals. It is not in the shot list, not in any report,
and not in `docs/night/shots/`. Put it first.

The one blemish: it needs a second typed turn to fire, and that turn costs 3–4
model calls and 8–14 s. On camera that is a beat of dead air. Nothing to fix
tonight, just something to cut around.

---

## 3. Would a judge who opened staging cold reach the good part?

**No, on two counts, and the first is trivially fixable.**

**The bare domain does not link to the submission.** I opened
`https://paillette-stg.berlayar.ai` in a fresh context. Title: *"Paillette -
AI-Powered Gallery Platform"*. Heading: *"Powerful Features"*. Emoji feature
cards. The complete link set:

```
/try  ·  /collections  ·  /translate  ·  /try  ·  /collections
🌏Multi-Language…/translate  ·  /docs/api  ·  github.com/erniesg/paillette
```

`/nga/search` appears nowhere in the document. This was iteration 4's finding
verbatim and it is unchanged. If the judge is handed the deep link it does not
matter; if they are handed the domain, they never see the app.

**On `/nga/search` itself, the affordance points at the wrong field.** The cold
page (`shots/search-cold.png`) leads with a large serif *"search by feeling, era,
subject…"* at the optical centre. "Ask the agent" is small, grey, below a
divider, at the foot, next to a 🎤 emoji. §5 says "one field, two inputs… there
is nothing to switch because there is one field." There are two, and the
prominent one is the ordinary catalogue search. A judge types into the big one
and gets a search results page.

What *does* work: hovering a card shows `P X U` badges, so the culling keys are
discoverable in about a second without a word of prose. That is exactly the §5b
discipline and it is well done.

What has no affordance at all is **Enter on an empty bar** — the headline
behaviour, the one the whole WebMCP argument rests on. There is no mark, no
position, no hint. A judge will not find it. I am not asking for helper text;
I am saying the design has not yet solved it, and §5b's own rule is that when
something needs explaining the design is wrong.

---

## 4. Do the visuals hold up?

**The two-up room and the exhibition header: yes, genuinely. The board: no.**

The two-up (`e2e5-06-two-up-room.png`) is the best-composed screen in the
product — two large works on charcoal, the question in serif, one control,
nothing else. §7.3 exactly.

The exhibition header, at native resolution, is the best-designed thing in the
submission full stop: a serif title, the human's own sentence behind a hairline
rule, `12 WORKS` in mono, and a great deal of silence. I would put that on a
slide.

**The board is a competent grid with the lights off, and I can give you the
number.** I measured every card on a dealt board on staging:

```
img 268x58   imgArea 15670   captionArea 18961   card 34631   img/card 45%
```

Identical on all twelve. **The caption block is larger than the picture on every
card.** §7's ground is a light table and its first rule is that the works are the
only saturated thing on screen; on the actual board the catalogue text outweighs
the artwork 55:45, the images render as a thin letterboxed band, and the artist
name is set as a **blue underlined link** — a third ink that reads as web
furniture, not as a wall label. `shots/census-board.png` and
`shots/c2-gapnote.png` both show it.

Ironically the visuals lane's own `/night/deal` harness
(`docs/night/shots/06-deal-settled.png`) is better composed than the product it
was ported into. That was iteration 4's nice-to-have; it is still true, and I am
promoting it, because "the visuals are something you would be willing to put in
front of a judge" is a PASS clause and the board is the screen the film lives on.

---

## 5. Is the WebMCP story real?

**The "one workspace, two operators" architecture is real and it is the
submission's best technical argument. The claim that both operators actually
operate it is not supported by any evidence anyone has produced.**

Real, and I checked it: 25 tools on `document.modelContext`; every one of them
wraps something the human can also do; `redeal` is literally the same function
Enter calls; `search_by_exemplars` answers for its own scoring when you ask it.
There is no agent-only path. That is a strong, honest, distinctive answer to
"how was WebMCP implemented."

Not supported: **the agent has never chosen to flag or to compare.** A census of
every transcript the night produced, plus the one new file from iteration 5
(`/tmp/e2e6/compare/turn-bodies.json`) — **508 model-chosen tool calls**:

```
search_artworks 192 · search_by_color 92 · get_view_context 61 · set_results 56
set_view 50 · list_collections 42 · redeal 15
flag_artworks 0 · compare_artworks 0 · search_by_exemplars 0
```

Unchanged from iteration 4's 484. I did not stop at the logs. I drove staging
myself with the two most natural invitations a person would type after flagging:

- *"Narrow these down for me — I can only hang one."* → agent marks 0, compare
  room not opened, a sentence written.
- *"I'm torn. Help me decide."* → agent marks 0, compare room not opened, a
  sentence written.

Both times the agent narrated and touched nothing. Every demonstration of
`flag_artworks` and `compare_artworks` in every report tonight — including the
integration report's own two-hands frame at §6.2 — was driven through
`window.__paillette_webmcp.call(...)`, the debug console. That is the back door
presented as behaviour, and it is precisely the failure mode the owner's standing
instruction names.

The consequence is concrete: §7.2 says "Every screenshot shows two hands. No
legend needed after the first second." On the boards I produced by typing, the
agent's contribution is one cyan sentence and nothing else. There is no frame in
which two operators have both marked the board, because the agent has never
marked one unless a console told it to.

---

## 6. Is the interface too wordy?

**There is no prose defect. There is a chrome defect, and it is 48 words.**

Credit where it is due, because this is the owner's standing complaint and the
build has actually obeyed it. I looked for every one of §5b's prohibitions on a
dealt board and found **none**: no helper text, no tooltip restating a control,
no onboarding copy, no empty state that lectures, no chrome narrating the
mechanism. The `exhibition-head.tsx` comment explaining why there is *no*
placeholder is the right instinct written down. Every agent note I saw tonight —
about twenty — was one sentence. The writing discipline is genuinely good.

The frame around it is not. Word census on a dealt board at 1440×900, counting
only visible leaf text, excluding anything inside a card and excluding the
agent's sentence: **48 words**, of which **23 sit in a single band directly
between the human's bar and the agent's note**:

```
10 | works | Copy link | 12 / 12 works | Sort | Relevance | Colour | Newest |
Artist | Title | View | Masonry | Salon | Atlas | Table | Settings | 30 / 20
```

with `Log in` and `Create account` above them, `Experimental search, not an
official catalogue; verify important details with linked source records.` below,
and `END OF RESULTS` under the board. **Ten distinct text colours on screen**
where §7 specifies two inks on charcoal.

The `VIEW` row is worse than noise: it offers Masonry / Salon / Atlas / Table
while a board is dealt, and choosing any of them destroys the board. It is a
control that undoes the thing the screen is for.

Does the design need a legend? On the board, no — the badges and the frames read
in a second. On the *cold* page, effectively yes: nothing tells you which of the
two fields is the interesting one, and nothing at all points at Enter.

---

## 7. Does the whole loop work by typing alone?

**Yes. This is properly proven and it is not in doubt.**

All six of my staging runs were typed; the mic was never pressed. The e2e lane
proved the negative half of the symmetric rule the right way — it wrapped
`speechSynthesis.speak` before any page script ran and measured **0 calls** on a
typed turn. Not one beat of the loop needs speech.

The `7dd250c` caret fix is load-bearing here and I confirmed it: I pressed `P`
and `X` on a page as it arrived, with no Escape and no wake-up click, in six
runs, and got `pick/human` and `reject/human` every time. Before that fix the
culling keys were dead on a cold load and four iterations of green reports
missed it because every harness clicked first. That is a good catch.

Real speech remains unproven — no microphone on this VM — and the reports say so
plainly rather than claiming it. The live-voice lane's own summary is equally
blunt: *"everything audio… has never met a microphone."* Scope the submission's
voice language to what has been shown, or film one spoken take on a real
machine.

---

## 8. What is the single weakest thing a judge would notice first?

**That the human's own Enter erases the agent's sentence, and the board slides
up into the gap.** Not because it is the largest defect — the agent never
proposing is larger — but because it happens *in the beat the whole submission
is built on*, and it is the one a judge will hit within thirty seconds.

The e2e lane found it and closed the arithmetic exactly: the note's wrapper
carries `empty:hidden`, the deterministic redeal writes no note, so 44 px of
sentence plus 12 px of margin collapse and every card moves 56 px. I reproduced
the erasure **3/3 in my own runs** (`noteAfterRedeal=null` every time), and on
screen — with the exhibition strip's own movement added — the pick travelled
**450→192 px** in one run and **497→192 px** in another.

Two consequences, and the second is the bad one:

1. §7.1 calls the deal "the single most important visual in the submission" and
   its entire content is that the picks do not move. They move.
2. **The thesis is "the board is the transcript," and the human's own Enter
   deletes the transcript.** Compare `e2e5-13` and `e2e5-14`: before, a cyan
   wall label over twelve works; after, twelve works and silence. Two inks
   become one at the exact moment the submission wants to say "two hands."

---

## 9. Does the curation half actually work?

**The labels are genuinely contextual — that half is real and I checked the raw
evidence, not the prose. The correction loop does not work reliably on today's
deploy: I got it once in three attempts.**

**What is real.** `curation-evidence/contextual-labels.txt` shows 3/3 works
getting a substantively different label under *Weather at Sea* versus *Leaving*,
and these are not rewordings. The Bruegel pair: *"the print shifts weather into a
human exchange: a condition imagined through companionship rather than an open
horizon"* versus *"held close by the print's paired arrangement but never
meeting. Their separation gives the exhibition's moment of departure a fixed,
formal shape."* That is the same object read twice. The feature is not
decorative.

**What does not hold.** All of that evidence is round-1 work from a lane that
died in the 07:41 reboot, run against that lane's own deploy, before the
integration lane redeployed the api at 14:33. So I ran §5c myself, four times,
on today's staging:

| run | draft | works added | works dropped | labels re-written | title |
| --- | --- | --- | --- | --- | --- |
| x1 | **never drafted** — title, statement and works all null after 150 s | — | — | — | — |
| x2 | ok | **0** | 0 | landed, but **weather-themed** | unchanged |
| x3 | ok | **0** | 0 | **0 in 180 s** | unchanged |
| x4 | ok | **+6** | −6 | **8/8** | *Weather at Sea* → **The Shape Left Behind** |

**Run x4 is the feature working, and it is excellent.** The human replaces the
statement with *"It is not about weather. It is about leaving — the hour before
someone goes, and the room that keeps their shape after they have gone."* Six
storm pictures leave; *East Side Interior*, *Das leere Café (The Empty Café)*,
*The New York Window*, *L'Inquietude*, *A Corner of the Artist's Room* and *Les
Salles des Gardes* arrive — empty rooms, exactly the human's second clause. The
title is rewritten. The two survivors are re-labelled around leaving:

> before: "Gray wash and dense linework give wind and cloud as much force as the
> two ships… how quickly the storm has swallowed the open [sea]"
> after: "Two ships strain through choppy water while a smaller vessel recedes in
> the distance. The ink and gray wash hold them at the uncertain point between
> **departure and disappearance**."

> before: "…placing working movement on water at the center of the scene."
> after: "…making the harbor a place of **watching rather than arrival**. The
> painting catches the interval when vessels are still **visible but already
> leaving**."

And the statement comes back `by: "human", theirs: true`, verbatim. The
provenance rule works.

**Run x2 is the feature failing in the way that is worst on camera.** The human's
sentence — *"It is not about weather"* — sits at the top of the page, and the
labels beneath it read *"a sky crowded with storm cloud"*, *"where navigation
gives way to wreck"*, *"the exhibition's sense that **weather** can overwhelm
human control"*. The wall argues with its own wall text. That is not a missing
feature; it is a visibly wrong one.

**Run x3 is the feature doing nothing.** 180 seconds, 0 labels, 0 works, title
unchanged. The statement field committed (`by: "human"`), so the write landed;
the turn either never fired or spent itself. The curation report already names
the likely cause and I agree with it: `MAX_TURNS = 8` with 5–6 routinely spent
searching, so the correction turn starves. My x4 run took **60 s** to re-title
and **24 s** to re-label; my x1 drafting turn produced nothing in 150 s.

**And there is a defect underneath all of this that nobody has reported.** In
x4 the six newly-selected works arrived **with no labels at all** — `labelBy:
null`, empty strings — and none were written in the following 40 s. The
re-selection and the re-labelling are two tool calls and the second only covers
the works that were already there. That is not a cosmetic gap: see §10.

---

## 10. Is there a shareable exhibition page?

**It exists, it opens cold, and the design is the best thing in the submission —
but the majority of the shows actually published have no wall labels on them.**

I opened all seven `/e/:code` URLs the reports name, each in a fresh browser
context with nothing in storage:

| code | title | HTTP | images | statement | agent-written labels |
| --- | --- | --- | --- | --- | --- |
| `MKwsxHy` | Everything the Light Left Behind | 200 | 6/6 | **human, 45 w** | **yes — and one human-written label** |
| `aWp7U3z` | The Amber Room | 200 | 12/12 | agent, 65 w | yes |
| `exYNx8X` | Everything the Light Left Behind | 200 | 3/3 | — | yes, incl. *"Mine. I put this one in because of the cart."* |
| `HcLSkLr` | The Amber Table | 200 | 12/12 | human, 21 w | **none — 12 works, 0 labels** |
| `QWwJnL5` | The Warm Side of Light | 200 | 12/12 | agent, 70 w | **none — 12 works, 0 labels** |
| `dfbA3tE` | The Hour Before | 200 | 4/4 | human, 26 w | **none** |
| `wycy7SS` | Leaving | 200 | 3/3 | **none** | **none** |

(My first pass reported 7/12 images on `aWp7U3z`; that was lazy-loading and my
ruler. With a full scroll and a 9 s wait every image on every page loads. The
pages are fine.)

**Four of seven published shows carry no wall labels whatsoever** — just
catalogue data and a *Catalogue record* link. And the two that look most like
real exhibitions, the twelve-work ones, are exactly the two with nothing written
on them. §9's last finding explains why: works added after `write_labels` are
never labelled, so any show whose last action added works ships blank.

That matters more than any other item on this list, because the exhibition page
is the *deliverable* of §5c and the only artifact that survives the tab. The
contextual wall label is the whole claim, and on the page a judge would actually
open, it is usually absent.

`MKwsxHy` is what the feature looks like when it works, and it is very good: the
human's statement in serif behind a rule, agent labels — *"The valley empties of
light before anyone has decided to go."*, *"A stopping place, which is not the
same as an arrival."* — and one label the human wrote themselves, *"Two people
sitting for a picture that will outlast the room."* Two hands, permanently, for
anyone with the URL. That is the page to film. Make the others look like it.

One smaller thing: the provenance *is* in the DOM as `data-provenance="human"` /
`"agent"`, but it is not rendered as ink. The two-hands information is present
and thrown away at paint.

---

## 11. What would make this win that nobody has built yet

Four, in the order I would build them. All use data that already exists.

**A. Let the deterministic redeal write its own sentence, and make the mechanism
the second voice.** `redeal`'s schema already carries `note?: string`. Today
Enter deletes the wall label and the board goes silent; the cheap fix reserves
the row and leaves it blank. Do the better thing: have the *engine* write one
line — *"Two rejects held. Ten works away from red chalk and firelight."* — with
no model call. That kills the 56 px jump, keeps a label on the board at the
headline beat, and turns the submission's worst defect into its clearest proof:
**the board still speaks with the model switched off.** Nobody else can show
that, because nobody else has a deterministic operator to give a voice to.

**B. Draw the disagreement instead of writing it.** My §2 finding is currently
*prose* — one cyan sentence saying "you said blue, but picked amber." Make it a
*mark*. When the agent detects the gap it should put dashed cyan flags on the
works that contradict the words, so the screen shows three graphite `P` badges
and three dashed cyan question-marks on the same cards. One card wearing two
inks is a picture of two operators disagreeing that needs no legend, cannot be
hallucinated, and survives the model being switched off because the mark is
already in the DOM. Pair it with fixing "the agent never proposes" and the
riskiest claim in the submission becomes its most photographable one.

**C. Publish the argument, not the gallery.** The exhibition page is the only
artifact that outlives the tab, and right now it publishes the *result*. Publish
the *collaboration*, from data already stored and discarded at render:
(1) the agent's drafted statement with a rule through it and the human's
replacement set beneath as the wall text it became; (2) the said/chose sentence
printed once in the colophon — *"You said blue; you picked three amber sunsets.
Following the picks."*; (3) the considered-and-declined pile as a small greyed
contact sheet at the foot under one word; (4) the stored per-field provenance
rendered as a hairline in each party's ink. A judge opening that URL gets the
entire thesis with no live demo, no model call, and no risk of the app being
down. Every other entry with a share feature will publish a page of pictures.
Only this one has a record of two operators to publish.

**D. The idea I would actually bet on: make the published page executable.**
Put a single mark on the exhibition page that deals its picks onto a fresh board
in the reader's own browser — the exemplars call already exists, it needs no
account, and it costs no model call. Then the shared object is not a page, it is
**a position in a 63,253-work collection that a stranger can continue from**.
Someone opens your show, disagrees with two works, presses `X` twice and Enter,
and the collection moves under *their* hands from where *your* taste left it.
That extends "people and their agents use it together" past one session and past
one person, it is one route parameter and one existing call, and it is the only
thing on this list that would make a judge send the link to somebody else.

---

## What I verified myself, so the fix phase knows what not to re-check

| claim | result | how |
| --- | --- | --- |
| Enter on an empty bar makes no model call | **holds** | silence-gated, 0 calls, exemplars at +29 ms |
| `P`/`X` work on a cold page with no Escape | **holds** | 6/6 runs, `pick/human` / `reject/human` |
| the note names the content of the rejects | **holds** | 4/4 my runs, media and palettes checked on the wire |
| gestures outrank words, and the agent says so | **holds, and is unrecorded** | 2/2, verbatim in §2 |
| the board follows the picks against the words | **holds** | `c2-gapnote.png`, 9 amber newcomers after a request for blue |
| Escape leaves the two-up without flagging | **holds** | `4e79c6c`, confirmed deployed |
| exhibition pages open cold | **holds** | 7/7 → 200, all images load |
| the agent chooses `flag_artworks` / `compare_artworks` | **never observed** | 508 transcript calls + 2 live natural probes |
| the redeal keeps a wall label on the board | **fails** | 3/3, `noteAfterRedeal=null` |
| picks visibly hold their place | **fails** | 450→192 px, 497→192 px |
| the correction re-selects and re-labels | **1 in 3** | x1 no draft, x2 wrong labels, x3 nothing, x4 works |
| newly selected works get labels | **fails** | x4: 6 works added, 0 labelled |
| `e2e5-02` shows the human's line above the agent's | **false** | cropped at native res; it is not in the frame |
| the site root reaches the app | **fails** | `/nga/search` appears in no link on `/` |
