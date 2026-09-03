# Paillette — complete handoff

Self-contained. Paste this whole file to a fresh agent; it should need to ask
nothing before starting.

Supersedes `webmcp-voice-plan.md`, `webmcp-agent-briefs.md`,
`webmcp-handoff-2.md` and `webmcp-handoff-3.md` — delete those once you have
read this.

---

## 1. The project

Paillette makes an art collection searchable by what its pictures *look* like
rather than by what a catalogue happens to record. It is a **WebMCP Challenge**
submission: **17 tools registered on `document.modelContext`**, so an agent can
search, filter, open and curate on the same page the human is using.

- Repo `~/code/erniesg/paillette`, branch **`deploy-nga-open-access`**
- Staging **https://paillette-stg.berlayar.ai** — deploy freely
- Production — **never**
- `/try` indexes a zip anonymously · `/nga/search` holds 63,253 open-access works
- `?webmcp-debug` on any page installs `window.__paillette_webmcp.call(name, args)`

The judging asks four things, and the demo video has to answer them: why this
use case suits WebMCP, how it makes the experience better, what people and
agents can do together that was hard before, and how WebMCP was implemented.

---

## 2. Verified facts

Everything here was checked against running code. Do not restate anything else
as fact without checking it first.

| Claim | Value | Where it came from |
| --- | --- | --- |
| Tools on `document.modelContext` | **17** | count `PAILLETTE_TOOL_NAMES` in `apps/web/app/lib/webmcp/tools.ts` |
| NGA open-access corpus | **63,253** works | paged `/api/public-search/nga/browse` to the last record |
| Demo zip | 100 works, CC0, ships `metadata.csv` | `apps/web/public/samples/` |
| Goes searchable | ~10s — **at 1 image of 100** | never say "searchable in 10 seconds"; say "as it loads" |
| Full index | ~5.5 min | speed-ramp it on screen |
| `describe_artwork` | ~4.5s, `gpt-5.6-luna` | live |
| Suggestions | 6, **all six return results** | *Fallen tree*, *Estuary at dusk*, *Female figure in motion*, *Armed roman goddess* |
| `estuary at dusk` returns | Fitz Henry Lane, *Lumber Schooners at Evening on Penobscot Bay*; *Estuary at Day's End* | live |
| `Rembrandt etchings from the 1640s` | parses to `dateRange 1640–1649` + `mediumFamilies:[etching]` | **only on `/nga/search`** — the 100-work sample has no Rembrandt |
| Test baseline | web 59 files / 593 tests · api 41 / 770 | `pnpm --filter web test` |

### Things that are NOT true — do not claim them

- Colour extraction and vision captions do **not** run at index time on the
  anonymous path. Colour is the authenticated org path; captions are on demand.
- Retrieval fuses **three** weighted channels by RRF (text, metadata, captions).
  Colour is a separate route plus a client-side CIEDE2000 re-rank — not in the
  fusion.
- Embeddings are **Jina** (`jina-clip-v2`), not Cloudflare AI. Workers AI is a
  caption-query fallback and translation.
- There is **no conversational voice**. Spoken input works, read-aloud works,
  but they are not joined into a continuous exchange.
- The intent parser extracts artist, medium, classification, yearFrom, yearTo.
  **Not** accession number.

---

## 3. What already works — do not rebuild

| | |
| --- | --- |
| **In-page agent** | prompt bar (`agent-prompt.tsx`) on `/try` and `/nga/search`. Loop decides server-side at `POST /api/public-agent/turn` (`apps/api/src/routes/agent.ts`, key is a Worker secret); every tool call executes in the browser against `document.modelContext`. The server never touches the page. |
| **Agentic by default** | the "try several interpretations, merge them, write a note, pick a layout" instruction lives in that route's SYSTEM PROMPT, not in what the user types. A bare *"something warm for above the sofa"* is enough. |
| **Speech in** | `webkitSpeechRecognition` in `agent-prompt.tsx` |
| **Speech out** | `speak-button.tsx`, `speechSynthesis`, over the caption `describe_artwork` persists |
| **`set_view`** (17th tool) | the agent picks masonry / salon / atlas / table; layout was React state it could not reach |
| **Agent board owns the canvas** | `set_results` with ids takes over `/nga/search`, its note rendered across the page |
| **`show_artwork`** | opens the page's own artwork dialog; it previously did nothing on `/nga/search` |
| **`callTool`** in `registry.ts` | prefers a real host's `executeTool`, falls back to this page's registered implementation |

### Recently fixed, so you know the shape of the bugs here

- Motif suggestions came back silently empty — the GPT-5.x reasoning budget ate
  the whole `max_completion_tokens` and returned `finish_reason: "length"` with
  empty content. Fixed with `reasoning_effort: 'none'`.
- `/try` froze at "queued 0%" forever: the adoption effect was keyed on the job
  it set, so it tore down its own poller on the first read.
- `/collections/nga/search` 404'd; it now 301s to `/nga/search`.
- Cached spotlight images used session-gated URLs and never loaded; regenerated
  with public IIIF URLs.
- The public search grid showed "No image" for every result, for the same reason.

---

## 4. Chrome and WebMCP — tested, not assumed

Chrome 152 with `--enable-features=WebMCPTesting`:

- `document.modelContext` is real; all 17 tools register with it.
- `getTools()` returns **descriptors** — none carry `execute`. Executing is the
  host's job.
- The host API is:

```js
document.modelContext.executeTool(toolObject, JSON.stringify(args))
//                                ^ the RegisteredTool from getTools(), NOT a name
//                                                ^ a JSON STRING, not an object
```

Both mistakes fail opaquely: a name gives *"not of type RegisteredTool"*, an
object gives *"Failed to parse input arguments"* with no hint which argument is
wrong. Verified working — it returned our real `list_collections` result.

- `window.LanguageModel` exists (Chrome's on-device Gemini Nano). In a headless
  profile `await LanguageModel.availability()` returned **`"unavailable"`** —
  the model is not downloaded there. Statics are `availability` and `create`
  only; `params` does not exist on this build.

**The flag gives the transport, not a brain.** Deciding *which* tool to call
still needs a model.

---

## 5. Open work, ranked

### 5.1 Is a zero-key on-device agent possible? *(research first)*

The upside: an agent driving the page with **no API key, no account, nothing
leaving the machine** — arguably what WebMCP is for, and a claim nobody else in
the competition will have.

1. On a real, non-headless Chrome run `await LanguageModel.availability()`.
   Report exactly what it returns. If `downloadable`, trigger `create()` and say
   how long and how large.
2. If a session is possible, establish whether it supports **tool calling**.
   Read what `create()` accepts — anything like `tools`, and structured output
   (`responseConstraint` / JSON schema). Gemini Nano is small; it may not.
3. Give a straight verdict.
   - **If it can call tools:** build a loop mirroring `agent-prompt.tsx` but
     entirely on-device — `getTools()` for schemas, the model to choose,
     `callTool()` from `registry.ts` to execute. Gate it behind a runtime
     `availability()` check.
   - **If it cannot:** say so, record the evidence, stop. Do not force it with
     prompt-and-parse hacks. A flaky agent in a submission video is worse than
     none, and the OpenAI path already works.

### 5.2 Make the voice trigger filmable

The mic works but shows nothing until recognition finishes, so on camera it is a
dead box while someone talks. In `agent-prompt.tsx`:

- `interimResults = true`; write interim transcripts into the input as they
  arrive.
- A visible listening state — pulsing indicator plus the live transcript.
- Submit on the final result; clear the interim text.
- Handle `onerror` for `not-allowed` and `no-speech` with a readable message
  instead of silence.
- Keep it feature-detected: no `SpeechRecognition` → no mic button, identical
  behaviour otherwise.

Add `apps/web/app/components/webmcp/__tests__/agent-prompt.test.tsx`; stub
`fetch` with `vi.stubGlobal`, no network.

### 5.3 Auto-describe before showing *(small, fixes a real gap)*

**Read aloud** only appears once a caption exists, and captions come from
`describe_artwork`. So an agent that opens a work without describing it first
produces a dialog with no audio — which is exactly the beat the video needs.

Make `show_artwork` opportunistically ensure a caption: if the work has no
`generated_caption`, run the describe path without blocking the open. Fail open;
captions are persisted so a repeat call is free.

### 5.4 A shareable board *(largest win; it is the stated roadmap item)*

The submission promises *"assemble works into shortlists and shareable
exhibitions"*. Half exists — `set_results` with ids and a note is an exhibition
and renders full-canvas — but it dies with the tab.

Give a board a URL: encode the pinned ids and note into a query parameter the
search page rehydrates, plus a control to copy the link. Watch URL length (60
ids is the cap) and note that ids are only session-resolvable today, so a cold
URL needs records re-fetched by id. Say which approach you chose and why.

### 5.5 Speak the agent's reply

The agent writes a short reply each turn and it is displayed silently. Speaking
it, reusing `speechSynthesis`, turns read-aloud from a button press into
something closer to conversation. Depends on 5.2 landing first.

---

## 6. The demo video

Script lives in `docs/webmcp-vo-script-final.md`. Structure is settled; **two
gaps remain and the owner has not chosen.** Offer options, do not silently pick.

### Gap 1 — completing "So now the agent becomes a co-creator…"

Angles already brainstormed:

1. *Inversion of expertise* — "The collection used to require a vocabulary. Now it just requires an opinion."
2. *Division of labour* — "I brought the taste. It brought sixty-three thousand works."
3. *Negative space* — "I didn't search for a single one of these. I described a room." ← most literally true of the shot
4. *Retrieval → proposal* — "That isn't search returning results. That's someone bringing you options."
5. *Curator friend* — "Every museum has someone who knows the store rooms. Now everybody does."
6. *Scale meets intimacy* — "Sixty-three thousand works, narrowed to five, for one wall in one room."
7. *Catalogued → usable* — "Art that was recorded but never seen is now art you can actually use."

3 + 6 combine well.

### Gap 2 — the ending, and the card

The film **opens** with "most art is never seen", so the ending should close that
loop, not announce a roadmap. Already rejected: *"Today, on one collection. Next,
on every collection"* (roadmap-speak) and *"in the future, your ears too"* (out
of date — read-aloud ships today).

- **"For everything you can't name. And everything you can't see."** ← maps onto
  the card exactly: can't name → eyes, can't see → ears
- "Museums can only hang a fraction. Your agent can see all of it."
- "Most of these have never hung anywhere. Now one of them can hang in your living room."
- "You don't have to know what you're looking for anymore."
- "The art was always there. Nobody was looking."

**Rule for both: nothing goes in that is not demonstrably true of the footage.**

---

## 7. Recording

Headless Chromium **cannot** do real speech recognition — Chrome sends audio to
Google's service. A genuinely spoken take must be filmed on a real machine.
Everything after the transcript is capturable headlessly.

The reproducible agent-driven capture:

```sh
export OPENAI_API_KEY=...        # it is in ~/code/erniesg/tong/.env
node agent-drive.mjs <out-dir> "<goal>" gpt-5.6-terra /nga/search
```

The best demo instruction found — it needs no coaching, because the system
prompt carries the behaviour:

> "I want something to hang above the sofa in my living room. Warm, not busy,
> nothing grim."

Which produced, unscripted: a text search, then `search_by_color` on amber (it
decided "warm" was a colour question), both merged onto one board,
`set_view: salon` chosen by the model, and the note *"Five warm, calm options
with open compositions — easy to live with, rather than visually demanding."*

---

## 8. Ground rules

- **Verify before asserting.** Every number in this repo's docs was checked
  against code. If you cannot verify something, say so rather than softening it.
- Run `pnpm --filter web typecheck` and `pnpm --filter web test`; add
  `pnpm --filter api test` when you touch the API. Report exactly what passed.
- Deploy staging: `pnpm --filter web deploy:staging`, and from `apps/api`,
  `npx wrangler deploy --env staging`. Never production.
- **No Claude or Anthropic attribution anywhere** — no `Co-Authored-By`, no robot
  emoji, no "generated with" footers. Hard rule from the owner's config.
- Commit in coherent pieces; explain *why*, not what.
- Check `git status` and `git log --oneline -5` before editing. Other agents may
  be working in parallel — if a file you need is dirty, stop and say so.
- The owner pushes back hard and is usually right. When a line is called bad,
  the fault is normally abstraction, or a claim that outruns the evidence.
