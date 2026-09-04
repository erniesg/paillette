# Critique, iteration 1 — would this win the WebMCP Challenge?

Read: `BRIEF.md` in full; `docs/night/integration-report.md`, `e2e-report.md`,
`shared-state-report.md` + notes, `visuals-report.md` + notes,
`voice-loop-report.md` + notes, `activity/docs/night/activity-report.md`; the
`night/curation` branch's five commits and its code (there is no curation
report); `docs/night/shots/` and `docs/night/e2e-evidence/`; and staging, live.

**Verdict: FAIL.** Eleven blocking items in `verdict.json`. This is not a bad
night's work — the reports are the most honest set of engineering documents I
have read on a project like this, and three of them caught their own false
positives before I could. It fails because two claims the submission wants to
make are not supported, and because the half of the brief that actually answers
the challenge's question is on a branch that is not merged, not deployed and not
proven.

---

## The short version

The night set out to get past delegation and it half succeeded. The half that
succeeded — **the deterministic culling loop** — is genuinely excellent, is
proven to a standard almost nobody bothers with, and contains the strongest
WebMCP argument available to anyone entering this challenge.

The half that did not succeed is **the narration**. The thesis is *"the human
points, the agent puts words to what they did."* The agent cannot see what the
human pointed at. Everything it receives about the flagged works is a title and
an artist name. Its note is a plausible inference from two strings, and in three
runs out of three nobody tested whether it would still be plausible if the
strings were different.

And the half that would have answered the challenge's question outright —
**curate with your agent**, §5c — exists as good code on `night/curation` and
does not exist on the deployed build at all.

---

## 1. Is this still delegation wearing a costume?

**Mostly no, and that is the best news in the report.** There is one behaviour
that is categorically not delegation, and it is verified rather than asserted.

`docs/night/e2e-evidence/deterministic-network.json` records **every** request
the page made during a full run — cold load, three flags, two redeals, a
compare, a choice:

```
  855ms  GET   /api/public-search/nga/quota
  856ms  POST  /api/public-search/nga/text
 3111ms  POST  /api/public-search/nga/exemplars    <-- Enter #1
 7520ms  POST  /api/public-search/nga/exemplars    <-- Enter #2
```

Four lines. Zero to `/public-agent/turn`, asserted negatively so it fails if a
model call ever appears. And `verify-agentless-loop.mjs` runs the same loop
against an agent route hard-refusing with a 429 — the real failure mode found
while rehearsing, not a hypothetical — and the loop keeps working: 9 checks,
three times in a row.

That is the thing to build the submission on. *There is no agent-only API;
there is one workspace with two operators, and one of them can leave.* Every
competitor's entry will stop working when their agent stops. This one does not,
and it is testable rather than rhetorical.

The gesture channel is real too. `flag_artworks`, `redeal`, `compare_artworks`
and `search_by_exemplars` are the same functions `P`/`X`/`U`/`C`/Enter call.
`board-keyboard.ts:135-165` is mounted on the product route
(`galleries.$galleryId.search.tsx:5082`), not just in the harness. The agent's
flags land dashed and provisional until the human confirms
(`flags.ts:101-108`), so the two hands are distinguishable in the data and not
only in the ink.

**Where it is still delegation:** the *agentic* beat is unchanged — you type a
sentence, three model calls happen, a board arrives 12–35 seconds later. The
"gestures outrank words" line rides on top of that request; it is not a
different interaction shape. And the said/chose gap is the only emergent thing
in the loop. §6 hopes for vocabulary transfer and drift; neither is demonstrated
anywhere in any report.

---

## 2. Does "gestures outrank words" actually happen?

**It happens as a sentence. It does not happen as an observation.** This is the
most likely way the submission is hollow, and the reports contain enough
evidence to settle it against themselves.

### What the model actually receives

From `docs/night/e2e-evidence/agent-runs.json`, the turn payload, verbatim:

```json
{"text":"I want something to hang above the sofa in my living room. Warm, not busy, nothing grim.",
 "flagsDelta":[
   {"artworkId":"…50295","title":"Peaceful Valley (Alexander Helwig Wyant)","to":"reject"},
   {"artworkId":"…184224","title":"Vicinity of Morestal (François-Auguste Ravier)","to":"reject"},
   {"artworkId":"…144846","title":"The Dawn of Creation (Samuel Jackson)","to":"pick"}],
 "selection":[],"hovered":{…},"compareChoice":null}
```

And `get_view_context`'s flags, from `e2e-evidence/get_view_context.json`:

```
.flags.rejects[].id      .flags.rejects[].title
.flags.rejects[].artist  .flags.rejects[].by     .flags.rejects[].onBoard
```

Five fields. No colour, no medium, no year, no description, no thumbnail, no
embedding neighbourhood — nothing about what the work looks like. The word
"colour" appears once in the whole document, in `humanSearch.colour: null`.

And the agent never went looking. Across all three runs:

```
lookup_artwork    0
describe_artwork  0
```

So **"leaving the darker pastoral mood behind" was generated from the strings
"Peaceful Valley (Alexander Helwig Wyant)" and "Vicinity of Morestal
(François-Auguste Ravier)".** A tonalist and a Barbizon-adjacent painter, both
of whom the model knows from training. The note is a competent art-historical
guess about two names. It is not the agent reading the board.

The e2e report gets to the edge of this itself and stops one step short: *"'the
darker landscapes' is true of both rejects but could have been produced from the
titles alone. It is content, not bookkeeping, so it passes the check as
written."* It passes the check as written because the check is written too
loosely. It **was** produced from the titles alone. There was nothing else.

### The experiment that was not run

The three runs used **the same two rejects and the same pick every time.** That
is one condition sampled three times. It cannot distinguish a grounded note from
a generic one, because a generic note and a grounded note produce identical
output when the input never varies.

The discriminating run is trivial and costs three model calls: same instruction,
reject the two *brightest* works instead. If the note still says "the darker
landscapes", the feature is a canned string and the first judge who tries it
will find out. Nobody ran it.

### The corroborating evidence from shared-state

`shared-state-report.md` volunteers the finding that makes this worse, and
deserves credit for it:

> The said-versus-chose behaviour comes from the **system-prompt rule**, not
> from the turn payload. Three earlier control runs *without* the payload
> produced the same sentence… **Do not claim the payload is what makes the agent
> follow the picks.**

Combine the two: the sentence shape comes from the prompt, and the only content
in it comes from two titles. What is left that is genuinely new? The flags do
reach the model via `get_view_context`, so it is not fabricated — but the
mechanism is "a model was told to say this, and given two names to say it
about."

### And it misquotes the human, in the load-bearing sentence

Two of three notes say *"You said warm **and calm**"*. The sentence typed was
"Warm, not busy, nothing grim." Nobody said calm. A judge reading the wall label
against the instruction on screen will see the agent putting a word in their
mouth in the exact beat where the pitch is *"it heard what you actually said."*

### The fix is cheap and it is in the repo already

The works carry indexed dominant colours — `search_by_color` works, and the
cards render four swatches plus a match percentage (visible in
`e2e-02-flags-XXP.png`). Medium, classification and date are on the card too.
Put colours + medium + year into the flag entries and into `flagsDelta`, and add
one prompt line: *name the visual property in the record, not the mood.* Then
render the note with the swatches it is talking about set beside it. That turns
"a note that sounds right" into "a note with its receipts on screen", which is a
different thing to put in front of a judge.

---

## 3. Would a judge who opened staging cold reach the good part?

**No.** Three walls, any one of which is sufficient.

1. **The prompt bar requires `?webmcp-debug`.** Without it the page has no
   utterance bar. The flag is documented in the brief and in the integration
   report; it is not documented anywhere a judge is looking. So a cold visitor
   gets a search page with no agent.
2. **Nothing announces the deterministic beat.** Hovering a card does reveal
   small `P` `X` `U` buttons in the corner, so a curious person might flag
   something. Nothing whatsoever announces that Enter then redeals from those
   flags — the single strongest behaviour in the build has no affordance at all.
   §5b is right that the interface should not explain itself in prose, but "no
   prose" is not the same as "no affordance". A mark, a hairline, a change of
   state on the bar once a flag exists — something.
3. **The obvious queries are empty.** `"warm landscape"` and `"golden light"`
   return **zero** works on staging. `"storm at sea"` returns 4. `"sunset
   landscape"` returns 30. A judge typing the phrase the demo instruction uses
   gets a blank page.

The one thing that *does* survive a cold open is the loop with no host —
`e2e-17` proves `P`, `X` and Enter work with no debug flag and no agent on the
page. But only if you already know to press them.

---

## 4. Do the visuals hold up?

**Split. The best of them are excellent and are in the wrong place; the product
page is a competent grid with a chat panel on it.**

What is genuinely outstanding, and I would put in front of anyone:

- `20-two-up.png` — the compare room. Two works at scale on charcoal, the
  question set in serif cyan between them, wall labels beneath, nothing else.
  That is a museum, not a UI. **It is at `/night/deal`, a harness, against a
  40-work fixture. On `/nga/search` the same overlay renders 1,700 px below the
  fold** (§5.1 of the e2e report), so the thing a viewer sees is a question over
  an empty page.
- `40-exhibition-page.png` — *Everything the Light Left Behind*, a 61-word
  statement in a serif column with a hairline rule, works large below with
  small-caps labels. It is the single best-designed artifact in the whole
  build. **It is on an unmerged branch, `/exhibition` is 404 on staging, and the
  title and statement in the shot are hand-authored fixtures** — no capture
  script is committed and no model run produced them.

What is on the deployed page: a competent dark masonry with good typographic
detail on the cards (serif title, mono catalogue line, colour chips, match
percentage) — and, in every un-curated shot, a fixed panel across the lower left
titled **AGENT ACTIVITY ● WEBMCP CONNECTED**, containing a mini-board, the
agent's note printed a second time, and a scrolling list of tool calls with JSON
arguments. It sits on top of the board, which is where the pinned picks are.

There is a second visual problem nobody flagged. §7 says *"the works are the
only saturated thing on screen."* On the `"sunset landscape"` demo query the
NGA's open-access results are largely grey etchings, drawings and charcoal
studies (`e2e-13`, `e2e-07`). A charcoal ground plus charcoal artworks is a grey
screen. The `"storm at sea"` shots (`e2e-02`) are much better — Inness, Cazin,
warm skies. **Choose the demo query for colour, not just for result count.**

Would this stand out? The two-up and the exhibition page would. What is
currently deployed would not.

---

## 5. Is the WebMCP story real?

**Yes, and it is the strongest part of the submission after the network log.**

21 tools on `document.modelContext`, enumerable live via
`window.__paillette_webmcp.tools()`. The load-bearing ones each wrap an
operation the human performs with the same keystroke:

| tool | human twin | verified |
| --- | --- | --- |
| `flag_artworks` | `P` / `X` / `U` on the hovered card | `board-keyboard.ts:135` |
| `redeal` | Enter on an empty bar | `board-keyboard.ts:100-113` |
| `compare_artworks` | `C` | `board-keyboard.ts:153-165` |
| `search_by_exemplars` | what Enter calls | same route |
| `set_view` | the Masonry/Salon/Atlas/Table switcher | on screen |

And the asymmetry is deliberate and in the right direction: an agent's flag is
`provisional: true` until the human touches it (`flags.ts:101-108`), and
`flags.ts:150` excludes provisional flags from the exemplar set — so the agent
can *propose* in the human's currency but cannot silently steer the engine. That
is a better answer to "how do people and agents share a workspace" than most
entries will have.

Two dents:

- `write_labels` (on `night/curation`) is genuinely agent-only — no UI path
  batch-generates labels. It is a small hole in a claim stated absolutely.
  Give the label field a human-pressable "draft this" and the hole closes.
- `set_results` lets the agent put an arbitrary list on the board; the human's
  equivalent is running a search, which is a stretch but defensible.

The inspectable tool log is the honest answer to *"how was WebMCP
implemented"* — a judge can watch the calls fire with arguments, results and
durations. That is a real asset, currently wrapped in chrome that undercuts it
(see next section) and fixed on `night/activity`.

---

## 6. Is the interface too wordy?

**Yes, badly, and in exactly the ways §5b names by name.** Counting words on
screen in `e2e-13-agent-note-run1.png` that are not the artwork's own catalogue
data:

| region | words | verdict |
| --- | --- | --- |
| nav — Paillette · About · Log in · Create account | 5 | product chrome, fine |
| breadcrumb — NATIONAL GALLERY OF ART, WASHINGTON / COLLECTION SEARCH / **0MS** | 8 | the `0MS` is a stale readout showing zero. Defect. |
| `874 FREE SEARCHES LEFT` | 4 | fine |
| Text · Image · Colour | 3 | fine |
| `SEARCH` (twice, on the button and on the chip) | 2 | one is redundant |
| placeholder *"something warm for above the sofa"* | 6 | **helper text. Defect.** |
| `Ask`, beside a bar that already looks like a bar | 1 | **restates the control. Defect.** |
| Relevance · Colour · Artist · Title | 4 | fine |
| VIEW · Masonry · Salon · Atlas · Table · Settings 30/30 | 8 | fine |
| **AGENT ACTIVITY ● WEBMCP CONNECTED** | 4 | **narrates the mechanism. Defect.** |
| **PINNED BY THE AGENT · 12** | 5 | **narrates the mechanism. Defect.** |
| **the agent's note, printed a second time** | ~14 | **the exact duplication §5b objects to. Defect.** |
| **TOOL CALLS** | 2 | **narrates the mechanism. Defect.** |
| **`redeal` / keep "picks" strategy "tighten" count 12 / done** | ~14 | **Defect** (in the default state; fine behind a click) |
| **`get_view_context` / read the view · nga · 30 on screen** ×2 | ~18 | **Defect.** |

**≈ 100 words of non-artwork chrome, of which roughly 55 are the agent
explaining itself and one sentence appears twice.** Six distinct §5b violations.
The agent's note itself is one sentence in all six recorded instances, so that
rule is being kept — it is the frame around the note that is loud.

Does it need a legend? Partly. The `P` `X` `U` buttons on the hovered card are
themselves a legend — three letters that mean nothing until you know Lightroom.
That is defensible (it is the pre-existing paradigm the brief asked for) but it
is not "needs no legend after one second". Enter-to-redeal needs a legend and
does not have one, which is worse: it has neither affordance nor explanation.

**`night/activity` fixes almost all of this and merges cleanly.** It deletes the
header pill, the mini-board, the repeated note and the empty state, and leaves a
69 × 33 px glyph resting on `·····` with no text anywhere on screen; the log is
behind a deliberate click. Its six glyph motions are visibly distinct in a real
browser (32 checks, contact sheet). Note that four files in that worktree are
modified beyond the last commit — including dismiss-on-outside-click — and a
plain `git merge` of the branch as committed would lose them.

---

## 7. Does the whole loop work by typing alone, voice off?

**Yes. This one passes cleanly and is well proven.** No beat depends on speech.

- Cold load with focus on `BODY`, so the culling keys are live immediately —
  the `autofocus` hazard two lanes called "the single most likely thing to spoil
  a take" is fixed and holds on the deployed build.
- `X`, `X`, `P` by keyboard; three requests during flagging, none to the agent.
- Enter on the empty bar → deterministic redeal, zero model calls, both paths
  (`isEmptyUtteranceBar` and `isBareBoardEnter`) exercised.
- The sofa sentence typed into the bar fires the agent every time, three runs,
  three model calls each, all 200, `"verbatim": true` asserted on all three.
- `compare_artworks` resolves and the choice writes pick/reject correctly.

The `--speak` truncation bug affects only the capture harness, not the typed
path, and the e2e report proves that by asserting the field held all 88
characters on every agent run.

Real speech remains unproven and unprovable on this VM: `webkitSpeechRecognition`
exists and `recognition.start()` is called, but nothing ever comes back — no
`onresult`, no `onerror`, no `onend`, silently. `speechSynthesis` has zero
voices. The voice lane is straight about this (*"the script installs a fake
recogniser, which makes the plumbing real in a real browser but not the
speech"*) and about the 700 ms flush being a guess. **Anything spoken must be
filmed on a machine with a microphone, and the 1.2 s grace bar has never been
watched by a human.** None of that blocks, because text is the primary path and
the primary path is complete.

---

## 8. The single weakest thing a judge would notice first

**That there is nothing there.** Open `https://paillette-stg.berlayar.ai/nga/search`
cold: an ordinary dark image search. No prompt bar (that needs `?webmcp-debug`).
No indication that the keyboard does anything. Type "warm landscape" — the phrase
the demo itself uses — and get zero results.

The runner-up, for a judge who *has* been given the demo URL: the compare. It is
the beat the brief calls "the demo's best ten seconds", the visuals lane built a
genuinely beautiful version of it, and on the product page it renders a question
in serif over 1,700 px of empty charcoal with the two works far below the fold.
If a judge clicks anything after seeing the deal, it will be that.

---

## 9. Does the curation half actually work?

**No, and it is the most consequential failure in the night — because this is
the half that answers the challenge's question.**

There is no `docs/night-curation-report.md` and no `docs/night/curation-report.md`.
The lane is still running, rate-limited, backing off at 900 s. Every sibling
lane shipped a report; this one did not. **There are no three by-hand runs to
read.** So the specific thing this critique was asked to judge does not exist,
and I judged the code instead.

What is genuinely built and good:

- A per-field provenance model that works. `applyText` (`exhibition.ts:99-116`):
  a human write always lands and clears pending proposals; an agent write onto a
  field the human has touched is parked as `proposed` and returned under
  `deferred`. Both the UI and the tool go through one merge function, so the
  rule cannot be true on one path and false on the other. **A field the human has
  edited is theirs** — this part is real and well tested.
- The label route hard-refuses without a statement (`labels.ts:199-208`,
  `NO_STATEMENT`), and the statement is in the brief sent to the model
  (`labels.ts:277-287`). The failure mode is closed off structurally, which is
  better than a prompt asking nicely.
- The "Neither" third door on compare is complete end to end: `NeitherControl`
  in the UI, `refuseCompare` rejecting **both** works as human flags with the
  reason attached, a discriminated union in the payload, and the server
  rendering *"refused both X and Y — that is a stronger signal than either
  choice."* Genuinely the cleanest work in the lane, and a better idea than the
  brief's own P4.

What does not work:

**(a) Editing the statement does not re-select or re-label anything.**
`writeExhibition` sets state and appends to a module-level `editJournal`, and
stops. Nothing re-runs selection. Nothing re-generates labels. The journal is
drained only by `prepareTurn`, reached only when the human submits a new turn
**with typed text** — and a bare statement edit with no text falls through
`submitHumanTurn`'s `if (text?.trim())` into `runRedeal`, the deterministic
flag-based redeal, **which does not read the statement at all.** §5c step 4 —
*"the agent re-selects and re-labels around that correction"* — is a line in
`apps/api/src/routes/agent.ts`'s system prompt and a doc comment in
`exhibition-head.tsx:5-7`. It is an aspiration, not a code path, and whether the
model complies has never been tested.

**(b) There is no evidence anywhere that labels are contextual.** The weather /
grief line is repeated in five places in the codebase — `labels.ts:6-10`,
`tools.ts:1797`, `tools.ts:1931`, the agent prompt, and `labels.test.ts:7-9` —
each time saying that if the label reads the same regardless of the statement
the feature is fake. **Every test stubs the model** (`stubOpenAi`,
`labels.test.ts:67-95`), and the strongest assertion in the file is
`expect(brief).toContain('A show about departure')` — i.e. the statement reached
the outbound HTTP body. That proves transport. It says nothing about
contextuality. The A/B test that would settle it — same `artworkIds`, two
statements, assert the labels differ — is precisely the test that was not
written. The two exhibition screenshots show one show with one set of labels, and
the title and statement in them are fixtures.

**So: I cannot judge whether the labels are contextual, because nothing in the
repo shows the same work under two statements.** That is the answer, and by the
brief's own standard — *"if the label reads the same regardless of the
statement, the feature is fake"* — an unfalsified feature is not a shipped one.
Six model calls settles it. Until they are spent, this is decorative, and it is
blocking.

**(c) None of it is on the deployed build.** `night/curation` is not merged.
`/exhibition` is 404 on staging. The branch conflicts with `night/integration`
on exactly one file — `galleries.$galleryId.search.tsx` — and the conflict is
semantic: integration's `e8c248e` deleted the `<ExhibitionHead />` mount to make
the dealt board a board, and curation adds `ShareExhibitionLink`,
`RegionedAtlas` and `useExhibition` at the same site. **As things stand,
integration has no UI entry point to the exhibition at all** — no editable
statement, no share button, no labels. Someone has to decide how the exhibition
head and the deal board coexist on one page. That is a product call and it is
the highest-value 30 minutes available in the fix phase.

Also: `pnpm --filter web test` on that branch is 1002 passed / 1 failed, and the
failure is a real bug in the lane's own new code — `share-link.tsx:65` throws
when `navigator.clipboard` is missing but the button text never changes, so the
copy-failure state the test asserts never renders. Typecheck fails on two files
that are committed but deleted from the working tree; that is worktree
inconsistency, not a code defect, but it needs clearing before a merge.

---

## 10. Is there a shareable exhibition page?

**In code, yes, and it is very good. In the submission, no.**

The design is right in the ways that are hard to get right:

- **Server-rendered.** `exhibition.tsx:98-181` is a Remix loader; the default
  export is pure `useLoaderData` with no `useState`, no `useEffect`, no store
  access, no `~/lib/webmcp/*` import. `Cache-Control: public, max-age=300,
  s-maxage=86400`, real OG meta.
- **Self-contained URL.** Title, statement, ordered ids and every label as JSON
  with one-letter keys → `deflate-raw` → base64url → one query param. Nothing
  stored on a server, so the link cannot rot and cannot be deleted out from
  under the person who shared it. Measured rather than assumed: a 12-work show
  with 150-char labels and a 300-char statement is a **~919-character URL**,
  24 works ~1080. Well under every real limit.
- **Images come from the institution's own IIIF URLs**, not from Paillette's
  session-gated `/assets/:id/content` — the exact trap that would make a shared
  link render twelve grey boxes for a stranger. It was seen and avoided
  (`exhibition.tsx:70-89`). Ids containing `/` or `%` are refused rather than
  sent, because percent-encoding a colon takes the request off the anonymous-read
  allowlist and 401s.

So the answer to *"does it survive being opened cold in a new browser by someone
who has never used Paillette"* is **yes by construction**, and the construction
is careful. But it has never been done, because there is nowhere to do it: the
route is 404 on staging.

And it is designed well enough to impress. `40-exhibition-page.png` is the best
thing in the build — a two-line serif title, a 61-word statement (within the
60–100 rule) in a measured column against a hairline rule, then works large with
small-caps labels and an honest colophon. If a judge opened that page they would
take the project seriously.

**Every word in it is a fixture.** No committed capture script produced the
shot; the title and statement are hand-authored strings that also appear in the
test files. So the page proves the *design* and the *transport*, and proves
nothing about the agent having written any of it.

---

## 11. What would make this win that nobody has built yet

Three proposals. The first is the one I would actually do.

### A. Make the shared URL carry how the show was made

Two assets are orphaned. The **ledger filmstrip** is built, tested, and imported
by nothing but `/night/deal` — three separate lanes each declined to wire it, all
for the same reason (it means deciding the activity panel is replaced), and
`night/activity` has now decided that. The **exhibition page** is server-rendered,
cold-openable, beautiful, and unreachable.

Put them together. Add the ledger's per-turn snapshots to the exhibition link
payload and render them at the foot of the shared page: six mini-boards, each
captioned in provenance ink — graphite for what the human did, cyan for what the
agent said — ending with the considered-and-declined pile.

Why this wins:

- It is **§6's artifact, made shareable**: "an ordered hang, a wall label the
  agent wrote from the human's gestures, a filmstrip of how they got there, and
  a considered-and-declined pile. None of it is a transcript, and neither party
  could have produced any of it alone." Right now that paragraph is a promise.
  This makes it a URL.
- It answers all four judge questions **on one page a judge can open cold**, with
  no account, no agent, no `?webmcp-debug`, and no risk of a tool failing on
  camera. That is worth more than any live demo, because it cannot break.
- It is the one thing in this space a chat-with-a-website provably cannot
  produce. A transcript is what every competitor will show. This is a transcript
  that is made of pictures and has no words in it that either party did not
  contribute.
- Cost: one field in the link payload, one component reuse, one section on a
  route that already exists. The compression headroom is there — 919 chars for a
  12-work show against a 2000-char soft limit, and six mini-boards are six lists
  of ids.

### B. Give the agent the pixels' proxy, and show its receipts

Per §2: add dominant colours + medium + year to the flag entries, and render the
agent's note with the swatches it is describing set beside it. The claim becomes
checkable in one glance — the human sees the two grey-green chips the agent
called "the darker landscapes", or sees that they are not grey-green at all.

This is small and it changes the category of the thing. An agent that says
something plausible is a party trick. An agent that says something and shows you
what it read is a collaborator you can argue with — which is the whole premise.

### C. Film the negative control

Two takes, same instruction, inverted flags: reject the two darkest, then reject
the two brightest. Cut them side by side. Six model calls.

If the note tracks, that is the most persuasive ten seconds available anywhere in
this submission, because it is the only thing that answers the objection every
judge will silently have — *"that sentence was probably canned."* If it does not
track, you found out before the judge did, and §2's fix is on the table with
hours to spare.

---

## Appendix — things I checked myself rather than taking from the reports

- `https://paillette-stg.berlayar.ai/nga/search?q=…&webmcp-debug` → 200, 0.82 s.
  `/night/deal` → **200 (the harness is deployed and unlinked)**. `/exhibition`
  → **404**.
- `get_view_context.json` field-by-field: flags carry `{id, title, artist, by,
  onBoard}` and nothing visual. The string "colour" appears once in the file, as
  `humanSearch.colour: null`.
- `agent-runs.json`: `lookup_artwork` 0, `describe_artwork` 0 across all three
  runs. `redeal` 3.
- `board-keyboard.ts:135/153` and `galleries.$galleryId.search.tsx:5082` —
  `P`/`X`/`U`/`C`/Enter are mounted on the product route, not only in the
  harness. `C` pairs the hovered card with the first confirmed pick, which is
  the right default.
- `flags.ts:101-108` and `:150` — agent flags are provisional and excluded from
  the exemplar set until a human touches them.
- Screenshots read at 1:1 rather than thumbnailed: `e2e-13` (chrome word count),
  `e2e-09` (the compare, full page), `e2e-02` (card detail, colour chips,
  `P`/`X`/`U` hover buttons), `20-two-up`, `01-deal-fresh`, `40-exhibition-page`,
  `42-exhibition-colophon`.
- `night/curation` → `night/integration`: one conflicting file,
  `galleries.$galleryId.search.tsx`, checked read-only via `git merge-tree`.
  `night/activity` → `night/integration`: clean.

## Appendix — what the reports got right, and should be said

Three lanes caught their own false positives and wrote them down rather than
shipping them. shared-state retracted its own causal claim about the turn
payload. voice-loop caught a harness that appeared to pass `P` and `X` only
because a turn in flight moved focus to `body`. visuals fenced its own
screenshots — *"the search shots are captured against a stubbed search
endpoint… those shots prove nothing about retrieval quality"* — and refused to
let the harness be mistaken for the product. Integration found a bug that 204
green checks across four lanes had all missed, because every test authenticated
as a signed-in user and the one code path that runs in production was the one
nothing exercised.

That is the reason this critique could be specific. A set of reports that had
oversold would have produced a vaguer and less useful FAIL.
