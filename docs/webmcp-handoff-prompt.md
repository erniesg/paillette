# Handoff prompt — make the WebMCP demo demonstrable

> Paste the block below into Codex (or another coding agent) as-is. It is written
> to be self-contained and to make the demo reliably recordable, not to add scope.

---

You are working in the repo at `~/code/erniesg/paillette`, branch
`deploy-nga-open-access`. This is a WebMCP Challenge submission. The WebMCP layer is
already built; your job is to make it **demonstrable end-to-end for a recording**
using OpenAI/ChatGPT voice, and to get the staging deploy current. Do not add new
features beyond what is asked. Do not deploy to production.

## Context (already built — do not rebuild)

- 25 tools registered on `document.modelContext` in
  `apps/web/app/lib/webmcp/tools.ts`, bound by `apps/web/app/lib/webmcp/registry.ts`,
  mounted from `apps/web/app/components/webmcp/webmcp-bridge.tsx` via `root.tsx`.
- Read tools wrap the anonymous public-search routes; shared-canvas tools
  (`get_view_context`, `set_results`, `show_artwork`) write React state; indexing
  (`index_zip`, `index_folder`, `get_index_status`) and read-aloud captioning
  (`describe_artwork`) are the new backend surface.
- The `/try` page drives the same indexing flow a human can use with no login.
- Live URL is `https://paillette-stg.berlayar.ai` (staging). Judges open this.

## Goal

A judge (or you, on camera) speaks to ChatGPT's in-app browser on `/try`, the agent
drives `index_zip` → `get_index_status`, then demonstrates the **full search spectrum**
— a mood query (`search_artworks`), an exact parsed query (artist/medium/date), a
visual query (`search_by_image`), a colour query (`search_by_color`) — and
`show_artwork`. ChatGPT's own voice reads a caption aloud when `describe_artwork`
returns. All of it works on the staging URL, anonymously.

## Tasks

1. **Read-back (no code).** The read-aloud is ChatGPT's own voice reading tool results
   — do not add `speechSynthesis`. Just confirm during the smoke test that when
   `describe_artwork` returns a caption, ChatGPT reads it aloud.

2. **Voice-in verification (no code, but verify).** In ChatGPT's in-app browser,
   confirm voice prompts on `/try` actually drive the tools. Document the exact
   spoken prompts from `docs/webmcp-demo-script-v2.md` and note any that fail. If
   voice is flaky, add a minimal hold-to-speak `webkitSpeechRecognition` button that
   drops the transcript into the search box — but only if needed.

3. **Gate check + smoke test on staging.**
   - `await document.modelContext.getTools()` returns all 25 tools.
   - `index_zip` on a sample → poll `get_index_status` until `searchable: true`.
   - **Full spectrum, verified end-to-end:** `search_artworks` on a mood query
     ("stormy seascapes"); `search_artworks` on an exact parsed query (an
     artist + medium + date phrase) and confirm `interpretation` shows the parsed
     filters and the results match; `search_by_image` on a returned id;
     `search_by_color` on a hex. Then `show_artwork` opens one.
   - Record the real wall-clock indexing time for the 25-image set (used for the demo).

4. **Commit + deploy staging.** There are uncommitted changes that are part of the
   submission: `apps/api/src/index.ts`, `apps/api/src/routes/search.ts`,
   `apps/web/app/lib/webmcp/{tools,client}.ts` and untracked
   `apps/api/src/routes/describe.ts`, `apps/api/src/utils/query-intent.ts`,
   `apps/web/app/routes/api.public-describe.ts`. Review them, commit with concise
   messages, push `deploy-nga-open-access`, and redeploy staging. Do not touch
   production (`master`).

5. **Fix stale docs.** Replace "fifteen tools" with "sixteen" in
   `docs/webmcp-whats-new.md` and `docs/webmcp-demo-script.md`.

## Definition of done

- `await document.modelContext.getTools()` on staging lists 25 tools.
- A spoken prompt in ChatGPT's in-app browser completes
  index → status → the full search spectrum (mood, exact parsed, visual, colour) →
  show-artwork end to end.
- A `describe_artwork` caption is read aloud by ChatGPT's voice.
- A browser without WebMCP renders and behaves identically — nothing breaks.
- Staging deploy is current; production is untouched.

## Future development (out of scope for this recording — do not build now)

- **Automatic vision titling.** Today a zip with no CSV gets filename-derived titles,
  and the vision model only describes a work on demand (`describe_artwork`). Future
  work: run a vision pass during indexing so metadata-less folders get real titles and
  descriptions automatically. Not needed for the demo — the recording uses `nga-100`,
  which ships a `metadata.csv` with full titles.

## Guardrails

- Feature-detect everything; never break the no-WebMCP path.
- No secrets/tokens on screen or in logs; no copyrighted music; no vendor logos.
- Do not add Claude/Anthropic attribution anywhere.
- Run `pnpm --filter web test` (webmcp registry/tools tests) and
  `pnpm --filter web typecheck` before finishing; report exactly what passed.
