# Devpost form — field-by-field draft

> Copy-paste ready, plain-language. `docs/webmcp-submission-description.md` already
> answers the four *required* prompts; this covers the rest of the form. Fill the
> `[bracketed]` spots, then delete this header block.

**Tagline:**
> Let AI be your eyes and ears with Paillette. Until now, art has been hard to discover when you don't know what you're looking for — and nearly impossible if you can't see it. Paillette makes any collection searchable by what it looks like, and readable out loud, to you and your agent together.

---

## Inspiration

Museums and galleries hold centuries of art with almost no usable metadata, so most
of it is hidden from everyone — including the people who can't see it at all. Finding
something in a collection usually means either already knowing what you're looking
for, or months of manual cataloguing. Paillette changes that: it makes art searchable
by what it *looks* like, and it can tell you what you're looking at.

WebMCP was the missing piece. Searching an art archive is a conversation ("find me
works like this one, but brighter"), and a conversation is best when a person and an
agent do it *together* — you speak, the agent finds, and it reads back what you're
both seeing. That's the future of the web this challenge is about.

## What it does

Paillette turns a pile of images — a zip, a folder, or an open museum collection —
into something you can search by how it looks, and that talks to you. You and your
agent work in the same tab, on the same screen.

Here's how it works:

1. **Index** — drop in a zip, a folder, or an open collection, and every image
   becomes searchable. No metadata required.
2. **Search** — find works by what you can say, what you can show, or even a colour.
3. **Interact** — your agent reads you what you're looking at, and takes voice
   control: it points, describes, and curates on the same screen you're using.

Under the hood, Paillette exposes sixteen tools to the browser's agent via WebMCP.
Read tools (`search_artworks`, `search_by_image`, `search_by_color`,
`browse_collection`, `lookup_artwork`) search the collection; shared-canvas tools
(`get_view_context`, `set_results`, `show_artwork`) let the agent read and move the
same grid you see; `describe_artwork` reads a painting aloud for accessibility; and
`index_zip` / `index_folder` build a brand-new searchable collection from your own
images. Write actions ask for your approval on the page first. In a browser without
WebMCP, nothing changes at all.

## How we built it

Remix on Cloudflare Workers (D1, R2, Vectorize, Cloudflare AI). We registered sixteen
tools on WebMCP's `document.modelContext`. Reads reuse the existing search API, so
there's no second "agent-only" backend. The agent and the person literally share one
screen — the tools write to the same grid the person is using. Indexing zips and
describing images aloud were the only new backend pieces, both rate-limited and safe
for anonymous visitors. The page detects WebMCP, so without it everything behaves
exactly as before.

## Challenges we ran into

1. **Indexed images wouldn't match.** They were embedded with the wrong setting, so
   every search came back empty. Found and fixed end-to-end.
2. **New images take ~15 seconds to become searchable.** A search right after
   indexing looked like an empty collection. We made the app say so honestly instead
   of showing a misleading "no results".
3. **WebMCP is still moving.** The API name and return shapes vary between browsers,
   and it rejects duplicate tool names. We wrote registration to be defensive about
   all of it.
4. **Browsers block cross-origin images and zips.** We added `data:` URI fallbacks so
   the agent can always hand over files.
5. **A test-environment bug** turned files into literal "[object Blob]" text. Fixed by
   reading raw bytes instead.

## Accomplishments that we're proud of

- **An agent that's honest** — clear tool descriptions, tells you its next move, and
  asks before it changes anything.
- **One canvas, two operators** — you and the agent work on the same screen, not a
  chat window next to it.
- **"Drop a zip → search it" in one go** — a work that existed only in someone's
  archive is findable and on-screen a minute later.
- **Safe to show anyone** — anonymous, sandboxed, capped, no login.
- **Works without WebMCP** — the page is unchanged in any ordinary browser.

## What we learned

- Good tool design beats UI scraping: clear instructions and honest errors are what
  make an agent reliable.
- Indexing is a *job*, not a single click — long work needs progress the agent can
  read.
- Tell the agent the truth about latency, or it will confidently report an empty
  collection.
- Experimental APIs need defensive code.

## What's next for P[ai]llette

- **Production for a complete museum collection** — roll the National Gallery of Art,
  Washington (NGA) fully into production end to end.
- **Real-time voice** — hold-to-speak, release-to-act, and continuous read-back of
  whatever's on screen, so the "eyes and ears" loop is seamless.
- Smarter metadata mapping (so "date" and "object type" aliases resolve on their own).
- Index into *your own* collection, not just the shared sandbox.
- Image and colour search over freshly indexed collections, and source ingestion —
  point at a URL and make it searchable with no zip at all.

## Built with

- **WebMCP** (`document.modelContext`) — the layer being judged
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
- **Live URL**: `https://paillette-stg.berlayar.ai` — open it in ChatGPT's in-app
  browser (WebMCP on by default) or Chrome 149+ with
  `chrome://flags/#enable-webmcp-testing`.
- **Gate check**: `await document.modelContext.getTools()` should list sixteen tools.
- **Fastest demo**: visit `/try`, pick a sample collection (e.g. "25 works, no
  metadata"), index it, then ask the agent to search it. The 25-image set indexes in
  a couple of minutes.

## Which agent(s) or client(s) did you test your WebMCP tools with?

ChatGPT's in-app browser (WebMCP on by default) and Google Chrome 149+ behind
`chrome://flags/#enable-webmcp-testing`. `[confirm which you recorded with]`

## Which AI tools have you leveraged while working on this project?

`[e.g. Codex CLI for implementation, ChatGPT for testing in-app WebMCP tool calls]`
— used for building and for validating the agent surface; all WebMCP code was written
by us and reviewed against the W3C WebMCP draft.
