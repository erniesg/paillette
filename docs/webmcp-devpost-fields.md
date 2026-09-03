# Devpost form — field-by-field draft

> Copy-paste ready. `docs/webmcp-submission-description.md` already answers the four
> *required* prompts; this covers the rest of the form. Fill the `[bracketed]` spots.

**Tagline:**
> Let AI be your eyes and ears with Paillette. Until now, art has been hard to discover when you don't know what you're looking for — and nearly impossible if you can't see it. Paillette makes any collection searchable by what it looks like, and readable out loud, to you and your agent together.

---

## Inspiration

Museums hold centuries of art, but most of it is effectively invisible — little to no
structured metadata, and nothing that helps you find a work you can't name or can't
see. Paillette makes art searchable by what it *looks* like, not by what a database
says. WebMCP was the last piece: searching an archive is a conversation, and now that
conversation happens *with* an agent — you speak, it finds, it reads back what you're
both looking at.

## What it does

The National Gallery of Art alone holds **over 160,000 works** — only a fraction are
ever on view, and asking "show me a moody seascape" or "works like this one" across
tens of thousands of records is impossible for a non-specialist.

Paillette makes a collection searchable in minutes. Drop in **a zip or a folder** and
it does the rest automatically: every image is embedded into the same search space, an
optional CSV becomes full catalogue metadata (or titles are pulled from filenames when
there is none), colours are extracted, and a vision model writes a description of what
each work depicts. No metadata required. Then you can search the result across the
**full spectrum**, and it talks back to you:

- **By what you can say** — natural language: a subject, a mood, a style, a century,
  an artist ("stormy seascapes", "portraits of women reading").
- **By what you can show** — upload an image and find visually similar works.
- **By colour** — "everything in this teal", matched against each work's extracted
  palette.
- **By query parsing** — a natural-language query becomes structured search:
  "Rembrandt etchings from the 1640s" resolves to *artist=Rembrandt, medium=etching,
  date 1640–1649* plus a rewritten semantic query, matched against the collection's
  real records rather than guessed.
- **By visual motifs** — "three figures under a stormy sky" matches a generated
  description of what's actually *depicted*, not just title keywords.
- **By advanced filters** — artist, medium, classification, date range, accession
  number, and colour, combinable however you like.

Discoverability is the point, so Paillette also **suggests what to search** — queries
grounded in the collection's own records, not guessed. And you don't have to know how
to search at all: **talk to it**, and your agent finds the work, narrates it aloud,
and curates on the same screen you're using.

## How we built it

Built with **Codex**, which helped design the hybrid retrieval at the core: it fuses
five signals — keyword text match, catalogue metadata, generated vision captions,
image embeddings, and colour — into a single ranking using **reciprocal rank fusion**,
with an LLM step that **parses a natural-language query into structured filters**
(artist, medium, date range) plus a rewritten semantic query, grounded in the values
that actually exist in the collection. On top of that sits a **serverless Cloudflare** stack (Remix
on Workers, D1, R2, Vectorize, Cloudflare AI) and a WebMCP layer of sixteen tools
registered on `document.modelContext`. Rich interactivity comes from voice in
(ChatGPT), read-aloud descriptions (speech synthesis), and data enrichment — vision
captions, colour extraction, and CSV metadata mapping run automatically on everything
indexed. The page detects WebMCP, so without it nothing changes.

## Challenges we ran into

1. **MCP wasn't enough.** We already had a working MCP server, so WebMCP looked like
   a rename. It isn't: a remote MCP server is disconnected from the page a person is
   looking at — it has no idea what's on screen or what they just selected. The real
   work was teaching the agent to *read the view and write back to it*
   (`get_view_context` / `set_results` / `show_artwork`) so human and agent share one
   state. That's what makes it feel collaborative, and it was the hard part.
2. **Embedded images that never matched.** Indexed images were embedded with the
   wrong task type, so they landed in the wrong part of vector space and every
   semantic search silently returned zero. One config line broke the entire "search
   anything you index" promise.
3. **"Indexing complete" was a lie.** Freshly embedded vectors aren't queryable for
   ~15 seconds, so a search right after completion returned nothing — indistinguishable
   from a broken collection. We built that propagation lag into the tool's own output
   so nobody (agent or human) reports a working collection as empty.
4. **Agents hand over files, not just text.** "Drop in any zip" means the agent has to
   pass files to the page, and browsers block cross-origin reads. We made `data:` URIs
   a first-class input so it works regardless of CORS.
5. **A test bug that faked corruption.** In the test environment, `new File([blob])`
   silently stringified the Blob to the literal text "[object Blob]" (15 bytes), so a
   valid zip arrived as corrupt text — indistinguishable from a genuinely broken
   archive. Fixed by reading raw bytes via `arrayBuffer()`.

## Accomplishments that we're proud of

- **The same search tool for experts and everyday users.** A curator and a first-time
  visitor ask the same engine and both land somewhere — no specialist vocabulary
  required.
- **Art, made accessible.** A work you can't see can now be described aloud — a real
  step for visually impaired users, not just a nice-to-have.
- **Resource-strapped institutions win.** Drop a zip and it's searchable — no
  cataloguing team, no months of metadata entry, no infrastructure.
- **One canvas, two operators.** You and your agent curate on the same screen, not a
  chat window next to it.
- **Built with Codex on WebMCP, fully open source.**

## What we learned

- **Anticipate the user's needs.** Honesty is a feature: surfacing search quota,
  indexing latency, and "here's what you could search for" is what makes the tool feel
  intelligent, not the model underneath.
- **New tech makes the previously exorbitant cheap.** Multimodal search over a whole
  museum used to need a data-science team and bespoke integrations; now it's a Worker
  and a list of tools.
- **Good tool design beats UI scraping** — clear schemas and recoverable errors are
  what make an agent reliable.

## What's next for P[ai]llette

- **Rollout for the National Gallery of Art's entire collection** in production.
- **Real-time interactions** — continuous voice in and read-back, so the eyes-and-ears
  loop is seamless.
- **Index from a URL** — point at any open-access collection and Paillette crawls,
  extracts, and indexes it automatically. No zip needed.
- Index into *your own* collection (not just the shared sandbox), and image/colour
  search over freshly indexed collections.

## Built with

- **WebMCP** (`document.modelContext`) — the layer being judged
- **AI**: Codex (build + algorithm design), OpenAI vision models (captions/query intent)
- **Frontend**: Remix, React, TypeScript, TanStack, Tailwind CSS, Radix UI
- **Platform**: Cloudflare Workers & Pages, D1, R2, Vectorize, Cloudflare AI, Hono
- **Testing**: Vitest, Playwright
- **Auth**: WorkOS

## If existing, what you updated during the submission period

Paillette predates the submission period; the platform (multimodal search, the
existing HTTP MCP server, NGA open-access ingestion) was live before Aug 25 2026.
This submission is for the **WebMCP layer added after Aug 25**: sixteen tools on
`document.modelContext`, the feature-detected bridge, the anonymous indexing and
read-aloud captioning, and the `/try` page. The full prior/new split with dated
commit hashes (verifiable via `git log e4ae3b43..master`) is in
`docs/webmcp-whats-new.md`.

## Testing instructions

- **No credentials.** Anonymous visitors can use everything demoed; leave auth blank.
- **Live URL**: `https://paillette-stg.berlayar.ai/try` — open it in ChatGPT's in-app
  browser (WebMCP on by default) or Chrome 149+ with
  `chrome://flags/#enable-webmcp-testing`.
- **Gate check**: `await document.modelContext.getTools()` should list sixteen tools.
- **Fastest demo**: pick a sample collection (e.g. "25 works, no metadata"), index it,
  then ask the agent to search it. The 25-image set indexes in a couple of minutes.

## Which agent(s) or client(s) did you test your WebMCP tools with?

ChatGPT's in-app browser (WebMCP on by default) and Google Chrome 149+ behind
`chrome://flags/#enable-webmcp-testing`. `[confirm which you recorded with]`

## Which AI tools have you leveraged while working on this project?

Codex for implementation and for designing the hybrid retrieval algorithm, and
ChatGPT's in-app browser for validating the WebMCP tool surface. All WebMCP code was
written and reviewed by us against the W3C WebMCP draft.
