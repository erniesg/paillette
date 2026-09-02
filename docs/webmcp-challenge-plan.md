# WebMCP Challenge — Paillette Submission Plan

> Goal: submit Paillette to the OpenAI WebMCP Challenge and win a top-10 spot ($3,000 + Codex Micro + ChatGPT Pro ×10 winners, $35k total).
> **Deadline: Wed Sep 3 2026, 1:00 PM PDT = Thu Sep 4 2026, 4:00 AM SGT.**
> Judging Sep 4–21; winners ~Sep 23.
> Sources verified against https://webmcp.devpost.com/rules on 2026-09-02 (not the marketing page — they differ).

## Verdict: we should submit — the fit is unusually strong

Paillette is already 80% of a winning entry:

- **An MCP server already exists** at `apps/api/src/routes/mcp.ts` (streamable HTTP + OAuth) with tools for `search_artworks`, `lookup_artwork`, `colour_search`, `list_collections`, `upsert_artwork_record`, `translate_text`, `extract_images`, etc.
- **Anonymous public search endpoints** already exist: `apps/web/app/routes/api.public-search.$orgId.{text,image,browse,quota}.ts`.
- **Cloudflare-native** (Remix on Workers + D1 + R2 + Vectorize + AI), already live at `paillette-stg.berlayar.ai` and `paillette.berlayar.ai` (both 200).
- **The core task is inherently agent-native**: "find me artworks like this one / in this mood / in these colours, then curate a collection" is exactly the human-and-agent-together shape the challenge asks for.

What's missing is the **browser surface** — registering Paillette's tools via `document.modelContext.registerTool(...)` so a browser agent discovers and calls them directly instead of guessing at the DOM. No `modelContext` code exists in the repo yet.

---

## ⛔ Eligibility blockers — fix these before anything else

These are hard rules, not nice-to-haves. Any one of them kills the entry.

### 1. No open-source licence file (BLOCKER)

`gh repo view` reports `licenseInfo: null`. The rules require the repo to
"be open source by including an open source license file … detectable and
visible at the top of the repository page (in the About section)".

- [ ] Add `LICENSE` (recommend **MIT** — shortest path, maximally permissive, GitHub auto-detects it) at repo root.
- [ ] It must land on **`master`** (the default branch) — GitHub only reads the licence from the default branch, so a licence on `deploy-nga-open-access` will not show in About.
- [ ] Verify: `gh repo view --json licenseInfo` returns non-null, and the About sidebar on github.com/erniesg/paillette shows it.

### 2. Repo must be functional from the default branch

The rules require "all necessary source code, assets, and instructions
required for the project to be functional". Judges will look at `master`.

- [ ] Merge the WebMCP work into `master` before submitting (or make `master` the branch we ship from).
- [ ] `README.md` must tell a judge how to run it and where the WebMCP tools are registered.

### 3. Pre-existing project rule (changes our whole framing)

> "Projects must be either newly created during the Hackathon Submission Period or, if the Project existed prior … must have been **meaningfully extended using WebMCP** after the Submission Period start date. **Pre-existing Projects will be evaluated only on work added during the Submission Period.**" Entrants "must provide clear documentation distinguishing prior work from new work, including … timestamped, dated commit history".

Submission Period started **Aug 25 2026, 11:00 AM PT**. Paillette long predates it.

Consequences:
- Everything we build for this must be committed **after Aug 25** (it is — 88 commits since).
- [ ] Write `docs/webmcp-whats-new.md`: a table of prior-work vs submission-period work with commit hashes and dates, linked from the README and the Devpost description.
- The video and the description must foreground **the WebMCP layer**, not the pre-existing platform. Treat Paillette-the-archive as the stage; the new tools are the act.

---

## Judging criteria (the real ones)

The rules list **four equally weighted** criteria — different from the marketing page's
"usefulness / originality / execution / thoughtful WebMCP use / human-agent experience".
Ties break in the order listed, so **WebMCP Leverage is the most valuable criterion.**

| Criterion (in tie-break order) | What they ask | Our angle |
|---|---|---|
| **1. WebMCP Leverage** | "How thoroughly and skillfully does the project use WebMCP? Does the code reflect genuine effort and a working, non-trivial implementation?" | Route-scoped dynamic tool registration, real JSON Schemas, `readOnlyHint` annotations, AbortSignal honoured, long jobs returning pollable ids, honest quota surfacing, tools that read *and* write the human's view |
| **2. Execution** | "a complete, coherent product experience — not just a technical proof of concept" | Production Cloudflare stack, live public URLs, real collections (NGA open access) online today |
| **3. Potential Impact** | "a credible, specific case for solving a real problem for a real audience" | Galleries and archives with unsearchable image piles; "index any zip/folder" generalises far past art |
| **4. Creativity & Ambition** | "creative and novel … differs from existing concepts" | WebMCP for *multimodal ingestion + co-curation*, not just search-as-a-tool |

**Implication:** depth of the WebMCP surface beats breadth of features. A tenth
tool that is thoughtfully annotated and visibly drives the page is worth more
than a second search modality.

---

## What WebMCP actually requires (technical ground truth)

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
  annotations: { readOnlyHint: true },
  execute: async (input, options) => {
    // options.signal is an AbortSignal. Return must be JSON-serializable.
    return await search(input.query, { signal: options.signal });
  },
});
```

Hard constraints:
- **Secure context required** — must run on `https://paillette-stg.berlayar.ai`, not localhost, for real agents.
- Tool `name` is unique per document; re-registering the same name rejects. Guard against double-mount (React StrictMode will bite).
- `execute` results are JSON-stringified — return plain objects, never DOM nodes.
- Read-only by default; mutations annotated and gated behind visible human intent.

**Testing surfaces (both blessed by the rules, judges use either):**
- ChatGPT desktop app → in-app browser (WebMCP on by default). ← primary
- Chrome **149+** with `chrome://flags/#enable-webmcp-testing`, then restart. ← fallback

---

## Submission checklist (verbatim requirements)

- [ ] **Working live URL** judges can open in ChatGPT's in-app browser or Chrome-with-flag. Keep it anonymous/public — if we auth it, credentials must go on the submission form. Must stay free and unrestricted until Sep 21.
- [ ] **Text description** covering, explicitly, all four prompts:
      (a) why this use case is a strong fit for WebMCP,
      (b) how it creates a better user experience,
      (c) what people and agents can do together that was difficult or impossible before,
      (d) briefly, how we implemented WebMCP.
- [ ] **Public code repo** with all source, assets, instructions, and a detectable OSS licence, containing a real `document.modelContext.registerTool({...})` call.
- [ ] **Demo video** — see the production plan below. Non-negotiable and the single most likely thing to sink us.
- [ ] English throughout.

---

## Tool inventory

### Tier 1 — ship these first (thin wrappers over existing endpoints)

| Tool | Backs on | Notes |
|---|---|---|
| `list_collections` | `/api/v1/mcp` `list_orgs` | discovery; `readOnlyHint` |
| `search_artworks` | public text search | semantic / keyword |
| `search_by_image` | public image search | image URL or upload → similar |
| `search_by_color` | public colour search | hex palette match |
| `lookup_artwork` | artwork read | full metadata + citation |
| `get_search_quota` | quota endpoint | surface limits honestly — a small, real "thoughtful use" signal |

### Tier 1.5 — the human-agent tools (cheapest points on the board)

These are what separate "an API with extra steps" from a co-pilot, and they map
straight onto criterion 1. Build these before Tier 2 if time is short.

| Tool | Purpose |
|---|---|
| `get_view_context` | Agent reads what the human is currently looking at (route, active collection, selected artwork, current result set) — so it can say "you're looking at X, want more like it?" |
| `show_artwork` / `set_results` | Agent **writes** the human's view: opens an artwork, or renders its result set into the page grid. The shared canvas. |
| `create_collection` / `add_to_collection` | Mutating, `readOnlyHint: false`, gated on a visible in-page confirmation |

### Tier 2 — the differentiators

| Tool | Purpose | Status |
|---|---|---|
| `index_zip` | Upload a zip of images (+ optional CSV metadata) → indexed, embedded, searchable collection | **committed** |
| `index_folder` | Agent streams a file list → same batch upload/embed path | **committed** |
| `get_index_status` | Poll a `job_id`; long work must not block a tool call | required by the above |
| `index_source` | Point at a source URL → Cloudflare Browser Rendering scrape → extract images+metadata → index | **stretch, cut first** |

### The one sentence

> Paillette turns **any** pile of images — a zip, a folder, an open-access collection — into a multimodal archive that a human and their agent search and curate together, in the same window, at the same time.

---

## 🎬 Demo video — yes, it is required, and here are the exact specs

Verified from the rules. The video is the only deliverable judges are guaranteed
to consume ("Judges are not required to test the Project and may choose to judge
based solely on the text description, images, and video").

**Hard requirements:**
- **Under 3:00.** Judges are not required to watch past 3:00. Target **2:30**, hard cap 2:50.
- **Public on YouTube.** Not unlisted — the rules say "uploaded to and made publicly visible on YouTube". Link goes on the submission form.
- **Audio required**, and it must cover **what you built** *and* **how you used WebMCP**. A silent screencast is non-compliant.
- **A clear demo of the project functioning.** And per Project Requirements, the app "must function as depicted in the video" — judges can and will open the live URL. Never stage a result we can't reproduce live.
- **No third-party trademarks, no copyrighted music.** No licensed music at all — narration over silence, or nothing. Keep other brands' logos off screen. Use **NGA open-access (public domain) works** as the on-screen art, which is what `deploy-nga-open-access` already gives us.
- English.

**Shot list (target 2:30):**

| Time | On screen | Voiceover beat |
|---|---|---|
| 0:00–0:15 | Paillette open in ChatGPT's in-app browser, gallery grid | "Paillette is multimodal search over art collections. Today it's an app you click. With WebMCP it's also an app your agent drives — with you, in the same window." |
| 0:15–0:45 | Ask the agent for a mood/subject; results appear **in the page grid**; activity panel names the tool + args | "The agent isn't scraping the DOM. The page registers tools with `document.modelContext.registerTool` — real schemas, read-only by default." |
| 0:45–1:05 | Colour/image search via agent | "Same surface, three embeddings: text, image, colour." |
| 1:05–1:30 | Human clicks an artwork → agent calls `get_view_context`, responds to what the human is looking at → `show_artwork` moves the human's view | "This is the part that's new: the agent can read what I'm looking at, and change what I'm looking at. It's one canvas, two operators." |
| 1:30–2:05 | Drop a zip → `index_zip` → `get_index_status` progress → the new collection is searchable, agent immediately searches it | "Any zip, any folder, becomes an agent-searchable multimodal archive in one turn." |
| 2:05–2:20 | `create_collection` + `add_to_collection` with the in-page confirm | "Mutations are annotated and need my confirmation." |
| 2:20–2:35 | Architecture card + live URL + repo | "Remix on Cloudflare Workers, D1, R2, Vectorize. Feature-detected — the page is unchanged in a browser without WebMCP." |

**Production (tooling that's actually installed here):**
- `ffmpeg` is on the machine. `hyperframes` CLI is **not** installed — do not put the deadline on it; optional polish only, for a title/architecture card.
- Record the **ChatGPT desktop window only**, not the full desktop. macOS: QuickTime → New Screen Recording (or CleanShot). 1920×1080, 30fps.
- Turn on Do Not Disturb. No other tabs, no bookmarks bar, no mail/Slack, **nothing with a token or key on screen**.
- Write the exact prompts on a card first and read them verbatim — retakes are the time sink.
- Narrate **live** in one take if possible; fallback is a silent capture + separate VO track.
- Assemble/normalise:
  ```sh
  # trim + concat takes
  ffmpeg -i take1.mov -ss 0 -to 45 -c copy p1.mov
  printf "file 'p1.mov'\nfile 'p2.mov'\n" > list.txt
  ffmpeg -f concat -safe 0 -i list.txt -c copy joined.mov
  # separate VO (only if not narrating live)
  ffmpeg -i joined.mov -i vo.wav -map 0:v -map 1:a -shortest -c:v copy -c:a aac joined_vo.mov
  # final encode + loudness normalise
  ffmpeg -i joined_vo.mov -af loudnorm=I=-16:TP=-1.5:LRA=11 \
         -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k paillette-webmcp.mp4
  # confirm under 3:00
  ffprobe -v error -show_entries format=duration -of csv=p=0 paillette-webmcp.mp4
  ```
- **Upload to YouTube as Public by T-3h.** HD processing is not instant, and a video stuck at 360p on submission is a bad look.

**Video fallbacks:**
- ChatGPT in-app browser uncooperative → record in Chrome 149 with `chrome://flags/#enable-webmcp-testing`. The rules bless both.
- A live agent turn flakes mid-take → cut the beats as separate clips; do **not** fake a result.
- `index_zip` not landed by the gate → drop that beat, extend the shared-canvas beat, and cut the video to Tier 1 + 1.5. Still a compliant, coherent entry.

---

## T-minus schedule (now = Sep 2, ~10:15 PDT / Sep 3, ~01:15 SGT — T-26.75h)

| Block | Window (SGT) | Work | Gate |
|---|---|---|---|
| **0** | now → +1h | Join Devpost, create draft submission, add `LICENSE` on `master`, confirm which URL we submit | Devpost draft exists; About shows a licence |
| **1** | +1h → +4h | `app/lib/webmcp.ts`, Tier 1 tools, local `.d.ts` types, feature detection, mount once in `root.tsx`; deploy to staging | **GATE 1: `document.modelContext.getTools()` lists our tools in ChatGPT's in-app browser and `search_artworks` returns real results.** If this fails, everything downstream is theatre — fix it before writing another tool. |
| **2** | +4h → +6.5h | Tier 1.5 shared-canvas tools + agent activity panel | Agent action visibly changes the human's view |
| — | sleep / buffer | | |
| **3** | +9h → T-10h | `index_zip`, `get_index_status`, then `index_folder` | **GATE 2 (T-10h): if `index_zip` isn't working end-to-end, freeze the build.** Cut `index_folder` and `index_source` without hesitation. |
| **4** | T-9h → T-4h | Video: script → rehearse → record → cut → **upload public to YouTube** | **GATE 3 (T-3h): video is live and public on YouTube.** |
| **5** | T-4h → T-2h | `docs/webmcp-whats-new.md`, Devpost description (all four prompts), merge to `master`, README instructions | Repo is functional and licence-visible on default branch |
| **6** | T-2h → T-0 | Final verify from a clean browser profile, submit, screenshot the confirmation | Submitted with >1h spare |

**Scope-cut ladder, in the order things get dropped:** `index_source` → `index_folder` → colour/image search tools → `index_zip`. Tier 1 + Tier 1.5 + video is the floor, and it is still a legitimate top-10 entry because criterion 1 rewards depth over breadth.

---

## Progress tracker

### Phase 0 — Eligibility (≤1h) — HIGHEST PRIORITY
- [ ] Join the hackathon on https://webmcp.devpost.com (registration closes at the same moment as submission — do not leave it late).
- [ ] Create a draft submission (title + one-line pitch) as a place to drop assets.
- [ ] Add `LICENSE` (MIT) on `master`; verify About section shows it.
- [ ] Decide submitted URL: `paillette-stg.berlayar.ai` vs `paillette.berlayar.ai` (prefer whichever is stable and anonymous through Sep 21).
- [ ] Confirm ChatGPT desktop app installed, or Chrome ≥149 with the flag on.

### Phase 1 — Browser WebMCP bridge (≤3h)
- [ ] `apps/web/app/lib/webmcp.ts` exporting `registerPailletteTools()`.
- [ ] Local `webmcp.d.ts` for `ModelContext` / `ModelContextTool` (not in `@types` yet).
- [ ] Feature-detect: `if (!('modelContext' in document)) return;` — page identical without the API.
- [ ] Register Tier 1 tools, each wrapping an existing public-search fetch, honouring `options.signal`.
- [ ] `annotations.readOnlyHint: true` on every Tier 1 tool.
- [ ] Mount once in `root.tsx`; guard against StrictMode double-registration.
- [ ] Route-scoped registration: collection routes register collection-scoped tools, and unregister on unmount.
- [ ] Deploy to staging over HTTPS.
- [ ] **DoD:** `getTools()` lists Paillette tools in ChatGPT's in-app browser; `search_artworks` returns real results.

### Phase 2 — Human-agent shared canvas (≤2.5h)
- [ ] `get_view_context` returns route + active collection + selected artwork + current results.
- [ ] `show_artwork` / `set_results` write into the same React state the human's UI reads.
- [ ] Agent activity panel: which tool ran, with what args, what came back.
- [ ] `create_collection` / `add_to_collection` with `readOnlyHint: false` and an in-page confirmation.
- [ ] **DoD:** human and agent converge on the same visible result set; agent actions are legible in the UI.

### Phase 3 — Indexing tools (≤7h)
- [ ] `index_zip`: parse zip client-side, split images vs CSV, POST to upload + metadata + embed queue, return `job_id` + collection id.
- [ ] `get_index_status`: pollable progress (never block inside `execute`).
- [ ] `index_folder`: agent supplies a file list → same batch path.
- [ ] `index_source` *(stretch — cut first)*: Cloudflare Browser Rendering scrape → extract → `upsert_artwork_record`. Scope to public/open-access sources only and document that intent.
- [ ] **DoD:** a zip becomes a searchable collection end-to-end, live, on camera.

### Phase 4 — Video (≤5h, start no later than T-9h)
- [ ] Prompt card written (exact strings to type).
- [ ] Screen clean: DND on, no secrets, no other brands.
- [ ] Record; retake beats as needed.
- [ ] Cut to ≤2:50, loudness-normalise, encode H.264/AAC.
- [ ] Upload **Public** to YouTube; confirm HD processed; copy link.

### Phase 5 — Submission (≤2h)
- [ ] `docs/webmcp-whats-new.md` — prior vs submission-period work, with commit hashes and dates.
- [ ] README: what it is, how to run, where tools are registered.
- [ ] Merge to `master`; confirm licence detected.
- [ ] Devpost description answering all four required prompts explicitly.
- [ ] Verify the live URL in a clean profile with WebMCP enabled.
- [ ] Submit. Screenshot the confirmation.

---

## Risks & mitigations

- **No licence on the repo.** → Blocker. Fix in Phase 0, on `master`.
- **Pre-existing-project rule discounts everything built before Aug 25.** → `webmcp-whats-new.md` with dated commits; frame the entry around the new layer.
- **WebMCP is experimental** (ChatGPT in-app browser; Chrome 149 + `#enable-webmcp-testing`). → Feature-detect so the app degrades to normal; verify on the real surface at GATE 1, not at the end.
- **~27h to deadline, and the video is the tail risk.** → Hard gates above; the scope-cut ladder is pre-agreed so nobody negotiates with the clock at 3am.
- **Video non-compliance** (over 3:00, unlisted, no audio, licensed music). → Checklist above; `ffprobe` the duration before upload.
- **Scraping arbitrary sources has ToS/legal risk.** → `index_zip`/`index_folder` are the safe default; `index_source` stays scoped to open-access sources and is the first thing cut.
- **Judges test the live URL and find it doesn't match the video.** → Only demo what is genuinely deployed; re-verify after the final merge to `master`.
- **Tool-name collisions / double registration.** → Register once, unregister on route unmount, guard StrictMode.

## Definition of done (overall)

- [ ] Live public app exposes Paillette tools to a browser agent, verified via `getTools()` in ChatGPT's in-app browser.
- [ ] A zip becomes an agent-searchable collection, on camera and reproducible live.
- [ ] Human and agent visibly share one canvas.
- [ ] Repo public on `master`, licensed, with real `registerTool` calls and run instructions.
- [ ] <3:00 public YouTube video with narration covering what we built and how we used WebMCP.
- [ ] Devpost submission entered before Sep 3, 1:00 PM PDT.
