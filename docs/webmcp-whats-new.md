# What's new for the WebMCP Challenge

Paillette is a pre-existing project. Under the [hackathon rules](https://webmcp.devpost.com/rules),
a pre-existing project "must have been meaningfully extended using WebMCP after the
Submission Period start date," and "will be evaluated only on work added during the
Submission Period." This document draws the line between prior work and Submission
Period work, and — separately, because they are not the same thing — between
Submission Period work that is WebMCP and Submission Period work that is not.

**Submission Period start:** Aug 25 2026, 11:00 AM PT (= Aug 26 2026, 02:00 SGT).

**How this was verified.** Every commit hash below comes from running, in this
repository, on the `deploy-nga-open-access` branch:

```sh
git log --since=2026-08-25T11:00:00-07:00 --format='%ad %h %s' --date=iso
```

The commit immediately before the cutoff is `e4ae3b43` ("perf(search): cache every
NGS Try result set", 2026-08-24 16:02:09 +0800), and the first one after it is
`8a86c4c5` ("feat(search): add global NGS quota ledger", 2026-08-28 16:04:02 +0800).
There is a multi-day gap with no commits in between, so the boundary is unambiguous
and nothing straddles it.

This makes the prior/new split unusually easy to audit. `master` sat at exactly
`e4ae3b43` — the last pre-period commit — until the submission-period work was
fast-forwarded onto it. It has only ever moved forward since, by fast-forward, and
now sits at `9daedcd` (111 commits past `e4ae3b43`). So:

```sh
git log e4ae3b43..master      # == the submission-period work, and nothing else
```

There was no merge commit and no rebase of the pre-period history: `master` never
held a commit the branch lacked, so every hash below is the original, dated commit
as it was authored.

A judge can rerun the command above and check every hash independently.

---

## 1. Prior work (before Aug 25 2026, 11:00 AM PT)

This is the platform. It is **not** being submitted as new work; it is the stage the
new WebMCP layer stands on, and per the pre-existing-project rule it is not what
judges are asked to score.

- **Repository founded**: `e6fcba2a` "Initial commit: Setup paillette master
  repository" (2025-11-06).
- **HTTP MCP server** (`apps/api/src/routes/mcp.ts`, streamable JSON-RPC + OAuth,
  mounted at `/api/v1/mcp`) with tools including `search_artworks`,
  `lookup_artwork`, `colour_search`, `list_collections`, `list_orgs`,
  `upsert_artwork_record`, `translate_text`, `extract_images`: file first added in
  `12714dc3` "ship search api docs and usage updates" (2026-05-24).
- **Anonymous public search endpoints**
  (`apps/web/app/routes/api.public-search.$orgId.{text,image,browse,quota}.ts`):
  browse/proxy path added `2360bfea` (2026-05-23), extended `c1c51576` "Add
  infinite collection browse to search" (2026-05-23).
- **Org-scoped search UI** (`apps/web/app/routes/$orgId.search.tsx`, the page that
  works for any org including `nga`): added in `8ba28db0` "Integrate NGS hybrid
  search" (2026-05-23).
- **NGA (National Gallery of Art, Washington) open-access ingestion tooling**
  (`scripts/open-access-art-dry-run.mjs`, `scripts/open-access-art-apply.mjs`, the
  `nga` org key in `apps/api/src/utils/orgs.ts`): added starting `f2e6146c` /
  `2811583b` (2026-06-05), extended through `ddba5f88` (2026-06-30).
- **Cloudflare-native stack**: Remix on Workers, D1, R2, Vectorize, Cloudflare AI —
  in place since the earliest phases of the repository (see `docs/ARCHITECTURE.md`
  for the full history).
- **Live URLs**: `paillette-stg.berlayar.ai` and `paillette.berlayar.ai`, both
  serving before the Submission Period and both still live today.

None of the above calls `document.modelContext`. No WebMCP code existed anywhere in
the tree as of the Aug 25 cutoff — confirmed by `grep -rn "modelContext" apps/`
returning nothing prior to this branch's WebMCP work.

---

## 2. Work added during the Submission Period (Aug 25 2026 →)

This splits into two groups that must **not** be conflated: the part that is WebMCP
(Section 2a — this is the basis for eligibility and the primary thing judges should
weigh), and everything else that also happened to be committed in this window
(Section 2b — real, dated, in-period engineering, but it does not use WebMCP and is
not being offered as evidence of "meaningfully extended using WebMCP").

### 2a. The WebMCP layer — this is what's being judged

Fifteen tools are registered on `document.modelContext`. All of it was written on
2026-09-03, inside the Submission Period. Hashes in commit order:

- **Bridge core** — feature detection (`document.modelContext`, falling back to
  `navigator.modelContext`), idempotent registration that survives React
  StrictMode's double-mount, and `AbortSignal` plumbing into every `execute`:
  `19bc988`, 2026-09-03 01:16 +0800 (`apps/web/app/lib/webmcp/registry.ts`).
- **Anonymous indexing job routes** on the API worker — the server side the
  indexing tools call: `5ddb16d`, 2026-09-03 01:20 +0800
  (`apps/api/src/routes/indexing.ts`).
- **The first twelve tools registered on `document.modelContext`**, and the bridge
  mounted once from `apps/web/app/root.tsx` — read/search (`list_collections`,
  `search_artworks`, `search_by_image`, `search_by_color`, `browse_collection`,
  `lookup_artwork`, `get_search_quota`) and shared-canvas/curation
  (`get_view_context`, `set_results`, `show_artwork`, `create_collection`,
  `add_to_collection`): `629f47c`, 2026-09-03 01:29 +0800.
- **Browser indexing client and `/api/public-index/*` proxy routes**: `07006bc`,
  2026-09-03 01:32 +0800.
- **Skipped-archive-entry reporting and an end-to-end indexing check**: `0ee64b9`,
  2026-09-03 01:36 +0800.
- **CORS-open source images**, so an agent can actually fetch what a tool returns:
  `9536606`, 2026-09-03 17:35 +0800.
- **Zip/folder indexing tools** (`index_zip`, `index_folder`, `get_index_status`) —
  taking the surface to fifteen tools: `04b2bc5`, 2026-09-03 17:49 +0800. All three
  landed; nothing was cut.
- **OpenAI-assisted metadata and access** — a model-mapped CSV header route with a
  client-side learned-mapping fallback (`430611ea`/`e3667c2f`), an LLM query
  interpreter grounding natural-language filters in each collection's own inventory
  (`66a77de1`/`2d6b158c`), a `describe_artwork` vision captioner taking the surface
  to seventeen tools (`c155b804`/`14bf9da8`), and a shared daily OpenAI budget across
  all of it (`6e7b918b`, `dffa2f2f`), all committed 2026-09-03.
- **Embedding fix** — indexed images were being embedded with the wrong Jina task
  type and so never matched a query: `2750179`, 2026-09-03 17:54 +0800.
- **Anonymous job cap raised to 100 images**: `386381c`, 2026-09-03 18:08 +0800.
- **`/try`** — the anonymous human-facing page for the same flow the indexing tools
  drive, sharing one client and one job with the agent path: `087c17d`,
  2026-09-03 10:42 +0000.
- **Vector-propagation honesty** — a search fired the instant a job reports
  `searchable: true` legitimately returns nothing for ~15s; both the page and
  `get_index_status` now say so instead of implying an empty collection:
  `b813d13`, 2026-09-03 10:56 +0000.
- **Auto-generated suggested searches** for a freshly indexed collection, derived
  from the collection's own catalogue metadata (or its filenames when there is no
  CSV sidecar) and surfaced both as chips on `/try` and on the
  `get_index_status` payload, so a human and an agent reading the same job see the
  same suggestions: `73df578`, 2026-09-03 11:11 +0000. Two implementations of this
  were written in parallel; the route-side one was removed in `c7c69de` and
  accession numbers were excluded as query candidates in `804bbb2`.
- **Demo hardening for `/try`** — four failure modes closed (`fe0b212`) and a
  four-collection picker (`809c7a2`), both 2026-09-03 20:02–20:05 +0800.

All of the above hashes fall after `e4ae3b43` (2026-08-24) and are verifiable with
the same `git log --since=...` command at the top of this document.

### 2b. Other engineering completed in the same window (not WebMCP)

Listed here only for completeness and honesty — this is genuine, timestamped,
in-period work, but none of it calls the WebMCP API, so it is **not** claimed as the
"meaningful extension using WebMCP" the rules require.

- **WorkOS auth migration and hardening** — session handling, org-key retirement,
  role-based write gating, MCP internal-capability signing/provenance, quota
  sanitisation. 79 commits, `8a86c4c5` "feat(search): add global NGS quota ledger"
  (2026-08-28 16:04) through `59c85894` "fix(web): avoid replaying WorkOS session
  handlers" (2026-08-28 22:36).
- **Interactive NGA query-interpretation visualisation** (a human-facing UI panel
  showing how a natural-language query maps to the underlying ranking — no
  WebMCP/agent path). 8 commits, `5991ae16` "feat(web): illustrate NGA query
  interpretation" (2026-08-31 16:00) through `c4c1a135` "fix(web): clarify
  query-to-ranking flow" (2026-08-31 17:56).
- **Submission logistics**: `4e10a26f` "docs: add WebMCP Challenge submission plan"
  (2026-09-03 00:57), `3f07ffd0` "docs: ground WebMCP plan in verified Devpost
  rules" (2026-09-03 01:06), `048f8044` "chore: add MIT licence" (2026-09-03
  01:12).

---

## Summary for judges

- **Before Aug 25 2026**: the archive platform — multimodal search, the HTTP MCP
  server, the public search API, NGA open-access ingestion. Pre-existing; not what
  is being judged.
- **After Aug 25 2026, and using WebMCP**: the browser-native agent layer —
  `document.modelContext.registerTool()` calls that let a browser agent discover
  and drive Paillette's search, view, and indexing tools directly — seventeen tools,
  all committed on 2026-09-03. This is the work this submission is asking to be
  judged on. See Section 2a for the exact commit hashes.
- **After Aug 25 2026, not using WebMCP**: real engineering (auth hardening, a
  query-interpretation UI) that happened to land in the same window. Included here
  for transparency, not claimed as the basis for eligibility.
