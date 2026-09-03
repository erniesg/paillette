# Paillette — Devpost submission

Corrected against the code. Changes from the previous draft are listed at the
bottom with the reason for each.

---

## Inspiration

Museums hold centuries of art, but most of it is effectively invisible — little
to no structured metadata, and nothing that helps you find a work you can't name
or can't see. Paillette makes art searchable by what it *looks* like, not by what
a database says.

WebMCP was the last piece. Searching an archive isn't a question, it's a
sequence: you look, you react, you narrow. Alone, you do that one query at a
time, in one modality at a time. With an agent on the same page, the loop
closes — you react, it searches, and the results land on the screen you were
already looking at.

## What it does

Museum search works well when you already know the artist, title, medium, or
date. It works far less well when all you have is a visual memory, a mood, a
colour, or "something like this."

Paillette turns a collection into a multimodal search engine in minutes. Drop in
**a ZIP or a folder** and every image is embedded in the same vector space the
National Gallery of Art collection uses. Add a CSV for catalogue metadata, or
use it without one — **no metadata required**; a collection with nothing but
filenames is still searchable by what its pictures look like.

You can then search:

* **By description** — "three figures under a stormy sky", or "something that feels like longing."
* **By image** — find works that look like a given one.
* **By colour** — everything sitting near a particular shade, ranked by perceptual distance.
* **By metadata** — artist, medium, classification and date range, parsed out of ordinary language and grounded in the values that actually exist in that collection.

With WebMCP, an agent drives all of it through the page's own tools — searching,
filtering, opening and curating on the same canvas you are looking at.

## Why an agent makes this better, not just faster

The page alone gives you a ranked list. The agent gives you three things the
interface cannot:

1. **It composes searches the UI keeps apart.** Text, image and colour are three
   separate modes in the interface — you use one at a time. "More like that one,
   but brighter, and only prints" is all three at once, in a single turn.
2. **It acts on what is already on your screen.** The image-search input takes an
   uploaded file, so on your own, "more like result #3" means downloading it and
   uploading it again. The agent searches from the work's id directly. *That one*
   becomes a usable instruction.
3. **It curates, and says why.** Search ranks thirty works by score. The agent
   pins ten and writes the through-line — "the four with the storm-lit horizon."
   Ranking is not curation.

None of that is a chat window next to the app. It is the app, with a second
operator.

## How we built it

Built with **Codex**, which helped design the hybrid retrieval at the core. Text,
catalogue metadata and generated vision captions are fused into a single ranking
with **reciprocal rank fusion**, and colour runs as a second stage: a semantic
pass on the colour's own language, then a perceptual (CIEDE2000) re-rank against
each work's extracted palette. An LLM step **parses a natural-language query into
structured filters** — artist, medium, classification, date range — plus a
rewritten semantic query, grounded in the values that actually exist in the
collection, so it never invents a filter the data cannot satisfy.

Embeddings are **Jina** (`jina-clip-v2` for the shared image/text space,
`jina-embeddings-v5-text-small` for captions). On top sits a **serverless
Cloudflare** stack — Remix on Workers, D1, R2, Vectorize, Workers AI and Queues —
and a WebMCP layer of **16 tools** registered on `document.modelContext`.

Two of those tools write the page's own React state, which is what makes the
shared canvas real: `set_results` pins a set with the agent's note, and
`show_artwork` opens one work. The store lives outside React precisely because
its writers are `execute()` calls arriving from the host rather than user events.
Everything that mutates — indexing, collection writes — parks on an in-page
approval prompt first.

## Challenges we ran into

1. **WebMCP is experimental and still moving.** Browsers expose it under
   different names (`document.modelContext` vs `navigator.modelContext`),
   `registerTool` returns different shapes, there is no reliable unregister, and
   re-registering a name rejects. Registration probes all of it defensively and
   degrades to a no-op, so the page is byte-identical without the API.
2. **An agent has to hand over files, and browsers block it.** "Drop in any ZIP"
   means the agent must pass files to the page, and cross-origin reads are
   blocked. We made `data:` URIs a first-class input so it works regardless of
   where the files live.
3. **The agent and the page have to agree on which collection they are in.** The
   search tools originally always resolved to the published catalogue, so on a
   collection you had just indexed yourself the agent would silently answer from
   somewhere else. Search now follows the live indexing job, and only an
   explicitly named collection overrides it.

## Accomplishments that we're proud of

* **The same search tool for experts and everyday visitors.** A curator asking
  for "Rembrandt etchings from the 1640s" and a visitor asking for "stormy
  seascapes" hit the same engine, and both land somewhere.
* **Art, made reachable.** A work you cannot see can be described in plain
  language on demand — the groundwork for genuine access, not a nice-to-have.
* **Resource-strapped institutions win.** Drop a ZIP and it is searchable. No
  cataloguing team, no months of metadata entry, no infrastructure.
* **One canvas, two operators.** You and your agent work the same screen, and
  either of you can take the next move.
* **Built with Codex on WebMCP, fully open source.**

## What we learned

* **Effective human–AI collaboration is the real unlock.** The design came from
  domain knowledge, not the model: experts usually know the exact work they are
  after and need precise, faceted search, while lay visitors are better served by
  visual and mood search — and plenty of people are just looking for a colour or
  a feeling for an occasion. I brought that from prior innovation work in
  museums; Codex turned it into the product.

  Human domain knowledge in, agent-shaped product out — that handoff is the whole
  point of WebMCP.

* **New tech makes the previously exorbitant cheap.** Multimodal search over a
  whole museum used to need a data science team and bespoke integrations. Now it
  is a Worker and a list of tools.

* **Good tool design beats UI scraping.** Clear schemas, honest errors and a
  described "what to do next" are what make an agent reliable. Every tool that
  can fail says how to recover.

## What's next for Paillette

* **Curate with your agent** — assemble works into shortlists and shareable
  exhibitions together. The same WebMCP app that finds the art helps you tell its
  story.
* **Roll out across the National Gallery of Art's entire collection** in
  production, with **real-time voice** so the loop is spoken end to end.
* **Index from a URL** — point at any open-access collection and Paillette
  crawls, extracts and indexes it automatically.
* **Vision captions and colour at index time** for every collection, not only the
  curated ones, so a folder of raw images arrives fully enriched.

---

## Changes from the previous draft, and why

| Was | Now | Why |
| --- | --- | --- |
| "automatically embeds every image, extracts its colors, and generates visual descriptions" | "every image is embedded… no metadata required" | Colour extraction and vision captions do **not** run on the anonymous index path. Colour extraction is on the authenticated org path (`queues/embedding-queue.ts`); vision captions are on demand via `describe_artwork`. Moved to "What's next". |
| "fuses different signals — … and color — using reciprocal rank fusion" | text + metadata + captions fused by RRF; **colour described as a second stage** | Colour is not in the fusion. It is a separate route plus a client-side CIEDE2000 re-rank. `search_by_color`'s own code says so. |
| "Cloudflare AI" as the embedding stack | **Jina** named, Workers AI kept for what it does | Primary embeddings are the Jina API. Workers AI is a caption-query fallback and translation. Jina was missing entirely. |
| "voice lets you explore the results conversationally" / "reads back what you're both looking at" / "described aloud" | removed; "described in plain language on demand" | There is no TTS in the repo. `describe_artwork` returns text; any speech is the agent host reading its own reply. Real-time voice moved to "What's next". |
| "accession number… parsed directly from natural language" | dropped from the parsed list | The intent parser extracts artist, medium, classification, yearFrom, yearTo. Accession is not a parsed filter. |
| — | added the "Why an agent makes this better" section | The brief asks what people and agents can do together that was hard before. The three items there are all checkable in the code. |
| — | added challenge #3 | It was a real bug found and fixed during the build, and it is the most WebMCP-specific problem we hit. |
