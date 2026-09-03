# Paillette — WebMCP demo script (v7)

Every cue is tagged with the judging criterion it answers, so nothing is left to
inference. Runtime ≈ **1:50**. Product on screen at 0:08.

> **The brief:** *"an app that becomes meaningfully better when people and their
> agents can use it together."* Cue 8 and Cue 9 exist to answer exactly that.

---

## 1. Script

### Cue 1 · Intro — 0:00–0:08
**On screen:** wordmark. *Let AI be your eyes.*

> "With WebMCP, your agent can now see, search and describe art with you, right
> on the page. Here's how it works."

---

### Cue 2 · Point it at anything — 0:08–0:20 — *fit for WebMCP*
**Footage:** `/try` drop zone → the sample collections
**Chip:** `index_zip`

> "First, point it at any collection of choice. Upload a zip archive or a
> folder. For our demo, a hundred works from the National Gallery of Art."

### Cue 3 · Why any of this matters — 0:20–0:30
**Footage:** progress climbing, ramped 37×
**Chip:** `get_index_status` · **Caption:** searchable as it loads

> "The world is full of art, but most of it sits where you can't see it, can't
> find it, can't even name it. Paillette brings it within reach."

### Cue 4 · What's in it — 0:30–0:43 — *better UX*
**Footage:** the page's **suggested searches** appear, one is clicked, grid fills
**Chips:** `get_index_status` → `search_artworks` → `set_results`

> "The moment it's indexed, it offers you searches — real artists, real media,
> real periods, taken from the collection's own catalogue. You don't have to
> know what's in there to start."

### Cue 5 · Describe — 0:43–0:51 — *better UX*
**Footage:** `describe_artwork` returning a caption
**Chip:** `describe_artwork` · **Caption:** accessible by design

> "We can even ask it to describe a work. Combined with voice, art becomes
> reachable for people who cannot see it."

---

### Cue 6 · The pivot — 0:51–0:56
**Footage:** cut to `/nga/search`, cached works drifting in

> "The true power of Paillette is unleashed when we run it over an entire
> collection."

### Cue 7 · The full catalogue — 0:56–1:12 — *fit for WebMCP*
**Footage:** mood → exact → colour → visual
**Chips:** `search_artworks` → `search_by_color` → `search_by_image`

> "The National Gallery's open catalogue. Ask for a mood: stormy seascapes. Or
> something exact: Rembrandt etchings from the sixteen-forties, read as artist,
> medium and date. Search by colour. Or hand it a picture instead of words."

---

### Cue 8 · What was impossible before — 1:12–1:30 — *people + agents together*
**Footage:** the agent pins a set with its note, then opens one work
**Chips:** `set_results` → `show_artwork`
**Pull-quote at 1:25:** *An agent that can only talk can't point.*

> "And here's the part that couldn't be done before. Art search isn't one
> answer — it's thirty pictures you compare, and a chat window can't be that.
> So the agent works the page itself. It pins a set on my screen, says why it
> picked them, and opens the one I should see.
> An agent that can only talk can't point."

### Cue 9 · Better together, and how — 1:30–1:50 — *the brief + implementation*
**On screen:** end card

> "Which is the whole point. Neither of us could do this alone — I can't name
> what I'm after, but I can point at it; the agent can't see what caught my eye,
> until it's reading the same page I am.
> That's what sixteen tools on `document.modelContext` buy: it reads my view,
> and it can change it. Same tab, same grid — and I can take the wheel back any
> second.
> Today, Paillette is your eyes on the collection. In the future, your ears too."

---

## 2. Criterion coverage

| Criterion | Where it is answered |
| --- | --- |
| **Why a strong fit for WebMCP** | Cue 2 (any collection, no setup) and Cue 7 — the answer to an art query is *a screenful of images*, not a sentence. A chat surface cannot be the result surface. |
| **How it creates a better UX** | Cue 4 (the page proposes searches so you needn't know the collection) and Cue 5 (a work you can't see gets described). Results land in your own grid, your own URL, your own back button. |
| **What people + agents can do together that was impossible** | Cue 8. "More like *that* one" only means something when both parties are looking at the same screen. Before, an agent had no view of your page and no way to change it. |
| **How WebMCP was implemented** | Cue 9, and §4 below. |

---

## 3. Voice lines, spoken to the agent

1. "Paillette, index the National Gallery of Art collection for me."
2. "What's interesting in this collection?"
3. "Show me stormy seascapes."
4. "Show me Rembrandt etchings from the 1640s."
5. "Find more like that one — pin the best of them and tell me why."

---

## 4. How the implementation actually works

**Registration.** `apps/web/app/lib/webmcp/registry.ts` puts 16 tools on
`document.modelContext`, reference-counted by name and feature-detected, so a
browser without WebMCP renders an identical page.

**Read tools** wrap the same anonymous endpoints the page itself calls — the
agent is not a second API surface.

**Two tools write the page's own state**, and this is the whole mechanism behind
Cue 8:

```
set_results({artworkIds, note})
  → recallArtworks(ids)          // only ids this session has actually seen
  → setAgentResults({...})       // writes lib/webmcp/store.ts
  → useSyncExternalStore         // panel + /try re-render
  → "PINNED BY THE AGENT · 10" plus the agent's note

show_artwork({artworkId, note})
  → setFocusedArtwork({...})     // same store, opens the work full-bleed
```

The store lives outside React precisely because its writers are `execute()`
calls arriving from the host rather than React events.

**Triggering the pin on camera.** Only an agent can — there is no UI button.
Either say *"pin the best five and tell me why"* in ChatGPT's in-app browser, or
open any page with `?webmcp-debug` and call
`window.__paillette_webmcp.call('set_results', { artworkIds: [...], note: '...' })`.
Every recording in this repo was driven the second way, so the footage is
reproducible without a live agent.

**Mutating tools gate on the human.** `index_zip`, `index_folder`,
`create_collection` and `add_to_collection` park on `requestConfirmation` until
someone clicks Approve in the page.

---

## 5. Verified on staging

**Part A — `/try`, the 100-work zip**

| Beat | Measured |
| --- | --- |
| tools registered | **16** |
| goes searchable | ~10s, at 1 of 100 embedded — the cut says "as it loads" |
| fully indexed | 100/100 in ~6 min → ramped 37× |
| suggested searches | 6 offered, **all 6 return results** |
| `search_artworks` | `indexed=true`, 12 hits |
| `set_results` | 30 on the page, `navigatedTo=none` |
| `describe_artwork` | caption in ~4.5s |
| `show_artwork` | opens full-bleed with the note |

**Part B — `/nga/search`, the whole catalogue**

| Beat | Measured |
| --- | --- |
| cached idle showcase | real works from a pre-built bundle, no auth |
| mood | `stormy seascapes` → 24 hits |
| exact | `Rembrandt etchings from the 1640s` → `1640–1649` + `etching` |
| colour | `navy` → 18 hits, palette re-ranked |
| visual | `search_by_image` → 11 hits |
| pin + open | "PINNED BY THE AGENT · 10", note *"more like that Rembrandt, by looking"* |

**Note on the Rembrandt query:** it belongs to the full-catalogue section, where
it returns four real Rembrandts. Don't run it against the 100-work sample — that
set contains none.

---

## 6. Not claimed, because it cannot be filmed

- **"It reads descriptions back aloud."** `describe_artwork` returns text;
  speech is the agent host reading its own reply. Cue 5 says *"combined with
  voice… in the future"* — a promise, not a demo.
- **ChatGPT voice-in.** Needs the desktop app and a live mic.
- **Webcam image search.** No capture UI exists.
- **Colour extraction / vision captions at index time.** Neither runs on the
  anonymous path.
- **"Five signals fused by RRF."** Three weighted channels are fused; colour is
  a separate route plus a client-side re-rank.
