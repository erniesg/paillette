# Critique — iteration 4

Read: `BRIEF.md`, every `docs/night/*-report.md`, the shots in `docs/night/shots/`
and `docs/night/shots/e2e4/`, and the raw transcripts under
`docs/night/e2e-evidence/`.

**Nothing here is taken from a report.** Every claim below that says "measured"
or "I ran" was run by me against
**https://paillette-stg.berlayar.ai** between 13:40 and 14:55 UTC on
2026-09-04, in a headless Chromium at 1440×900, against the live 63,253-work
index, with nothing stubbed. Probe scripts are in `/tmp/crit/` on this VM (not
committed — they touch no application code, which this phase is forbidden to
change). Where a report is right, I say so; where a report claims more than its
own evidence carries, I quote both.

Staging is running `28a37ee`. `git diff --name-only 28a37ee..HEAD -- apps
packages` is empty, so the deployed page is byte-identical in application code
to this branch. The e2e report checked this too and was right.

---

## The short version

The mechanism is real and I could not break it. I verified the two hardest
claims in the submission myself, from scratch, and both held:

- **Enter on an empty bar redeals from flags with no model call.** Cold page, no
  `?webmcp-debug`, two `X` presses and *zero* picks: one
  `POST /api/public-search/nga/exemplars`, **zero** requests to
  `/public-agent/turn`, twelve cards back, both rejects in the visible tray, no
  page errors. Iteration 3 failed the submission on exactly this being a dead
  key. It is not dead any more.
- **The agent's note is grounded in the content of the flags.** Three fresh
  runs of my own, quoted in §2 below. It names media and palettes that are
  actually true of the actually-rejected works. It is not a generic line.

So this is not hollow, and it is not delegation in the plain sense. It fails on
three narrower things, and one of them is the kind of failure the owner's
standing instruction is aimed at: **a claim that outruns the evidence.**

The agent never proposes. In **484 model-chosen tool calls across every
transcript in the night's evidence**, `flag_artworks` was called **0** times and
`compare_artworks` **0** times. Both are wired, both are in the system prompt,
both work — and every demonstration of either in every report was driven through
`window.__paillette_webmcp.call(...)`, the debug console. The half of the thesis
that says the agent *disagrees in the human's own currency* has never been
observed happening on its own.

**FAIL**, narrowly and late, with a fix list that is three items long.

---

## The eleven questions

### 1. Is this still delegation wearing a costume?

**Mostly no. The escape is real, and I can point at the behaviour.**

Delegation is: human asks → agent searches → human receives. The thing that is
not delegation is that **the human's hands change the board with no agent in the
loop at all**, and the agent then has to write about a board it did not choose.

I ran it cold, no debug flag, no query string, on a plain browser context:

```
flags:    X on Environs de Cremieu, X on Lake Albano Sunset   (0 picks)
Enter on an empty bar
requests: POST /api/public-search/nga/exemplars      <- one
          ... 10 IIIF images ...
          GET  /api/public-search/nga/quota
model calls to /public-agent/turn:  0
result:   12 cards, 2 in the left tray, 0 page errors
```

That is Rocchio relevance feedback driven by two keystrokes, and it is the
strongest WebMCP argument in the build, because the agent's `redeal` tool goes
through the *same* route — `apps/web/app/routes/api.public-search.$orgId.exemplars.ts:8`
says so in a comment and I confirmed there is no second endpoint. One workspace,
two operators, and the human's operator works with the model switched off.

The narration half is also real. After those two rejects, one neutral turn:

> **"You rejected the two gold-and-umber landscapes, including a watercolor and
> a sunset; moving toward lighter, quieter warmth."**

*Environs de Cremieu* is a watercolour. *Lake Albano, Sunset* is a sunset. Both
are gold-and-umber. The agent is reading the flags, not the transcript.

**Where it is still delegation:** the reciprocity is one-directional. The human
gestures and the agent narrates; the agent never gestures back. See §5 and the
blocking list. Right now the loop is *human points → engine acts → agent
speaks*. The brief's picture is *both parties point*. Half of that is shipped.

### 2. Does the "gestures outrank words" moment actually happen?

**Yes, and it survived my trying to catch it out.** This was the most likely
way the submission was hollow and it is not.

The check that matters is whether the note names the *content* of what was
thrown out, or emits a line that would fit any board. I ran three fresh
instructions of my own, on boards I had not seen, and printed the flagged works
beside the note each time:

| rejected / picked | the agent's sentence |
| --- | --- |
| ✗ *Environs de Cremieu* (Ravier, watercolor) · ✗ *Lake Albano, Sunset* (Inness) | "You rejected the two gold-and-umber landscapes, **including a watercolor and a sunset**; moving toward lighter, quieter warmth." |
| ✓ watercolour · ✓ oil landscape · ✗ etching | "Following your picks: **a pale rust-and-bone watercolor and an olive oil landscape, away from the brown etching**." |
| ✓ *The Dawn of Creation* (ink drawing) · ✗ two darker landscapes | "You asked warm, but **kept the charcoal ink drawing and rejected the two darker painted landscapes**; following that spare tonal line." |

Every one names a medium or a subject that is true of the specific work, and the
third names the said/chose gap unprompted. Swap the board and these sentences
stop making sense — which is the test.

The lanes' own evidence agrees and is better than mine: `notes-e2e4-paced.json`
and `fix-iteration-4/notes.json` carry **6 for 6** with the rejects' titles,
media and hex palettes printed alongside, and I re-derived them from the raw
JSON rather than reading the table. Run 3's *"the rejected peach and flask:
their saturated amber-brown object studies"* against `#C3803A #7E3F0F` and
`#BF894D #885E39` is the strongest single instance in the pack.

Iteration 3 got 0 for 5. This is a change of kind, not a change of degree, and
`9b1fa61` (flags kept in context for the whole turn) is why.

**One honest caveat.** The integration walk's own note called a *Drawing* a
"painted landscape". Grounded with one wrong word. It misdescribes media
occasionally; it does not invent boards.

### 3. Would a judge who opened staging cold reach the good part?

**Yes — better than I expected, and I tested the actual cold path rather than
reasoning about it.**

Bare `https://paillette-stg.berlayar.ai/nga/search`, no query, no flag, fresh
context, zero artworks on screen. Typed the sofa sentence into "Ask the agent",
pressed Enter:

```
23.2 s -> 12 cards + "A warm, unhurried hang: fruit, vessels, and open ground
                      in amber, cream, and softened earth tones."
then hover, X, X, Enter on the empty bar -> 12 cards, 2 in the tray
```

No incantation. `?webmcp-debug` is *not* needed — the host is claimed on every
visit and only the console back door is behind the flag. That was iteration 2's
tenth blocking item and it is properly fixed.

**The two frictions a judge will actually hit:**

- **Two live text fields.** Measured on the cold page: `search by feeling, era,
  subject…` and `Ask the agent`, both visible, both accepting Enter. §5 says
  "there is nothing to switch because there is one field." There are two, and
  they are still both in the money-shot frame. A judge typing the sofa sentence
  into the serif one gets a literal text search and never meets the agent.
- **Nothing says press X.** The `P | X | U` badge appears on hover, which is the
  only hint. A Lightroom user reads it in a second; nobody else will hover long
  enough to find out. This is defensible — it is a mark, not prose — but it is
  the one place the loop depends on prior knowledge.

The site root is still a different product: *"AI-powered multimodal search and
management platform for galleries worldwide"*, *"Powerful Features"*, six emoji
feature cards, nothing linking to `/nga/search`. Flagged in iteration 3, still
there. Point every submission link at `/nga/search` and this stops mattering.

### 4. Do the visuals hold up?

**Split. The exhibition page is the best thing in the submission. The board is
competent and sits inside the wrong frame.**

I opened `/e/aWp7U3z` in a fresh browser context that had never seen Paillette
and shot it at 1440×900 and 390×844. It is genuinely designed: serif "The Amber
Room" over a near-black ground, the statement in a rule-marked block, `12 WORKS`
in tiny mono, then works alternating left and right at large scale with mono
catalogue blocks and a serif label each. It reads like an editorial photo essay,
not a CMS output. All twelve IIIF derivatives return 200. I would put this in
front of a judge without hesitation. *(My first pass reported three broken
images; that was lazy-loading on a 9,088 px page, not a defect — the URLs are
all live.)*

**The board is the weaker half, and the problem is the frame around it, not the
deal.** In the actual money-shot frame, on screen, at the same time as the
pictures:

- `Log in` and `Create account` buttons, top right
- `SORT · Relevance · Colour · Newest · Artist · Title`
- `VIEW · Masonry · Salon · Atlas · Table`
- `Settings 30 / 20`

That is a database results toolbar sitting **between the human's sentence and
the agent's sentence**, in every frame of the film. There is also a magenta
`● TEXT warm landscape` chip and a magenta logo, so the screen carries three
colour systems where §7 specifies two inks on charcoal.

Second, the works are not the only saturated thing on screen and they are not
the biggest thing either. On the dealt board the thumbnail is routinely smaller
than its own caption block — *Candlestick*, *Flower Holder* and *Flask* are
roughly 25 × 40 px objects floating in a card whose title-and-artist slab is
several times their area. §7's ground is a light table; this reads as a search
results grid with the lights off.

The deal itself is good and I am not disputing it: 19–27 distinct layouts per
redeal where a jump cut measures 4–5, measured every animation frame by the e2e
lane on `/nga/search` and not in the harness. That is the money shot and it is
in the product.

`docs/night/shots/06-deal-settled.png` — the visuals lane's `/night/deal`
harness — is *better composed* than the product: uniform slots, larger pictures,
and the ledger filmstrip along the bottom. The filmstrip is still wired to
nothing in the product. That is a §7.5 deliverable sitting on the floor.

### 5. Is the WebMCP story real?

**The architecture is real. The behaviour is half of what the reports say it
is, and this is the blocking finding.**

What is genuinely true, and is a better answer than most entries will have:

- 25 tools on `document.modelContext`, registered on every visit, no flag.
- **No agent-only path.** The human's Enter and the agent's `redeal` tool hit
  one route. I checked for a second endpoint and there is none.
- Every tool wraps something the human can do. I tested the keyboard side by
  hand rather than assuming: `P` picks, `U` clears it, shift-click two cards and
  `C` opens the two-up (`data-compare-open="true"`, the serif question rendered
  between the works). So `flag_artworks`, `redeal` and `compare_artworks` are
  all human-reachable. The claim holds on the human side.
- Clicking the activity glyph opens a real inspectable log — arguments,
  durations, results. Verbatim from my run:
  `get_view_context · 11ms · {} · read the view · nga · 30 on screen`, then
  `flag_artworks · 18ms · {"flags":[{"artworkId":"…136181","flag":"reject","reason":"The broad river v…` ·
  `3 rejected · provisional`. That is the honest answer to "how was WebMCP
  implemented" and a judge can watch it fire.

**What is not true:** the agent never chooses the two tools that make this
collaboration rather than delegation. I extracted every `assistant` message with
`tool_calls` from every transcript in `docs/night/e2e-evidence/`:

```
iteration-3/notes.json               140 calls   flag_artworks=0  compare_artworks=0
iteration-4/notes-e2e4-paced.json    129 calls   flag_artworks=0  compare_artworks=0
iteration-4/notes-e2e4-unpaced.json   86 calls   flag_artworks=0  compare_artworks=0
fix-iteration-4/notes.json           129 calls   flag_artworks=0  compare_artworks=0
----------------------------------------------------------------------------------
TOTAL                                484 calls   flag_artworks=0  compare_artworks=0

search_artworks 186 · search_by_color 86 · get_view_context 56 · set_results 53
set_view 47 · list_collections 42 · redeal 14
```

It is not that the model was not told. `apps/api/src/routes/agent.ts:110-111`
instructs it in as many words — *"Use flag_artworks to disagree in their own
currency…"*, *"Use compare_artworks when you have a real hypothesis…"* — and the
"gestures outrank words" rule is in the prompt verbatim at line 99. It searches
instead, every time, until `MAX_TURNS = 8` runs out.

I probed it three ways rather than concluding from the logs:

| what I typed | what the agent did |
| --- | --- |
| "Narrow these down for me — I can only hang one." | searched; **no compare, no flag** |
| "Show me two side by side and let me choose between them." | **opened the two-up** ✅ |
| "I want warm and cheerful. Be honest — mark the ones on this board you would throw out." | **six provisional rejects in dashed agent ink** ✅ (and then wrote no note) |

So both beats are reachable by typing — no console needed, which is better than
the transcripts alone suggest. But they need to be asked for almost verbatim.
A judge will not phrase it that way, and the natural phrasing produced neither.

The consequence for the submission's own copy: §7.2's *"Every screenshot shows
two hands. No legend needed after the first second"* is false of the product as
it behaves. The agent's dashed cyan ink is in the reports because a lane called
`window.__paillette_webmcp.call('flag_artworks', …)` from a console. No report
says the model has never chosen it. That is the claim outrunning the evidence,
and it is in the most important place.

### 6. Is the interface too wordy?

**No prose defects, and a chrome problem.** I counted rather than eyeballed:
every leaf element visibly on screen, excluding anything inside a card and
excluding `sr-only` nodes (there is a `"12 works on the board. 0 kept in place,
12 new."` live region — it is 1×1 and clipped, so it is correctly not chrome).

```
scrollY   0 : 24 strings /  29 words of non-artwork text
scrollY 180 : 25 strings /  32 words
```

The brief's specific prohibitions are all respected, and I looked for each one:

- no helper text, no onboarding copy, no empty state that lectures
- no tooltip restating a control
- **the agent's note is one sentence, every time**, across ~15 notes I have now
  seen. No preamble, no bullets. The prompt enforces "under about twenty-five
  words" and the model obeys.
- **no chrome narrating the mechanism** on screen — the one sentence that does
  is screen-reader-only, which is the right call.
- provenance is ink and position, not a caption saying who did what.

So the *writing* discipline is genuinely good. The wordiness that is left is
inherited product chrome, and all 29 words of it are in every frame of the film:

```
Paillette · About · Log in · Create account          (5 — SaaS account chrome)
Sort · Relevance · Colour · Newest · Artist · Title  (6 — a database sort row)
View · Masonry · Salon · Atlas · Table               (5 — a layout picker)
Settings · 30 / 20                                   (3)
"warm landscape" · End of results                    (5)
```

Nineteen of those are a results toolbar that the thesis has no use for once a
board is dealt — §5b's own rule is that once anything is flagged, the deal *is*
the layout, so the `VIEW` row is offering the human a way to destroy the board.
And `Log in / Create account` in the top-right of the defining image is the one
thing a judge will read as "this is a SaaS product with an agent bolted on".

**Does the design need a legend?** No, with one exception: the `P | X | U`
three-letter badge is a legend, and it is the only affordance teaching the loop.
I would keep it. Terse is not the same as cryptic, and this is the line.

### 7. Does the whole loop work by typing alone, with voice off?

**Yes. I never touched the mic and every beat landed.** Cold page, typed
instruction → board + label; hover + `X` → flags; Enter on an empty bar →
deterministic redeal; typed nudge → grounded note; typed "show me two side by
side" → the two-up; shift-click + `C` → the two-up without the agent at all.

The e2e lane proved the silence properly rather than assuming it — stubbing
`speechSynthesis.speak` and both `SpeechRecognition` constructors before any
page script runs, then typing: `utterances spoken: 0, recognisers started: 0`.
The channel is derived from how the turn arrived
(`speech-channel.ts`, `shouldSpeakReply(lastTurn) === (lastTurn === 'voice')`),
so there is nothing to toggle. Correct design, and demonstrated.

**Not blocking, but state it plainly in the submission:** the *spoken* half —
push-to-talk, the 1.2 s grace bar, and the note being spoken back after a spoken
turn — is unverified by anyone tonight, because headless Chromium has no
microphone. Do not claim it without filming it on a real machine first.

### 8. What is the single weakest thing a judge would notice first?

The `Log in` / `Create account` / `Sort · Relevance · Colour · Newest · Artist ·
Title` / `View · Masonry · Salon · Atlas · Table` band sitting between the
human's sentence and the agent's, in the frame that is supposed to be the
argument. It says "search results page" at exactly the moment the submission
needs to say "two people working on one board".

Second, and close: if they open the site root first, they get a different
product with emoji feature cards.

### 9. Does the curation half actually work?

**Re-labelling: yes, convincingly, and it is the best-evidenced claim in the
pack. Re-selection: no, not reliably.**

The test the brief sets is whether the same work gets a different label under
two statements. `docs/night/curation-evidence/contextual-labels.txt` isolates
exactly that, and it is not decorative — the Daumier lithograph, verbatim:

> under **"Weather at Sea"** — "…The lithograph brings the exhibition's reduced
> visibility ashore, where recognition can be as unstable as a view through
> changing conditions."
>
> under **"Leaving"** — "…In the context of leaving, the print turns the image
> left behind into an unstable record."

Same picture, two genuinely different readings, each one only sensible under its
own statement. **3/3 works differ.** The human's words survive verbatim and come
back `by: "human", theirs: true` in every documented run, and the title follows
the correction ("Weather at Sea" → "After Leaving", 2/2). Per-field provenance
is real; the agent proposes and does not overwrite.

**Re-selection is where it falls down**, and the reports are honest about it
without drawing the conclusion. Post-fix runs, from the evidence files:

| batch | board movement on the correction turn |
| --- | --- |
| 2 | run 1 **+1** · run 2 **−1** · run 3 **+3** |
| 3 | run 1 **0 new, 0 dropped** · run 2 **0 new, 0 dropped** · run 3 **+9** |
| integration, staging | **0 new, 2 dropped** |

So on a filmed take there is roughly a one-in-three chance that editing the
statement changes nothing on the wall, and one of the "re-selections" is pure
subtraction — the board shrinks rather than being re-chosen around the new
theme. §5c asks for "re-selects **and** re-labels". Half of that is excellent
and half is a coin flip.

Both reports name the likely cause and I agree with it: `MAX_TURNS = 8`
(`agent-prompt.tsx:148`) and a drafting turn routinely spends five or six of
them searching, so the correction turn runs out of budget before it can
re-populate.

**Do not write "re-selects and re-labels" into the submission** without a fresh
run behind it. Write "re-labels every work around your correction, keeping your
words" — which is true, demonstrated, and still the more interesting half.

### 10. Is there a shareable exhibition page?

**Yes, and it is the strongest visual artifact in the submission.** Verified by
me, not read: `/e/aWp7U3z`, `/e/exYNx8X`, `/e/HcLSkLr` all return 200. Opened
`/e/aWp7U3z` in a browser context with no prior state — `HTTP 200`, title
*"The Amber Room — Paillette"*, `<h1>The Amber Room</h1>`, an 84-word statement,
**12 works each with a contextual wall label and its catalogue record**, and all
12 IIIF images live. It survives being opened cold by someone who has never used
Paillette, because the rows are in D1 and independent of the worker — I
confirmed the read path still works after this build was deployed.

Design: near-black ground, alternating full-scale works, serif labels, mono
catalogue blocks, generous negative space. It looks designed. §5c's "the board
must stop dying with the tab" is genuinely delivered.

Two things it is missing, and they are the difference between a nice page and
one nobody else will have — see §11.

### 11. What would make this win that nobody has built yet?

Two proposals. The first is small and fixes a blocking item at the same time;
the second is the one I would actually build if there is a window.

**A. Draw the disagreement. (small)**

The agent never flags on its own (§5), and even when it does, its mark cannot
share a card with the human's. Change both: make **one provisional flag with a
reason mandatory** on any turn where the human has already flagged — the agent
must put at least one mark on the board, not just a sentence about it — and let
a dashed agent flag **coexist with a confirmed human flag on the same card**,
the two badges offset in the same corner.

Then a card wearing a graphite `X` and a dashed cyan `P` at the same time is a
picture of two operators disagreeing. It needs no prose, it cannot be
hallucinated, and it is the one frame in the video that survives the model being
switched off — because the mark is already in the DOM. It converts the riskiest
claim in the submission into its most photographable one.

**B. Publish the argument, not the gallery. (medium)**

Every entry that has a share feature will produce a page of pictures. The thing
only *this* app can publish is **how the show was arrived at**, because it is the
only one where the collaboration left a record: a struck-out sentence, the
sentence that replaced it, and the works that fell out when it did.

So put three things on the exhibition page that no competitor's output can
carry:

1. **The correction, printed.** The agent's drafted statement with a rule
   through it, and under it the human's — *"It is not about weather. It is about
   leaving"* — set as the wall text it became. §5c's own example, as a design
   element.
2. **The considered-and-declined pile.** A small greyed contact sheet at the
   foot under one word. §6 lists it as part of the artifact; today it dies with
   the tab. The renderer already resolves every id server-side, so this is
   carrying reject ids in the share payload.
3. **Who wrote each line.** The per-field provenance already exists
   (`{"text":…,"by":"agent"}` / `"by":"human"`) and is thrown away at render.
   A hairline in the agent's ink beside the labels it wrote, graphite beside the
   human's, and the page itself becomes the two-hands picture — permanently,
   for anyone who opens the URL, with no model call and no live demo.

A judge who opens that link sees a designed show *and* an argument about how
people and agents make things together. That is the challenge's actual question,
answered by an artifact rather than by a claim.

---

## Blocking, ranked

1. **The agent never proposes.** 484 model-chosen tool calls, `flag_artworks` 0,
   `compare_artworks` 0. Instructed, wired, human-reachable, never selected.
   Every demo of either in every report ran through the debug console. Fix in
   the prompt, and give it the turns to do it.
2. **Two reports claim two inks in a frame that has one.** e2e §1 and the
   integration §5 both describe frames that do not contain what they say. The
   frame *does* exist — I found it — but at a scroll position neither report
   names.
3. **Theme correction re-labels but does not reliably re-select.** 1-in-3 of the
   documented post-fix runs move no works at all.
4. **The chrome in the money shot.** Account buttons and a 19-word database
   toolbar between the two sentences the film is about.

## Not blocking, worth knowing

- Artwork thumbnails are routinely smaller than their own captions on the board.
- Two live text fields on the cold page and in the money shot, against §5.
- Site root is a different product with emoji feature cards.
- `set_results` is uncapped at 12 and **empties the reject tray** — an agent turn
  deletes the human's considered-and-declined pile (integration §6.1).
- The two-up has no cancel: Escape does nothing, the backdrop does nothing, and
  every exit flags both works.
- `beats.json` reports 11 tools fired when 7 did (`capture.mjs:444` maps every
  beat, so mid-flight calls are counted twice). It is the artifact that answers
  "how was WebMCP implemented"; it should not overstate.
- Ten NGA searches per minute per client, shared between the agent's bursts and
  the deterministic redeal. It refused a `redeal` mid-run for the e2e lane. Pace
  the takes or raise `PUBLIC_SEARCH_COLD_MISS_LIMIT_PER_MINUTE`.
- The ledger filmstrip exists at `/night/deal` and is wired to nothing in the
  product (§7.5).
- The spoken half of the voice loop is unverified by anyone. Do not claim it.

## What I would put in the video

`X`, `X`, Enter on an empty bar — twelve cards deal from your rejects with the
network panel open showing one call to a vector engine and none to a model — and
then the agent's next sentence naming what you threw out by medium and palette.
Both halves verified by me, live, today. No chat and no search box can do
either, and the second one is only possible because of the first.

## Where this run's numbers came from

| claim | how I checked it |
| --- | --- |
| redeal with 0 model calls | full request log on a cold page, no debug flag |
| note grounded in flags | 3 fresh runs, flagged works printed beside each note |
| 484 calls, 0 flag / 0 compare | parsed every `assistant.tool_calls` in `e2e-evidence/**/*.json` |
| agent will flag / compare if asked | 3 elicitation turns on staging |
| two inks in one frame | measured at scrollY 0 / 60 / 120 / 180 / 261 / 320 |
| 29–32 words of chrome | every visible leaf node, minus cards, minus `sr-only` |
| `P` / `U` / `C` work for the human | driven by keyboard, flags read back off the DOM |
| exhibition opens cold | fresh context, desktop and mobile, all 12 image URLs probed |
| cold judge path | bare `/nga/search`, no query, typed only |
