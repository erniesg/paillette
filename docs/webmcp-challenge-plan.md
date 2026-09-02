# WebMCP Challenge — Paillette Submission Plan

> Goal: submit Paillette to the OpenAI WebMCP Challenge and win a top-10 spot.
> Deadline: **Wed Sep 3 2026, 1:00 PM PT** = **Thu Sep 4 2026, 4:00 AM SGT** (~27h from repo review).

## Verdict: we should submit — the fit is unusually strong

Paillette is already 80% of a winning entry:

- **An MCP server already exists** at `apps/api/src/routes/mcp.ts` (streamable HTTP + OAuth) with tools for `search_artworks`, `lookup_artwork`, `colour_search`, `list_collections`, `upsert_artwork_record`, `translate_text`, `extract_images`, etc.
- **Anonymous public search endpoints** already exist: `apps/web/app/routes/api.public-search.$orgId.{text,image,browse,quota}.ts`.
- **Cloudflare-native** (Workers + D1 + R2 + Vectorize + AI) — matches the challenge's judging bench (Cloudflare's Andrew Galloni is a judge).
- **The core task is inherently agent-native**: "find me artworks like this one / in this mood / in these colours and curate a collection" is exactly what an agent + human co-pilot does well, and exactly what the challenge wants ("an app that becomes meaningfully better when people and their agents use it together").

What's missing is the **browser surface** — registering Paillette's tools via `document.modelContext.registerTool(...)` so a browser agent (ChatGPT in-app browser / Chrome WebMCP flag) discovers and calls them directly, instead of guessing at the DOM.

## What WebMCP actually requires (technical ground truth)

From the W3C WebMCP draft + Chrome EPP:

```ts
document.modelContext.registerTool({
  name: "search_artworks",          // 1-128 chars, [A-Za-z0-9_-.]
  title: "Search artworks",
  description: "Natural-language / semantic search over a collection",
  inputSchema: {                    // JSON Schema object
    type: "object",
    properties: { query: { type: "string" }, topK: { type: "integer", default: 10 } },
    required: ["query"],
  },
  execute: async (inputObject, options) => {
    // options.signal is an AbortSignal. Return must be JSON-serializable.
    return await search(inputObject.query);
  },
});
```

Hard constraints to respect:
- **Secure context required** (must run on `https://paillette-stg.berlayar.ai`, not localhost, for real agents).
- Tool `name` is unique per document; re-registering the same name rejects.
- `execute` result is JSON-stringified — return plain objects/strings, not DOM nodes.
- Tools must be **idempotent/read-only by default**; mutations should be gated behind user intent (annotations: `readOnlyHint`).

## Submission requirements (from Devpost / openai.com)

- [ ] Project description
- [ ] **Working live app** (public URL)
- [ ] **Code repository** (public, `erniesg/paillette`)
- [ ] **Demo video** (required) — this is make-or-break; plan time for it
- [ ] Judges: usefulness, originality, execution, thoughtful WebMCP use, human-agent experience

## Tool inventory (what agents should be able to do)

### Tier 1 — ship these (reuse existing backend)

| Tool | Backs on | Notes |
|---|---|---|
| `list_orgs` | `/api/v1/mcp` `list_orgs` | discover collections |
| `search_artworks` | public text search | semantic / keyword |
| `search_by_image` | public image search | upload/URL image → similar |
| `search_by_color` | public color search | hex palette match |
| `lookup_artwork` | artwork read | full metadata + citation |
| `get_search_status` | quota endpoint | surface limits honestly |

### Tier 2 — the differentiators the user asked for (build)

| Tool | Purpose | New work |
|---|---|---|
| `index_zip` | Upload a zip of images (and optional CSV metadata) → indexed, embedded, searchable collection | zip parse + reuse upload/embedding queue |
| `index_folder` | Index a folder of local files (agent streams file list) | batch upsert + embed queue |
| `index_source` | _(stretch)_ Point at a source URL/reference → scrape (Cloudflare Browser Rendering / scrape worker) → extract images+metadata → index | new scrape worker + extract reuse |
| `create_collection` | Make a named, shareable collection from search results | reuse `upsert_collection` |
| `add_to_collection` | Curate results into a collection | reuse existing |

### The winning "one sentence"

> Paillette turns **any** collection — a zip, a folder, or a source website — into a multimodal, agent-searchable art archive that a human and their agent curate together.

## Phased task list (track progress here)

### Phase 0 — Submit placeholder & confirm eligibility (≤ 1h) — HIGHEST PRIORITY
- [ ] Register on Devpost (https://webmcp.devpost.com) and confirm eligibility + exact deadline.
- [ ] Create a draft submission (title, one-line pitch) so we have a place to drop assets.
- [ ] Confirm the live app URL we'll use (`paillette-stg.berlayar.ai` vs `paillette.berlayar.ai`).
- [ ] Note any sponsor-specific prize categories (Shopify / Chrome / Netlify / Cloudflare / Vercel / Render).

### Phase 1 — Browser WebMCP bridge (≤ 3h)
- [ ] Add a client-side `registerPailletteTools()` module in `apps/web` (e.g. `app/lib/webmcp.ts`).
- [ ] Register **Tier 1** tools via `document.modelContext.registerTool`, each wrapping the existing public-search fetch calls.
- [ ] Guard: `if (!('modelContext' in document)) return;` — page behaves identically without the API (feature-detect).
- [ ] `readOnlyHint` on all Tier 1 tools; mutations annotated and human-confirmable.
- [ ] Mount the registration in `app/root.tsx` (or a search-scope route) once, idempotently.
- [ ] TypeScript types for `ModelContext`/`ModelContextTool` (spec is not in `@types` yet — add a local `.d.ts`).
- [ ] Definition of done: in Chrome with WebMCP origin-trial/flag, `document.modelContext.getTools()` lists Paillette tools; calling `search_artworks` returns real results.

### Phase 2 — Indexing tools (zip / folder / source) (≤ 8h)
- [ ] `index_zip`: client parses zip (unzip stream), splits images vs CSV, POSTs to upload + metadata + embed queue; returns collection id + progress.
- [ ] `index_folder`: agent supplies a file list; reuse the batch upload path.
- [ ] `index_source`: new scrape worker (Workers Browser Rendering or `cloudflared` scrape) → discover images/metadata → feed `extract` + `upsert_artwork_record`.
- [ ] Return a `job_id` + status endpoint so agents can poll (`get_index_status`).
- [ ] Definition of done: a zip or URL becomes a searchable collection end-to-end, demonstrable in the video.

### Phase 3 — Human-agent co-pilot UX (≤ 4h)
- [ ] Make search results the *shared canvas*: agent actions reflect into the UI (results grid, active collection) so the human sees and steers.
- [ ] A minimal "agent activity" panel that shows which tool ran and what it returned.
- [ ] Definition of done: human types a query AND/OR agent runs a tool; both converge on the same visible result set.

### Phase 4 — Demo video + writeup (≤ 3h, parallelizable)
- [ ] Script a 2–3 min video: (1) ask ChatGPT/Chrome agent "find me works like this one", (2) drop a zip, (3) point at a source URL, (4) agent curates a collection with the human.
- [ ] Record in ChatGPT in-app browser (supports WebMCP out of the box) — easiest proof.
- [ ] Write Devpost description: problem, demo, how WebMCP is used thoughtfully, architecture.
- [ ] Push repo, ensure public, link in submission.

## Judging-criteria mapping (how we win)

| Criterion | Our angle |
|---|---|
| **Usefulness** | Real galleries (NGS live today) + "index anything" is broadly useful beyond art |
| **Originality** | WebMCP for *multimodal collection ingestion + curation*, not just search-as-a-tool |
| **Execution** | Reuses a production-grade Cloudflare stack; small, surgical new surface |
| **Thoughtful WebMCP use** | Read-only-by-default, feature-detected bridge, structured schemas, abort-signal support, honest quota surfacing |
| **Human-agent experience** | Shared canvas: human and agent co-curate the same results, not a fire-and-forget call |

## Risks & mitigations

- **WebMCP is experimental** (Chrome flag/origin trial, ChatGPT in-app browser). → Feature-detect; the app works unchanged without it. Demo on ChatGPT in-app browser (first-class support).
- **Deadline is ~27h.** → Phase 0 first (never lose the spot to a missed registration). Demo video is the bottleneck — start it early.
- **Scrape/index of arbitrary sources has legal/ToS risk.** → Ship `index_zip`/`index_folder` as the safe default; keep `index_source` scoped to public/open-access sources and document intent.
- **Tool-name collisions / re-registration.** → Register exactly once, guard against duplicate mounting.

## Definition of done (overall)

- [ ] Live app exposes Paillette tools to a browser agent (verified via `getTools()`).
- [ ] A zip, a folder, or a source URL can be turned into a searchable collection by an agent.
- [ ] Demo video + Devpost description submitted before the deadline.
- [ ] Public repo linked in the submission.
