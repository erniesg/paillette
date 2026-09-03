# Paillette — WebMCP demo script (v5)

Your v2 skeleton, your two opening lines, the Devpost narrative — with every
unverifiable claim removed and every number checked against staging.

**Shape:** small index proves *any* collection → pivot → the full catalogue
shows what it's for → why human + agent on one surface is the point → close.

**Runtime ≈ 1:34** of narration across eight cues. Product on screen at 0:10.

---

## 1. Script

### Cue 1 · Hook — 0:00–0:09
**On screen:** wordmark, *Let AI be your eyes*

> "Some of the most beautiful art on earth is invisible. Locked in storage,
> uncatalogued, unreachable. Paillette makes it searchable by how it looks."

### Cue 2 · What this is — 0:09–0:18
**On screen:** `/try` — the drop zone and the four sample collections

> "And with WebMCP, your agent can now see, search and describe it with you,
> right on the page. Here's how it works."

---

### Cue 3 · Index anything — 0:18–0:28
**Footage:** progress climbing, speed-ramped ~56×
**Chips:** `index_zip` → `get_index_status`

> "First, any collection. Drop in a zip. Here, a hundred works from the National
> Gallery of Art. It goes searchable while it's still loading the rest."

### Cue 4 · What's in it — 0:28–0:38
**Footage:** suggestions appear, one runs, grid fills
**Chips:** `get_index_status` → `search_artworks` → `set_results`

> "And it shows me what's actually in there. Real artists, real media, real
> periods, straight out of the catalogue. No cataloguing team required."

---

### Cue 5 · Pivot — 0:38–0:42
**Footage:** cut to `/nga/search`, cached works drifting in

> "That's a hundred works. Now point it at an entire collection."

---

### Cue 6 · The full catalogue — 0:42–0:59
**Footage:** mood → exact → colour → visual
**Chips:** `search_artworks` → `search_by_color` → `search_by_image`

> "The National Gallery's open catalogue. Ask for a mood: stormy seascapes. Or
> something exact: Rembrandt etchings from the sixteen-forties, read as artist,
> medium and date. Search by colour. Or hand it a picture instead of words, and
> it finds more by looking."

---

### Cue 7 · Why this needs WebMCP — 0:59–1:20
**Footage:** the agent's pinned grid with its note, then one work opening
**Chips:** `set_results` → `show_artwork` → `describe_artwork`

> "And here's why that matters. Art search isn't one answer — it's thirty
> pictures you compare. A chat window can't be that.
> So the agent works my screen instead. It pins a set, tells me why it picked
> them, and opens the one it wants me to see.
> An agent that can only talk can't point. This one can say *this one*, and mean
> it."

### Cue 8 · How, and close — 1:20–1:34
**On screen:** end card

> "Sixteen tools on the model context. Two of them write the page's own state,
> so what the agent finds is what I'm looking at.
> Today, Paillette is your eyes on the collection. In future, your ears too."

---

## 2. Voice lines, spoken to the agent

1. "Paillette, index the National Gallery of Art collection for me."
2. "What's interesting in this collection?"
3. "Show me stormy seascapes."
4. "Show me Rembrandt etchings from the 1640s."
5. "Find more like that one, and take me to the best of them."

---

## 3. What each half is showing, and why both

**Part A — `/try`, the 100-work zip.** The point is *any* collection: drop a zip
and it becomes searchable, with no catalogue. This is the claim that Paillette
isn't hard-wired to one museum. Kept short — one index, one look at what's
inside, one search.

**Part B — `/nga/search`, the whole catalogue.** The point is *what it's for*:
all four search modalities on a real corpus, where "Rembrandt etchings from the
1640s" returns actual Rembrandts and colour search has real palettes to sort by.
This is where the product looks like a product.

The pivot line is what stops these reading as two different apps.

---

## 4. Verified — Part A (`/try`)

| Beat | Measured |
| --- | --- |
| tools registered | **16** |
| approval gate | prompt shown, approved, `index_zip` returns |
| goes searchable | ~11s — **but only 1 of 100 embedded**, so the script says "while it's still loading", never "searchable in 11 seconds" |
| fully indexed | 100/100 in ~5.5 min → speed-ramp |
| suggestions | 6, and **all 6 return results** |
| `search_artworks` | `indexed=true`, 12 hits |
| `set_results` | 30 on the page, `navigatedTo=none` |
| `describe_artwork` | caption in ~4.5s |
| `search_by_image` | `indexed=true`, 5 hits |
| `show_artwork` | full-bleed overlay carrying the agent's note |

## 5. Verified — Part B (`/nga/search`)

| Beat | Measured |
| --- | --- |
| cached idle showcase | renders real works from a pre-built bundle, no auth |
| mood | `stormy seascapes` → 24 hits |
| exact | `Rembrandt etchings from the 1640s` → parsed to `dateRange 1640–1649` + `mediumFamilies:[etching]`, real Rembrandts |
| colour | `navy` → 18 hits, palette re-ranked |
| visual | `search_by_image` → 11 hits |
| pin + open | "PINNED BY THE AGENT · 10", note *"more like that Rembrandt, by looking"*, `show_artwork` opens one, `describe_artwork` returns a caption |

## 6. Cut — cannot be recorded, so not claimed

- **"reads it aloud."** `describe_artwork` returns text. Speech would be the
  agent host reading its own reply — not something the page can be filmed doing.
  The Devpost line "it reads descriptions back aloud" is not in this script.
- **ChatGPT voice-in.** Needs the desktop app and a live mic.
- **Webcam image search.** No capture UI exists.
- **"Extracts colours and generates visual descriptions on index."** Neither
  happens at anonymous index time — colour extraction runs on the authenticated
  org path, and vision captions are on demand via `describe_artwork`.
- **"Five signals fused via RRF."** The fusion is three weighted channels;
  colour is a separate route plus a client-side re-rank.
- **`Rembrandt etchings from the 1640s` on the 100-work set** — zero hits, no
  Rembrandt in it. It appears only in Part B.
