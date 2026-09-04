# Paillette — Devpost submission

## Inspiration

Museums hold centuries of art, but most of it is effectively invisible — little
to no structured metadata, and nothing that helps you find a work you can't name
or can't see. Paillette makes art searchable by what it *looks* like, not by what
a database happens to record.

Search engines answer queries. Paillette with an agent answers **goals**. Ask for
"something warm to hang above the sofa" and it doesn't run one search — it works
out four different things that could mean, runs all of them, and puts the best of
each on one board with a note explaining the selection. Your search box cannot do
that: every search replaces the last one. Only something that can drive the page
can hold four searches side by side.

That is what WebMCP made possible, and it is the whole reason this is an app with
an agent in it rather than a chatbot next to one.

## What it does

Museum search works well when you already know the artist, title, medium or date.
It works far less well when all you have is a visual memory, a mood, a colour, or
"something like this."

Paillette turns a collection into a multimodal search engine in minutes. Drop in
**a ZIP or a folder** and every image is embedded in the same vector space the
National Gallery of Art collection uses. Add a CSV for catalogue metadata, or go
without one — **no metadata required**. A folder holding nothing but filenames is
still searchable by what its pictures show.

You can then search:

* **By description** — "three figures under a stormy sky", or "something that feels like longing."
* **By image** — find works that look like a given one.
* **By colour** — everything sitting near a shade, ordered by perceptual distance.
* **By metadata** — artist, medium, classification and date range, parsed out of ordinary language and grounded in values that actually exist in that collection.

Any work can be **described on demand** by a vision model and then **read aloud**
by the page itself, so a painting you cannot see still reaches you.

With WebMCP, an agent drives all of it through the page's own tools — searching,
filtering, opening and curating on the canvas you are already looking at.

## Why it is better with an agent, not just faster

The page alone gives you a ranked list. An agent in the page gives you three
things the interface cannot:

1. **It composes modes the UI keeps apart.** Text, image and colour are separate
   tabs — you use one at a time. *"Storms at sea, pushed toward navy, then more
   like the best one"* is all three, in one instruction.
2. **It acts on what is already on screen.** Image search takes an uploaded file,
   so on your own "more like that one" means saving a picture and uploading it
   back. The agent searches from the work's id. *That one* becomes usable.
3. **It curates, and says why.** Search ranks results by score; the agent keeps
   the handful that answer the question and writes the through-line. Ranking is
   not curation.

Search engines answer queries. Paillette with an agent answers **goals**. Ask for
a mood and you get a ranked list; ask for an outcome — "a small room about storms
at sea" — and you get a specific handful of paintings, in an order, with a reason.
A chat window can paste those pictures at you. What it cannot do is change what
is already on your screen — the grid you were working in, that you can re-sort,
click into, and search onward from. Pasted results are a dead snapshot in
someone else's surface; these are live, in yours. That is why it has to happen
in the page.

Given one sentence — *"I'm hanging a small room about storms at sea. Find the
most dramatic one, then build the room around it: works that look like it, and
put your final selection on my screen with a note about why those. Open the
centrepiece too."* — the agent chose to call `list_collections`,
`get_search_quota`, `search_artworks`, `search_by_image`, `lookup_artwork`,
`set_results` and `show_artwork`. It pinned five works and wrote its own wall
text:

> *"A tightening storm sequence: Dietzsch's wreck is the centrepiece, surrounded
> by visually kindred ships, turbulent water, and storm-heavy skies — from full
> gale to a boat racing home."*

Nothing in that sequence was scripted. The model was handed the page's 25 tool
schemas and chose the chain itself.

## How we built it

Built with **Codex**, which helped design the hybrid retrieval at the core.
Keyword text, catalogue metadata and generated vision captions are fused into one
ranking with **reciprocal rank fusion**; colour runs as a second stage — a
semantic pass on the colour's own language, then a perceptual (CIEDE2000) re-rank
against each work's extracted palette. An LLM step **parses a natural-language
query into structured filters** — artist, medium, classification, date range —
plus a rewritten semantic query, grounded in the values the collection actually
contains, so it can never invent a filter the data cannot satisfy.

Embeddings are **Jina** (`jina-clip-v2` for the shared image/text space,
`jina-embeddings-v5-text-small` for captions). On top sits a **serverless
Cloudflare** stack — Remix on Workers, D1, R2, Vectorize, Workers AI and Queues —
and a WebMCP layer of **25 tools** registered on `document.modelContext`.

Two of those tools write the page's own React state, which is what makes the
shared canvas real: `set_results` pins a set together with the agent's note, and
`show_artwork` opens one work. The store lives outside React precisely because
its writers are `execute()` calls arriving from the host rather than user events.
Everything that mutates — indexing, collection writes — parks on an in-page
approval prompt first.

## Challenges we ran into

1. **WebMCP is experimental and still moving.** Browsers expose it under
   different names (`document.modelContext` vs `navigator.modelContext`),
   `registerTool` returns different shapes, there is no reliable unregister, and
   re-registering a name rejects. Registration probes all of it defensively and
   degrades to a no-op, so the page is identical without the API.
2. **An agent has to hand over files, and browsers block it.** "Drop in any ZIP"
   means the agent must pass files to the page, and cross-origin reads are
   blocked. `data:` URIs became a first-class input so it works wherever the
   files live.
3. **The agent and the page have to agree which collection they are in.** The
   search tools originally always resolved to the published catalogue, so on a
   collection you had just indexed yourself the agent would quietly answer from
   somewhere else. Search now follows the live indexing job, and only an
   explicitly named collection overrides it.
4. **A suggestion that returns nothing is worse than no suggestion.** Filters
   were applied after a semantic top-K, so a precise filter could cull every
   candidate — "Works by Eadweard Muybridge" returned zero for an artist with two
   works in the set. Short filtered pages are now topped up from the metadata the
   filter describes.

## Accomplishments that we're proud of

* **The same search tool for experts and everyday visitors.** A curator asking
  for "Rembrandt etchings from the 1640s" and a visitor asking for "stormy
  seascapes" hit the same engine, and both land somewhere.
* **Art, made reachable.** A work you cannot see is described by a vision model
  and read aloud by the page — no agent, no account and no extra software
  required.
* **Resource-strapped institutions win.** Drop a ZIP and it is searchable. No
  cataloguing team, no months of metadata entry, no infrastructure.
* **One canvas, two operators.** You and your agent work the same screen, and
  either of you can take the next move.
* **Built with Codex on WebMCP, fully open source.**

## What we learned

* **Effective human–AI collaboration is the real unlock.** The design came from
  domain knowledge, not the model: experts usually know the exact work they are
  after and need precise, faceted search, while lay visitors are better served by
  visual and mood search — and plenty of people are simply after a colour or a
  feeling for an occasion. I brought that from prior innovation work in museums;
  Codex turned it into the product.

  Human domain knowledge in, agent-shaped product out — that handoff is the whole
  point of WebMCP.

* **New tech makes the previously exorbitant cheap.** Multimodal search over a
  whole museum used to need a data science team and bespoke integrations. Now it
  is a Worker and a list of tools.

* **Good tool design beats UI scraping.** Clear schemas, honest errors and a
  described "what to do next" are what make an agent reliable. Watching a model
  chain six tools off one sentence, unprompted, is the proof.

## What's next for Paillette

* **Curate with your agent** — assemble works into shortlists and shareable
  exhibitions together. The same WebMCP app that finds the art helps you tell its
  story.
* **Roll out across the National Gallery of Art's entire open-access archive** —
  63,253 works — in production, with **real-time voice** so the loop is spoken
  end to end.
* **Index from a URL** — point at any open-access collection and Paillette
  crawls, extracts and indexes it automatically.
* **Vision captions and colour extraction at index time** for every collection,
  not only the curated ones, so a folder of raw images arrives fully enriched.

---

## What changed from the previous draft, and why

| Was | Now | Why |
| --- | --- | --- |
| Inspiration ran three ideas into one sentence ending "you speak, it finds, and it reads back what you're both looking at" | Split into: most art is invisible → finding art is looking, not asking → an agent closes that loop | The original packed a claim about voice into a paragraph about metadata, and "you speak" needs an agent host we do not ship. |
| "automatically… extracts its colors, and generates visual descriptions" | "every image is embedded… described on demand" | Colour extraction and vision captions do **not** run on the anonymous index path — colour is on the authenticated org path, captions are on demand. Moved to *What's next*. |
| "fuses different signals — … and color — using RRF" | text + metadata + captions fused by RRF, **colour described as a second stage** | Colour is not in the fusion. It is a separate route plus a client-side CIEDE2000 re-rank. |
| "Cloudflare AI" as the embedding stack | **Jina** named; Workers AI kept for what it does | Primary embeddings are the Jina API. Jina was missing from the write-up entirely. |
| "described aloud" (aspirational) | **kept, and now true** | The page now reads descriptions with the browser's own `speechSynthesis`, so this no longer depends on the visitor bringing an agent that speaks. |
| "accession number… parsed from natural language" | dropped | The parser extracts artist, medium, classification, yearFrom, yearTo. Accession is not among them. |
| — | added *Why it is better with an agent* | The brief asks what people and agents can do together that was hard before; all three points are checkable in code, and the six-tool chain is a real run. |
| — | added challenges 3 and 4 | Both were real bugs found and fixed during the build, and both are specific to putting an agent on a page. |
