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

A third round follows at §10 and §11: the one §9 clause I declined to fix last
round, finished — and a silence I chased through three deploys before finding it
in my own instrument.

**Deployed and measured on** api `501e3889-e4cc-4555-bbd4-7e20c317739e` and web
`9ab4735d` → `fb739583` → `e52ef6a3` → `756a665b` → `0c76f553` → `9197880b` →
**`e111d748`**. §9 and the hardening pass were re-run on `9197880b`; the voice
attempts ran on the two after it. Where a number below was taken on an earlier
build it says so. Staging only; production never touched.

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

`scripts/demo/harden.mjs`, seven cases, all on staging by typing and keying
(`docs/night/blockers-evidence/harden.json`):

| case | what it does | result |
| --- | --- | --- |
| `reloaded` | refresh mid-cull | **pass** — flags, records and a working deal all survive; see §10 |
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
| 1b | flags persist across a **page reload** | **3/3** — was 0/3, fixed in §10 |
| 2 | Enter on an empty bar redeals, picks in place, no LLM call | **3/3** |
| 3 | the note refers to the content of what was rejected | **3/3**, judged by hand |
| 4 | nothing is spoken after a typed turn; no mic control without the API | **3/3** |
| 4b | a spoken utterance lands in the field | **verified**, §11 |
| 4c | …and the note is spoken back | **verified**, 2/2, §11 |
| 5 | two colours of ink | **3/3** after the agent turn — read on |

**Every clause 3/3, exit 0, zero page errors**, re-run on web `9197880b`. The
first table above was taken on `756a665b`, before flags persisted; the only line
that changed is 1b.

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

**The voice direction is in §11, and it is now done** — but the story of how is
worth more than the result: two real fixes, and three rounds of chasing a
silence that turned out to be my own harness.

**Clause 5 needs one qualification and the submission should keep it.** On a
board dealt entirely by the human, before any agent turn, there is **one** ink
on screen — 3 human marks, 0 agent marks — because the agent has not done
anything yet. After the agent's turn both are present in all three runs (3
human against 3, 7 and 5 agent marks). So the honest sentence is *"once both
operators have acted, both inks are on the board"*, not *"two inks in every
state"*. A screenshot of the deterministic beat is a one-handed board on
purpose, and that is the point of that beat rather than a defect in it.

---

# Round three — the clause I declined

## 10. Flags now survive a refresh

### What was wrong, and that I chose not to fix it

§9's first clause asks that flags "persist per session". They did not.
Measured last round: **three flags before a reload and zero after**, with
`get_view_context` reporting no picks and no rejects. I wrote it up honestly and
left it, arguing that the flag store's in-memory design was deliberate — its own
docblock called it *"a working surface, not a saved document"* — and that
nothing in the demo reloads.

That was the easy read of a non-negotiable. `sessionStorage` is literally the
platform's name for "per session", and a judge who refreshes the page is not
doing anything strange.

### What changed

`apps/web/app/lib/webmcp/flag-storage.ts`. A versioned payload in
`sessionStorage`, written from `publish()` — the single point every flag
mutation already funnels through — validated per record on read, capped at 500,
and failing soft on every path a browser can throw one.

**Why this is not a new class of behaviour.** Flags are keyed by a namespaced
artwork id, so nothing can bleed between collections, and a flag on a work that
is not currently on screen is already ordinary in-session state: running a
second search today keeps every flag from the first. This only stops the reload
being the one event that erases it.

**The catalogue records travel with the flags.** The session index does not
survive a reload either, and `get_view_context` builds the agent's picture of a
flagged work out of that index — so without them a restored pick would reach the
model as an id with `title: null` and `palette: []`, under a prompt that tells it
to name what it can see, and `flag_artworks` would refuse to touch it because it
rejects ids the page has never loaded. Restoring a flag the agent can neither
describe nor change is a hollow pass. They are written as one entry so the two
cannot disagree; if that will not fit, the flags are written alone rather than
nothing at all.

**The journal is deliberately not restored.** It carries what the human did
*since the last turn* and is drained into the next agent turn, so rehydrating it
would open the first sentence typed after a reload by telling the agent the human
had just flagged everything in front of it. Standing state survives a refresh; a
delta does not.

### The error I shipped doing it, and how it was caught

The first version called `hydrateFlags()` at module evaluation. That writes the
store before React hydrates, so the tree React builds from the server's HTML no
longer matches what the components read — **React error #418, hydration failed**,
logged on every reload that had flags in storage. I had explicitly considered
this risk and talked myself out of it, reasoning that `useSyncExternalStore`
exists to reconcile a client store against a server snapshot. It does, for
changes *after* hydration; it cannot help with a store that has already moved by
the time hydration begins.

It now runs from a mount effect in `WebMcpBridge`, which `root.tsx` renders once
on every route — and deliberately outside that component's `isWebMcpAvailable`
guard, because `P`, `X` and Enter work on a browser with no WebMCP host at all
and their marks have to come back there too.

**The way this was found is the point.** The flags themselves were completely
fine: three on screen, three in `get_view_context`, three with titles, three with
palettes, and a working deal afterwards. A harness that had only asked "did the
flags come back" would have gone green over a page that was throwing a hydration
error on every load. It asserts zero page errors as well, which is the only
reason the run was red.

### One nuance the submission needs, found by measuring it

**The flags persist; whether you can *see* all of them depends on the search.**
On one §9 run the store held all three after a refresh — `get_view_context`
returned 1 pick and 2 rejects, exactly what went in — while only one mark was
visible on the grid, because the re-run search did not bring the other two works
back onto the page. On the `harden` run minutes earlier all three were visible.

That is not the persistence failing. A flag on a work that is not currently on
screen is ordinary state — running a second search does the same thing with no
reload involved — and the mark reappears when the work does. But it means the
honest sentence is about the *board*, not about the pixels:

> Refresh the page and your picks and rejects are still there — the agent still
> sees them, and Enter still deals from them.

rather than "refresh and the board looks exactly the same", which is not
something the search results guarantee.

It also cost me a harness bug worth recording: my first check scored the clause
on how many marks were visible, which is stricter than what §9 asks ("flags
persist per session; `get_view_context` returns them") and would have failed the
build for something the product does not promise. The check now asserts the
state and reports the visible count beside it.

### Verified on staging

`scripts/demo/harden.mjs`, case `reloaded` — flag `X X P`, refresh, then look:

| | before the fix | after |
| --- | --- | --- |
| flags on screen after reload | 3 of 3 | **3 of 3** |
| flags in `get_view_context` | 3 | **3** |
| restored with a title | 3 | **3** |
| restored with a palette | 3 | **3** |
| Enter still deals afterwards | yes | **yes** — *"One pick holds — bone."* |
| page errors | **4 × React #418** | **0** |

---

## 11. The spoken turn that was answered in silence

### What the harness could finally see

Last round I could not drive the page's recogniser at all and reported clause 4b
as unverified. The cause was mine and it was dull: I read the mic control's
`boundingBox()` without scrolling it into view first. That box is
viewport-relative, and by clause 4 the board is dealt and the bar can be well
off the top of the screen — so the harness pressed at coordinates holding
something else entirely and honestly recorded "the transcript never landed".

With the control scrolled under the cursor, on staging:

```
micRendered              true
recognisersAfterHold     1          the hold really did start listening
drove                    "said"     the transcript reached onresult
utteranceLandedInField   "Something quieter, please."
silentAfterTyping        true
heardBackAfterSpeaking   []         ← nothing
```

**"A voice utterance lands in the editable field" is now verified by this lane**,
by holding the control, speaking, and releasing into the 1.2 s grace bar.

### And then a real defect underneath it

Nothing was spoken back, and the reason is that two rules in this build pull
against each other:

- §5: *"The agent's note is a wall label above the board. Spoken **only if** the
  human's last turn was spoken."* — the thing spoken is the note.
- The system prompt: *"Never repeat your note as your reply… either add one
  sentence the note does not say, or say nothing at all."* — and most turns,
  correctly, it says nothing.

Speech was gated on `message.content`. So the model wrote a note, added nothing,
and the one sentence the human was owed sat on the wall unread. Measured: the
turn ran 13.9 s, the note came back — *"You asked for warmth; you kept the spare
monochrome sailor and rejected storm ships and the blue-grey Weymouth
Bay—following the pick"* — and the speakers stayed quiet.

It now speaks the reply when there is one and the wall label when there is not.
`firstSentence` caps either at one sentence, because the board is the rest of
the answer.

**I got this wrong once on the way.** The first fix read the note off
`board.note` only — and a board the agent pins with `set_results` carries its
note on `agentResults` instead, which is what the page renders in that case. So
it was still silent on staging for exactly the shape of turn that had failed.
It now takes whichever of the two is actually on the wall, newest first, with a
test for each and a negative control for both.

### It was my instrument, and I should have looked there three attempts sooner

Two fixes shipped, three staging round-trips spent, and the stub run still came
back `heardBackAfterSpeaking: []`. I had a fourth hypothesis about the code and
was about to act on it. Instead I made the harness record what the *page* had
logged during the turn, and got this:

```
Failed to execute 'speak' on 'SpeechSynthesis':
parameter 1 is not of type 'SpeechSynthesisUtterance'.
```

`window.speechSynthesis` is a **read-only accessor** in Chrome. My harness
installed its recorder with a plain assignment, which fails silently — so the
getter kept returning the native object, the page handed it my fake utterance,
and the browser refused it. The page had been calling `speak` correctly the
whole time. Every "silence" reading in the previous two rounds was my
instrument, not the build. `Object.defineProperty` fixes it.

### With the instrument working

`--voice=stub`, two runs, on web `e111d748`:

| | run 1 | run 2 |
| --- | --- | --- |
| utterance in the editable field | *"Something quieter, please."* | same |
| spoken after the *typed* turn | none | none |
| spoken after the *spoken* turn | the wall label | the wall label |
| spoken text is the note **verbatim** | yes | yes |
| page errors | 0 | 0 |

**Every clause 2/2, exit 0.** §9 now passes end to end in both modes.

> Following the picked boat and Breton port scenes, and moving away from the
> rejected tempest: quieter water, fewer dramatic gestures.

That sentence was on the wall and in the air, and nowhere else — the model
returned no reply of its own, which is what the prompt asks of it.

### The two fixes were load-bearing. The evidence I gave for them was not.

The spoken text being the note *verbatim* in both runs is the proof: `said` was
empty, so it is the `|| note` branch doing the work. Without it those turns
would have been silent for real. And the second fix matters because the note on
a `set_results` board lives on `agentResults`, not `board`.

**But the commit messages for both claim staging measurements that were
artefacts of the broken stub** — "measured on staging… nothing was spoken",
"was still silent on staging for the exact turn shape that had failed". Those
sentences describe my instrument. The changes are right and are now properly
evidenced by the table above; the reasoning I recorded at the time was not, and
that is worth more to whoever reads this next than a tidy history would be.

**Nothing here touches the text-first path.** The branch is only reachable when
the last turn arrived by voice; a typed turn stays silent, which has its own
test either side of these two and passed 3/3 in every `--voice=off` run and 2/2
here.

---

## Tests

Baseline, from the integration report: web 97 files / 1203 tests, api 46 / 857.
(The brief's 59 / 593 and 41 / 770 predate three lanes and no longer reproduce.)

| | result |
| --- | --- |
| `pnpm --filter web typecheck` | **exit 0** |
| `pnpm --filter web test` | **100 files / 1255 tests passed**, 0 failed |
| `pnpm --filter api test` | **46 files / 857 tests passed**, 0 failed |

+3 files, +52 tests on web. Nothing skipped, nothing deleted.

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
| `saveFlags` out of `publish` | 4 red in `flag-storage` — `restores what was on the board`, `keeps whose mark it was`, `does not restore the journal`, `forgets everything when the flags are cleared` |
| the flags-only retry out of `saveFlags` | `falls back to the flags alone when the records will not fit` — `expected [Array(1)] to have a length of 2` |
| speaking the wall label reverted to `said` only | `speaks the wall label when the model adds nothing to it` — `expected [] to deeply equal [Array(1)]` |
| the `agentResults` note source removed | `speaks the label of a board the agent pinned, not only a dealt one` |

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
| | …and it records what the *page* logged during a turn, which is the only reason the voice silence was ever traced |
| `scripts/demo/harden.mjs` | the deal beat slow, dead, empty, spent, refreshed, and called with ids that do not resolve |

The two `phantom` cases in `harden.mjs` are the one exception to the rule above:
they drive `flag_artworks` and `compare_artworks` through the debug console
because they are testing what those tools do with **bad input**, which is not
behaviour being demonstrated and cannot be reached by typing.

---

## Still open

- ~~**Flags do not survive a page reload.**~~ **Fixed in §10** and verified on
  staging: three flags before a refresh, three after, with their catalogue
  records and a working deal. **Safe phrasing for the submission: "flags last as
  long as the tab is open — refresh the page and the board is still yours."**
  Still unsafe: anything implying they outlive the tab, because closing it
  clears `sessionStorage` by design.
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
- ~~**The voice reply is unverified.**~~ **Verified 2/2 in §11**, once the
  harness stopped lying: the utterance lands in the field, the wall label is
  spoken back verbatim, and a typed turn stays silent. Safe phrasing: *"speak
  and the agent answers aloud; type and it answers in writing."*
- **Two harness flakes worth knowing about before a filmed take**, both
  environmental rather than product: the `?webmcp-debug` harness occasionally
  takes longer than 30s to mount (which is why `harden.mjs` only loads it for
  the two cases that need it), and the staging agent route returned 429 twice
  under parallel load. Neither reproduced when the harnesses were run serially.
