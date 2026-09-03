# Paillette — WebMCP demo video script (v2, NGA)

**Thesis:** *Let AI be your eyes and ears.* You talk; the agent drives the page; the
page reads the art back to you. Target **2:30**, hard cap **2:50** (rules: under 3:00,
public YouTube, audio, no copyrighted music, no third-party marks).

Demo collection: **NGA — 100 works, full catalogue metadata** (`nga-100`,
National Gallery of Art, Washington, CC0). Three acts: **Index → Search → Interact.**

---

## 0. Pre-flight

- [ ] Staging is current — api `48f7f0a8`, web `b991cf2c` (16 tools, LLM query
      interpretation, `describe_artwork` on `gpt-5.6-luna`). Verify `/try`
      loads and `await document.modelContext.getTools()` lists 16 tools.
- [ ] **Gate 1**: on `https://paillette-stg.berlayar.ai/try`, in ChatGPT's
      in-app browser, the tools list and `index_zip` both fire.
- [ ] ChatGPT desktop app, in-app browser, **voice on** — the agent speaks
      through ChatGPT's own voice; the page has no speech of its own. When
      the agent calls `describe_artwork`, its spoken answer *is* the
      "narrates the first one" beat.
- [ ] **Pre-run `nga-100` once** to learn its real indexing time (100 images — expect a few minutes). On camera, if it's too slow, let the searchable partial-results moment carry the beat instead of waiting for full completion.
- [ ] Mic gain checked, 10s room tone. Record 4K/1440p60.

---

## 1. Shot list — verbatim

### Beat 1 — Hook · 0:00–0:10
**Screen:** `/try` picker (four collections listed).
**Say:** "Let AI be your eyes and ears with Paillette."

### Beat 2 — Problem · 0:10–0:26
**Say:**
> "Here's the problem: galleries sit on centuries of art with almost no metadata.
> Paillette makes it searchable by what the work looks like — image, text, colour,
> even vibes. Here's how it works."

### Beat 3 — Index · 0:26–0:58
**Screen:** ChatGPT in-app browser on `/try`. Human speaks, no typing.
**You (spoken):** "Paillette, index the National Gallery of Art's open collection for me."
**Agent (voice back):** "Indexing now — I'll tell you when it's searchable."
**Action:** show `create_collection` → `index_zip` → `get_index_status`; the on-page approval prompt appears and is approved.
**Say:**
> "All I do is talk. It takes a hundred public-domain works and builds a searchable
> collection — loading their full catalogue records, artist, medium, classification —
> and it asks before it writes anything."
**Captions:** `create_collection` → `index_zip` → `get_index_status`

### Beat 4 — Discover · 0:58–1:18
**You:** "What's interesting in this collection?"
**Agent (voice):** reads out the suggested searches.
**Action:** suggestion chips appear — real artists, media, and classifications.
**Say:**
> "It reads back what I could search for — grounded in the museum's own records,
> not guessed."
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

### Beat 8 — Close · 2:22–2:35
**Say:**
> "That's one open collection. Next, we take the whole National Gallery of Art to
> production — and add real-time voice. Let AI be your eyes and ears."
**Captions:** live URL + `github.com/erniesg/paillette`

*(≈315 words ≈ 2:15 at 145 wpm. Leaves headroom under 3:00.)*

---

## 2. Voice lines (spoken, not typed)

- **Beat 3:** "Paillette, index the National Gallery of Art's open collection for me."
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
