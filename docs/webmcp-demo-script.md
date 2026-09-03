# Paillette — WebMCP demo video script

Target **2:30**, hard cap **2:50** (rules: under 3:00, **public** YouTube, audio
narration covering *what you built* and *how you used WebMCP*, no copyrighted
music, no third-party marks in title/thumbnail. The app must behave exactly as
shown — judges open the live URL).

---

## 0. Pre-flight (do once, before recording)

- [ ] **Push + redeploy the two local commits** (`1f8f11b3` rate limit, `d39aafed`
      honest job limit) to staging — the /try page copy must match what you say.
- [ ] Rehearse **Gate 1** in ChatGPT desktop in-app browser on
      `https://paillette-stg.berlayar.ai/try`: agent lists tools, `index_zip`
      fires, results land. If Gate 1 fails, fix before recording anything.
- [ ] ChatGPT desktop app, in-app browser on `/try`. DND on, one window, hide
      bookmarks bar, no token/account email visible, 1440p+ display.
- [ ] Pre-run the cleveland-30 indexing once so you know its real timing on
      camera; have the 25-no-metadata zip downloaded locally as a fallback prop.
- [ ] Screen recorder: 4K or 1440p60, mic gain checked, 10s of room tone.
- [ ] Have these prompts ready to paste (below, §3).

---

## 1. Shot list — verbatim

### Beat 1 — Hook · 0:00–0:12
**Screen:** `/try` page, demo-collection picker visible.
**Action:** Slow scroll over the picker (4 datasets listed).
**Say:**
> "Paillette turns a zip of images into a semantically searchable art
> collection — text, image and colour. And because it speaks WebMCP, it's not
> just an app you click. It's an app your agent operates with you, in the same
> window."

### Beat 2 — Index a zip through the agent · 0:12–0:45
**Screen:** ChatGPT in-app browser on `/try`.
**Action:** Paste prompt P1 (§3). Show `create_collection` and `index_zip`
firing; show the job id returned immediately; let progress poll once.
**Say:**
> "I'll hand the agent a bundle of public-domain works from the Cleveland
> Museum of Art. Instead of scraping my upload form, it calls the real tools
> this page registers on `document.modelContext`: `create_collection`, then
> `index_zip`. That returns a job id straight away, and `get_index_status`
> reports progress honestly — no pretending."

### Beat 3 — Searchable, with its own suggested queries · 0:45–1:05
**Screen:** The indexed collection; suggested-search chips appear.
**Action:** Click one suggested chip (pick one grounded in the CSV metadata —
an artist or medium, not a filename).
**Say:**
> "The moment it's searchable, the collection suggests its own queries —
> grounded in the catalogue metadata the zip carried. These suggestions come
> from real records: artists, media, classifications."

### Beat 4 — Semantic search + metadata query parsing · 1:05–1:35
**Screen:** Collection search.
**Action:** Run search S1 (semantic), then S2 (metadata-driven) — prompts P2/P3.
Results land in the page grid via `set_results`.
**Say:**
> "Search runs over text, image and colour embeddings. And queries parse
> against the metadata — I can ask for a specific artist, or a medium, or a
> century, and the agent resolves it through the declared schema rather than
> guessing at a search box."

### Beat 5 — The shared canvas · 1:35–2:00
**Screen:** One artwork open in the viewer.
**Action:** With an artwork on screen, paste prompt P4. Agent answers using
`get_view_context`, then navigates the view itself with `show_artwork`.
**Say:**
> "This is the part that's genuinely new. The agent reads what I'm looking at
> — the exact artwork, from the page — and then changes what I'm looking at.
> One canvas, two operators. No screen-scraping, no copy-pasting URLs."

### Beat 6 — Your own zip, with or without metadata · 2:00–2:20
**Screen:** Back on `/try` picker; highlight the no-metadata set.
**Action:** Point at "25 works, no metadata".
**Say:**
> "Anyone can try this: pick a bundled set from four museums, or upload your
> own zip. Metadata optional — with a CSV you get catalogue-grade search;
> without one, we still index every image and title from filenames."

### Beat 7 — Close · 2:20–2:35
**Screen:** Architecture card / homepage with URL.
**Action:** Show live URL + repo (docs already in repo).
**Say:**
> "Paillette is Remix on Cloudflare Workers, D1, R2 and Vectorize — fully
> open source, MIT. Fifteen tools registered on `document.modelContext`,
> feature-detected, so the page is identical in a browser without WebMCP.
> Try it live, and bring your own zip."

*(≈355 words ≈ 2:30 at 145 wpm. If over, cut the second search in Beat 4 or
trim Beat 6 to one sentence.)*

---

## 2. Captions to burn in (tool names must be visible)

Lower-third on each tool call, so judges see the WebMCP surface even with
sound off:

- Beat 2: `create_collection` → `index_zip` → `get_index_status`
- Beat 4: `search_artworks` · `set_results`
- Beat 5: `get_view_context` · `show_artwork`

## 3. Prompts to paste (rehearse each once first)

- **P1 (Beat 2):** "Open the Paillette page. Create a new collection called
  'Cleveland Highlights', then index the demo zip this page offers from the
  Cleveland Museum of Art into it. Tell me the job id and keep me posted."
- **P2 (Beat 4, semantic):** "Find stormy seascapes in this collection."
- **P3 (Beat 4, metadata):** "Show me only bronzes." *(or whatever the
  cleveland CSV actually supports — verify before recording)*
- **P4 (Beat 5):** "What am I looking at right now? Find three more works like
  it, but brighter, and take me to the best one."

## 4. Assembly + upload

```sh
ffmpeg -i raw.mov -af loudnorm=I=-16:TP=-1.5:LRA=11 \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k demo.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4   # must be < 180s
```

- No music (safest), or CC0 only. No logos in title/thumbnail.
- Upload **Public** (not unlisted) early — HD processing is not instant.
- Title: "Paillette — agent-operated art collections with WebMCP".
- Then submit on Devpost: staging URL, repo, description from
  `docs/webmcp-submission-description.md` (zero `[VERIFY` markers left).
