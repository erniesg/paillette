# Devpost submission text (draft)

> **Before pasting this into Devpost, verify every `[VERIFY: ...]` marker below
> against the actual code in `apps/web/app/lib/webmcp/**` and
> `apps/web/app/components/webmcp/**` — that work was still landing from other
> agents at the time this draft was written (2026-09-03, ~01:15 SGT) and none of
> it existed in the tree yet. Delete any paragraph describing a tool that did not
> ship, and delete the markers once confirmed. Do not submit with an unresolved
> `[VERIFY]` in the text.**

Paillette turns a pile of images — a zip, a folder, an open-access museum
collection — into a multimodal archive that a human and their AI agent search and
curate together, in the same browser tab, at the same time. This submission covers
only the WebMCP layer added during the Submission Period; the underlying archive
platform (multimodal search, the Cloudflare stack, an existing HTTP MCP server)
predates Aug 25 2026 and is documented, with commit evidence, in
`docs/webmcp-whats-new.md`.

## Why this use case is a strong fit for WebMCP

Paillette's core interaction — "find me artworks like this one / in this mood /
in these colours, then build a collection" — is exploratory and conversational by
nature, which is exactly the shape WebMCP is built for: instead of a browser agent
guessing at DOM selectors on an art-search page, the page itself declares its real
capabilities as typed tools. Paillette already modeled this domain as tools once,
for its existing HTTP MCP server (`apps/api/src/routes/mcp.ts`) — `search_artworks`,
`colour_search`, `lookup_artwork`, `list_collections`, and more. WebMCP lets a
general-purpose browser agent reach the same verbs directly inside the page a human
is already looking at, with no separate integration and no server-side OAuth
handshake for the read paths. And because the domain is genuinely multimodal —
text, image, and colour queries, plus curation into collections — WebMCP has more
than one tool to actually leverage, not a single search box wrapped in a schema.

## How it creates a better user experience

There is no handoff. The agent runs in the same tab the person is already
browsing, not a disconnected chat window that has to be told what's on screen.
`[VERIFY: get_view_context]` lets the agent read the human's current route, active
collection, selected artwork, and result set, so it can respond to what the person
is actually looking at instead of asking them to re-describe it.
`[VERIFY: show_artwork / set_results]` let the agent write back into that same
view — opening an artwork or rendering a new result set directly into the grid the
human is scrolling — so the two of them converge on one visible state instead of
the agent narrating results in text. Every read tool is registered with
`annotations.readOnlyHint: true`; every tool that mutates data
(`[VERIFY: create_collection, add_to_collection]`) is annotated `readOnlyHint:
false` and gated behind an in-page confirmation the human sees before it commits.
Nothing changes for the vast majority of visitors without WebMCP support — the
bridge feature-detects `'modelContext' in document` and the page is byte-for-byte
identical without it.

## What people and agents can do together that was difficult or impossible before

Before this layer, "using Paillette with an agent" meant one of two things: calling
the separate authenticated MCP endpoint out of band, disconnected from whatever the
human happened to be looking at in their browser, or an agent driving the page
blind — clicking through the DOM with no shared state and no idea what the person
had already selected. Now the human and the agent operate on the same page state at
the same time: a person opens an artwork, the agent already knows (via
`[VERIFY: get_view_context]`) and can say "here are five more like it" — and those
five appear directly in the grid, not in a separate chat reply the person has to
cross-reference back to the page.
`[VERIFY — confirm before including: if index_zip/index_folder shipped]` a person
can also drop in a zip of their own images and have the agent turn it into a
searchable collection and immediately query it, in the same conversational turn —
something neither a static gallery site nor an out-of-band MCP integration offers
today. Mutating actions (building or adding to a collection) stay visible and
confirmed in-page, so co-curation has an audit trail instead of being a black box.

## Briefly, how we implemented WebMCP

Tools are registered from `apps/web/app/lib/webmcp/**`
`[VERIFY: exact file/module names]`, mounted once from `apps/web/app/root.tsx`
behind a feature-detection guard (`'modelContext' in document`) and a
StrictMode-safe double-registration check. Each tool declares a real JSON Schema
`inputSchema`, a `title`/`description`, and `annotations.readOnlyHint`; `execute`
honours the `AbortSignal` passed via `options.signal` so a host can cancel an
in-flight call. The Tier 1 tools (`list_collections`, `search_artworks`,
`search_by_image`, `search_by_color`, `lookup_artwork`, `get_search_quota`)
`[VERIFY: final tool names/count]` are thin wrappers over Paillette's existing
anonymous public search endpoints
(`apps/web/app/routes/api.public-search.$orgId.{text,image,browse,quota}.ts`) — no
new backend surface for reads. The shared-canvas tools read and write the same
React state the human's UI already renders from, so there is exactly one source of
truth for "what's on screen." Long-running work (`[VERIFY: index_zip /
get_index_status]`) returns a pollable job id rather than blocking inside
`execute`. The whole app runs on Cloudflare Workers over HTTPS — the secure
context WebMCP requires — at `[VERIFY: final submitted URL — paillette-stg.
berlayar.ai vs paillette.berlayar.ai]`.
