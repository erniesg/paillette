# Paillette — WebMCP demo script (v8)

Your outline, blanks filled. The one you marked `Xxx` is the composition beat —
variant B — and it is the answer to *what can people and agents do together that
was hard before*.

Runtime ≈ **1:45**. Product on screen at 0:08.

---

## 1. Script

### Cue 1 · Intro — 0:00–0:08
**On screen:** wordmark. *Let AI be your eyes.*

> "With WebMCP, your agent can now see, search and describe art with you, right
> on the page. Here's how it works."

### Cue 2 · Point it at anything — 0:08–0:20
**Footage:** `/try` drop zone → sample collections → approval → indexing starts
**Chip:** `index_zip`

> "First, point it at any collection of choice. Upload a zip archive or a folder
> to get started. For our demo, let's use 100 works from the National Gallery of
> Art."

### Cue 3 · The unlock — 0:20–0:29
**Footage:** progress climbing, ramped
**Chip:** `get_index_status` · **Caption:** searchable as it loads

> "The unlock is that agents can now make the world's art discoverable — the
> vast majority of it has no usable metadata, and nothing you could search even
> if you were standing in front of it."

### Cue 4 · Explore — 0:29–0:40
**Footage:** the page's suggested searches appear, one is clicked, grid fills
**Chips:** `get_index_status` → `search_artworks` → `set_results`

> "Once indexing is completed, we can start to explore this collection with some
> suggestions — drawn from what is actually in it, so you don't have to know the
> collection to begin."

### Cue 5 · Describe — 0:40–0:48
**Footage:** `describe_artwork` returning a caption
**Chip:** `describe_artwork` · **Caption:** accessible by design

> "We can even ask it to describe a work. Combined with voice, art becomes
> reachable for people who cannot see it."

---

### Cue 6 · The pivot — 0:48–0:53
**Footage:** cut to `/nga/search`, cached works drifting in

> "The true power of Paillette is unleashed when we run it over an entire
> collection."

### Cue 7 · At full scale — 0:53–1:10
**Footage:** mood search → the exact query, filter chips landing
**Chips:** `search_artworks`

> "Let's take a look at the National Gallery of Art again — this time its entire
> open-access archive, sixty-three thousand works. Ask for a mood: stormy
> seascapes. Or something exact: Rembrandt etchings from the sixteen-forties,
> and it reads that as artist, medium and date."

---

### Cue 8 · The composition beat — 1:10–1:30  *(this was your `Xxx`)*
**Footage:** colour re-rank → `search_by_image` from a result → pinned set + note
**Chips:** `search_by_color` → `search_by_image` → `set_results`

> "Here's what changes with an agent in the page.
> Text, image and colour are three separate tabs here — on my own I use them one
> at a time, and image search wants a file, so *more like that one* means saving
> a picture and uploading it back.
> The agent runs it as a single move. Start with the text search, re-rank it by
> colour, then take one of those results and search by the work itself. Three
> modes, one instruction, straight onto my grid — and it keeps the ten that
> answer the question, with a line saying why."

### Cue 9 · Close — 1:30–1:45
**On screen:** end card

> "Today, Paillette is your eyes on the collection. In the future, your ears
> too."

---

## 2. The chained instruction Cue 8 is built around

Spoken to the agent, one sentence:

> "Show me stormy seascapes, push it toward navy, then find more like the best
> one and pin your favourites with a note."

Which the agent executes as:

```
search_artworks({query:'stormy seascapes'})      → text
search_by_color({color:'navy', query:'...'})     → semantic pass + CIEDE2000 re-rank
search_by_image({artworkId:'<from above>'})      → visual, from an id, no upload
set_results({artworkIds:[...], note:'...'})      → pinned on the human's grid
```

The UI cannot express that sequence: the three modes are exclusive tabs, and its
image search takes an uploaded `File` (`visibleImagePreview?.file`), so a result
already on screen is not a valid query without a round trip through the
filesystem.

---

## 3. Verified numbers

| Claim | Measured |
| --- | --- |
| tools on `document.modelContext` | **16** |
| NGA open-access corpus | **63,253 works** |
| demo zip | 100 works, CC0 |
| goes searchable | ~10s at 1/100 embedded — say "as it loads" |
| fully indexed | 100/100 in ~6 min → ramp it |
| suggested searches | 6, all 6 return results |
| `stormy seascapes` | 24 hits |
| `Rembrandt etchings from the 1640s` | parses to `1640–1649` + `etching` |
| `search_by_color` navy | 18 hits |
| `search_by_image` | 11 hits |
| `describe_artwork` | ~4.5s |

## 4. Not claimed, because it cannot be filmed

- **Speech.** `describe_artwork` returns text; Cue 5 says "combined with voice…
  in the future", which is a promise, not a demo.
- **ChatGPT voice-in.** Needs the desktop app and a live mic.
- **Webcam image search.** No capture UI.
- **Colour/vision enrichment at index time.** Not on the anonymous path.
