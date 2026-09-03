# Devpost submission text

**Live URL:** https://paillette-stg.berlayar.ai
**Repository:** https://github.com/erniesg/paillette (MIT)

Paillette turns a pile of images — a zip, a folder, an open-access museum
collection — into a multimodal archive that a human and their AI agent search and
curate together, in the same browser tab, at the same time. This submission covers
only the WebMCP layer added during the Submission Period; the underlying archive
platform (multimodal search, the Cloudflare stack, an existing HTTP MCP server)
predates Aug 25 2026 and is documented, with commit evidence, in
`docs/webmcp-whats-new.md`.

## Why this use case is a strong fit for WebMCP

Paillette's core interaction — "find me artworks like this one / in this mood / in
these colours, then build a collection" — is exploratory and conversational by
nature, which is exactly the shape WebMCP is built for: instead of a browser agent
guessing at DOM selectors on an art-search page, the page itself declares its real
capabilities as typed tools.

Paillette already modeled this domain as tools once, for its existing HTTP MCP
server (`apps/api/src/routes/mcp.ts` — `search_artworks`, `colour_search`,
`lookup_artwork`, `list_collections`, and more). That server needs a separate
integration and an OAuth handshake. WebMCP lets a general-purpose browser agent
reach the same verbs directly inside the page a human is already looking at, with no
separate integration and no server-side OAuth for the read paths.

And because the domain is genuinely multimodal — text, image, and colour queries,
plus curation into collections, plus building a brand-new collection out of a zip —
there are sixteen tools with real work behind them, not a single search box wrapped
in a schema.

Unseen data is handled, not special-cased. A CSV sidecar whose headers the page has
never seen is mapped by a model call that receives only the header row and a few
sample rows — never the file — and the learned mapping feeds directly into what gets
indexed and what queries can constrain. Search queries themselves are interpreted
against each collection's own metadata inventory: "oil sketches by Marco Ricci from
the 1860s" becomes grounded artist/medium/date filters plus a rewritten semantic
query, and the interpretation is returned so the agent can explain why a result set
looks the way it does. `describe_artwork` generates assistive alt-text for any
artwork — including one from a zip uploaded moments ago — with the model choice
explicit in the tool schema, and every model spend across the surface draws from a
single shared daily budget the tools can report honestly.

## How it creates a better user experience

There is no handoff. The agent runs in the same tab the person is already browsing,
not a disconnected chat window that has to be told what is on screen.

`get_view_context` lets the agent read the human's current route, active collection,
selected artwork, result set, and any indexing job running on the page — so it can
respond to what the person is actually looking at instead of asking them to
re-describe it. `show_artwork` and `set_results` let the agent write back into that
same view, opening an artwork or rendering a new result set directly into the grid
the human is scrolling, so the two of them converge on one visible state instead of
the agent narrating results in text.

Honesty is built into the tool results, not just the UI. A freshly indexed image
does not become queryable the instant it is embedded, so a search fired the moment a
job reports `searchable: true` can legitimately come back empty. `get_index_status`
says exactly that in its result, with the current embedded count, so an agent reports
"still settling, N of M embedded" instead of telling the human their collection is
empty.

Of the sixteen tools, nine are annotated `readOnlyHint: true`. The seven that are
not (`set_results`, `show_artwork`, `describe_artwork`, `create_collection`,
`add_to_collection`, `index_zip`, `index_folder`) are marked `readOnlyHint: false`.
The four that write human-visible state — `create_collection`,
`add_to_collection`, `index_zip`, `index_folder` — are additionally gated behind an
in-page confirmation the human sees and approves before anything commits;
`describe_artwork` spends a paid model call but only adds a caption to the record,
so it asks no permission and says in its result whether the caption was new or
already stored.

Nothing changes for visitors without WebMCP support: the bridge feature-detects, and
a browser without it installs nothing and renders nothing.

## What people and agents can do together that was difficult or impossible before

Before this layer, "using Paillette with an agent" meant one of two things: calling
the separate authenticated MCP endpoint out of band, disconnected from whatever the
human happened to be looking at in their browser; or an agent driving the page blind,
clicking through the DOM with no shared state and no idea what the person had already
selected.

Now the human and the agent operate on the same page state at the same time. A person
opens an artwork, the agent already knows via `get_view_context` and can say "here are
five more like it" — and those five appear directly in the grid, not in a separate
chat reply the person has to cross-reference back to the page.

The part that was genuinely not possible before: a person can hand over a zip of their
own images and have the agent turn it into a semantically searchable collection and
query it in the same conversational turn. `index_zip` takes an archive, plans the job,
and returns a job id immediately rather than blocking; `get_index_status` reports
progress and, once anything is embedded, runs semantic search over a collection that
did not exist a minute earlier. The ids it returns work with `lookup_artwork`,
`show_artwork` and `set_results`, so a work that existed only in the human's zip is
addressable by every other tool on the page. Neither a static gallery site nor an
out-of-band MCP integration offers that today.

Mutating actions stay visible and confirmed in-page, so co-curation has an audit trail
instead of being a black box.

## Briefly, how we implemented WebMCP

Tools are defined in `apps/web/app/lib/webmcp/` (`tools.ts` for the sixteen
definitions, `registry.ts` for the host binding, `store.ts` for the shared canvas) and
mounted once from `apps/web/app/root.tsx` via
`apps/web/app/components/webmcp/webmcp-bridge.tsx`, so the tools exist on every route
and survive client-side navigation.

Registration is guarded three ways: it feature-detects `document.modelContext`
(falling back to `navigator.modelContext`, which some vintages of the proposal use);
it is idempotent, so React StrictMode's double-mount cannot register twice; and every
`execute` honours the `AbortSignal` passed via `options.signal`, so a host can cancel
an in-flight call. Each tool declares a real JSON Schema `inputSchema`, a `title` and
`description`, and `annotations` carrying `readOnlyHint`, `idempotentHint` and
`openWorldHint`.

The read tools (`list_collections`, `search_artworks`, `search_by_image`,
`search_by_color`, `browse_collection`, `lookup_artwork`, `get_search_quota`) are thin
wrappers over Paillette's existing anonymous public search endpoints
(`apps/web/app/routes/api.public-search.$orgId.{text,image,browse,quota}.ts`) — no new
backend surface for reads. The shared-canvas tools (`get_view_context`, `set_results`,
`show_artwork`) read and write the same React state the human's UI already renders
from, so there is exactly one source of truth for "what is on screen."

Indexing and assistive description are the places that needed new backend surface:
anonymous job routes on the API worker (`apps/api/src/routes/indexing.ts`) behind
Worker proxy routes (`apps/web/app/routes/api.public-index.*`), and an anonymous
captioner (`POST /api/public-describe`, `apps/api/src/routes/describe.ts`) behind its
own proxy (`apps/web/app/routes/api.public-describe.ts`) — per-caller rate-limited,
pinned to two allowlisted vision models, and scoped to the open-access collection and
sandboxed, freshly indexed collections only. Because indexing an archive takes minutes,
`index_zip` returns a pollable job id rather than blocking inside `execute`, and the
upload pump deliberately outlives the tool call — a host cancelling `execute` does not
cancel the job. Anonymous writes are sandboxed to a dedicated org and capped
server-side (100 images per job, 6 jobs per client per hour).

The whole app runs on Cloudflare Workers over HTTPS — the secure context WebMCP
requires — at https://paillette-stg.berlayar.ai.

## What we learned

**Effective human-AI collaboration matters more than the model underneath.** The
domain insight came before the code: from prior museum-innovation work we know
that experts usually arrive knowing the exact work they want — an artist, an
accession number, a medium — while most visitors arrive with a look or a mood:
a colour, a feeling, "something for an upcoming occasion." Neither a keyword box
nor a pure vector search serves both. So the tool surface carries both intents:
`facet` and inventory-grounded query interpretation for the expert who needs the
exact thing, and text, image, and colour embeddings for everyone searching by
vibe. The agent's job is to hear which kind of searcher is in front of it and
pick the right path — that is the collaboration, and it only works because the
human's context can steer declared tools instead of being lost in a form.

**Honesty is a feature.** Surfacing the search quota, the indexing progress, and
"here's what you could search for" is what makes the system feel intelligent to
the person using it.

**New technology makes the previously exorbitant cheap.** Multimodal search over
an entire museum once demanded a data-science team and bespoke integrations.
Today it is a Worker, a Vectorize index, and a list of WebMCP tools — and a zip
anyone brings.

**Good tool design beats UI scraping.** Clear schemas, honest job objects, and
recoverable errors are what make an agent reliable in a page; the same agent
guessing at buttons is not.
