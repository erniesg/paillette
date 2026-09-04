# Devpost — the four judged questions, v2

`docs/webmcp-devpost-fields.md` is left in place, unedited. **Do not merge
them.** This file answers only the four questions the challenge judges. The rest
of the form (Inspiration, Built with, Testing instructions) can be lifted from v1
once the numbers in it are corrected — see §5.

This is a **revision** of the draft lane's v2, not a new document.

## What changed from the draft, and why

| Draft v2 | This revision |
| --- | --- |
| Q2: *"It re-selects the works and writes a wall label for every one of them — eighteen of eighteen."* | **Cut.** On today's deploy the correction turn worked in **1 of 4** hand-run attempts. What survives is the part that is real and checkable: the label is written *against* the statement, and the human's sentence is never overwritten. |
| Q2: the note example was the `warm landscape` capture | Kept, and joined by the **said/chose sentence** shot on staging in iteration 5, which is the stronger of the two. |
| Q3: the agent's dashed flag described as ordinary behaviour | **Qualified.** The tool works and a human can ask for it; the model has never chosen it unprompted in 508 recorded tool calls. Said plainly rather than found out. |
| Q3: *"picks hold their exact slot"* | Narrowed to what is measured: the deal plan pins a held id to the index it already had, so the layout delta is zero. There is an open layout defect above the board — §6. |
| Test counts quoted from mid-run | **97 files / 1204 tests (web) and 46 / 857 (api)**, both run on this tree this session. |

Everything else stands. Claims marked ⚠ are qualified in place rather than
softened.

---

## 1. Why is this use case a good fit for WebMCP?

Because the interesting state in Paillette is not in a database. It is on the
page, and it is made of gestures.

The National Gallery of Art's open-access collection is 63,253 works. Most of
them are not findable by name, because the person looking does not know the name
— that is the whole problem. What they have instead is a reaction: *not that
one*, *more like this*, *warmer*. A server-side MCP endpoint cannot see any of
that. It can search a catalogue. It cannot see which two works you just threw
out, which one you pinned, which one your cursor is resting on, or that you said
"warm" and then kept the grey harbour.

WebMCP can, because it lives in the page where those things happen. Our
`get_view_context` returns the human's current query, the works actually on
screen, the picks and rejects with the reasons attached, the current selection,
what is hovered, and whether the last change to the board was made by the human
or by the agent. Every one of those is a fact that only exists in a document.

The second reason is that the tools have to write to the same board the human is
looking at, not to a copy of it. When the agent flags a work, the badge appears
on the human's own card — dashed, because an agent's flag is a proposal until the
human confirms it with the same key they would have pressed themselves. There is
no synchronisation problem to solve, because there are not two states.

The third reason is honesty. A judge can open the page and watch the tools fire:
click the activity glyph and you get `document.modelContext · 25`, the tool
names, and then every call with its arguments, its result and its duration.
That is a claim about implementation that does not have to be taken on trust.

## 2. How does WebMCP improve the user experience of this app?

It supplies the words for what the human just did.

Paillette's culling loop is deliberately old. Lightroom's keys, unchanged: `P`
picks the work under the cursor, `X` rejects it, `U` clears, `C` puts two side by
side, and Enter on an empty bar re-deals the board from your flags. The scoring
underneath is Rocchio relevance feedback from 1971, over `jina-clip-v2` image
embeddings:

```
score(x) = cos(x, mean(positives)) − w · max(cos(x, each negative))
```

`max` on the negatives rather than a mean, so one emphatic rejection pushes a
whole visual region away instead of being diluted by milder ones. `w` is 0.5 by
default, 0.8 when the agent asks to tighten, 0.25 when it asks to widen. Twelve
cards, so every move reads. Picks hold their slot; rejects slide to a tray at the
left edge and stay restorable; newcomers arrive from the right.

None of that needs an agent, and that is the point. What the agent adds is a
sentence.

Reject two works, keep one, type a sentence, and the wall label above the board
reads:

> *"Following the pick: sunset watercolor; away from the firelit scene and the
> red-chalk landscape."*

The human never typed "firelit" or "red chalk". They pressed `X`, `X`, `P`. The
rejects were *Harvesters by Firelight* and a Berchem drawing whose medium is
literally `red chalk on laid paper`. The agent is handed the four indexed
dominant-colour swatches, the medium, the year and the classification of every
flagged work — the same fields printed on the card — and one instruction: name
the visual property you can see in the record, not a mood you associate with the
artist's name. The swatches it wrote from are drawn under the sentence, picks
whole and rejects struck through, so the claim is checkable without leaving it.

We tested this by varying the flags rather than assuming. Three runs of the same
walk on the deployed build produced three notes, and every noun in all three is
true of a specific work that was on the board — medium, classification and
palette checked one at a time. The strongest evidence is one work flagged both
ways: the same etching described the same way, and moved from *the thing you
kept* to inside *the palettes you rejected*, with its swatch strip whole in one
frame and struck through in the other.

⚠ It is not perfect. An earlier round produced a note that was accurate but
generic — *"darker, crowded scenes"* — and one run called a drawing a painting.
It misdescribes a medium occasionally; it does not invent boards.

The second improvement is that the words are two-way. The agent drafts a title
and a statement. The human rewrites the statement — *"it is not about weather, it
is about leaving"* — and committing that edit is itself a turn. Two things then
hold, and we checked both on the wire:

- **The human's sentence stays the human's.** It comes back `by: "human", theirs:
  true`, and an agent write onto a field the human has edited is parked as a
  proposal rather than landing.
- **The labels are written against that sentence, not against the picture alone.**
  Same works, same call, only the statement changed: three of three came back
  substantively different, and not as paraphrases. A pair of Bruegel portraits in
  separate oval frames, under *Weather at Sea*: *"the print shifts weather into a
  human exchange: a condition imagined through companionship rather than an open
  horizon."* The same print under *Leaving*: *"held close by the print's paired
  arrangement but never meeting. Their separation gives the exhibition's moment of
  departure a fixed, formal shape."* If the label read the same under both, the
  feature would be fake. It does not.

⚠ **The correction is not yet reliable.** Run by hand four times on the current
deploy, the turn that re-selects works around the new statement produced a full
result once, changed nothing twice, and timed out once. The cause is a turn
budget: `MAX_TURNS` is 8 and a drafting turn routinely spends five or six of them
searching, so the correction starves. The contextual label is real; the
re-selection around it is a coin flip today, and we would rather say so.

The result leaves the tab. `https://paillette-stg.berlayar.ai/e/MKwsxHy` is a real
exhibition that opens in a browser with no session, no cookies and nothing in
local storage — the loader re-fetches every record by id on the server before a
pixel is sent. It carries agent-written labels — *"The valley empties of light
before anyone has decided to go."* — and one the human wrote themselves — *"Two
people sitting for a picture that will outlast the room."* It serves real Open
Graph tags, and a colophon counted from the data rather than asserted: *"4 of 6
labels written by an agent."*

## 3. What can people and agents do together here that was hard or impossible before?

**Two things, and we would defend the first hardest.**

### When your words and your gestures disagree, the agent follows the gestures and says so.

Keep three warm pictures. Then type the opposite:

> *"I want something cool and blue and severe. Nothing warm."*

The wall label comes back:

> *"You said blue, but picked three amber-brown sunset drawings and paintings;
> following the picks."*

The three picks hold their slots. The works that arrive are *Clouds at Dawn*,
*Marsh Landscape at Twilight*, *Landscape with Storm* — amber and dusk, not blue.
Run cold, typed, twice, on the deployed build.

That is one sentence doing three things: quoting what was typed, naming what was
chosen in terms of the pixels rather than the catalogue, and saying which of the
two it followed.

No search box has both signals. A search box has words and no gestures. A chat
window has words and no gestures either — it just has more of them. A
recommendation feed has gestures and no words, and never tells you what it
concluded from them. Paillette has both in one payload: every human turn carries
`{ text?, flagsDelta, selection, hovered, compareChoice }`, so the sentence and
the clicks arrive together and can be compared. When they conflict, the system
prompt says to follow the clicks and name the conflict out loud.

That inverts the usual burden. The human does not have to author a good query —
which is the thing they cannot do, because they cannot name what they want. They
react, and the agent puts words to the reaction. When it gets the words right,
the human has heard their own taste described for the first time. When it gets
them wrong, the human corrects the *words*, which is a thing people are good at,
and the correction steers the next deal.

### There is one workspace with two operators, and no agent-only path through the loop.

Every tool in the culling loop wraps an operation the human can perform with a
key:

| Tool | The human's version |
| --- | --- |
| `flag_artworks` | `P` / `X` / `U` on the hovered or focused card |
| `redeal` | Enter on an empty bar |
| `search_by_exemplars` | what Enter calls |
| `compare_artworks` | `C` |
| `set_view` | the view tabs |
| `show_artwork` | clicking a card |
| `set_exhibition` | editing the title, statement or label in place |

This is not a design intention; it is one import. `submitHumanTurn` — what the
human's Enter runs — and the `redeal` tool both call the same `runRedeal`. Same
function, either hand.

And it is checkable by taking the agent away, which is how we checked it. With
the model route hard-refusing `429`, the loop keeps working: nine assertions,
three runs in a row. With no WebMCP host on the page at all, `P` and `X` still
flag and Enter still deals. The headline beat is asserted **negatively**, counted
off the wire rather than trusted: four silence-gated runs — no traffic to the
model route for twenty consecutive seconds, then every request timed from the
keypress — measured **zero model calls** and exactly one request, a vector search
that left the browser **8 to 29 milliseconds** after the key. Twenty-seven further
redeals across five harnesses in an earlier round: zero POSTs to the agent route,
every time. The board deals rather than cuts: 15 to 27 distinct grid layouts per
redeal across hundreds of sampled frames, where a jump cut measures four or five.

That is what makes "two operators" true rather than rhetorical. The agent is not
the mechanism. It is a second operator of a mechanism that works without it, and
what it adds is strategy and language.

**Where the claim has a dent, and we would rather say so than be found out.**

- **The agent proposes far less often than it can.** `flag_artworks` and
  `compare_artworks` work: ask for them — *"mark the ones on this board you would
  throw out"* — and six provisional rejects land in dashed agent ink beside the
  human's solid marks. But across 508 model-chosen tool calls in every transcript
  we recorded, the model chose `flag_artworks` zero times and `compare_artworks`
  zero times unprompted. It narrates well and proposes rarely. That is a prompt
  problem, not an architecture one, and it is the first thing we would fix.
- **Two of the twenty-five tools have no human control today.** A human can edit
  any wall label by hand, but cannot press a button to draft six at once
  (`write_labels`), and cannot name a region of the atlas (`annotate_atlas`).
  Both should wrap a human affordance and currently do not.
- **The deterministic half has a horizon.** The exemplar route asks the vector
  index for a fixed pool of candidates and then subtracts everything already
  dealt, so after about five redeals against an unchanged pick set the board thins
  and then empties. Every property that matters still holds while it does — no
  reject ever returns, the pick never moves, no model is ever called — but Enter
  eventually stops producing new work, and the pool should widen instead.

### And it survives being shared.

The artefact at the end is not a transcript. It is an ordered hang, a wall label
per work written against the human's own statement, a considered-and-declined
tray, and a URL that opens for a stranger with no account. Neither party could
have produced any of it alone: the human could not have found six works out of
63,253 they could not name, and the agent could not have known the show was about
leaving.

## 4. How was WebMCP implemented?

**25 tools on `document.modelContext`**, registered by a feature-detected bridge
in `apps/web/app/lib/webmcp/`. Read them off the deployed page yourself:

```js
(await document.modelContext.getTools()).map(t => t.name)
```

**Registration** (`registry.ts`). The host is resolved without being touched if it
is absent — `document.modelContext` first, then `navigator.modelContext`, because
different vintages of the proposal expose it in different places — and every entry
point returns a no-op disposer when neither exists, so a browser with no WebMCP
renders a byte-identical page. Tool names are unique per document and
re-registering one *rejects*, so registration is reference-counted by name rather
than by caller, and each name has its own promise queue that outlives the entry it
belonged to. That last detail was a real bug: React StrictMode's double-mount
dropped an entry synchronously while its unregister was still in flight, the new
`registerTool` overtook the old `unregisterTool`, and the page tore down its own
tool surface and then reported every tool as already registered. `registerTool`
may return void, a handle, or a promise of either, so three teardown paths are
probed in order.

**The host API, tested rather than assumed** (Chrome 152 with
`--enable-features=WebMCPTesting`). `getTools()` returns *descriptors* — none
carry `execute`; executing is the host's job. The call is
`document.modelContext.executeTool(toolObject, JSON.stringify(args))`: the
`RegisteredTool` object, not a name, and a JSON **string**, not an object. Both
mistakes fail opaquely.

**The tools.** Names and argument shapes, verbatim from
`apps/web/app/lib/webmcp/tools.ts`:

```jsonc
flag_artworks   // an agent flag is a proposal, drawn dashed until confirmed
{ "flags": [ { "artworkId": string,
               "flag": "pick" | "reject" | "clear",
               "reason": string } ] }        // 1–3 per call, reason ≤ 200

redeal          // the same function the human's Enter runs
{ "keep": "picks",                           // the only value; picks always survive
  "strategy": "tighten" | "widen",           // negative weight 0.8 / 0.25; omit for 0.5
  "count": integer,                          // 1–60, default 12
  "note": string }                           // ≤ 160 — the wall label, one sentence
→ { "kept": [...], "removed": [...], "added": [...], "order": [...],
    "exemplars": { "positive": [...], "negative": [...] },
    "strategy": string, "note": string }

search_by_exemplars                          // server-side Rocchio, no embedding call
{ "positiveIds": string[],                   // 1–32; their mean is the query
  "negativeIds": string[],                   // ≤ 32; scored with max, not mean
  "excludeIds":  string[],                   // ≤ 400 — everything already dealt
  "topK": integer }                          // 1–100, default 12

compare_artworks
{ "artworkIds": [string, string],            // exactly two
  "question": string }                       // ≤ 200, set between the works
→ { "kind": "winner", "winnerId": string, "loserId": string }
| { "kind": "neither", "artworkIds": [...], "reason": string }

set_exhibition                               // every field optional; writes merge
{ "title": string, "statement": string,
  "works": [ { "artworkId": string, "label": string, "position": integer } ],
  "removeArtworkIds": string[] }

write_labels                                 // refuses with NO_STATEMENT if there is no theme
{ "artworkIds": string[], "voice": string }  // 1–12, in hanging order
→ per work: { "label": string, "source": "caption" | "catalogue" }

get_view_context                             // read-only; the whole point
→ { page, humanSearch, humanResults, agentResults, openArtwork,
    flags:      { picks[], rejects[], provisional[], exemplars },
    selection, hovered, compare,
    board:      { order[], works[], note, lastChangeBy, redeals, dealtThisSession },
    exhibition: { title, statement, works[], regions[], unlabelled } }
```

The remaining seventeen are the search, description and indexing surface:
`list_collections`, `search_artworks`, `search_by_image`, `search_by_color`,
`browse_collection`, `lookup_artwork`, `describe_artwork`, `get_search_quota`,
`set_results`, `show_artwork`, `set_view`, `get_exhibition`, `annotate_atlas`,
`create_collection`, `add_to_collection`, `index_zip`, `index_folder`,
`get_index_status`.

**Where the loop runs.** The turn loop decides server-side at
`POST /api/public-agent/turn` (`apps/api/src/routes/agent.ts`; the key is a Worker
secret, so no API key is ever in the page). Every tool call it chooses executes
**in the browser**, against `document.modelContext`. The server never touches the
page and holds no copy of the board. Flags, selection, hover, the board order and
the exhibition draft are page-session state; nothing is persisted except a
published show.

**What the agent is given about a flagged work.** This is the part that decides
whether the narration is real, and it is the part we got wrong first. Every entry
in `flags.picks[]`, `flags.rejects[]` and in the turn payload's `flagsDelta`
carries the fields already printed on the card:

```json
{ "id": "open-access-art:nga:130607", "title": "Northern Landscape Fantasy…",
  "artist": "Nicolaes Pietersz Berchem",
  "palette": ["#EEC8AB", "#D88E5E", "#C4A88C"],
  "medium": "red chalk on laid paper", "year": 1660,
  "classification": "Drawing", "by": "human", "onBoard": true }
```

Before that, the entries carried only `id`, `title`, `artist` and `by` — so
everything the model could say about a rejected picture was inferred from two
proper nouns it happened to recognise, and it would have been confidently wrong
the first time a judge rejected a work by an artist it did not know. The fix was
to project the four indexed swatches, the medium, the year and the
classification into the payload, add one prompt line telling the model to name
the visual property in the record rather than the mood, and then draw those
swatches under the note so the claim is falsifiable on screen.

**Gestures as a turn.** Every human turn posts
`{ text?, flagsDelta, selection, hovered, compareChoice }`. Flags never trigger
the agent — Enter is the beat — or the board thrashes under the human's hands
while they are still deciding. A deterministic redeal *reports* the gestures
without spending them, so the same flags are still in the delta when the human
finally types something. A click in the two-up resolves as a pick on the winner
and a reject on the loser and rides the next turn, so an answer given by pointing
lands in the exemplars whether or not anything is said.

**Deterministic first.** `search_by_exemplars` is a server route over the existing
`jina-clip-v2` Vectorize index at 1024 dimensions, reusing vectors already stored,
so a redeal makes no embedding call and is metered against no model quota. The
positive mean is unit-normalised and handed straight to the index, so the positive
term *is* the index score; with negatives present the top candidates are
re-fetched and re-scored by hand. Enter on an empty bar calls that route directly,
with no model anywhere in the path.

**Making it inspectable.** The registry takes an `onExecute` observer that wraps
every call, which feeds the activity glyph — five monospace cells at rest,
animating differently by tool kind while one runs, and expanding into a log of
every call with its arguments, its result and its duration, each row openable into
the full request and response. No prose anywhere in it. Before the first run it
shows the tool surface instead of an empty box: `document.modelContext · 25` and
the names, read from the registry rather than hardcoded.

**Testing.** `pnpm --filter web test` — **97 files, 1204 tests** — and
`pnpm --filter api test` — **46 files, 857 tests** — both green on this tree.
Alongside them, checked-in Playwright harnesses under `scripts/demo/` and
`apps/*/scripts/` that drive the **deployed** build rather than a dev server:
`e2e-deterministic.mjs` (asserts zero model calls, negatively, off the wire),
`verify-agentless-loop.mjs` (the loop with the model route refusing),
`verify-contextual-labels.mjs` (the same works under two statements),
`e2e-curation.mjs` (the statement correction, driven the way a person types it),
and `verify-exemplars-live.mjs` (the scorer against the real 63,253-work index).

---

## 5. Numbers to fix before pasting anything from v1

`docs/webmcp-devpost-fields.md` says **seventeen tools** in three places (*How we
built it*, *Testing instructions* → gate check, *What you updated*). It is **25**.
The count is derived from `PAILLETTE_TOOL_COUNT` in one place now, and a registry
test fails if the list and the factory disagree, because this number has been
wrong twice — first 17 when it was 21, then 21 when the exhibition tools took it
to 25.

The gate check should read:

> `(await document.modelContext.getTools()).length` should be **25**.

The *Testing instructions* live URL should be
`https://paillette-stg.berlayar.ai/nga/search`, not `/try`. `/try` indexes a zip
and is the throat-clearing; `/nga/search` is where the loop is. **No
`?webmcp-debug` is needed** — the utterance bar and all 25 tools render without
it, verified on the deployed build. Tell a judge the three keys: hover a work and
press `P` or `X`, then press Enter on the empty bar.

⚠ **Do not send a judge to the bare domain.** `https://paillette-stg.berlayar.ai`
is a marketing page headed *"Powerful Features"* and the string `/nga/search`
appears in no link on it. Link the deep URL directly, or add one link to the root.

*"Curate with your agent"* moves out of **What's next** and into **What it does** —
with the qualification in §2: the contextual label ships, the automatic
re-selection around a corrected statement does not yet work reliably.

---

## 6. One open defect, stated here so nobody has to discover it

The deterministic redeal writes no wall label, and the label's wrapper collapses
when it is empty (`empty:hidden`), so the human's own Enter deletes the agent's
sentence and the whole board — picks included — slides up 56 px into the gap. It
lands on the beat whose entire content is that the picks do not move.

The fix is small and already has a home: `redeal`'s schema carries
`note?: string`, so the deterministic path can write its own one-line label with
no model call — which would also make the point better, by leaving a wall label
on the board at the exact moment the model is switched off.
