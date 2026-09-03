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

- 16 tools registered on `document.modelContext` in
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
drives `index_zip` → `get_index_status` → `search_artworks`/`search_by_image` →
`show_artwork`, and the page **reads a caption aloud** when `describe_artwork`
returns. All of it works on the staging URL, anonymously.

## Tasks

1. **Read-back (only new code).** Add `speechSynthesis` narration so that when
   `describe_artwork` returns a caption (and when `show_artwork` opens a work with a
   note), the page speaks it aloud. Wire it where the agent-activity panel settles
   activity (`apps/web/app/lib/webmcp/store.ts` `settleActivity` /
   `apps/web/app/components/webmcp/agent-activity-panel.tsx`). Feature-detect
   `window.speechSynthesis`, cancel any in-flight utterance before speaking a new
   one, and never speak if the human hasn't interacted (avoid autoplay rejection).
   Keep it a no-op in a browser without the API.

2. **Voice-in verification (no code, but verify).** In ChatGPT's in-app browser,
   confirm voice prompts on `/try` actually drive the tools. Document the exact
   spoken prompts from `docs/webmcp-demo-script-v2.md` and note any that fail. If
   voice is flaky, add a minimal hold-to-speak `webkitSpeechRecognition` button that
   drops the transcript into the search box — but only if needed.

3. **Gate check + smoke test on staging.**
   - `await document.modelContext.getTools()` returns all 16 tools.
   - `index_zip` on the 25-no-metadata sample → poll `get_index_status` until
     `searchable: true` → `search_artworks` returns hits → `show_artwork` opens one.
   - Record the real wall-clock timing for the 25-image set (used for the demo).

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

- `await document.modelContext.getTools()` on staging lists 16 tools.
- A spoken prompt in ChatGPT's in-app browser completes
  index → status → search → show-artwork end to end.
- `describe_artwork` result is spoken aloud by the page.
- A browser without WebMCP (or without `speechSynthesis`) renders and behaves
  identically — nothing breaks.
- Staging deploy is current; production is untouched.

## Guardrails

- Feature-detect everything; never break the no-WebMCP path.
- No secrets/tokens on screen or in logs; no copyrighted music; no vendor logos.
- Do not add Claude/Anthropic attribution anywhere.
- Run `pnpm --filter web test` (webmcp registry/tools tests) and
  `pnpm --filter web typecheck` before finishing; report exactly what passed.
