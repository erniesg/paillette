# Handoff — finish the VO script and keep building

Self-contained. Paste the whole file to a fresh Claude agent; it should not need
to ask anything to start.

---

## 1. What this is

Paillette makes an art collection searchable by what its pictures *look* like
rather than by what a catalogue records. It is a WebMCP Challenge submission:
**17 tools registered on `document.modelContext`**, so an agent can drive the
page — searching, filtering, opening and curating on the same canvas the human is
using.

- Repo: `~/code/erniesg/paillette`, branch `deploy-nga-open-access`
- Live staging: `https://paillette-stg.berlayar.ai` — **deploy here freely**
- Production: **do not touch**
- Anonymous entry: `/try` (index a zip) · `/nga/search` (63,253 open-access works)
- Debug harness: append `?webmcp-debug` to any page for
  `window.__paillette_webmcp.call(name, args)`

Judging asks four things, and the video has to answer them: why this use case
fits WebMCP, how it makes the experience better, what people and agents can do
together that was hard before, and how WebMCP was implemented.

---

## 2. Verified facts — do not restate anything else as fact

| Claim | Value | How it was checked |
| --- | --- | --- |
| Tools on `document.modelContext` | **17** | count `PAILLETTE_TOOL_NAMES` in `apps/web/app/lib/webmcp/tools.ts` |
| NGA open-access corpus | **63,253** works | paged `/api/public-search/nga/browse` to the last record |
| Demo zip | 100 works, CC0, ships `metadata.csv` | `apps/web/public/samples/` |
| Goes searchable after | ~10s — **at 1 image of 100** | never say "searchable in 10 seconds"; say "as it loads" |
| Full index | ~5.5 min | speed-ramp it on screen |
| `describe_artwork` | ~4.5s, `gpt-5.6-luna` | live |
| Suggestions | 6, **all six return results** | *Fallen tree*, *Estuary at dusk*, *Female figure in motion*, *Armed roman goddess* |
| `estuary at dusk` returns | Fitz Henry Lane, *Lumber Schooners at Evening on Penobscot Bay*; *Estuary at Day's End* | live |
| `Rembrandt etchings from the 1640s` | parses to `dateRange 1640–1649` + `mediumFamilies:[etching]` | **only on `/nga/search`** — there is no Rembrandt in the 100-work sample |

**Things that are NOT true and must not be claimed:**

- Colour extraction and vision captions do **not** run at index time on the
  anonymous path. Colour is the authenticated org path; captions are on demand.
- The retrieval fuses **three** weighted channels via RRF (text, metadata,
  captions). Colour is a separate route plus a client-side CIEDE2000 re-rank —
  it is *not* in the fusion.
- Embeddings are **Jina** (`jina-clip-v2`), not Cloudflare AI. Workers AI is a
  caption-query fallback and translation.
- There is **no conversational voice**. Spoken input works
  (`webkitSpeechRecognition`) and read-aloud works (`speechSynthesis`), but they
  are not joined into a continuous exchange.
- The intent parser extracts artist, medium, classification, yearFrom, yearTo.
  **Not** accession number.

---

## 3. What shipped in the last few hours — do not redo

| | |
| --- | --- |
| `set_view` (17th tool) | agent picks masonry / salon / atlas / table; layout was React state it could not reach |
| Agent board owns the canvas | `set_results` with ids takes over `/nga/search`, note rendered across the page |
| `show_artwork` opens the artwork dialog | it previously did nothing on `/nga/search` |
| Read-aloud | `SpeakButton` on the artwork dialog and the `/try` overlay, over the caption `describe_artwork` persists |
| In-page agent + mic | prompt bar on `/try` and `/nga/search`; loop server-side (key is a Worker secret), tool calls execute client-side |
| Agentic system prompt | a bare goal is enough — the "try several interpretations and merge" instruction lives in `apps/api/src/routes/agent.ts`, not in what the user types |
| Motif suggestions | were silently empty; the GPT-5.x reasoning budget ate the whole `max_completion_tokens`. Fixed with `reasoning_effort: 'none'` |
| `/try` adoption poller | was frozen at "queued 0%" forever; effect was keyed on the job it set |
| `/collections/nga/search` | 301s to `/nga/search`; it used to 404 |
| Cached spotlight images | regenerated with public IIIF URLs; they were session-gated and never loaded |

---

## 4. Task one — finish the VO script

Current file: `docs/webmcp-vo-script-final.md`. The owner's latest structure is
below with two gaps marked. **Everything else in it is settled — do not rewrite
lines that are not marked.**

```
Intro   [card: Let AI be your eyes and ears with Paillette]
VO: With WebMCP, your agent can now see, search, and describe art with you — right on the page. Here's how it works.

VO: First, point it at any collection of choice. Upload a .zip archive or a folder to get started. For our demo, let's use 100 works from the National Gallery of Art.
VO: Paillette unlocks a new experience with art that makes works discoverable, even if there's little or missing metadata.
VO: Once indexing is completed, we can start to explore this collection with some suggestions.
VO: For example: estuary at dusk. And there it is — Fitz Henry Lane's lumber schooners at evening, and a Dutch estuary at day's end. Neither of which I could have named.
VO: We can even ask it to describe a work, and have that read out loud. Art then becomes reachable for people who cannot see it. [hold on the spoken description, then fade]
VO: The true power of Paillette is unleashed when we run it over an entire collection.
VO: Let's take a look at the National Gallery of Art again, this time at its entire open access collection of 63,253 works. Ask for a mood: stormy seascapes. Or something like: Rembrandt etchings from the sixteen-forties.
VO: But make it even more agentic. I'll just say what I want — something to hang above the sofa in my living room, warm, not busy, nothing grim.
VO: It doesn't just run one search. It works out the different things that could mean, runs all of them, and puts the best of each on one board — laid out so I can see how they relate.
VO: So now the agent becomes a co-creator. ←── GAP 1
Ending  [card: ←── GAP 2 (card wording) ]
VO: ←── GAP 2 (closing line)
```

### Gap 1 — the co-creator completion

Seven angles were brainstormed. The owner has not chosen. Present a shortlist,
do not silently pick:

1. **Inversion of expertise** — "The collection used to require a vocabulary. Now it just requires an opinion."
2. **Division of labour** — "I brought the taste. It brought sixty-three thousand works."
3. **Negative space** — "I didn't search for a single one of these. I described a room." *(most literally true of the shot)*
4. **Retrieval → proposal** — "That isn't search returning results. That's someone bringing you options."
5. **Curator friend** — "Every museum has someone who knows the store rooms. Now everybody does."
6. **Scale meets intimacy** — "Sixty-three thousand works, narrowed to five, for one wall in one room."
7. **Catalogued → usable** — "Art that was recorded but never seen is now art you can actually use."

3 + 6 combine well. Offer two or three combinations, ask, then write it in.

### Gap 2 — the ending and the card

The film **opens** with "most art is never seen", so the ending should close that
loop rather than announce a roadmap. Rejected already: *"Today, on one
collection. Next, on every collection."* (roadmap-speak) and *"in the future,
your ears too"* (out of date — read-aloud ships today).

Candidates:

- **"For everything you can't name. And everything you can't see."** — maps
  exactly onto the card: can't name → eyes (visual search), can't see → ears
  (read aloud). Shortest complete statement of the product.
- "Museums can only hang a fraction. Your agent can see all of it."
- "Most of these have never hung anywhere. Now one of them can hang in your living room."
- "You don't have to know what you're looking for anymore."
- "The art was always there. Nobody was looking."

Card options: keep *Let AI be your eyes and ears with Paillette*, or
*For what you can't name, and can't see*, or *Ask for what you want, not what
it's called*.

**Rule for both gaps: nothing goes in that is not demonstrably true of the
footage.** If a line implies a capability, check it in the code first.

---

## 5. Task two — feature development

Ranked. Do them in order; each is independent.

### 5.1 Auto-describe before showing *(small, fixes a real sequencing gap)*

`show_artwork` opens the artwork dialog, and the **Read aloud** control only
appears once a caption exists — captions come from `describe_artwork`. So an
agent that opens a work without describing it first produces a dialog with no
audio, which is exactly the Cue 6 beat.

Make `show_artwork` opportunistically ensure a caption: if the artwork has no
`generated_caption`, call the same describe path before or just after focusing
it, without blocking the open. Fail open — a describe failure must not stop the
work being shown, and must not spend budget twice on the same work (captions are
persisted, so a second call is already free).

Files: `apps/web/app/lib/webmcp/tools.ts`, and its tests.

### 5.2 A shareable board *(the biggest win; it is the Devpost roadmap item)*

The submission's "What's next" promises *"assemble works into shortlists and
shareable exhibitions"*. Half of it already exists: `set_results` with ids plus a
note is an exhibition, and it renders full-canvas — but it dies with the tab.

Give a board a URL. Encode the pinned ids and the note into a query parameter the
search page can rehydrate, and add a control to copy that link. Then an agent can
assemble a hang and the human can send it to someone.

Watch: URL length (60 ids is the cap), and the ids are only resolvable in-session
today — rehydrating from a cold URL needs the records re-fetched by id, so check
whether `lookup_artwork`'s path can serve that or whether a small batch endpoint
is needed. Say which you chose and why.

Files: `apps/web/app/routes/galleries.$galleryId.search.tsx`,
`apps/web/app/lib/webmcp/` as needed, plus tests.

### 5.3 Speak the agent's reply *(makes "ears" continuous)*

The agent writes a short reply each turn ("I've opened my favourite: *Moonlight*
by Julian Alden Weir…"). It is displayed silently. Speaking it — reusing the
existing `speechSynthesis` path — turns read-aloud from a button press into a
conversation, which is the one thing the ending currently has to promise rather
than show.

**Blocked until the other agent finishes Task A**, which owns
`apps/web/app/components/webmcp/agent-prompt.tsx`. Check `git log` first.

### 5.4 Index from a URL *(roadmap, larger)*

`index_zip` already accepts an `https://` URL or a `data:` URI. Pointing at an
open-access collection endpoint and crawling it is the natural next step. Scope
it before starting; it is bigger than it looks.

---

## 6. File ownership — read before editing

Another agent is working in parallel on tasks A, B and D. **Do not touch:**

- `apps/web/app/components/webmcp/agent-prompt.tsx` *(theirs — task A)*
- `apps/web/app/components/webmcp/agent-activity-panel.tsx` *(theirs — task B)*
- `scripts/demo/` *(theirs — task D)*

Yours: `apps/web/app/lib/webmcp/tools.ts`,
`apps/web/app/routes/galleries.$galleryId.search.tsx`,
`apps/web/app/lib/webmcp/store.ts`, `apps/api/src/**`, `docs/**`.

Run `git status` and `git log --oneline -5` before you start. If a file you need
is dirty, stop and say so rather than editing over someone.

---

## 7. Ground rules

- Verify before asserting. Every number in the video, the README and the Devpost
  has been checked against the code; keep it that way. If you cannot verify
  something, say so rather than softening it.
- Run `pnpm --filter web typecheck`, `pnpm --filter web test`, and
  `pnpm --filter api test` when you touch the API. Report exactly what passed.
  Baseline is 58 files / 585 tests (web) and 41 / 770 (api).
- Deploy staging with `pnpm --filter web deploy:staging`, and from `apps/api`,
  `npx wrangler deploy --env staging`. Never production.
- **No Claude or Anthropic attribution anywhere** — no `Co-Authored-By` trailers,
  no robot emoji, no "generated with" footers. This is a hard rule from the
  owner's own config.
- Commit in coherent pieces with messages that explain *why*, not what.
- The owner pushes back hard and is usually right. When they say a line is bad,
  the fault is normally abstraction or a claim that outruns the evidence.

---

## 8. Useful scratch assets

Recordings and capture scripts live outside the repo in the coordinator's
scratch directory. If you need footage, the reproducible path is:

```sh
# a real agent loop against the live site, using the page's own tool schemas
export OPENAI_API_KEY=...        # in ~/code/erniesg/tong/.env
node agent-drive.mjs <out-dir> "<goal>" gpt-5.6-terra /nga/search
```

The single best demo instruction found so far, which needs no coaching because
the system prompt carries the behaviour:

> "I want something to hang above the sofa in my living room. Warm, not busy,
> nothing grim."

It produced: a text search, then `search_by_color` on amber — it decided "warm"
was a colour question — merged onto one board, `set_view: salon` chosen by the
model, and the note *"Five warm, calm options with open compositions — easy to
live with, rather than visually demanding."*
