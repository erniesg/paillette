# Paillette — WebMCP demo voiceover (final)

For ElevenLabs. §1 is the script to paste, one block per cue, nothing but words
to be spoken. §2 onward is production detail.

Runtime ≈ **2:10** at ~150 wpm. Ten cues.

---

## 1. Voiceover — paste this

**Cue 1 · Intro**

> With WebMCP, your agent can now see, search and describe art with you — right
> on the page. Here's how it works.

**Cue 2 · Point it at anything**

> First, point it at any collection of choice. Upload a zip archive or a folder
> to get started. For our demo, let's use a hundred works from the National
> Gallery of Art.

**Cue 3 · Why it matters**

> Most art is never seen. A museum can only hang a fraction of what it owns, and
> most of the rest was never catalogued well enough to find — no description, no
> subject, sometimes not even a title. Paillette indexes the pictures
> themselves, so a work nobody ever wrote about is still findable.

**Cue 4 · Explore**

> Once indexing is complete, we can start exploring with the suggestions it
> offers — drawn from what is actually in this collection, so you don't have to
> know it to begin.

**Cue 5 · Describe**

> We can even ask it to describe a work, and have that read out loud. Art
> becomes reachable for people who cannot see it.

**Cue 6 · Scale**

> The true power of Paillette is unleashed when we run it over an entire
> collection.

**Cue 7 · The full archive**

> Let's take a look at the National Gallery of Art again — this time its entire
> open-access collection of sixty-three thousand works. Ask for a mood: stormy
> seascapes. Or something exact: Rembrandt etchings from the sixteen-forties.

**Cue 8 · Let it work**

> But we can make this even more agentic. I'll just say what I want — something
> to hang above the sofa, warm, not busy, nothing grim.
> It doesn't run one search. It works out four different things that could mean,
> runs all of them, and puts the best of each on one board — laid out so I can
> see how they relate.

**Cue 9 · Co-creator**

> So the agent becomes a co-creator. Work that was unfindable is now not just
> discoverable but usable — which means you can walk in with nothing but a
> feeling and leave with a shortlist. Assembled from searches you would never
> have thought to run. Arranged so you can see how they relate. And described
> out loud, if you can't see them at all.

**Cue 10 · Close**

> Today, Paillette is your eyes on the collection. In the future: your ears too.

---

## 2. Two lines you asked me to rewrite

**Cue 3** was: *"The unlock is that agents can now make the world's art
discoverable by humans — most of it is hardly seen as museums can only show some
at a time, many are also missing metadata or enrichment that makes them
findable. Paillette takes care of all that."*

Three sentences fused into one, and "takes care of all that" says nothing. The
rewrite keeps both of your facts — museums can only show a fraction; the rest
isn't catalogued — and replaces the vague ending with the actual mechanism: it
indexes the pictures, not the catalogue. That is also the claim the 100-work demo
proves on screen.

**Cue 8** was your `xxx`. First draft was a refinement loop — "something calm",
then "warmer" — which read as a preference slider rather than an agent doing its
own thinking. This version is the real capability: given one vague goal the model
decided what the goal could *mean*, ran four different searches, and merged the
best of all four onto a single board with its reasoning.

That is the beat, because it is the one thing the interface genuinely cannot do.
A human running four searches sees the fourth; the first three are gone.
`set_results` takes up to sixty ids, so an agent can hold a cross-section of all
four on screen at once.

---

## 3. What is on screen per cue

| Cue | Footage | Tool chips |
| --- | --- | --- |
| 1 | wordmark card | — |
| 2 | `/try` drop zone, agent calls `index_zip`, approval prompt clicked | `index_zip` |
| 3 | progress climbing, speed-ramped ~37× | `get_index_status` |
| 4 | suggestions appear — *Estuary at dusk*, *Fallen tree* — one is run | `search_artworks` → `set_results` |
| 5 | a work opens, its description shown, **Read aloud** pressed | `describe_artwork` |
| 6 | cut to `/nga/search`, cached works drifting in | — |
| 7 | mood search, then the Rembrandt query with its filter chips | `search_artworks` |
| 8 | the in-page agent: one goal, four searches, one merged board with its note | `search_artworks` ×4 → `set_results` |
| 9 | the board flips to **atlas** — works positioned by visual similarity | `set_view` |
| 10 | end card | — |

---

## 4. Verified, so the script can say it

| Claim in the VO | Evidence |
| --- | --- |
| "a hundred works from the National Gallery of Art" | `sample-art-100.zip`, CC0, ships a `metadata.csv` |
| "indexes the pictures themselves" | every image is embedded with `jina-clip-v2`; the 25-work sample has no CSV at all and is still searchable |
| "suggestions drawn from what is actually in this collection" | 6 suggestions from the collection's own titles and facets — *Fallen tree*, *Estuary at dusk*, *Female figure in action*, *Armed figure amid trophies* — **all six return results** |
| "describe a work, and have that read out loud" | `describe_artwork` returns a caption in ~4.5s; the page speaks it with `speechSynthesis` — no agent required |
| "sixty-three thousand works" | `total: 63253`, confirmed by paging to the last record |
| "Rembrandt etchings from the sixteen-forties" | parses to `dateRange 1640–1649` + `mediumFamilies: [etching]`, returns real Rembrandts |
| "it tries four different ideas… on one board" | unscripted. Given "something to hang above the sofa, warm, not busy", the model ran `search_artworks` four times — soft landscapes, garden and flowers, Mediterranean earth tones, restful still lifes — then one `set_results` merging the best of all four, with its own note |
| "my search box can't do that" | the UI is URL-driven and single-query; a new search replaces the previous result set. `set_results` accepts up to 60 ids in one call |
| "laid out so I can see how they relate" | `set_view` — new in this build. Layout was React state the agent could not reach; it can now ask for masonry, salon, atlas or table |
| "described out loud" | the page speaks a generated description with `speechSynthesis`; no agent and no account needed |

## 5. Not said, because it cannot be shown

- Voice *input* driving the agent is real in ChatGPT's in-app browser, but the
  cut does not claim it — the recording uses the in-page agent instead.
- Colour extraction and vision captions do not run at index time on the
  anonymous path.
