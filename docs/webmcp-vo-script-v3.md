# Paillette — WebMCP demo VO script (v3)

Spoken, not written. Read it out loud; if you wouldn't say it to a person in a
room, cut it. Target **2:05**, cap 2:50. Product on screen by 0:06.

Everything below is verified on staging against the indexed `nga-100`
collection. §4 lists what does *not* work there, so it never reaches camera.

---

## 1. Script

### 0:00–0:12 · Open
**On screen:** wordmark → `/try`

> "This is Paillette. Let AI be your eyes.
> Finding art is a looking problem — so we gave the agent hands on the page."

---

### 0:12–0:38 · Index
**On screen:** drop zone → approval prompt → progress climbing (speed-ramped)
**Chips:** `index_zip` → `get_index_status`

> "I'll ask it to index a collection — a hundred open-access works from the
> National Gallery of Art.
> It asks me before it writes anything. And about ten seconds in, I can already
> search it, while the rest is still loading."

---

### 0:38–0:56 · Discover
**On screen:** suggestions appear; one is clicked
**Chips:** `get_index_status`

> "So what's actually in here? I don't know yet — but it does.
> It reads back this collection's real artists, media and periods, straight from
> the catalogue. It's not guessing, and it's not making them up."

*(All six suggestions verified to return results.)*

---

### 0:56–1:22 · Search
**On screen:** grid refilling per query
**Chips:** `search_artworks` → `set_results`

> "Now I can just say what I want.
> *Stormy seascapes* — and there's de Vlieger, Turner, Boudin.
> Or I get specific: *oil paintings from the 1860s*, and it turns that into a
> real date filter over the records.
> And look where the results land. Not in a chat window — in my grid, my tab,
> my back button. I can grab the wheel any time."

---

### 1:22–1:46 · The new part
**On screen:** the agent's grid with its note, then one work full-bleed
**Chips:** `search_by_image` → `show_artwork` → `describe_artwork`

> "I can hand it a picture instead of a sentence, and it finds more by looking.
> Then it does something a chat window can't. It puts a set on my screen, tells
> me why it picked them, opens the one it wants me to see — and describes what's
> in the painting, for anyone who can't make it out.
> We're both working on the same screen."

---

### 1:46–2:05 · Scale, then close
**On screen:** cut from the 100 works to the full NGA catalogue on `/nga/search`

> "That's a hundred works. Point it at a whole collection and it holds up —
> here's the National Gallery's open catalogue, same tools, same page.
> Sixteen of them, on `document.modelContext`. Three write the page's own state,
> so what the agent finds *is* what I'm looking at.
> Today Paillette is your eyes. Next, your ears."

*(≈280 words ≈ 2:00 at 145 wpm.)*

---

## 2. Voice lines, spoken to the agent

1. "Paillette, index the National Gallery of Art collection for me."
2. "What's interesting in this collection?"
3. "Show me stormy seascapes."
4. "Now show me oil paintings from the 1860s."
5. "Find more like that one, and take me to the best of them."

---

## 3. Verified numbers

| Claim | Measured |
| --- | --- |
| Tools on `document.modelContext` | **16** |
| Searchable after | **~10s** (first image embedded) |
| Full 100-work index | **5–8 min** (~4.6s/image) |
| `describe_artwork` | **4.7s**, `gpt-5.6-luna` |

Don't say "instantly" about indexing, and don't wait for 100/100 on camera —
cut at the searchable moment and speed-ramp the rest.

## 4. Verified on the indexed `nga-100`

| Query | Result |
| --- | --- |
| `stormy seascapes` | 8 hits — de Vlieger, Turner, Boudin, Fitz Henry Lane |
| `oil paintings from the 1860s` | 4 hits, parsed `yearFrom 1860 / yearTo 1869` |
| `etchings on laid paper` | 2 hits, parsed `medium: "etching on laid paper"` |
| `portraits of women` | 8 hits, pure semantic |
| ~~`Rembrandt etchings from the 1640s`~~ | 0 — no Rembrandt in this set. Save it for the `/nga/search` beat at 1:46. |

The 1:46 cut to the full catalogue is what makes the switch read as a scale
reveal rather than a bait-and-switch — and it's where the Rembrandt query,
which parses to `artist + medium + 1640–1649` and returns four real Rembrandts,
actually earns its place.

## 5. One thing I could not verify

`describe_artwork` returns the caption as text — measured, 4.7s. Whether it is
**spoken** depends on ChatGPT reading its own reply aloud in voice mode, which
is ChatGPT's behaviour, not Paillette's. The script says "describes", not
"reads aloud", until that is confirmed live.

## 6. Not in this cut

`search_by_image` takes an id from a previous result, so on camera the move is
"find more like *that* one". A webcam capture — "find the painting that looks
like me" — would be a better beat, but there is no capture UI for it yet.
