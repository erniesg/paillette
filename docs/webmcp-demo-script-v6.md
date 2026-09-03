# Paillette — WebMCP demo script (v6)

Your v2 skeleton with the blanks filled, every claim checked against staging,
and anything unrecordable cut. This is the script the rendered cut actually
speaks — nine cues, **1:45**.

Video: `paillette-demo-v6.mp4` · 1920×1080 · narration on a scratch TTS voice
for timing (replace with your own read; the cut is built to these durations).

---

## 1. Script

### Cue 1 · Intro — 0:00–0:08
**On screen:** wordmark. *Let AI be your eyes.*

> "With WebMCP, your agent can now see, search and describe art with you, right
> on the page. Here's how it works."

---

### Cue 2 · Point it at anything — 0:08–0:20
**Footage:** `/try` — the drop zone, then the sample collections
**Chip:** `index_zip` · **Caption:** zip or folder · 100 works, NGA

> "First, point it at any collection of choice. Upload a zip archive or a folder
> to get started. For our demo, let's use this dataset of a hundred works from
> the National Gallery of Art."

### Cue 3 · Why it matters — 0:20–0:30
**Footage:** progress climbing, speed-ramped 37×
**Chip:** `get_index_status` · **Caption:** searchable as it loads

> "The world is full of art, but most of it sits where you can't see it, can't
> find it, can't even name it. Paillette brings it within reach."

### Cue 4 · Explore — 0:30–0:43
**Footage:** suggestions appear, one runs, the grid fills
**Chips:** `search_artworks` → `set_results` · **Caption:** no cataloguing team required

> "Once indexing is complete, we can explore what the collection actually holds.
> Its real artists, media and periods, read straight from the catalogue. And
> then search it in plain language."

### Cue 5 · Describe — 0:43–0:51
**Footage:** `describe_artwork` returning a caption
**Chip:** `describe_artwork` · **Caption:** accessible by design

> "We can even ask it to describe a work. Combined with voice, art becomes
> reachable for people who cannot see it."

*Note the tense. The caption is text today; speech is the agent host's job. This
line promises a future, which is honest — see §4.*

---

### Cue 6 · The pivot — 0:51–0:56
**Footage:** cut to `/nga/search`, cached works drifting in
**Card:** *The true power is an entire collection*

> "The true power of Paillette is unleashed when we run it over an entire
> collection."

### Cue 7 · The full catalogue — 0:56–1:12
**Footage:** mood → exact → colour → visual
**Chips:** `search_artworks` → `search_by_color` → `search_by_image`
**Caption:** mood · exact · colour · by looking

> "The National Gallery's open catalogue. Ask for a mood: stormy seascapes. Or
> something exact: Rembrandt etchings from the sixteen-forties, read as artist,
> medium and date. Search by colour. Or hand it a picture instead of words."

---

### Cue 8 · Why this needs WebMCP — 1:12–1:30
**Footage:** the agent pinning a set with its note, then opening one work
**Chips:** `set_results` → `show_artwork`
**Pull-quote lands at 1:25:** *An agent that can only talk can't point.*

> "And this is why it needs WebMCP. Art search isn't one answer. It's thirty
> pictures you compare, and a chat window can't be that. So the agent works the
> page itself. It pins a set, says why it picked them, and opens the one you
> should see. An agent that can only talk can't point."

### Cue 9 · Close — 1:30–1:45
**On screen:** end card

> "Sixteen tools on the model context. Two of them write the page's own state,
> so what the agent finds is what you are looking at. Today, Paillette is your
> eyes on the collection. In the future, your ears too."

---

## 2. Voice lines, spoken to the agent

1. "Paillette, index the National Gallery of Art collection for me."
2. "What's interesting in this collection?"
3. "Show me stormy seascapes."
4. "Show me Rembrandt etchings from the 1640s."
5. "Find more like that one, and take me to the best of them."

---

## 3. Verified on staging

**Part A — `/try`, the 100-work zip** (`demo-v5/beats.json`)

| Beat | Measured |
| --- | --- |
| tools registered | **16** |
| goes searchable | ~10s — **1 of 100 embedded**, so the cut says "as it loads", never "searchable in 10 seconds" |
| fully indexed | 100/100 in ~6 min → ramped 37× on screen |
| suggestions | 6, **all 6 return results** |
| `search_artworks` | `indexed=true`, 12 hits |
| `set_results` | 30 on the page, `navigatedTo=none` |
| `describe_artwork` | caption in ~4.5s |
| `search_by_image` | `indexed=true`, 5 hits |
| `show_artwork` | opens full-bleed with the agent's note |

**Part B — `/nga/search`, the whole catalogue** (`showcase-v5/beats.json`)

| Beat | Measured |
| --- | --- |
| cached idle showcase | real works from a pre-built bundle, no auth |
| mood | `stormy seascapes` → 24 hits |
| exact | `Rembrandt etchings from the 1640s` → `dateRange 1640–1649` + `mediumFamilies:[etching]` |
| colour | `navy` → 18 hits, palette re-ranked |
| visual | `search_by_image` → 11 hits |
| pin + open | "PINNED BY THE AGENT · 10", note *"more like that Rembrandt, by looking"* |

---

## 4. Cut, because it cannot be recorded

- **"It reads descriptions back aloud."** `describe_artwork` returns text.
  Speech is the agent host reading its own reply — not something the page can be
  filmed doing. Cue 5 therefore says *"combined with voice… in the future"*,
  which is a promise, not a demo.
- **ChatGPT voice-in.** Needs the desktop app and a live mic.
- **Webcam image search** ("find the painting that looks like me"). No capture
  UI exists.
- **"Extracts colours and generates visual descriptions on index."** Neither
  runs at anonymous index time — colour extraction is on the authenticated org
  path, vision captions are on demand.
- **"Five signals fused via RRF."** Three weighted channels are fused; colour is
  a separate route plus a client-side re-rank.
- **`Rembrandt etchings from the 1640s` on the 100-work set** — zero hits. It
  appears only in Cue 7, against the full catalogue, where it works.

## 5. Rebuilding the cut

```sh
cd video
say -v Daniel -r 168 -o vo/NN.aiff -f vo/NN.txt   # narration, one file per cue
npx hyperframes lint && npx hyperframes render -o paillette-demo-v6.mp4 -q high
```

Scene timings live in `index.html`; each `<audio>` cue's `data-start` is what
the visuals are cut against. Replace a `vo/*.wav` with a real read of the same
line and adjust that one `data-start`/`data-duration` pair.
