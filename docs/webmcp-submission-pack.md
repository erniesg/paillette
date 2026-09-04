# WebMCP Challenge — submission pack

Everything needed to fill in the Devpost form, plus the demo script.
**Deadline: 2026-09-03 20:00 UTC / 1:00 PM PDT.** Registration closes at the same moment.

---

## 1. Form fields — paste these

| Field | Value |
|---|---|
| **Live URL** | `https://paillette-stg.berlayar.ai` |
| **Repo** | `https://github.com/erniesg/paillette` |
| **Licence** | MIT — detected by GitHub, visible in the About panel |
| **Video** | *(YouTube URL — must be **public**, under 3:00, with audio)* |
| **Auth** | None. Anonymous visitors can use everything demoed. Leave the credentials fields blank. |

**Submit the staging URL, not `paillette.berlayar.ai`.** Production has never had
the indexing migration, the Vectorize metadata index, or a deploy of this work —
it returns 404 on `/api/public-index/jobs`. Staging is the build that works.

---

## 2. Text description — the four required prompts

The rules require the description to answer these four explicitly. Draft prose
lives in `docs/webmcp-submission-description.md`; these are the arguments it must land.

**Why this use case fits WebMCP.** Search over a visual archive is a poor fit for
DOM-driving agents: the useful query surface is semantic (text, image and colour
embeddings), not a form to be filled in. Guessing at the UI gets an agent a
keyword box; a declared tool gets it the actual retrieval engine, with schemas
that say what a query can express.

**How it improves the experience.** The agent and the person operate the same
canvas. The agent reads what the human is looking at (`get_view_context`) and
writes back into the view they are already using (`show_artwork`, `set_results`)
— it is not a chatbot beside the app returning links, and it never has to
screen-scrape.

**What people and agents can now do together that was hard before.** Hand an
agent a zip of images and get back a semantically searchable collection in one
turn. `index_zip` creates a job and returns immediately with a `jobId`; the
agent polls `get_index_status`, and can search partial results before the job
finishes. Previously this needed an account, an upload UI and a pipeline run.

**How WebMCP was implemented.** 25 tools registered on `document.modelContext`
in `apps/web/app/lib/webmcp/tools.ts` via `apps/web/app/lib/webmcp/registry.ts`.
Feature-detected (`'modelContext' in document`), so the page is unchanged in a
browser without WebMCP. Registration is idempotent and route-scoped, tools
unregister on unmount, every `execute` honours `options.signal`, and read-only
tools carry `readOnlyHint: true` while the two mutating index tools require an
on-page confirmation.

**Tools:** `search_artworks`, `search_by_image`, `search_by_color`,
`browse_collection`, `lookup_artwork`, `list_collections`, `get_search_quota`,
`describe_artwork`, `get_view_context`, `show_artwork`, `set_results`,
`create_collection`, `add_to_collection`, `index_zip`, `index_folder`,
`get_index_status`.

**Eligibility note to include:** Paillette predates the submission period, so per
the rules only submission-period work counts. `docs/webmcp-whats-new.md` splits
prior from new work with dated commits — `master` sat exactly on the last
pre-period commit (`e4ae3b43`), so `git log e4ae3b43..master` is the
submission-period work and nothing else, fast-forwarded with no rebase.

---

## 3. Demo video script — target 2:30, hard cap 2:50

Requirements: **public** YouTube, **under 3:00**, **audio** covering what you
built *and* how you used WebMCP, no copyrighted music, no third-party marks. The
app must behave as shown — judges open the live URL.

Record the **ChatGPT desktop in-app browser** (WebMCP on by default). Fallback:
Chrome 149+ with `chrome://flags/#enable-webmcp-testing`. DND on, one window, no
bookmarks bar, nothing with a token on screen.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | `/try` open, demo collections listed | "Paillette is multimodal search over art collections. With WebMCP it's not just an app you click — it's an app your agent operates, alongside you, in the same window." |
| 0:15–0:45 | Pick the bundled demo zip; indexing progress runs | "This zip is public-domain art. The page registers real tools on `document.modelContext` — so the agent calls `index_zip` instead of guessing at my upload form. It returns a job id straight away and reports progress honestly." |
| 0:45–1:15 | Collection becomes searchable; suggested searches appear; click one | "The moment it's searchable, the collection suggests its own queries — grounded in whatever metadata the zip carried." |
| 1:15–1:45 | Ask the agent for a mood/subject; results land in the page grid | "Text, image and colour embeddings, all behind declared tools with real schemas. Read-only by default." |
| 1:45–2:10 | Click an artwork; agent responds to it via `get_view_context`, then moves the view with `show_artwork` | "This is the part that's new. The agent can read what I'm looking at — and change what I'm looking at. One canvas, two operators." |
| 2:10–2:30 | Architecture card: live URL + repo | "Remix on Cloudflare Workers, D1, R2, Vectorize. Feature-detected, so the page is identical in a browser without WebMCP." |

Assemble and check length:
```sh
ffmpeg -i raw.mov -af loudnorm=I=-16:TP=-1.5:LRA=11 \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k demo.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4
```
Upload as **Public** early — HD processing is not instant.

---

## 4. Demo datasets

Bundled under `data/samples/`, all open access, verified public domain per record:

- `sample-art-25-no-metadata.zip` — 25 images, **no CSV**. The metadata-free path.
- `sample-art-100.zip` — 100 images **plus `metadata.csv`** (title, artist, year,
  medium, classification, credit line, accession number, source URL). National
  Gallery of Art, CC0.
- Met and Cleveland sets, generated by `scripts/build-sample-datasets.ts`.

The anonymous cap is 100 images per job, so the 100-image set indexes in full.
It takes several minutes; the 25-image set is the better on-camera choice.

The picker reads `apps/web/public/samples/manifest.json` — adding a dataset means
dropping a zip beside it and appending an entry, with no app change.

---

## 5. Pre-submission checklist

- [ ] Video: under 3:00, **public** on YouTube, audio covers what + how
- [ ] Live URL loads anonymously and `document.modelContext.getTools()` lists the tools
- [ ] `master` carries the work (judges land there), licence still detected
- [ ] No `[VERIFY` markers left in `docs/webmcp-submission-description.md`
- [ ] Devpost description answers all four prompts
- [ ] Registered on Devpost — registration closes at the deadline, not before
