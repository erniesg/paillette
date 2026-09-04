# Review lane — report

Branch `night/review`, cut from `deploy-nga-open-access` @ `44b2c7d`.

**Read this before writing anything public.** Every "true" below was measured on
a running browser, not inferred from code. Everything else is marked unverified
or broken, and the submission must not claim it.

---

## 1. What shipped

### 1.1 `?webmcp-debug` now actually drives the page (`928b5dc`)

Two ordering bugs, both of which made the debug flag register all 17 tools and
then present nothing an agent or a script could drive.

**The mount-order race.** `WebMcpBridge` installed the stub host inside its own
effect. `root.tsx` renders it *after* `<Outlet />`, so React ran the route
subtree's effects first. `AgentPrompt` decides whether to render by reading
`document.modelContext` once on mount, found nothing, and latched off for the
life of the page. Net effect: **the in-page agent never rendered under
`?webmcp-debug` on any build** — local, staging, or production. Installing the
harness at module evaluation removes the race for every consumer at once, and it
is still gated on the query parameter, so a normal visit is untouched.

**The remount teardown race**, which only surfaced once the host survived a
remount. The per-name queue that exists to stop `registerTool` and
`unregisterTool` racing lived on the registry *entry*, and the entry is deleted
the moment its last owner releases it. A remount therefore started a fresh queue
with no ordering against the teardown still in flight: the host rejected the
re-registration as a duplicate, the late unregister landed, and the surface came
back empty — 17 `already registered` warnings and `getTools()` returning nothing.
Keying the queue by name, outside the entry, serialises them.

Measured in a headless browser before and after, same URL, same build:

| | before | after |
| --- | --- | --- |
| `document.modelContext` present | yes | yes |
| tools via `__paillette_webmcp.tools()` | **0** | **17** |
| `input[aria-label="Ask the agent"]` | **0** | **1** |

Files: `debug-harness.ts`, `registry.ts`, `webmcp-bridge.tsx`. No lane's files
touched — checked with `git log` across `night/shared-state` and
`night/voice-loop`; zero overlap.

### 1.2 `scripts/demo/verify-demo-path.mjs` (`31e56b9`)

A headless check of the demo path against §9. Prints a `PASS`/`FAIL`/`skip` line
per clause, writes `verify.json`, exits non-zero on any failure. Skips carry the
reason and are never counted as passes.

It enforces the two mid-run constraints mechanically:

- **Text first.** `SpeechRecognition` and `webkitSpeechRecognition` are deleted
  from the window before the page loads. Every check runs against a page with no
  recogniser in it. Anything that quietly needs a microphone fails here.
- **No LLM in the deterministic loop.** Requests to `/api/public-agent/turn` are
  counted, so "redeal with no model call" is a number, not a claim.

Playwright is resolved from `apps/web`, where `@playwright/test` is already a
devDependency. No hardcoded paths.

### 1.3 Review of PR #71 (`ae78ce3`)

Posted as comments-only on `erniesg/paillette#71`. Full findings in
`docs/night/review-pr71-report.md`. Recommendation: cherry-pick `71d8acef`,
split out `643ef43a` and fix three bugs in it, close `c3ba2ad8`.

---

## 2. What is demonstrably true

Measured on the **integrated** build — `night/review` + `night/shared-state` +
`night/voice-loop` merged into a scratch branch, both merges clean, running on a
local dev server. Three consecutive runs, identical results, no flakiness.

```
PASS  host.installs               document.modelContext present, stubbed=true
PASS  tools.register              21 tools, stable
PASS  tools.noDuplicates          every name unique
PASS  agent.rendersHeadless       agent input present under ?webmcp-debug
PASS  agent.noMicWithoutSpeech    no mic, input still there
PASS  context.readable            keys: ok, page, humanSearch, humanResults, agentResults, openArtwork
PASS  context.reportsFlags        `flags` present
PASS  flags.rejectsStaleId        ARTWORK_NOT_IN_SESSION
PASS  resilience.unknownId        ARTWORK_NOT_IN_SESSION
PASS  resilience.badArgs          rejected without throwing internals
PASS  agent.typedTriggerFires     3 turn(s) from typed input
PASS  agent.toolsExecuteFromTypedTurn  2 tool call(s) attributable to the typed turn
skip  flags.roundTrip             no artwork loaded into this session (search needs credentials here)
PASS  redeal.noModelCall          0 model calls (redeal ran)
PASS  panel.rendersActivity       panel present once something happened

14 pass · 0 fail · 1 skip
```

The four statements the submission may make on this evidence, and no more:

1. **21 tools register on `document.modelContext`**, all names unique, on the
   integrated build. (17 on `deploy-nga-open-access` today.)
2. **The agentic loop fires from a typed instruction with no speech recognition
   present in the page at all.** The recogniser was deleted before load; typing
   *"something warm for above the sofa"* and pressing Enter produced 2–3 model
   turns and executed tools. Voice is an accelerant here, not a dependency —
   that is measured, not asserted.
3. **`redeal` runs with zero calls to the model endpoint.** This is §9's one
   "Demonstrate this" clause and it is the strongest WebMCP argument in the
   build: the loop has a deterministic operator, and the agent is a second
   operator of the same mechanism rather than the mechanism itself.
4. **Stale and malformed ids are refused readably.** Every probe came back as a
   coded error with a human-readable message and an actionable hint —
   `ARTWORK_NOT_IN_SESSION` ("None of those ids have been loaded by this page"),
   `NO_EXEMPLARS` ("Nothing has been picked yet, so there is no direction to
   deal in"). No stack traces, no `[object Object]`, no silent no-ops, page alive
   throughout. Checked against `flag_artworks`, `show_artwork`,
   `compare_artworks`, `search_artworks` and `redeal`.

---

## 3. What is built but unverified, and why

- **`search_by_exemplars` end to end.** Returns `UNAUTHORIZED` on a local dev
  server, which has no search credential. The tool registers and refuses
  cleanly; whether the Rocchio scoring returns sensible works is **not**
  verified by me. Needs a run against an environment with credentials.
- **`flags.roundTrip`** — writing a flag and reading it back out of
  `get_view_context` — skips locally for the same reason: no search means no
  artwork is loaded into the session, and flagging an unloaded id is correctly
  refused. The refusal path *is* verified; the success path is not.
- **The §9 keyboard clause** (`P`/`X`/`U`/`C` and Enter on the grid). Not
  checked. `board-keyboard.ts` exists on `night/shared-state` but I did not
  verify it is wired to a focused card in the DOM.
- **§9's redeal-note clause** — that after two `X` presses the agent's note
  refers to the *content* of what was rejected, on three runs by hand. Not done.
  It needs credentials and a human reading three notes.
- **Two colours of ink in every state.** Not checked; the visuals lane had
  nothing pushed when I ran.
- **Real speech recognition.** Untested and untestable here — headless Chromium
  has no microphone. A spoken take must be filmed on a real machine. This is the
  premise of the capture harness and I have no reason to doubt it.

---

## 4. What is broken

### 4.1 `deploy-nga-open-access` does not typecheck — needs a human, one line

```
app/components/webmcp/agent-activity-panel.tsx(153,9): error TS6133:
  'runningEntry' is declared but its value is never read.
```

Present on `origin/deploy-nga-open-access` @ `44b2c7d`, introduced by `fab3ccb9`,
which swept in the computation of `runningEntry` without the code that consumes
it. **Not a regression from my branch** — reproduced on the base branch with my
work absent.

I have not fixed it: the brief reserves that file for a human editing it locally.
Either delete the unused binding, or merge PR #71's `c3ba2ad8`, which is the
commit that consumes it. Until then `pnpm --filter web typecheck` fails for every
lane.

### 4.2 Staging is behind and cannot be driven

Verifier against `https://paillette-stg.berlayar.ai/nga/search`: **7 pass, 3
fail, 5 skip.** The three failures are all the same cause — no
`input[aria-label="Ask the agent"]`, so no typed turn can be sent. Deploying
§1.1 fixes it; nothing else will, and in particular deploying the in-page-agent
commits alone would **not** have.

### 4.3 `pnpm --filter web typecheck` and `test` need a build first

On a clean checkout both fail on `worker.ts(2,24): Cannot find module
'./build/server/index.js'` — `worker.ts` imports the Remix server build. Run
`pnpm --filter web build` first. Worth adding to the ground rules; it costs every
new agent one false failure.

---

## 5. Checks, exactly

On `night/review` @ `31e56b9`, after `pnpm --filter web build`:

```
$ pnpm --filter web typecheck
app/components/webmcp/agent-activity-panel.tsx(153,9): error TS6133: 'runningEntry' is declared but its value is never read.
```
One error, pre-existing on the base branch, in a file I am not permitted to edit.
See §4.1.

```
$ pnpm --filter web test
 Test Files  60 passed (60)
      Tests  613 passed (613)
```
Baseline was 59 / 593. I added one file and 20 tests: 17 for `debug-harness.ts`,
which had none, and 3 remount regression tests that **fail without** the registry
change (verified by reverting it — 3 failed / 17 passed).

```
$ pnpm exec eslint <my five changed files>
eslint exit=0
```

`pnpm --filter api test` not run — I did not touch the API.

---

## 6. Audit against the two mid-run constraints

**Text first.** My lane produces no UI, so nothing of mine assumed speech. More
usefully, the constraint is now enforced for everyone: `verify-demo-path.mjs`
deletes the recogniser before load, and the full typed loop passes without it.
The `agent.noMicWithoutSpeech` check also confirms the mic button correctly does
not render when no recogniser exists, and the input remains.

**Cut the words.** My only user-visible surface is the verifier's stdout. Audited
and tightened: one line per check, `PASS`/`FAIL`/`skip` + id + a short detail;
details are error *codes* rather than pasted JSON. No preamble, no legend, no
explanation of what a check means — the id says it. One summary line at the end.

Two observations for the lanes that do own UI, from the same discipline:

- The activity panel's `hint` strings inside `get_view_context` are prose aimed
  at the model, not the screen — correct place for words. But the panel's own
  header currently narrates state ("step N of M") where a position or a mark
  would do. §7.4 replaces it with the ledger filmstrip; that is the fix.
- Every error message I probed reads as one sentence plus one hint. That is the
  right shape and matches a wall label's discipline. Keep it.

---

## 7. What I cut

- **Did not fix `agent-activity-panel.tsx`**, despite it breaking typecheck for
  every lane. The brief reserves it. Reported instead, with the one-line fix.
- **Did not land a corrected `capture.mjs`.** PR #71 has one with three bugs I
  documented; duplicating it on my branch would force the owner to reconcile two
  versions. The verifier is a different tool with a different job.
- **Did not merge or push anything to `deploy-nga-open-access`**, and did not
  push to `webmcp/voice-activity-capture`. The scratch integration branch used
  to test the lanes together is local only and is not for merging.

---

## 8. For the owner, in thirty seconds

Two ordering bugs meant `?webmcp-debug` registered every tool and then showed
nothing you could drive — which is why nobody could film the agent headlessly and
why PR #71 concluded, wrongly, that staging being behind was the problem. Both
are fixed and verified in a browser: 0 → 17 tools, no agent input → one. On the
lanes merged together, 14 of 15 §9 checks pass on three consecutive runs,
including the one that matters most — **redeal runs with zero model calls** — and
the whole agentic loop fires from typing with speech recognition deleted from the
page. One thing needs you personally: `deploy-nga-open-access` does not typecheck
because `fab3ccb9` left `runningEntry` unused in the panel file reserved for you.
One line, and it unblocks every lane.
