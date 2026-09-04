# Devpost — the four judged questions, v2

`docs/webmcp-devpost-fields.md` is left in place, unedited. **Do not merge
them.** This file answers only the four questions the challenge judges. The rest
of the form (Inspiration, Built with, Testing instructions) can be lifted from
v1 once the numbers in it are corrected — see §5.

## What changed from v1, and why

| v1 | v2 |
| --- | --- |
| Framed as delegation: *"you speak, it finds, it reads back"* | Framed as two operators on one board. The human's gestures are the input; the agent's words are the output. |
| *"Let AI be your eyes and ears"* | Cut. It makes the human passive, and the judged question is what people and agents do **together**. |
| "seventeen tools" (×3) | **25**, counted live off the deployed build. |
| No mention of the deterministic path | The deterministic path is the lead argument in Q1 and Q3. |
| Curation listed under "What's next" | Curation is shipped and demonstrated. |

Every substantive claim below is mapped to its evidence in
`docs/night/submission-evidence.md`. **Claims marked ⚠ are not yet demonstrated
end to end** and should be cut if the build does not catch up.

---

## 1. Why is this use case a good fit for WebMCP?

Because the interesting state in Paillette is not in a database. It is on the
page, and it is made of gestures.

The National Gallery of Art's open-access collection is 63,253 works. Most of
them are not findable by name, because the person looking does not know the
name — that is the whole problem. What they have instead is a reaction: *not
that one*, *more like this*, *warmer*. A server-side MCP endpoint cannot see any
of that. It can search a catalogue. It cannot see which two works you just threw
out, which one you pinned, which one your cursor is resting on, or that you said
"warm" and then kept the grey harbour.

WebMCP can, because it lives in the page where those things happen. Our
`get_view_context` returns the human's current query, the works actually on
screen, the picks and rejects with the reasons attached, the current selection,
what is hovered, and whether the last change to the board was made by the human
or by the agent. Every one of those is a fact that only exists in a document.

The second reason is that the tools have to write to the same board the human is
looking at, not to a copy of it. When the agent flags a work, the badge appears
on the human's card — dashed, because an agent's flag is a proposal until the
human confirms it with the same key they would have pressed themselves. There is
no synchronisation problem to solve, because there are not two states.

And the third reason is honesty. A judge can open the page and watch the tools
fire: click the activity glyph and you get `document.modelContext · 25`, the
tool names, and then every call with its arguments, its result and its duration.
That is a claim about implementation that does not have to be taken on trust.

## 2. How does WebMCP improve the user experience of this app?

It supplies the words for what the human just did.

Paillette's culling loop is deliberately old. Lightroom's keys, unchanged: `P`
picks the work under the cursor, `X` rejects it, `U` clears, `C` compares two
side by side, and Enter on an empty bar re-deals the board from your flags. The
scoring underneath is Rocchio relevance feedback from 1971 — `cos(x, mean(pos))
− w · max_j cos(x, neg_j)`, with `max` on the negatives so a single strong
reject actually pushes a whole visual region away. Twelve cards, so every move
reads. Picks hold their exact slot; rejects slide to a tray at the left edge and
stay restorable; newcomers arrive from the right.

None of that needs an agent, and that is the point. What the agent adds is a
sentence.

Reject the two darkest works on the board and the note above it reads:

> *"You rejected the two brown-and-ochre oils; these keep the warmth in
> firelight, gold, and clear sunlit colour."*

Run the same instruction again with the flags inverted — reject the two
brightest instead — and it reads:

> *"Warmth here runs from sunlit gold to russet domestic colour, avoiding the
> tan-and-cream palettes you rejected."*

The human never typed "brown-and-ochre" or "tan-and-cream". They pressed `X`
twice. The agent is given the four indexed dominant-colour swatches, the medium,
the year and the classification of every flagged work — the same fields printed
on the card — and one instruction: *name the visual property you can see in the
record, not a mood you associate with the artist's name*. The swatches it wrote
from are drawn under the sentence, picks whole and rejects struck through, so
the claim is checkable without leaving it.

We tested this adversarially rather than assuming it. Four notes across two
inverted conditions: three named the rejected works' actual colour, correctly
and differently in each direction; the fourth described the board without
referring to the rejects at all. The two conditions never produced the same
note. ⚠ A third run was blocked by our own anonymous rate limit, and one run's
JSON was overwritten before it was archived — the notes above are transcribed
from the console, and the harness is checked in and deterministic.

The second improvement is that the words are two-way. The agent drafts a title,
a statement and a wall label for every work. The human rewrites the statement —
*"it is not about weather, it is about leaving"* — and committing that edit is
itself the turn. The agent re-selects the works and rewrites all eighteen labels
against the human's sentence, and does not touch the sentence: a field the human
has edited comes back `theirs: true`, and an agent write onto it is parked as a
proposal rather than landing. The same painting under two different statements
gets two genuinely different labels — same six works, two statements, live
model, **zero of six byte-identical**:

> **weather** — *"The river carries the last light of the day beneath a setting
> sun … the scene closes the hanging order with weather and illumination
> settling toward evening."*
>
> **leaving** — *"The river carries the eye through an unpeopled stretch of
> shore, where no boat or figure interrupts the water's course. At day's end,
> the scene reads as a place left behind rather than a view awaiting activity."*

The result leaves the tab. `https://paillette-stg.berlayar.ai/e/MKwsxHy` is a
real exhibition that opens in a browser with no session, no cookies and nothing
in local storage — the loader re-fetches every record by id on the server before
a pixel is sent. It serves Open Graph tags, and it carries a colophon counted
from the data rather than asserted: *"4 of 6 labels written by an agent."*

## 3. What can people and agents do together here that was hard or impossible before?

**Two things, and the first is the one we would defend hardest.**

### When your words and your gestures disagree, the agent follows the gestures and says so.

> *"You said warm; you picked the grey harbour and rejected the golds —
> following the picks."*

No search box has both signals. A search box has words and no gestures. A chat
window has words and no gestures either — it just has more of them. A
recommendation feed has gestures and no words, and never tells you what it
concluded from them. Paillette has both in one payload: every human turn carries
`{ text, flagsDelta, selection, hovered, compareChoice }`, so the sentence and
the clicks arrive together and can be compared. When they conflict, the system
prompt says to follow the clicks and name the conflict out loud.

That inverts the usual burden. The human does not have to author a good query —
which is the thing they cannot do, because they cannot name what they want. They
react, and the agent puts words to the reaction. When the agent gets the words
right, the human has heard their own taste described for the first time. When it
gets them wrong, the human corrects the *words*, which is a thing people are
good at, and the correction steers the next deal.

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

Same function, either hand. This is not a design preference; it is checkable,
and we checked it by taking the agent away. With the model route hard-refusing
`429`, the loop keeps working: nine assertions, three runs in a row. With no
WebMCP host on the page at all, `P` and `X` still flag and Enter still deals.
And the headline beat is asserted **negatively**, against a recorded network
log: a full run — cold load, three flags, two redeals, a compare, a choice —
made four HTTP requests, and `/api/public-agent/turn` appears zero times. The
picks held their slots at zero pixels of displacement across a measured 22
distinct layouts.

That is what makes "two operators" true rather than rhetorical. The agent is not
the mechanism. It is a second operator of a mechanism that works without it, who
adds strategy and language.

**Where the claim has a dent, and we would rather say so than be found out.**
Two of the twenty-five tools — `write_labels` and `annotate_atlas` — have no
human control behind them today. A human can edit any label by hand but cannot
press a button to draft six at once, and cannot name a region of the atlas. Both
should wrap a human affordance and currently do not.

### And it survives being shared.

The artefact at the end is not a transcript. It is an ordered hang, a wall label
per work written from the human's gestures and the human's statement, a
considered-and-declined tray, and a URL. Neither party could have produced any
of it alone: the human could not have found six works out of 63,253 they could
not name, and the agent could not have known the show was about leaving.

## 4. How was WebMCP implemented?

**25 tools on `document.modelContext`**, registered by a feature-detected bridge
in `apps/web/app/lib/webmcp/`. Read them off the deployed page yourself:

```js
(await document.modelContext.getTools()).map(t => t.name)
```

**Registration** (`registry.ts`). The host is resolved without being touched if
it is absent — `document.modelContext` first, then `navigator.modelContext`,
because different vintages of the proposal expose it in different places — and
every entry point returns a no-op disposer when neither exists, so a browser
with no WebMCP renders a byte-identical page. Tool names are unique per
document and re-registering one *rejects*, so registration is reference-counted
by name rather than by caller, and each name has its own promise queue that
outlives the entry it belonged to. That last detail was a real bug: React
StrictMode's double-mount dropped an entry synchronously while its unregister
was still in flight, the new `registerTool` overtook the old `unregisterTool`,
and the page tore down its own tool surface and then reported every tool as
already registered. `registerTool` may return void, a handle, or a promise of
either, so three teardown paths are probed in order.

**The tools.** Names and argument shapes, verbatim from
`apps/web/app/lib/webmcp/tools.ts`:

```jsonc
flag_artworks   // an agent flag is a proposal, drawn dashed until confirmed
{ "flags": [ { "artworkId": string,
               "flag": "pick" | "reject" | "clear",
               "reason": string } ] }        // 1–3 per call

redeal
{ "keep": "picks", "strategy": "tighten" | "widen",
  "count": integer, "note": string }
→ { "kept": [...], "removed": [...], "added": [...], "order": [...],
    "exemplars": { "positive": [...], "negative": [...] } }

search_by_exemplars                          // server-side Rocchio, no embedding call
{ "positiveIds": string[],  "negativeIds": string[],
  "excludeIds": string[],   "topK": integer }

compare_artworks
{ "artworkIds": [string, string], "question": string }
→ { "kind": "winner", "winnerId": string, "loserId": string }
| { "kind": "neither", "artworkIds": [...], "reason": string }

set_exhibition                               // every field optional; writes merge
{ "title": string, "statement": string,
  "works": [ { "artworkId": string, "label": string, "position": integer } ],
  "removeArtworkIds": string[] }

write_labels                                 // refuses with NO_STATEMENT if there is no theme
{ "artworkIds": string[], "voice": string }
→ per work: { "label": string, "writtenFrom": "caption" | "catalogue" }

get_view_context                             // read-only; the whole point
→ { page, humanSearch, humanResults, agentResults, openArtwork,
    flags: { picks[], rejects[], provisional[], exemplars },
    selection, hovered, compare, board }
```

The remaining eighteen are the search and indexing surface:
`list_collections`, `search_artworks`, `search_by_image`, `search_by_color`,
`browse_collection`, `lookup_artwork`, `describe_artwork`, `get_search_quota`,
`set_results`, `show_artwork`, `set_view`, `get_exhibition`, `annotate_atlas`,
`create_collection`, `add_to_collection`, `index_zip`, `index_folder`,
`get_index_status`.

**What the agent is given about a flagged work.** This is the part that decides
whether the narration is real, and it is the part we got wrong first. Every
entry in `flags.picks[]`, `flags.rejects[]` and in the turn payload's
`flagsDelta` carries the fields already printed on the card:

```json
{ "id": "open-access-art:nga:50295", "title": "Peaceful Valley",
  "artist": "Alexander Helwig Wyant",
  "palette": ["#DEB585", "#3B2F1F", "#715023", "#B09176"],
  "medium": "oil on canvas", "year": 1872, "classification": "Painting",
  "by": "human", "onBoard": false }
```

Before that, the entries carried only `id`, `title`, `artist` and `by` — so
everything the model could say about a rejected picture was inferred from two
proper nouns it happened to recognise, and it would have been confidently wrong
the first time a judge rejected a work by an artist it did not know. The fix was
to project the four indexed swatches, the medium and the year into the payload,
add one prompt line telling the model to name the visual property in the record
rather than the mood, and then draw those swatches under the note so the claim
is falsifiable on screen.

**Gestures as a turn.** Every human turn posts
`{ text?, flagsDelta, selection, hovered, compareChoice }`. Flags never trigger
the agent — Enter is the beat — or the board thrashes under the human's hands
while they are still deciding. A deterministic redeal *reports* the gestures
without spending them, so the same flags are still in the delta when the human
finally types something.

**Deterministic first.** `search_by_exemplars` is a server route over the
existing `jina-clip-v2` Vectorize index, reusing the vectors already stored, so a
redeal makes no embedding call and is metered against nothing. Enter on an empty
bar calls that route directly, with no model in the path at all. The tool and
the key are the same function.

**Making it inspectable.** The registry takes an `onExecute` observer that wraps
every call, which is what feeds the activity glyph — five monospace cells at
rest, animating by tool kind while one runs, and expanding into a log of every
call with its arguments, its result and its duration. No prose anywhere in it.

**Testing.** `pnpm --filter web test` and `pnpm --filter api test` (~94 files /
1171 web, ~46 / 849 api at the last full run), plus a set of checked-in
Playwright harnesses under `scripts/demo/` that drive the deployed build rather
than a dev server: `e2e-deterministic.mjs` (asserts zero model calls, negatively),
`negative-control.mjs` (the inverted-flag experiment), `labels-ab.mjs` (the same
works under two statements), `e2e-curation.mjs` (the statement correction, driven
the way a person types it), and `verify-agentless-loop.mjs` (the loop with the
model route refusing).

---

## 5. Numbers to fix before pasting anything from v1

`docs/webmcp-devpost-fields.md` says **seventeen tools** in three places
(*How we built it*, *Testing instructions* → gate check, *What you updated*).
It is **25**. The count is derived from `PAILLETTE_TOOL_COUNT` in one place now
and a registry test fails if the list and the factory disagree, because this
number has been wrong twice.

The gate check should read:

> `(await document.modelContext.getTools()).length` should be **25**.

The *Testing instructions* live URL should be `https://paillette-stg.berlayar.ai/nga/search`,
not `/try`. `/try` indexes a zip and is the throat-clearing; `/nga/search` is
where the loop is. **No `?webmcp-debug` is needed** — the utterance bar renders
without it, verified on the deployed build. Tell a judge the three keys: hover a
work and press `P` or `X`, then press Enter on the empty bar.

*"Curate with your agent"* should move out of **What's next** and into **What it
does**. It ships.
