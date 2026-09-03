# Paillette — WebMCP demo video script (v2, NGA)

**Thesis:** *Let AI be your eyes with Paillette.* Target **2:30**, hard cap **2:50**
(rules: under 3:00, public YouTube, audio, no copyrighted music, no third-party
marks). Demo set: **NGA — 100 works, full catalogue metadata** (`nga-100`, CC0).

---

## 0. Pre-flight

- [ ] Redeploy the two local commits (`1f8f11b3`, `d39aafed`) to staging.
- [ ] **Gate 1**: on `https://paillette-stg.berlayar.ai/try`, `await document.modelContext.getTools()` lists 16 tools.
- [ ] ChatGPT desktop app, in-app browser, **voice mode on**. Voice is ChatGPT's own:
  you use its mic (or push-to-talk) to speak a prompt, and ChatGPT's voice reads its
  response — which includes the tool results (suggestions, the artwork description).
  Paillette adds no voice UI; it only exposes the tools.
- [ ] **Pre-run `nga-100` once** to learn its real indexing time (100 images — a few minutes). If too slow on camera, let the searchable partial-results moment carry Beat 3.
- [ ] Verify "stormy seascapes" returns strong hits in the indexed set before recording.
- [ ] Mic gain checked, 10s room tone. Record 4K/1440p60.

---

## 1. Shot list — verbatim

### Beat 1 — Opening · 0:00–0:06
**Say:** "Let AI be your eyes with Paillette."

### Beat 2 — What WebMCP enables · 0:06–0:20
**Say:**
> "With WebMCP, your agent can now see, search, and describe art with you — right on
> the page. Here's how it works."

### Beat 3 — Just talk · 0:20–0:50
**Screen:** ChatGPT in-app browser on `/try`. Human speaks, no typing.
**Narrator:** "All I have to do is talk."
**You (spoken):** "Paillette, index the National Gallery of Art's collection for me."
**Agent (voice back):** "Indexing now — I'll tell you when it's searchable."
**Action:** `create_collection` → `index_zip` → `get_index_status`; the approval prompt appears and is approved.
**Narrator:** "A hundred public-domain works — now searchable."
**Captions:** `create_collection` → `index_zip` → `get_index_status`

### Beat 4 — Discover · 0:50–1:08
**You:** "What's interesting in this collection?"
**Agent (voice):** reads out the suggested searches.
**Narrator:** "It tells me what's worth looking for."
**Captions:** `get_index_status` (suggestions)

### Beat 5 — Show · 1:08–1:30
**You:** "Show me: stormy seascapes."
**Action:** `search_artworks` → `set_results`; the grid fills; agent narrates the first work.
**Narrator:** "It shows me the results — and reads the first one back to me."
**Captions:** `search_artworks` → `set_results` → `describe_artwork` (🔊)

### Beat 6 — Refine · 1:30–1:55
**You:** "Find three more like it, but brighter, and take me to the best one."
**Action:** `search_by_image` → `show_artwork`; the grid re-arranges; agent narrates the assembled set.
**Narrator:** "It finds them by looking — and takes me to the best one."
**Captions:** `search_by_image` → `show_artwork`

### Beat 7 — Echo · 1:55–2:08
**Say:** "Today, Paillette is your eyes on the collection. Next: your ears too —
a curator that talks back, in real time, wherever the art is."
**Captions:** live URL + `github.com/erniesg/paillette`

*(≈180 words ≈ 1:20 at 145 wpm. Well under 3:00 — add pauses, not filler.)*

---

## 2. Voice lines (spoken, not typed)

- **Beat 3:** "Paillette, index the National Gallery of Art's collection for me."
- **Beat 4:** "What's interesting in this collection?"
- **Beat 5:** "Show me: stormy seascapes."
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
- Title: **"Paillette — let AI be your eyes (WebMCP)"**.

The "ears" line lands as *future* framing on purpose: the demo shows the eyes
(`describe_artwork` alt-text, the agent reading the collection to you through
ChatGPT's voice), and closes by pointing at real-time voice as the next step.
Don't claim the page speaks — it doesn't.
