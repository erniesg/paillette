# Devpost form — field-by-field draft

> Copy-paste ready. `docs/webmcp-submission-description.md` already answers the four
> *required* prompts; this covers the rest of the form. Fill the `[bracketed]` spots.

**Tagline (194 chars):**
> Let AI be your eyes and ears with P[ai]llette. Art is hard to discover when you don't know what you're looking for, or if you can't see it. Paillette makes it searchable — and reads it out loud.

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
it does the rest automatically: every image is embedded and colours are extracted, so
it's searchable by how it looks. Add a CSV and it becomes full catalogue records —
artist, medium, classification, date. Without one, the vision model can still describe
each work aloud on demand. **No metadata required.** Then you can search the result
across the **full spectrum**, and it talks back to you:

- **By description** — a subject, mood, motif, or era, in your own words: "three
  figures under a stormy sky" or "something that feels like longing".
- **By image** — upload one and find visually similar works.
- **By colour** — "everything in this teal", matched against each work's extracted
  palette.
- **By exact match** — artist, medium, classification, date range, accession number.
  Say "Rembrandt etchings from the 1640s" and it's parsed into those filters
  automatically, against the collection's real records.

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
on Workers, D1, R2, Vectorize, Cloudflare AI) and a WebMCP layer of twenty-five tools
registered on `document.modelContext`. Rich interactivity comes from OpenAI voice —
you talk to the agent and it reads descriptions back aloud — plus data enrichment:
vision captions, colour extraction, and CSV metadata mapping run automatically on
everything indexed. The page detects WebMCP, so without it nothing changes.

## Challenges we ran into

1. **WebMCP is experimental and still moving.** Different browsers expose it under
   different names (`document.modelContext` vs `navigator.modelContext`),
   `registerTool` returns different shapes, there's no reliable unregister, and
   re-registering a name rejects. We built registration to probe all of it defensively
   — and to degrade to a no-op so the page is identical without the API.
2. **An agent has to hand over files, and browsers block it.** "Drop in any zip" means
   the agent must pass files to the page, and cross-origin reads are blocked. We made
   `data:` URIs a first-class input so it works regardless of where the files live.

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

- **Effective human–AI collaboration is the real unlock.** The design came from
  domain knowledge, not the model: experts usually know the exact work they're after
  (they need precise, faceted search), while lay users are better served by visual and
  mood search — and a lot of people are just looking for a colour or a vibe for an
  occasion. I brought that context from prior innovation work in museums; Codex turned
  it into the product, and I was genuinely, pleasantly surprised by what came back.
  Human domain knowledge in, agent-shaped product out — that hand-off is the whole
  point of WebMCP.
- **Anticipate the user's needs.** Honesty is a feature: surfacing search quota,
  indexing latency, and "here's what you could search for" is what makes the tool feel
  intelligent, not the model underneath.
- **New tech makes the previously exorbitant cheap.** Multimodal search over a whole
  museum used to need a data-science team and bespoke integrations; now it's a Worker
  and a list of tools.
- **Good tool design beats UI scraping** — clear schemas and recoverable errors are
  what make an agent reliable.

## What's next for P[ai]llette

- **Build your own collection** — index a zip, a folder, or a URL into your own space
  (not just the shared sandbox), and keep it private or make it public.
- **Explore** — the full spectrum — description, image, colour, exact — over anything
  you've built.
- **Curate with your agent** — assemble works into shortlists and shareable
  exhibitions, together. The same eyes-and-ears loop that finds the art also helps you
  tell its story.
- **Rollout for the National Gallery of Art's entire collection** in production, and
  **real-time voice** so the loop is seamless.

## Built with

- **WebMCP** (`document.modelContext`) — the layer being judged
- **AI**: OpenAI (Codex for build + algorithm design, voice, vision models for captions/query intent)
- **Frontend**: Remix, React, TypeScript, TanStack, Tailwind CSS, Radix UI
- **Platform**: Cloudflare Workers & Pages, D1, R2, Vectorize, Cloudflare AI, Hono
- **Testing**: Vitest, Playwright
- **Auth**: WorkOS

## If existing, what you updated during the submission period

Paillette predates the submission period; the platform (multimodal search, the
existing HTTP MCP server, NGA open-access ingestion) was live before Aug 25 2026.
This submission is for the **WebMCP layer added after Aug 25**: twenty-five tools on
`document.modelContext`, the feature-detected bridge, the anonymous indexing and
read-aloud captioning, and the `/try` page. The full prior/new split with dated
commit hashes (verifiable via `git log e4ae3b43..master`) is in
`docs/webmcp-whats-new.md`.

## Testing instructions

- **No credentials.** Anonymous visitors can use everything demoed; leave auth blank.
- **Live URL**: `https://paillette-stg.berlayar.ai/try` — open it in ChatGPT's in-app
  browser (WebMCP on by default) or Chrome 149+ with
  `chrome://flags/#enable-webmcp-testing`.
- **Gate check**: `await document.modelContext.getTools()` should list twenty-five tools.
- **Fastest demo**: pick a sample collection (e.g. "25 works, no metadata"), index it,
  then ask the agent to search it. The 25-image set indexes in a couple of minutes.

## Which agent(s) or client(s) did you test your WebMCP tools with?

ChatGPT's in-app browser (WebMCP on by default) and Google Chrome 149+ behind
`chrome://flags/#enable-webmcp-testing`. `[confirm which you recorded with]`

## Which AI tools have you leveraged while working on this project?

Codex for implementation and for designing the hybrid retrieval algorithm, and
ChatGPT's in-app browser for validating the WebMCP tool surface. All WebMCP code was
written and reviewed by us against the W3C WebMCP draft.
