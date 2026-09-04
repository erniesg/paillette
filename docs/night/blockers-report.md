# Blockers lane — report

Branch `night/blockers`, cut from `night/integration`. Five items from
`BLOCKERS.txt`, all of them product defects rather than submission defects: the
things that stop the build working for the person using it.

Everything below was measured by **typing into the page on staging**. Nothing in
this report was *made to happen* through `window.__paillette_webmcp.call`; where
a harness reads through it — `get_view_context` for the flag counts,
`get_exhibition` for the label counts — the read is named `harnessReads` in the
JSON so it can never be mistaken for the census. The harnesses are in
`scripts/demo/` and the raw output is in `docs/night/blockers-evidence/`.

A second round follows the five, from §6 onward: the two constraints added
mid-run applied back over this work, and §9 run end to end as one sequence.

**Deployed and measured on** api `501e3889-e4cc-4555-bbd4-7e20c317739e` and web
`9ab4735d` → `fb739583` → `e52ef6a3` → **`756a665b`**, which is what the §9 and
hardening numbers below were taken on. Staging only; production never touched.

---

## The census, old beside new

The critique's census, over every transcript the night produced plus iteration
5's `turn-bodies.json` — **508 model-chosen tool calls**:

| tool | calls |
| --- | --- |
| `search_artworks` | 192 |
| `search_by_color` | 92 |
| `get_view_context` | 61 |
| `set_results` | 56 |
| `set_view` | 50 |
| `list_collections` | 42 |
| `redeal` | 15 |
| **`flag_artworks`** | **0** |
| **`compare_artworks`** | **0** |
| **`search_by_exemplars`** | **0** |

Mine, on this deploy, read off the model's own `tool_calls` in the responses to
`/api/public-agent/turn` — **85 model-chosen tool calls** across six sessions
driven entirely by typing:

| tool | culling (3 runs) | exhibition (3 runs) | total |
| --- | --- | --- | --- |
| `search_artworks` | 0 | 19 | 19 |
| `set_exhibition` | 0 | 12 | 12 |
| `write_labels` | 0 | 12 | 12 |
| `get_view_context` | 9 | 1 | 10 |
| `redeal` | 8 | 0 | 8 |
| **`flag_artworks`** | **6** | 0 | **6** |
| `set_results` | 0 | 4 | 4 |
| **`compare_artworks`** | **3** | 0 | **3** |
| `search_by_color` | 0 | 3 | 3 |
| `set_view` | 0 | 3 | 3 |
| `get_exhibition` | 0 | 3 | 3 |
| `list_collections` | 0 | 2 | 2 |
| `search_by_exemplars` | 0 | 0 | **0** |

**Nine typed culling turns, nine proposal calls.** Every turn that followed a
human gesture called `flag_artworks` or `compare_artworks`.

Calling is not marking, and the two came apart. Of those nine turns, **seven
left the proposal where the human could see it** — the three two-ups by having
the room open, and four of the six flag turns by leaving 3, 2, 3 and 2 marks on
the board. The other two flagged and then redealt, and the deal took the agent's
own marks with it. That is the defect the browser probe found and the last
commit fixes. Re-measured on the fixed build, two more runs:

| | typed turns | proposal called | proposal visible |
| --- | --- | --- | --- |
| tool-name check | 9 | 9 | 7 |
| board-state check | 6 | 6 | **6** |

`scripts/demo/census.mjs`, `docs/night/blockers-evidence/census.json` and
`census-after-fix.json`.

`search_by_exemplars` is still 0 and I am not claiming that as a fix. It is not
the model's tool on this path: once anything is flagged the prompt tells it to
call `redeal`, and `redeal` is what calls `search_by_exemplars` server-side —
the eight `redeal` calls above are eight exemplar searches. A model calling the
engine directly during a cull would be going around the human's flags, which is
the thing §P2 exists to prevent. If the submission wants a model-chosen
`search_by_exemplars` it has to come from the exhibition path, where it did not
happen in three runs either.

---

## 1. The agent never proposed

### What was wrong

`apps/api/src/routes/agent.ts` described `flag_artworks` and `compare_artworks`
as things the model *may* use. An invitation is not a behaviour: the same prompt
also tells it — correctly — to redeal and write a note, and a turn that has
redealt and written a note feels finished. It declined for 508 consecutive tool
calls.

### What changed

**The prompt, moved into the mandatory form** (`agent.ts`). On any turn where
the human has flagged or answered a two-up, at least one mark of the agent's own
goes on the board, or a two-up opens — *in addition to* the note, never instead
of it, because iteration 4 hit the opposite failure with six flags landing and
`note: null`. The same instruction is repeated in the gestures message that
arrives last, `describeHumanTurn`, because that is the sentence sitting beside
the very gestures it is about.

**A post-condition, because prose is how you ask for judgement and not how you
guarantee a state** (`apps/web/app/lib/webmcp/unmarked-board.ts`). The same
discipline `unfinished-show` already used on the exhibition: when the model
returns no tool calls and thinks it has finished, the page checks the board and
can put the turn back to work. Nothing in it composes a flag, chooses a work or
writes a reason — it names the unmarked ids so the model need not search again,
and refuses to let a turn that answered someone's hands end with a sentence and
no mark.

**The page pays for what the page demands** (`agent-prompt.tsx`). `MAX_TURNS`
stays at 8 — the transcripts show five or six routinely going on searching, and
a bigger allowance for a model that is dithering buys more dithering on
someone's screen. But a nudge is not the model's choice, so it does not come out
of the model's budget: `TURNS_PER_NUDGE` 2, `MAX_NUDGES` 4, `HARD_MAX_TURNS` 16.

**And then the probe found the rest of it.** The first version of the check
asked "was `flag_artworks` among this turn's tool names". I drove staging with
the model's first response replaced by a bare sentence — exactly what it used to
do every time — and watched: the page nudged, the model flagged three works, and
then it redealt. Only confirmed human picks hold a slot, so **the deal took the
agent's own proposals with it**, and the board in front of the human had one
hand on it while the tool name said otherwise. The check now asks whether there
is an agent mark on the board they are looking at, which is the question §7.2
actually asks; a two-up satisfies it by the room being open; and the nudge is
keyed on the board's contents so a turn that dealt its marks away is looking at
a job it has not done. When it was a redeal that erased them, the nudge says so.

### How it was verified

- `scripts/demo/census.mjs`, five runs across the two builds, everything typed
  or keyed: `X X P` on the grid, Enter on an empty bar, Enter again, then the
  sofa prompt and the two follow-ups the critique found produced nothing —
  *"Narrow these down for me — I can only hang one."* and *"I'm torn. Help me
  decide."* Each of those produced a proposal in **5 of 5** runs. The first
  reliably opens a two-up; the second reliably flags.
- **The post-condition never fired in any of those fifteen turns.** Zero nudges,
  on both builds. The prompt change alone carried it and the mechanism was never
  needed. That is the good outcome and it is also a gap in the evidence, because
  a backstop nobody has seen catch anything is a backstop on paper. So:
- `scripts/demo/nudge-probe.mjs` fakes the model's first response — one
  sentence, no tool calls — and leaves everything else deployed and real. The
  page issued a second request carrying the nudge, and the real model answered
  it. Before and after the board-state fix, on the same probe:

  | | requests | model chose after the nudge | agent marks on the board |
  | --- | --- | --- | --- |
  | tool-name check | 4 | `get_view_context, flag_artworks, redeal` | **0** |
  | board-state check | 3 | `flag_artworks` | **3** |

  `docs/night/blockers-evidence/nudge-probe-before-fix.json` and
  `nudge-probe.json`; the second run's frame is
  `docs/night/shots/blockers-04-marks-after-the-nudge.png`, three works
  carrying dashed cyan marks with the agent's reasons on them.
- Unit tests, made to fail first. Disabling `findUnmarkedBoard` in
  `agent-prompt.tsx` fails *"refuses to end on a sentence when only the human
  has marked the board"* with `expected 1 to be greater than 1`; reverting the
  board-state check to the tool-name check fails *"is not satisfied by a flag
  the turn then dealt away"* and *"is satisfied by a two-up"*.

### What a judge will see

`docs/night/shots/blockers-01-two-inks-scrolly-80.png` — one 1440×900 frame with
the human's sentence in graphite, the agent's wall label in cyan with the
swatches it was written from, and twelve whole cards carrying **1 human mark and
2 agent marks**, counted off `data-flag-by` at the moment of the shot and
recorded in the attestation beside it. Nothing in that frame was produced by a
console.

---

## 2. The human's own Enter deleted the agent's sentence

### What was wrong

The note wrapper carries `empty:hidden`, the deterministic redeal passed no
note, so pressing Enter on an empty bar — the beat the whole thesis rests on —
removed the wall label and slid every card up into the gap, picks included.

### What changed

Not a reserved row. **The deal writes its own line**
(`apps/web/app/lib/webmcp/deal-note.ts`), composed from the flags and the
palettes already printed on the cards, with no model call anywhere in the path:

Four lines it actually wrote on staging, all of them reached by pressing keys:

```
One pick holds — bone.                        one pick
Three picks hold — bone and umber.            three picks, second deal
Twelve rejects out — olive and sage.          everything thrown out
Twelve works — umber and bone.                nothing flagged at all
```

**This was two sentences until the last round, and the second one was wrong.**
It read *"One pick holds — bone. Eleven works dealt to sit with it."* — and the
second half is §5b's "never narrate the mechanism" exactly: eleven cards had
just arrived on screen and the sentence was reporting that back to the person
who had watched it happen. Cut. A test now counts the full stops and greps for
mechanism words, because a comment saying "one sentence" is not a check.

Museum discipline per §5b: one line, no preamble, never names the mechanism. It
names what was kept or thrown out, which is what the human just did and what the
swatches beside it can be checked against. Colour names are refused past a
CIEDE2000 distance of 26, so it will not call something bone that nobody can see
as bone; the fallback is the titles, then a bare count.

This turns the worst beat in the build into the clearest proof of the claim
underneath it: **the board still speaks with the model switched off.**

### How it was verified

`scripts/demo/deal-geometry.mjs`, twice, nothing but `P`/`X`/Enter
(`docs/night/blockers-evidence/deal-geometry.json`):

```
first deal (grid → board)   note "One pick holds — bone."
                            provenance human · noteHeight 44 · 12 cards · dealError null
after the second Enter      note "Three picks hold — bone and umber."
                            picks moved 0px, 0px, 0px · boardChanged true · modelCalls 0
```

Re-measured after the note was cut to one sentence: **the row is still 44px and
the picks still move 0px**, so shortening it did not reopen the defect it was
written to close.

`modelCalls 0` is the point: no request reached `/api/public-agent/turn` in
either deal. The note is in the human's ink, because a human redeal put that
board on the table and a note about it must not arrive in the agent's colour.

**The negative control, run in the browser rather than argued from arithmetic.**
The harness takes the note row out of the live page and re-measures the board:
every card moves by −44px, −30px or −15px depending on its row. That is what the
human's own Enter used to do to their picks, measured on the fixed build.

### What I did not fix, and why

The exhibition strip. Measured the same way — take
`.paillette-exhibition-head` out of the document and re-measure — it is **104px
tall and worth +1px, +48px, +96px** of card movement by row. It is not part of
the deal beat: in the flow a person actually takes — flag on the grid, then
Enter — it arrives before the board does, and once a board is on the table no
redeal moves it at all (0px, measured twice). It can still land on a live board
in one case: an agent-dealt board with nothing picked, and then the human's
first `P`. Reserving its height
means an empty 104px band above every board before anything is flagged, which is
the dead space §5b argues against, and moving it below the board puts the
statement off the fold at exactly the moment §5c needs the human to watch the
wall follow their correction. So it is measured, reported and left. If a later
iteration wants it gone, moving it below the board is the change; the number to
beat is 96px.

---

## 3. §5c did not work reliably

### What was wrong

The critique measured 1 success in 4 by hand. One drafting turn produced nothing
in 150s; one relabelled nothing; one changed 0 labels and 0 works in 180s; one
worked. The turn spent itself hunting for candidates and ran out of road.

### What changed

**The ordering is made true rather than requested** (`agent-prompt.tsx`). The
prompt has said "labels first, searching last" since iteration 3. Now, on a turn
where the human has rewritten the statement, every search tool returns
`RELABEL_FIRST` until `write_labels` has run — with the reason in the tool
result, so the model does the labels next and searching reopens immediately. It
never applies to a show with nothing hanging yet.

**And the nudge budget above**, so a turn that has spent six calls searching is
not told to write six labels and then hit the ceiling with the wall blank.

### How it was verified

`scripts/demo/e2e-correction.mjs`, three runs, every one of them typed: the
brief into the utterance bar, then the statement clicked and retyped with the
critique's own sentence — *"It is not about weather. It is about leaving — the
hour before someone goes, and the room that keeps their shape after they have
gone."*

| run | added | dropped | relabelled | unlabelled at end | title changed | statement theirs | correction time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 11 | 11 | 1 | **0** | yes | yes | 78.9s |
| 2 | 12 | 12 | 0 | **0** | yes | yes | 95.2s |
| 3 | 6 | 8 | 4 | **0** | yes | yes | 66.0s |

**3 of 3**, against the critique's 1 of 4. The titles the runs produced were
*"The Hour of Going"*, *"After They Go"* and *"After the Departure"* — none of
them the storm title they replaced. The human's statement survived verbatim in
all three.

The ordering shows in the tool sequence. Every correction turn's first write was
`write_labels`, before any search:

```
run 1  get_exhibition, write_labels, set_exhibition, search_artworks ×4, set_exhibition, write_labels, set_results, set_exhibition, write_labels
run 2  get_exhibition, write_labels, set_exhibition, search_artworks ×4, set_exhibition, write_labels, set_exhibition, write_labels, set_exhibition
run 3  write_labels, get_exhibition, set_exhibition, write_labels, search_artworks, set_exhibition, write_labels, search_artworks
```

Runs 1 and 2 each show the title post-condition firing and being answered — the
mechanism working in a browser, on the gap it was built for.

`docs/night/blockers-evidence/correction.json` carries all three in full.

---

## 4. Works hung after `write_labels` were never labelled

### What was wrong

"Once per gap" meant a correction turn labelled the six works hanging, was
satisfied, then dropped four and hung six others — and *those* were never
labelled. Four of the seven published `/e/:code` pages carried no wall label
anywhere on them.

### What changed

**A nudge is keyed on what it was about, not on which gap it was**
(`unfinished-show.ts`). `labels:${sorted ids}` — a different set of unlabelled
works is a different job. The caller's `MAX_NUDGES` is what stops it looping, so
there is no "once" to be wrong about.

### How it was verified

`unlabelled: 0` at the end of all three correction runs above, and the pages
themselves, opened in fresh browser contexts and re-checked over the API just
now:

| code | title | works | labelled | by |
| --- | --- | --- | --- | --- |
| `qcwysHs` | The Hour of Going | 12 | **12** | agent |
| `N9xxBg2` | After They Go | 12 | **12** | agent |
| `GtHVSnZ` | After the Departure | 10 | **10** | agent |

A sample, so the "contextual" claim can be checked rather than taken:

> The etched interior holds a figure at the edge of departure, its black lines
> making the room feel already emptied around her.

All seven codes the critique lists, re-read over the API tonight — the three
that were fine still are, and the four blank ones are still blank:

| code | works | labelled |
| --- | --- | --- |
| `MKwsxHy` | 6 | 6 |
| `aWp7U3z` | 12 | 12 |
| `exYNx8X` | 3 | 3 |
| `HcLSkLr` | 12 | **0** |
| `QWwJnL5` | 12 | **0** |
| `dfbA3tE` | 4 | **0** |
| `wycy7SS` | 3 | **0** |

Those four **cannot be re-published**: a published show is a snapshot, the boards
that made those four are gone with their tabs, and writing labels onto them
would mean inventing them. The submission should point at `qcwysHs` or
`N9xxBg2`, which are twelve-work shows with a label on every work, written
against a statement the human typed.

I did not add a refusal to publish while `unlabelled > 0`. It would put a
sentence on screen explaining why a button did not work, which is the chrome
§5b forbids, to cover a case the post-condition now closes; and it would block a
human who deliberately wants an unlabelled hang.

---

## 5. A named screenshot did not contain what its report said

### What was wrong, confirmed

I opened `docs/night/shots/e2e5-02-board-and-note.png` at native resolution. It
contains the agent's cyan label and twelve cards, and above the label: the
Paillette logo, About, Log in, Create account, `12 / 12 works`, the SORT row,
the VIEW row, `Settings 30 / 20`. **There is no human utterance in the frame.**
The critique is exactly right, for the second iteration running.

### What changed

**In the product** — the chrome stands down while a deal is on the table
(`public-shell.tsx`, `galleries.$galleryId.search.tsx`). About, Log in and
Create account go; Sort, View and Settings take the same `lt-board-fold` the
rest of the search form already takes. The logo stays: it is the way back, and
it is a mark rather than a word. Two reasons and the second is not cosmetic —
the View row was offering Masonry, Salon, Atlas and Table over a board where
choosing any of them destroys the deal, a live control whose only effect is to
throw away the human's work. Sorting a hang is meaningless anyway; the order is
the curation. Clearing the flags brings the whole rail straight back.

**Also in the product**: the human's echo in the transcript now carries
`data-provenance="human"`. It was a bare span, so every harness checking §9's
"two colours of ink in every state" through `[data-provenance]` was asking a
question the page could only ever answer `agent` to.

**In the process** — `scripts/demo/frame-attest.mjs`. The frame is not chosen by
measuring one element and then described from memory, which is how this went
wrong twice. The script sweeps for a scroll position that holds both sentences
and a whole board, shoots it, and then **reads the pixels back out of the saved
PNG** to attest what the file contains. Measuring the DOM proves the page was in
the right state; only sampling the file proves the file is.

### The attestation

`docs/night/shots/blockers-01-two-inks-scrolly-80.png`, and
`docs/night/blockers-evidence/frame.json`:

```
scrollY 80 · 1440×900 · 12 of 12 whole cards in frame
marks on those cards: 1 human, 2 agent
human : "I want something to hang above the sofa in my living room. Warm, not busy, nothing grim."
agent : "You asked warm and quiet; the picked bone-toned sea holds while the darkest storm scenes leave."
sampled at the human's rule, x336 y165 : #525252   (page says rgb(82, 82, 82))
sampled at the agent's rule, x220 y432 : #5ec8d8   (page says rgb(94, 200, 216))
every other word in the frame (17):
  P · ai · llette · 🎤 · 12 · works · Copy link · 12 / 12 works · " · storms at sea · "
distinct text colours in frame: 9
```

Those two hexes were read out of the PNG on disk, and the value beside each is
what the page's own computed style said the rule was, so the sample has
something to be checked against that is not a constant typed in from memory. The
chrome census on a dealt board is **17 word-strings, from 48** — and three of the
seventeen are the logo lockup split across spans, one is the microphone glyph.
The band of 23 words between the human's bar and the agent's sentence is gone
entirely.

Two things I will not overstate. The distinct-text-colour count moved 10 → 9,
which is a small move and most of the nine are neutral greys at different
weights rather than nine inks. And the human's rule samples `#525252`
(`border-neutral-600`) where the agent's samples the `--ink-agent` token
exactly: both read correctly as graphite and cyan, but they come from different
token families and could drift apart in a refactor without anything failing.

### The false clause

I replaced it in `docs/night/e2e-report.md` §2 with what that file actually
contains, and pointed the paragraph at the attested frame. That is another
lane's report; the sentence was named in my work order and it was wrong, so it
is corrected rather than deleted, and this paragraph is here so the edit is not
silent.

---

# Round two — the two new constraints, and §9 end to end

The five blockers above were the work order. This section is what came after
it: my own work audited against **text first** and **cut the words**, and then
the §9 demo path run as one sequence instead of five separate claims.

## 6. Cut the words, applied to what I had just built

Two findings, both in my own work from earlier tonight.

**The deal's own line was two sentences, and the second one narrated the
mechanism.** It read *"One pick holds — bone. Eleven works dealt to sit with
it."* Eleven cards had visibly just arrived; the sentence was reporting that
back to the person who had watched it happen, which is §5b's "never narrate the
mechanism" almost word for word. Cut to one sentence — see §2 above for the
four shapes it now writes and the re-measured geometry. A unit test counts the
full stops and greps for mechanism words, because a comment saying "one
sentence" is not a check.

**The count was on screen twice.** The frame attestation in §5 listed
`12 works` (the exhibition rail) and `12 / 12 works` (the results rail) in one
1440×900 frame — the same twelve pictures counted twice, two inches apart. And
on a dealt board the results number is not even about what is on screen: it is
the size of the search result the deal replaced. The hang's count belongs to the
show and stays; the results count now folds away with the rest of the rail and
comes back when the flags are cleared.

I also measured the model's own note every run rather than trusting the prompt's
"one sentence, under about twenty-five words": **1 sentence, 13 and 20 words**
on the two runs that reached it.

## 7. Text first

The whole §9 sequence is run with `SpeechRecognition`, `webkitSpeechRecognition`,
`speechSynthesis` and `SpeechSynthesisUtterance` **deleted before the page
loads** — not stubbed, deleted, so the page's own feature detection sees what a
browser without the API would show it.

- Every beat works. Flags, `P`/`X`/`U`/`C`, Enter, the deterministic deal, the
  typed instruction and the agent's reply all run with no speech API present.
- The push-to-talk control is not rendered, which is the page's own
  `getSpeechRecognition()` answering correctly rather than something the harness
  arranged.
- **Nothing is spoken after a typed turn**, asserted every run by recording
  every call to `speechSynthesis.speak`.
- No page errors attributable to the missing APIs.

The agentic trigger fires from a typed instruction alone; that is what the
census in §1 measures and what the sofa prompt does in clause 3.

Nothing this lane built touches speech. The deal note, the two post-conditions,
the in-flight mark and the chrome fold are all reached by keys and typing, and
all of them were measured with the speech APIs deleted. **What I did *not*
establish is the voice-in-voice-out direction** — see clause 4b in §9.

## 8. The deal beat when things go wrong

`scripts/demo/harden.mjs`, six cases, all on staging by typing and keying
(`docs/night/blockers-evidence/harden.json`):

| case | what it does | result |
| --- | --- | --- |
| `slow` | exemplars route held open 8s | **pass** — mark reads dealing, board holds still, deal lands, mark clears |
| `dead` | exemplars route refused | **pass** — `REDEAL_FAILED` draws, board unchanged, mark clears |
| `empty` | Enter with nothing flagged | **pass** — deals and names the board: *"Twelve works — umber and bone."* |
| `spent` | Enter with all twelve rejected | **pass** — deals: *"Twelve rejects out — olive and sage."* |
| `phantom` | `flag_artworks` on ids never loaded | **pass** — `ARTWORK_NOT_IN_SESSION`, no phantom marks |
| `phantom2` | `compare_artworks` on an unresolvable id | **pass** — refuses, room stays shut |

Two of these were real defects when first run, and both are fixed:

**A deal in flight was completely silent.** `setDealing` had been written to the
store since the loop was built — carrying a comment that a slow deal "has to be
visibly in progress rather than look ignored" — and **no component ever read
it**. On a slow connection Enter did nothing observable until the board changed,
which on a filmed take reads as a dead key. The hairline the human's own Enter
armed now travels while the deal is out. No text: "Redealing…" is the chrome
§5b forbids and would need a slot that stands empty the rest of the time. Under
`prefers-reduced-motion` the rule brightens and holds instead of moving. The
screen-reader line says "Dealing.", because a moving hairline is no use there.

**Rejects alone were not an instruction to one of the two Enters.** The
bare-board binding tested picks only, so someone who threw out the worst things
on screen and pressed Enter with no caret in the bar got nothing — no deal, no
refusal, no mark — while the same keystroke *inside* the bar dealt correctly.
Two Enters on one page disagreeing about whether rejects count, decided by where
the caret happened to be. Fixed; `spent` above is the proof on staging.

With nothing flagged at all, a bare Enter is still deliberately left alone, and
the harness asserts that too (`bareEnterLeftAlone`). Before anyone has marked
anything the key should keep whatever meaning it had.

**Two of the six "failures" on the first run were my harness, not the build.**
The phantom cases asserted a top-level `success: false` that the tool's error
envelope does not carry, so a correctly-refusing tool was scored as broken. Said
here because a harness that is red for the wrong reason is worse than one that
is green for the wrong reason — it gets believed.

## 9. §9 as one sequence

`scripts/demo/section-9.mjs`, three runs, `--voice=off` — no speech API in the
browser at all — on web `756a665b`
(`docs/night/blockers-evidence/section-9.json`):

| clause | | result |
| --- | --- | --- |
| 1 | `P`/`X`/`U`/`C` and Enter on the grid; `get_view_context` returns the flags | **3/3** |
| 1b | flags persist across a **page reload** | **0/3** — see *Still open* |
| 2 | Enter on an empty bar redeals, picks in place, no LLM call | **3/3** |
| 3 | the note refers to the content of what was rejected | **3/3**, judged by hand |
| 4 | nothing is spoken after a typed turn; no mic control without the API | **3/3** |
| 4b | a spoken utterance lands in the field and is answered aloud | **not verified by me** — see below |
| 5 | two colours of ink | **3/3** after the agent turn — read on |

Zero page errors across all three runs.

**Clause 2, three times:** `modelCallsDuring: 0`, the pick moved `0px`, and the
board wrote its own line. No request reached `/api/public-agent/turn` during
either Enter of any run.

**Clause 3, the three notes, quoted in full so the judgement can be checked:**

> You rejected the darker storm seascapes and kept Moran's bone-and-umber
> coast—following the pick. *(1 sentence, 13 words)*

> You picked Moran's bone-and-umber sea and rejected shipwrecks, boats, and
> darker coastal views—following the quieter palette. *(1 sentence, 16 words)*

> You asked warm and quiet; the picked bone-toned sea stays, while the darker
> storm scenes and busier boats leave. *(1 sentence, 19 words)*

The two works thrown out were *Sea Pasture* and *The Bell Buoy*. All three notes
describe what left — storm seascapes, shipwrecks and boats, darker coastal views
— and none of them shares a word with either title. **That is why this is judged
by hand and not by the harness:** an earlier version scored the overlap with a
token matcher and marked a plainly correct note wrong. The matcher survives as a
hint that reports nothing here; the notes and the catalogue records are printed
side by side in the JSON so anyone can disagree with my reading.

**Clause 4b — the voice direction — I could not verify, and I am not claiming
it.** `--voice=stub` installs a fake recogniser and records everything the page
speaks. The half that matters for the new text-first constraint passed: the mic
control *is* rendered when the API exists (`micRendered: true`), and nothing was
spoken after the typed turn. But my stub never got a transcript into the field
(`utteranceLandedInField: ""`), and a re-run with diagnostics flaked on an
unrelated timeout before reaching the clause. I do not know whether that is my
stub failing to drive the page's recogniser or the page failing to read it, and
I ran out of runway to find out.

The voice lane reports this clause as met — `docs/night/voice-loop-report.md`
§"A voice utterance lands in the editable field; the note is spoken only after
voice", *"yes, with a fake recogniser and no audio produced on this machine"*.
**That is their evidence, not mine, and the submission should cite it as
theirs.** What this lane establishes is the other half: with the speech APIs
absent the page is whole, silent and fully operable by typing.

**Clause 5 needs one qualification and the submission should keep it.** On a
board dealt entirely by the human, before any agent turn, there is **one** ink
on screen — 3 human marks, 0 agent marks — because the agent has not done
anything yet. After the agent's turn both are present in all three runs (3
human against 3, 7 and 5 agent marks). So the honest sentence is *"once both
operators have acted, both inks are on the board"*, not *"two inks in every
state"*. A screenshot of the deterministic beat is a one-handed board on
purpose, and that is the point of that beat rather than a defect in it.

---

## Tests

Baseline, from the integration report: web 97 files / 1203 tests, api 46 / 857.
(The brief's 59 / 593 and 41 / 770 predate three lanes and no longer reproduce.)

| | result |
| --- | --- |
| `pnpm --filter web typecheck` | **exit 0** |
| `pnpm --filter web test` | **99 files / 1237 tests passed**, 0 failed |
| `pnpm --filter api test` | **46 files / 857 tests passed**, 0 failed |

+2 files, +34 tests on web. Nothing skipped, nothing deleted.

**Every new check was made to fail on purpose first.** In each case the
production change was reverted in the working tree, the test was run, and the
change was restored:

| change reverted | test that went red |
| --- | --- |
| `composeDealNote` out of `runRedeal` | `redeal > writes its own note…` — `expected null to be 'One pick holds…'` |
| `findUnmarkedBoard` disabled in `agent-prompt` | `refuses to end on a sentence when only the human has marked the board` — `expected 1 to be greater than 1` |
| the board-state check back to the tool-name check | `is not satisfied by a flag the turn then dealt away`, `is satisfied by a two-up` |
| `RELABEL_FIRST` disabled | `closes the searches until the wall has been rewritten` — `spy … called 1 times` |
| labels nudge keyed on `'labels'` again | `asks again when different works turn up unlabelled` |
| `quiet` ignored in `PublicSiteHeader` | `stands the account chrome down but keeps the way back` |
| `setDealing(true)` out of `runRedeal` | `reports the deal as in flight while the request is out` — `expected false to be true` |
| `isBareBoardEnter` back to picks-only | `deals from rejects alone, the way the bar already does` — `expected false to be true` |
| the second sentence back on the deal note | `is one sentence and never says what just happened` |

---

## The harnesses

All of these drive the deployed page by typing and keying. None of them calls
`window.__paillette_webmcp.call` to *make* anything happen; where they read
through it, the read is named in the output.

| script | what it settles |
| --- | --- |
| `scripts/demo/census.mjs` | the tool-call census, by typing |
| `scripts/demo/deal-geometry.mjs` | the note survives Enter; picks hold their slots; the negative controls |
| `scripts/demo/e2e-correction.mjs` | §5c three times, with per-run counts and the published page |
| `scripts/demo/frame-attest.mjs` | shoots the frame and then attests it from the file's own pixels |
| `scripts/demo/nudge-probe.mjs` | makes the model fail on purpose to prove the post-condition fires |
| `scripts/demo/agent-marks.mjs` | where the agent's marks land, as opposed to whether the tool ran |
| `scripts/demo/section-9.mjs` | the five clauses of §9 as one sequence, `--voice=off` or `--voice=stub` |
| `scripts/demo/harden.mjs` | the deal beat slow, dead, empty, spent, and called with ids that do not resolve |

The two `phantom` cases in `harden.mjs` are the one exception to the rule above:
they drive `flag_artworks` and `compare_artworks` through the debug console
because they are testing what those tools do with **bad input**, which is not
behaviour being demonstrated and cannot be reached by typing.

---

## Still open

- **Flags do not survive a page reload, and the submission must not say they
  do.** §9's first clause says "flags persist per session", and that holds only
  if *session* means the page as it stands. The flag store is explicitly
  in-memory — its own docblock calls it "a working surface, not a saved
  document" — so a reload empties it: measured at 3 flags before and **0
  after**, with `get_view_context` reporting 0 picks and 0 rejects. Everything
  else in clause 1 passes. I did not add `sessionStorage` persistence: it is a
  deliberate design decision by whoever built that module, changing it on the
  last round would put stale flags from one query onto the results of another,
  and nothing in the demo reloads. **Safe phrasing for the submission: "flags
  live for as long as the page is open." Unsafe: "flags persist", unqualified.**
- **The exhibition strip**, 104px, up to 96px of card movement on the human's
  first `P`. Measured above, deliberately not fixed, with the reason.
- **`search_by_exemplars` is 0 in the model's own census** and is likely to stay
  there while `redeal` is the right tool for a flagged board. Anyone writing the
  submission should say "the agent redeals, and redeal is Rocchio over CLIP"
  rather than claiming the model calls the engine.
- **`agent-marks.mjs` opened a two-up in both of its runs** and so did not get a
  reading on marks-per-board. The census covers the same ground and the frame
  shows three dashed marks on twelve cards, but a run that lands on flags rather
  than a compare would be worth having.
- **The voice direction of §9 clause 4 is unverified by this lane.** My stub
  recogniser did not put a transcript in the field and the diagnostic re-run
  flaked before reaching the clause. The voice lane reports it as met; cite them,
  not me. Everything text-first passed 3/3.
- **Two harness flakes worth knowing about before a filmed take**, both
  environmental rather than product: the `?webmcp-debug` harness occasionally
  takes longer than 30s to mount (which is why `harden.mjs` only loads it for
  the two cases that need it), and the staging agent route returned 429 twice
  under parallel load. Neither reproduced when the harnesses were run serially.
