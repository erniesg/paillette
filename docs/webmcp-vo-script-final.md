# Paillette — WebMCP demo voiceover (final)

For ElevenLabs. §1 is the script to paste — one block per cue, nothing but words
to be spoken. §2 onward is production detail.

Runtime ≈ **2:05** at ~150 wpm.

> Written against your latest structure, including *eyes **and ears***. This file
> is owned by the coordinator; `docs/webmcp-vo-script.md` belongs to the docs
> agent. Delete whichever one loses.

---

## 1. Voiceover — paste this

**Intro** · *on screen: Let AI be your eyes and ears with Paillette*

> With WebMCP, your agent can now see, search and describe art with you — right
> on the page. Here's how it works.

**Cue 2 · Point it at anything**

> First, point it at any collection of choice. Upload a zip archive or a folder
> to get started. For our demo, let's use a hundred works from the National
> Gallery of Art.

**Cue 3 · The unlock**

> Paillette unlocks a new experience with art: it makes works discoverable even
> when there's little metadata, or none at all. It indexes the pictures
> themselves — so a painting nobody ever wrote about is still findable.

**Cue 4 · Explore**

> Once indexing is completed, we can start to explore this collection with some
> suggestions — drawn from what's actually in it, so you don't need to know the
> collection to begin.

**Cue 5 · A live example**

> For example: estuary at dusk. And there it is — Fitz Henry Lane's lumber
> schooners at evening, and a Dutch estuary at day's end. Neither of which I
> could have named.

**Cue 6 · Describe, and hear it**

> We can even ask it to describe a work, and have that read out loud. Art then
> becomes reachable for people who cannot see it.
> *[hold on the spoken description, then fade]*

**Cue 7 · Scale**

> The true power of Paillette is unleashed when we run it over an entire
> collection.

**Cue 8 · The full archive**

> Let's take a look at the National Gallery of Art again — this time at its
> entire open-access collection of sixty-three thousand works. Ask for a mood:
> stormy seascapes. Or something like: Rembrandt etchings from the
> sixteen-forties.

**Cue 9 · Make it agentic**

> But we can make it even more agentic. I'll just say what I want — something to
> hang above the sofa in my living room. Warm, not busy, nothing grim.
> It doesn't just run one search. It works out the different things that could
> mean, runs all of them, and puts the best of each on one board — laid out so I
> can see how they relate.

**Cue 10 · Co-creator**

> So now the agent becomes a co-creator. Work that nobody could find is not just
> discoverable now, it's usable — which means you can walk in with nothing but a
> feeling and leave with a shortlist. Assembled from searches you'd never have
> thought to run. Arranged so you can see how they relate. And read out to you,
> if you can't see them at all.

**Ending** · *on screen: Let AI be your eyes and ears with Paillette*

> Today, Paillette is your eyes on the collection — and it can already read it
> back to you. Next, we make the whole thing a conversation.

---

## 2. The gaps you left, and what went in them

**"For example: [live example]"** → Cue 5. The suggestion the page generates for
the indexed hundred is *Estuary at dusk*; running it returns Fitz Henry Lane's
*Lumber Schooners at Evening on Penobscot Bay* and *Estuary at Day's End*. Both
verified on staging. The line earns the suggestions beat: you just searched
something you could not have named.

**The co-creator bracket** → Cue 10. Three concrete things a person can do now
that they could not before, in the order the film has just shown them — searches
they would not have thought to run, an arrangement rather than a list, and a
description read aloud.

**The ending `xxxx`.** Your on-screen text now says *eyes and ears*, and the ears
half is true **today**: the page reads a generated description aloud through the
browser, with no agent involved. So "in the future, your ears too" is now out of
date and would undersell what shipped. The new ending claims the ears we have
and promises the one we don't — a continuous spoken conversation.

---

## 3. What is on screen per cue

| Cue | Footage | Tool chips |
| --- | --- | --- |
| 1 | wordmark card | — |
| 2 | `/try` drop zone, `index_zip`, approval prompt clicked | `index_zip` |
| 3 | progress climbing, speed-ramped ~17× to 100% | `get_index_status` |
| 4 | suggestion chips appear, "grounded in this collection's catalogue metadata" | `get_index_status` |
| 5 | *Estuary at dusk* runs, the grid fills | `search_artworks` → `set_results` |
| 6 | a work opens, description shown, **Read aloud** pressed | `describe_artwork` |
| 7 | cut to `/nga/search`, cached works drifting in | — |
| 8 | mood search, then the Rembrandt query with its filter chips | `search_artworks` |
| 9 | one spoken goal → several searches → one merged board | `search_artworks` ×n → `search_by_color` → `set_results` |
| 10 | the board takes the whole canvas, the agent's note across it | `set_view` |

---

## 4. Verified, so the script can say it

| Claim | Evidence |
| --- | --- |
| "a hundred works from the National Gallery of Art" | `sample-art-100.zip`, CC0, ships a `metadata.csv` |
| "indexes the pictures themselves" | every image embedded with `jina-clip-v2`; the 25-work sample has no CSV and is still searchable |
| "suggestions drawn from what's actually in it" | six generated from the collection's own titles — *Fallen tree*, *Estuary at dusk*, *Female figure in motion*, *Armed roman goddess* — **all six return results** |
| "Fitz Henry Lane's lumber schooners" | `estuary at dusk` → *Lumber Schooners at Evening on Penobscot Bay*, *Estuary at Day's End* |
| "read out loud" | `describe_artwork` ~4.5s; the page speaks it via `speechSynthesis`, no agent needed |
| "sixty-three thousand works" | `total: 63253`, confirmed by paging to the last record |
| "Rembrandt etchings from the sixteen-forties" | parses to `dateRange 1640–1649` + `mediumFamilies: [etching]` |
| "works out the different things that could mean" | unscripted. Given only *"something to hang above the sofa, warm, not busy, nothing grim"*, the model ran a text search, then `search_by_color` on amber — it decided "warm" was a colour question — merged both onto one board and chose the `salon` layout itself |
| "laid out so I can see how they relate" | `set_view`, the 17th tool. Layout was React state the agent could not previously reach |

## 5. Not said, because it cannot be shown

- **Conversational voice.** Spoken input works (`webkitSpeechRecognition`) and
  read-aloud works (`speechSynthesis`), but they are not joined into a continuous
  exchange. The ending promises that rather than claiming it.
- **Colour extraction and vision captions at index time.** Neither runs on the
  anonymous path.
- **Which layout the agent picks.** It chooses; on the sofa prompt it chose
  `salon`, not `atlas`. The VO stays layout-agnostic so it is true either way.
