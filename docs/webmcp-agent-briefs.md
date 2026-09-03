# Briefs to farm out

Four self-contained prompts. Paste one per agent. They can all run at once —
their file ownership does not overlap. Do not give one agent two of these.

---

## → Agent 1 · Voice input that reads on camera

```
You are working in ~/code/erniesg/paillette on branch deploy-nga-open-access.
This is a WebMCP hackathon submission being filmed for a demo video.

ONLY touch these files:
  apps/web/app/components/webmcp/agent-prompt.tsx
  apps/web/app/components/webmcp/__tests__/agent-prompt.test.tsx   (create)
If you believe you need any other file, stop and say so instead of editing it.

CONTEXT
AgentPrompt is an in-page agent: the human types or speaks a goal, the loop runs
server-side at /api/public-agent/turn, and every tool call it returns is executed
in the browser against document.modelContext. The mic uses webkitSpeechRecognition
and already works — but it shows nothing until recognition finishes, so on camera
it looks like a dead input while someone is talking.

TASK
1. Set interimResults = true, continuous = false. Write interim transcripts into
   the input as they arrive so words appear while the person is still speaking.
2. Make the listening state visible — a pulsing indicator plus the live
   transcript. The existing `listening` boolean is your hook.
3. Submit on the final result and clear the interim text.
4. Handle onerror: 'not-allowed' (permission denied) and 'no-speech' should each
   push a short readable message into the entries list instead of failing silently.
5. Keep everything feature-detected. No SpeechRecognition -> no mic button, and
   the component must render and behave identically without it.

TESTS
Write apps/web/app/components/webmcp/__tests__/agent-prompt.test.tsx covering:
renders nothing agent-related when document.modelContext is absent; the mic
button is hidden with no SpeechRecognition; an interim result updates the input;
a final result submits; permission-denied surfaces a message. Stub the API with
vi.stubGlobal('fetch', ...) — do not hit the network.

CONSTRAINTS
- Run `pnpm --filter web typecheck` and `pnpm --filter web test`. Report exactly
  what passed.
- Do not commit. Leave changes in the tree.
- No Claude/Anthropic attribution anywhere: no Co-Authored-By trailers, no robot
  emoji, no "generated with" footers.
```

---

## → Agent 2 · The "agent working" view

```
You are working in ~/code/erniesg/paillette on branch deploy-nga-open-access.
This is a WebMCP hackathon submission being filmed for a demo video.

ONLY touch this file:
  apps/web/app/components/webmcp/agent-activity-panel.tsx
If you believe you need any other file, stop and say so instead of editing it.

CONTEXT
The panel logs WebMCP tool calls. In the demo an agent chains four to seven tools
off a single sentence — searches, a colour pass, set_results, set_view — and on
camera it reads as an undifferentiated list. A viewer cannot tell what is running
now, how far through it is, or that these calls are one operation.

The store already holds everything you need: `activity` entries carry
status: 'running' | 'ok' | 'error' | 'aborted', and `agentResults` carries the
agent's pinned set and its note. This is a presentation change only — do not
change the store, and do not change what any tool writes.

TASK
1. Give the entry with status 'running' a clearly active treatment, distinct from
   completed lines.
2. Show a step counter for the current burst (e.g. "step 3") so a chain reads as
   one operation rather than unrelated calls. Derive it from the activity list;
   do not add state to the store.
3. When the agent has pinned a set, keep its note visible above the thumbnails
   while later tools are still running.
4. Keep it legible on a dark background at video sizes. The palette is in
   apps/web/tailwind.config.ts — violet #a855f7, fuchsia #d946ef, amber #fbbf24
   for the agent label, green #4ade80 for OK.

CONSTRAINTS
- Run `pnpm --filter web typecheck` and `pnpm --filter web test`. Report exactly
  what passed. Existing tests must stay green.
- Do not commit. Leave changes in the tree.
- No Claude/Anthropic attribution anywhere.
```

---

## → Agent 3 · Docs and submission text

```
You are working in ~/code/erniesg/paillette on branch deploy-nga-open-access.
This is a WebMCP hackathon submission.

ONLY touch these files:
  docs/webmcp-devpost.md
  docs/webmcp-vo-script.md
  docs/webmcp-submission-pack.md
  docs/webmcp-submission-description.md
  docs/webmcp-devpost-fields.md
  README.md
Do not touch anything under apps/.

TASK
1. The WebMCP tool count is now 17 — `set_view` was added. Several docs still say
   16 or "sixteen". Fix every one. Verify by counting the entries in
   PAILLETTE_TOOL_NAMES in apps/web/app/lib/webmcp/tools.ts; quote the number you
   counted in your report.
2. Add `set_view` to every tool listing. Describe it as: the agent chooses the
   layout, because presentation is part of its answer — atlas to show how a
   cross-section relates, salon for a curated hang, table for comparing catalogue
   fields, masonry for ordinary browsing.
3. Add voice, but ONLY as far as it is true. The page accepts a spoken goal via
   webkitSpeechRecognition (apps/web/app/components/webmcp/agent-prompt.tsx) and
   reads a generated description aloud via speechSynthesis
   (apps/web/app/components/artwork/speak-button.tsx). Paillette does NOT do
   real-time conversational voice — that belongs in "What's next", not in the
   feature list.
4. Every numeric or behavioural claim must be checked against the code before you
   repeat it. Do not copy a number from a neighbouring doc. In your report, list
   anything you could not verify.

CONSTRAINTS
- Docs only; you should not need to run typecheck.
- Do not commit. Leave changes in the tree.
- No Claude/Anthropic attribution anywhere.
```

---

## → Agent 4 · Capture harness

```
You are working in ~/code/erniesg/paillette on branch deploy-nga-open-access.

ONLY create files under:
  scripts/demo/
Do not modify any existing file.

CONTEXT
We record demo footage by driving the live staging site
(https://paillette-stg.berlayar.ai) in Playwright and capturing video. Playwright
is not a workspace dependency; resolve playwright-core from
/Users/erniesg/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs
(an existing script does exactly this — do not add a dependency).

The page has an in-page agent: a prompt input rendered by AgentPrompt on /try and
/nga/search. Typing a goal there runs a real agent loop that calls the page's
WebMCP tools. Loading any page with ?webmcp-debug also exposes
window.__paillette_webmcp for direct tool calls.

TASK
Create scripts/demo/capture.mjs:
1. `node scripts/demo/capture.mjs <url> "<instruction>"` opens the url, waits for
   document.modelContext, types the instruction into the AgentPrompt input,
   submits, and records video at 1440x900 deviceScaleFactor 2.
2. While it runs, watch for the page's own approval prompt (a button named
   /^approve$/i) and click it. Mutating tools park on that gate — the harness
   must click it, never bypass it.
3. Write beats.json: a timestamped list of every tool the activity panel shows
   firing, plus screenshots at each step.
4. Add a --speak flag that dispatches the instruction the way the speech
   recogniser would rather than typing it. Document in the file header that
   headless Chromium cannot perform real speech recognition, so this reproduces
   the post-transcript path only, and a genuine spoken take must be filmed on a
   real machine.
5. Exit non-zero with a readable message if the page never registers tools.

CONSTRAINTS
- Node ESM, no new dependencies, no changes outside scripts/demo/.
- Verify it runs end to end against https://paillette-stg.berlayar.ai/nga/search
  with an instruction like "something warm for above the sofa" and report the
  tools that fired.
- Do not commit. No Claude/Anthropic attribution anywhere.
```
