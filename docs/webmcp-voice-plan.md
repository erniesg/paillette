# Voice + agent-working view — parallel work plan

Five tasks. **File ownership is disjoint**, so they can run at the same time
without stepping on each other. Each names the files it may touch; nothing else
is in scope for that task.

Branch: `deploy-nga-open-access`. Staging deploys are fine; production is not.

---

## Ground rules for every task

- Do **not** edit files outside your task's "Owns" list. If you think you need
  to, stop and say so instead.
- Run `pnpm --filter web typecheck` and `pnpm --filter web test` before
  finishing. Report exactly what passed.
- No Claude/Anthropic attribution anywhere — no `Co-Authored-By`, no robot
  emoji, no "generated with" footers.
- Feature-detect anything browser-specific and render nothing where it is
  missing. The page must stay identical for a browser without the API.
- Do not commit. Leave the work in the tree and describe what changed.

---

## Task A — Voice input that reads well on camera

**Owns:** `apps/web/app/components/webmcp/agent-prompt.tsx`,
`apps/web/app/components/webmcp/__tests__/agent-prompt.test.tsx` (new)

The mic works but is invisible until it finishes. On camera nothing appears to
happen while someone is speaking.

1. Set `interimResults = true` and `continuous = false`, and write interim
   transcripts into the input as they arrive, so the words appear while the
   person is still talking.
2. Add a visible listening state — a pulsing dot and the live transcript. The
   existing `listening` boolean is the hook.
3. Submit on the final result, as now, and clear the interim text.
4. Handle `onerror` for `not-allowed` (permission denied) and `no-speech` with a
   short message in the entries list rather than silence.
5. Keep the whole thing feature-detected: no `SpeechRecognition`, no mic button.

**Done when:** speaking shows words appearing live, then the agent's tool chips
appear beneath, and denying mic permission shows a readable message.

---

## Task B — An "agent working" view

**Owns:** `apps/web/app/components/webmcp/agent-activity-panel.tsx`

The panel is a log. During a five-tool chain a viewer cannot tell what is
happening now versus what already finished.

1. Give the currently-running tool a distinct, prominent state — the entry with
   `status: 'running'` should read as active, not as another line in a list.
2. Show a step counter for the current burst (e.g. "step 3") so a chain reads as
   one operation rather than unrelated calls.
3. When `pinnedByTheAgent` is present, keep the note visible above the
   thumbnails while later tools run.
4. Do not change what the store holds — this is presentation only. The state is
   already in `activity` and `agentResults`.

**Done when:** during a chain a viewer can see which step is running, how many
have run, and the note once it lands. `pnpm --filter web test` stays green.

---

## Task C — Docs and submission text

**Owns:** `docs/webmcp-devpost.md`, `docs/webmcp-vo-script.md`,
`docs/webmcp-submission-pack.md`, `docs/webmcp-submission-description.md`,
`docs/webmcp-devpost-fields.md`, `README.md`

1. The tool count is **17** — `set_view` was added. Check every doc; some still
   say 16 or "sixteen".
2. Add `set_view` to any tool listing, described as: the agent chooses the
   layout because presentation is part of its answer (atlas for a cross-section,
   salon for a hang, table for comparing fields).
3. Add voice input to the capability lists **only as far as it is true**: the
   page accepts a spoken goal through `webkitSpeechRecognition`, and reads a
   generated description aloud through `speechSynthesis`. Paillette does not do
   real-time conversational voice; that stays in "What's next".
4. Verify every numeric claim against the code before repeating it. Do not copy
   a number from another doc.

**Done when:** no doc says 16 tools, `set_view` appears in every tool listing,
and voice is described as input + read-aloud, not as conversation.

---

## Task D — Capture harness for the voice beat

**Owns:** `scripts/demo/` (new directory only)

Headless Chromium cannot do real speech recognition, so the voice beat is
recorded on a real machine. This task builds the harness for everything else.

1. A script that opens a given URL, waits for `document.modelContext`, and
   drives the in-page agent by typing an instruction into `AgentPrompt` (not by
   calling tools directly), then records video and a `beats.json` of what fired.
2. It must click the page's own approval prompt when a mutating tool parks on
   it, rather than bypassing the gate.
3. Include a `--speak` flag that, instead of typing, dispatches the transcript
   the way the recogniser would — so the captured footage matches what a real
   spoken run looks like, and the difference is documented in the file header.

**Done when:** `node scripts/demo/capture.mjs <url> "<instruction>"` produces an
mp4 and a `beats.json`, with the approval gate clicked rather than skipped.

---

## Task E — Nothing. Reserved.

Kept empty deliberately: `apps/web/app/routes/galleries.$galleryId.search.tsx`
and `apps/web/app/lib/webmcp/tools.ts` are **not** owned by any parallel task.
They were both changed in the last hour (agent board takeover, `set_view`), and
two agents editing a 5,000-line route is how this breaks. Any change there comes
back to the coordinator.

---

## What is already done, so nobody redoes it

| | |
| --- | --- |
| `set_view` (17th tool) | agent picks masonry / salon / atlas / table |
| Agent board owns the canvas | `set_results` takes over `/nga/search`, with the note rendered across the page |
| In-page agent + mic | `/try` and `/nga/search`; loop server-side, tools client-side |
| Read-aloud | `SpeakButton`, `speechSynthesis`, no agent needed |
| Motif suggestions | fixed — reasoning tokens were eating the whole budget |
| `/try` adoption poller | fixed — was frozen at "queued 0%" |
| Suggestions all return results | verified, six of six |

## Verified numbers, for anyone writing copy

| Claim | Value |
| --- | --- |
| Tools on `document.modelContext` | **17** |
| NGA open-access corpus | **63,253** works |
| Demo zip | 100 works, CC0 |
| Searchable after | ~10s, at 1 image of 100 |
| Full index | ~5.5 min |
| `describe_artwork` | ~4.5s, `gpt-5.6-luna` |
