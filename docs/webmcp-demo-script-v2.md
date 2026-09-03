# Paillette — WebMCP demo video script (v2)

**Thesis:** *Let AI be your eyes and ears.* You talk; the agent drives the page; the
page reads the art back to you. Target **2:30**, hard cap **2:50** (rules: under 3:00,
public YouTube, audio, no copyrighted music, no third-party marks).

Three acts: **Index → Search → Interact.**

---

## 0. Pre-flight

- [ ] Redeploy the two local commits (`1f8f11b3`, `d39aafed`) to staging.
- [ ] **Gate 1**: on `https://paillette-stg.berlayar.ai/try`, `await document.modelContext.getTools()` lists 16 tools.
- [ ] ChatGPT desktop app, in-app browser, **voice on** (ChatGPT's mic = the "ears"; no code).
- [ ] Confirm the page speaks captions aloud (`speechSynthesis`) — the "eyes" beat.
- [ ] Pre-run the cleveland sample indexing once to learn its real timing; 25-no-metadata zip as fallback.
- [ ] Mic gain checked, 10s room tone. Record 4K/1440p60.

---

## 1. Shot list — verbatim

### Beat 1 — Hook · 0:00–0:10
**Screen:** `/try` picker.
**Say:** "Let AI be your eyes and ears with Paillette."

### Beat 2 — Problem · 0:10–0:26
**Say:**
> "Here's the problem: galleries sit on centuries of art with almost no metadata.
> Paillette makes it searchable by what the work looks like — image, text, colour,
> even vibes. Here's how it works."

### Beat 3 — Index · 0:26–0:58
**Screen:** ChatGPT in-app browser on `/try`. Human speaks, no typing.
**You (spoken):** "Paillette, index the Cleveland collection for me."
**Agent (voice back):** "Indexing now — I'll tell you when it's searchable."
**Action:** show `create_collection` → `index_zip` → `get_index_status`; the on-page approval prompt appears and is approved.
**Say:** "All I do is talk. It builds a searchable collection from a zip — and it asks before it writes anything."
**Captions:** `create_collection` → `index_zip` → `get_index_status`

### Beat 4 — Discover · 0:58–1:18
**You:** "What's interesting in this collection?"
**Agent (voice):** reads out the suggested searches.
**Action:** suggestion chips appear (grounded in the collection's own metadata).
**Say:** "It reads back what I could search for — grounded in the records this collection actually came with."
**Captions:** `get_index_status` (suggestions)

### Beat 5 — Show · 1:18–1:42
**You:** "Show me stormy seascapes."
**Action:** `search_artworks` → `set_results`; the page grid fills.
**Agent (voice):** narrates the first work out loud.
**Say:** "It shows me the results — and narrates the first one, out loud."
**Captions:** `search_artworks` → `set_results` → `describe_artwork` (🔊)

### Beat 6 — Refine · 1:42–2:08
**You:** "Find three more like it, but brighter, and take me to the best one."
**Action:** `search_by_image` → `show_artwork`; the grid re-arranges, one work opens.
**Say:** "It builds a new grid by *looking* — and takes me straight to the best one."
**Captions:** `get_view_context` → `search_by_image` → `show_artwork`

### Beat 7 — How · 2:08–2:22
**Say:**
> "Through WebMCP, Paillette turns the page itself into something your agent can
> drive — same tab, same grid, no screen-scraping. It isn't guessing at buttons;
> it's calling the real tools."

### Beat 8 — Close · 2:22–2:32
**Say:** "Next: production for a complete museum collection. Let AI be your eyes and ears."
**Captions:** live URL + `github.com/erniesg/paillette`

*(≈300 words ≈ 2:10 at 145 wpm. Leaves headroom under 3:00.)*

---

## 2. Voice lines (spoken, not typed)

- **Beat 3:** "Paillette, index the Cleveland collection for me."
- **Beat 4:** "What's interesting in this collection?"
- **Beat 5:** "Show me stormy seascapes."
- **Beat 6:** "Find three more like it, but brighter, and take me to the best one."

---

## 3. Assembly + upload

```sh
ffmpeg -i raw.mov -af loudnorm=I=-16:TP=-1.5:LRA=11 \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k demo.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4   # must be < 180s
```

- No music (or CC0 only). No logos in title/thumbnail.
- Upload **Public** early — HD processing is not instant.
- Title: **"Paillette — let AI be your eyes and ears (WebMCP)"**.
