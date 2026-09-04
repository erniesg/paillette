# Paillette

Multimodal search over art collections — text, image, colour and catalogue
metadata — with a **WebMCP** tool surface so a browser agent can drive the same
search and curation the human is using, in the same tab, on the same page state.

MIT licensed. Built and deployed on Cloudflare.

---

## Live

|             | URL                                 | State                                                                                                                                                |
| ----------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Staging** | <https://paillette-stg.berlayar.ai> | **Current build.** Use this.                                                                                                                         |
| Production  | <https://paillette.berlayar.ai>     | Older deploy. No indexing migration and no Vectorize metadata index — `/api/public-index/*` returns 404. The WebMCP indexing tools do not work here. |

Two pages matter on staging:

- **`/try`** — anonymous indexing sandbox. Drop a zip or a folder of images and
  it becomes a semantically searchable collection. First image is searchable
  ~11s after start; a 100-image zip finishes in roughly 5–8 minutes. No account,
  no metadata required; a CSV sidecar inside the zip becomes catalogue records if
  you have one.
- **`/nga/search`** — the published National Gallery of Art (Washington)
  open-access collection. (Route is `/nga/search`, served by
  `apps/web/app/routes/$orgId.search.tsx` — not `/collections/nga/search`.)

---

## What the search actually does

Four query modalities, all anonymous:

- **Description / semantic** — natural language over image and caption
  embeddings (`jina-clip-v2` for images, `jina-embeddings-v5-text-small` for
  caption text).
- **Image** — upload or link an image, match against the same image vectors.
- **Colour** — for published collections, a semantic pass on colour language
  followed by a client-side CIEDE2000 re-rank against each work's extracted
  palette. Sandbox-indexed collections have no extracted palette, so they get
  the semantic half only and the tool result says so.
- **Metadata / exact** — artist, medium, classification, date range, accession
  number, as keyword-scored SQL over the catalogue columns in D1.

Ranking is **reciprocal rank fusion** (`RRF_K = 60`, weighted per query route)
in `apps/api/src/routes/search.ts`, fusing three weighted channels:

| Channel                                                         | Source                                            |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `image_embedding`                                               | Jina CLIP image vectors in Vectorize              |
| `generated_caption_embedding` / `institution_caption_embedding` | caption vectors in a second Vectorize index       |
| `metadata`                                                      | keyword token scoring over catalogue fields in D1 |

Colour is a separate two-stage path, not one of the fused channels.

Two LLM steps sit in front of retrieval, both fail-open:

- `apps/api/src/utils/nga-search-intent.ts` — deterministic intent parsing for
  the NGA collection.
- `apps/api/src/utils/query-intent.ts` — for user-indexed collections, one small
  model call maps a natural-language query onto values that **actually exist**
  in that collection (from a D1 metadata inventory), producing structured
  filters plus a rewritten semantic query. Returns `null` on every failure path
  so search degrades to its pre-intent behaviour.

---

## The WebMCP layer

**25 tools** registered on `document.modelContext`.

```
apps/web/app/lib/webmcp/
  tools.ts       # the 25 tool definitions (schemas, annotations, execute)
  registry.ts    # host binding: feature detection, idempotent registration, AbortSignal
  store.ts       # the shared canvas — the same React state the human's UI renders from
  client.ts      # HTTP client for the public search + indexing endpoints
  caps.ts        # anonymous indexing caps, mirrored from the API
  collections.ts # which collections are exposed to anonymous callers
  __tests__/     # tools.test.ts, registry.test.ts, collections.test.ts
apps/web/app/components/webmcp/webmcp-bridge.tsx   # mounted once from app/root.tsx
apps/web/app/types/webmcp.d.ts                     # host API types
```

| Group                                | Tools                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read / search (`readOnlyHint: true`) | `list_collections`, `search_artworks`, `search_by_image`, `search_by_color`, `browse_collection`, `lookup_artwork`, `get_search_quota`, `get_view_context`, `search_by_exemplars`, `get_exhibition`, `get_index_status` |
| Shared canvas                        | `set_results`, `show_artwork`, `set_view`, `flag_artworks`, `redeal`, `compare_artworks`                                                                                        |
| Exhibition                           | `set_exhibition`, `write_labels`, `annotate_atlas`                                                                                                                             |
| Curation                             | `create_collection`, `add_to_collection`                                                                                                                                       |
| Indexing                             | `index_zip`, `index_folder`                                                                                                                                                    |
| Vision                               | `describe_artwork` — captioner on `gpt-5.6-luna` (or `gpt-5.6-terra`), scoped to the open-access collection and freshly indexed sandbox collections                            |

11 tools are `readOnlyHint: true`; the other 14 are `readOnlyHint: false`.
`create_collection`, `add_to_collection`, `index_zip` and `index_folder`
additionally require an in-page confirmation the human sees before anything
commits.

The bridge feature-detects `document.modelContext` (falling back to
`navigator.modelContext`), registers idempotently so React StrictMode's
double-mount cannot double-register, and threads `options.signal` into every
`execute`. A browser without WebMCP installs and renders nothing.

**Server surface the tools use.** Reads are thin wrappers over the existing
anonymous endpoints (`apps/web/app/routes/api.public-search.$orgId.*`). Indexing
and captioning needed new backend: `apps/api/src/routes/indexing.ts` and
`apps/api/src/routes/describe.ts`, behind Worker proxy routes
`apps/web/app/routes/api.public-index.*` and `api.public-describe.ts`. Anonymous
writes go to a dedicated sandbox org, capped server-side at 100 images per job,
120 MB per job, 8 MB per image, 24 jobs per client per hour, 5000 artworks total
(`INDEXING_CAPS` in `apps/api/src/routes/indexing.ts`).

### Trying the tools yourself

WebMCP requires a **secure (HTTPS) context**, so local dev will not expose tools
to a real browser agent — use the staging URL.

- **ChatGPT desktop app** — open a staging URL in its in-app browser (WebMCP on
  by default), or
- **Chrome 149+** — enable `chrome://flags/#enable-webmcp-testing`, restart,
  then open a staging URL.

Gate check in the console: `await document.modelContext.getTools()` should list
25 tools.

Sample archives for the sandbox live in `data/samples/` (mirrored to
`apps/web/public/samples/`, listed by `manifest.json`): a 25-image set with no
CSV, a 100-image NGA set with `metadata.csv`, plus Met and Cleveland sets.

---

## Quickstart

**Prerequisites:** Node >= 20, pnpm >= 9, a Cloudflare account with Wrangler
configured (D1, R2, Vectorize, KV, Queues, Workers AI).

```bash
git clone https://github.com/erniesg/paillette.git
cd paillette
pnpm install
pnpm dev        # api on :8787 (wrangler), web on :5173 (remix vite)
```

Secrets go in `apps/api/.dev.vars` and `apps/web/.env`. See
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) for the full setup, including
creating the Cloudflare resources.

Deploys are `wrangler deploy` from each app:

```bash
pnpm --filter @paillette/web deploy:staging
pnpm --filter @paillette/api deploy:staging
```

---

## Architecture in brief

```
apps/
  api/    Hono on Cloudflare Workers  (src/routes/{search,indexing,describe,mcp,...}.ts)
  web/    Remix on Cloudflare Workers (worker.ts + app/)
packages/
  ai/ color-extraction/ database/ document-processor/
  image-processing/ metadata/ translation/ types/
services/query-embeddings/   # external query-embedding service
scripts/                     # open-access ingestion, sample-dataset builders, backfills
eval/ infra/ data/ docs/
```

Cloudflare bindings (`apps/api/wrangler.toml`): `DB` (D1), `IMAGES` (R2),
`VECTORIZE` / `VECTORIZE_V2` and `CAPTION_VECTORIZE` / `CAPTION_VECTORIZE_V2`,
`CACHE` (KV), `AI` (Workers AI), and three Queues (`EMBEDDING_QUEUE`,
`TRANSLATION_QUEUE`, `OPEN_ACCESS_ASSET_QUEUE`). Staging is a separate `[env.staging]`
block with its own D1/R2/Vectorize resources.

Embeddings are generated by the Jina API (`jina-clip-v2`,
`jina-embeddings-v5-text-small`); the Workers AI binding is used for caption
query embeddings and translation, not as the primary embedding provider.

Paillette also has a pre-existing **HTTP MCP server** at `/api/v1/mcp`
(`apps/api/src/routes/mcp.ts`, streamable JSON-RPC + OAuth) — that is the
out-of-band integration; the WebMCP layer is the in-page one.

---

## Tests

```bash
pnpm test                                # turbo: all workspaces
pnpm --filter @paillette/web test        # vitest (includes the WebMCP tool tests)
pnpm --filter @paillette/api test        # vitest, node config
pnpm typecheck                           # turbo: tsc --noEmit everywhere
pnpm lint

cd apps/web && pnpm test:e2e             # playwright
```

The WebMCP tool surface is covered by
`apps/web/app/lib/webmcp/__tests__/{tools,registry,collections}.test.ts`; the
new backend by `apps/api/src/routes/{indexing,describe,metadata-map}.test.ts`.

---

## Docs

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design and tech decisions
- [GETTING_STARTED.md](docs/GETTING_STARTED.md) — local setup
- [webmcp-whats-new.md](docs/webmcp-whats-new.md) — what the WebMCP layer added,
  with dated commit evidence, split from the pre-existing platform
- [webmcp-submission-description.md](docs/webmcp-submission-description.md) — how
  the WebMCP layer is implemented and why
- [webmcp-submission-pack.md](docs/webmcp-submission-pack.md) — submission and
  demo logistics
- [SEARCH_API_SCALE_REPORT.md](docs/SEARCH_API_SCALE_REPORT.md) — search load
  behaviour

## Licence

MIT — see [LICENSE](LICENSE).
