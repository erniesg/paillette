# Review — PR #71 `webmcp/voice-activity-capture`

Reviewed 2026-09-03 against `origin/deploy-nga-open-access` @ `44b2c7d`.
Three commits, 474 insertions / 61 deletions, 4 files.

## Thirty-second recommendation

**Cherry-pick `71d8acef` onto the base branch today — it fixes a real eslint
error that is on `deploy-nga-open-access` right now. Split `643ef43a` (the
capture harness) into its own PR and merge it after three fixes. Close
`c3ba2ad8` unmerged.** The harness is the valuable thing here and it does work
end to end — I drove a full six-tool agent chain with it and got video, six
screenshots and a `beats.json` — but it is currently unrunnable on any machine
that is not the author's Mac (hardcoded `/Users/erniesg/...` playwright path),
and its `--speak` mode silently sends the agent only the last third of the
instruction. The panel commit rewrites 164 lines of the one file the overnight
brief says nobody may touch, to polish a component the brief schedules for
removal (§7.4, triage item 9). Separately, and more important than anything in
this PR: **the in-page agent never renders under `?webmcp-debug` at all** — a
mount-order race in `agent-prompt.tsx`, already on the base branch — so the PR's
stated reason the harness could not be tested ("staging is 7 commits behind") is
wrong, and redeploying staging will not fix it.

---

## 1. Exact check output

All checks run on `643ef43a`, Linux arm64, Node v22.22.3, pnpm workspace.

### `pnpm --filter web typecheck`

First run, on a clean checkout:

```
> @paillette/web@0.1.0 typecheck /home/ubuntu/paillette-night/review/apps/web
> tsc --noEmit

worker.ts(2,24): error TS2307: Cannot find module './build/server/index.js' or its corresponding type declarations.
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @paillette/web@0.1.0 typecheck: `tsc --noEmit`
Exit status 2
```

This is environmental, not the PR: `worker.ts` imports the Remix server build.
After `pnpm --filter web build`:

```
> @paillette/web@0.1.0 typecheck /home/ubuntu/paillette-night/review/apps/web
> tsc --noEmit
```

Clean, exit 0.

### `pnpm --filter web test`

Before building, one suite fails to collect for the same reason:

```
 FAIL  __tests__/worker-cache-control.test.ts [ __tests__/worker-cache-control.test.ts ]
Error: Failed to resolve import "./build/server/index.js" from "worker.ts". Does the file exist?

 Test Files  1 failed | 58 passed (59)
      Tests  591 passed (591)
```

After `pnpm --filter web build`:

```
 Test Files  59 passed (59)
      Tests  593 passed (593)
   Duration  46.90s
```

**The claimed 59 files / 593 tests baseline holds — but only if `pnpm --filter
web build` is run first.** Worth adding to the ground rules; a reviewer on a
fresh clone will otherwise report a false failure, as I did on the first pass.

### eslint

```
$ cd apps/web && pnpm exec eslint app/components/webmcp/agent-activity-panel.tsx app/components/webmcp/__tests__/agent-prompt.test.tsx
eslint exit=0
```

Clean. And the fix is load-bearing — the version of that test file currently on
`origin/deploy-nga-open-access` fails:

```
apps/web/app/components/webmcp/__tests__/agent-prompt.test.tsx
  31:5  error  Unexpected aliasing of 'this' to local variable  @typescript-eslint/no-this-alias
✖ 1 problem (1 error, 0 warnings)
```

### `node --check scripts/demo/capture.mjs`

```
node --check exit=0
```

### `node scripts/demo/capture.mjs` (no args)

The PR says this "should print usage, exit 1". It does not:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/erniesg/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs'
    imported from /home/ubuntu/paillette-night/review/scripts/demo/capture.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    ...
exit=1
```

`await import(PLAYWRIGHT_CORE)` is a top-level await, evaluated before `main()`
and outside its `.catch()`, so argument parsing is never reached. With
`PLAYWRIGHT_CORE` set correctly it behaves as claimed:

```
$ PLAYWRIGHT_CORE=.../playwright-core@1.56.1/.../index.mjs node scripts/demo/capture.mjs
usage: node scripts/demo/capture.mjs [--speak] <url> "<instruction>"
EXIT=1
```

## 2. Verifying the `fab3ccb9` sweep claim

**The claim is correct.** `git show --stat fab3ccb9` lists
`agent-prompt.test.tsx` (+173), `agent-activity-panel.tsx` (+52) and
`agent-prompt.tsx` (+71) alongside the registry work. Content check confirms the
specific items the PR lists as already landed: `interimResults = true`,
`continuous = false`, the interim/final split in `onresult`,
`voiceErrorMessage()` with the `not-allowed` / `no-speech` cases, the
amber/violet/green constants, `Pill`'s `pulse` prop, `currentBurst`,
`BURST_GAP_MS` and the `stepByEntryId` / `runningEntry` computation. The PR is
neither incomplete nor duplicating.

One thing the author could not have known and the coordinator should: `fab3ccb9`'s
commit message describes only the `callTool`/host-transport change. Half of what
it actually contains — all the speech work — is undocumented in its own message.
Anyone reading the log will not find where the voice feature landed.

## 3. The finding that matters most: the agent input never appears

The PR's known-gap section says the harness cannot be tested because staging is
7 commits behind and "the deployed build may predate the in-page agent". I
reproduced the failure against staging:

```
$ node scripts/demo/capture.mjs "https://paillette-stg.berlayar.ai/nga/search" "..."
[capture] opening https://paillette-stg.berlayar.ai/nga/search?webmcp-debug=
[capture] The page registered its tools but never showed the in-page agent input
          (input[aria-label="Ask the agent"]). The deployed build may predate the in-page agent.
```

Then I ran it against a **local dev server on this branch**, which unambiguously
contains `AgentPrompt`, and got the identical failure. So the diagnosis is wrong.

The cause is a mount-order race in `agent-prompt.tsx` (already on the base
branch via `fab3ccb9`):

```tsx
useEffect(() => {
  setAvailable(Boolean(getModelContext()));
}, []);
...
if (!available) return null;
```

`root.tsx` renders `<Outlet />` at line 126 and `<WebMcpBridge />` at line 130.
The bridge installs the `?webmcp-debug` stub host inside *its* effect, which
React fires after the route subtree's effects. `AgentPrompt` therefore checks
`document.modelContext` before it exists, latches `available = false`, and never
re-checks. Empirically:

```
# ?webmcp-debug, host installed in the bridge's effect:
after hard load: modelContext= true agentInput= 0

# host pre-installed via addInitScript, i.e. a real WebMCP browser:
modelContext= true
agentInput= 1
```

So the in-page agent renders in Chrome-with-the-flag and never renders under
`?webmcp-debug`. Consequences:

- Deploying the in-page-agent commits to staging will **not** make the harness
  work. That should be corrected before anyone spends a deploy on it.
- The harness's error message is confidently wrong and will send the next person
  down the same dead end.
- The fix is small and belongs on the base branch, not in this PR: re-check on a
  short interval, or subscribe to the bridge's `setBridgeAttached` store update.

With that race patched locally (throwaway patch, reverted; not committed
anywhere) the harness works end to end:

```
[capture] final panel: ... step 6 search_by_color ok 35ms ... step 1 list_collections ok 9ms
[capture] mp4   -> scripts/demo/captures/20260903-194850/capture.mp4
[capture] beats -> scripts/demo/captures/20260903-194850/beats.json
```

Output: `capture.mp4` (550 KB), `capture.webm`, `beats.json`, and
`steps/step-1..6.png` + `final.png`. `beats.json`:

```
mode type durationMs 22942
toolsFired ['list_collections', 'get_search_quota', 'search_by_color',
            'search_artworks', 'search_artworks', 'search_by_color']
   1587  +0      type
   6042  +4455   tool  list_collections  ok
   8351  +2309   tool  get_search_quota  ok
  13030  +4679   tool  search_by_color   ok
  13535  +505    tool  search_artworks   ok
  13957  +422    tool  search_artworks   ok
  14446  +489    tool  search_by_color   ok
```

(The searches returned `UNAUTHORIZED` because the local dev server has no search
credential. That does not affect the harness; the agent loop, the tool
dispatch, the panel, the video and the beats file all worked.)

**So: the harness genuinely works, not just parses.** That is the answer to the
most valuable open question in the PR.

## 4. The four questions

### Q1 — is the 10 s `BURST_GAP_MS` sound? Can a slow reasoning step split one operation?

**No, it cannot — the author is worried about the wrong direction.** The gap the
heuristic measures is `newer.startedAt - older.endedAt`, and the tool's own
duration is excluded by construction (`webmcp-bridge.tsx` calls `startActivity`
before `execute` and `settleActivity` after). So the gap is purely the model
round trip. Measured, on a real chain: **4455 ms, 2309 ms, 4679 ms, 505 ms,
422 ms, 489 ms.** Worst case less than half the threshold.

It cannot get much worse, because `apps/api/src/routes/agent.ts:153` sets
`reasoningEffort: 'none'` on `gpt-5.6-terra` with `maxTokens: 1200`. There is no
slow reasoning step to split anything. **That coupling is the actual load-bearing
assumption and the comment above `BURST_GAP_MS` does not mention it** — if anyone
later raises `reasoning_effort` to fix a quality problem, the step counter breaks
silently on camera. One sentence in the comment fixes that.

The failure I would actually worry about is the opposite one and the PR does not
consider it: **two human turns merging into one burst.** The refinement loop
("something calm", then "warmer") is the beat the demo wants, and if the operator
starts the second request within 10 s of the first chain's last tool settling —
easy on a rehearsed take — both turns become one burst and the panel says
"step 9 of 9" across two distinct requests. Given the measured 2–5 s gaps, a
crisp operator will land inside 10 s more often than not.

And the deeper point: the app *knows* where turns begin. `AgentPrompt` pushes a
`{ kind: 'you' }` entry on every submit. Deriving turn boundaries from tool-call
timing is inferring something already available. If the panel survives at all,
reset the burst on submit and delete the heuristic.

Also note `entry.endedAt !== null` short-circuits the gap check, so a still-running
entry never terminates a burst. Harmless today; not obviously intended.

### Q2 — does the running entry read as *active* on a dark background at video bitrates?

**Yes — but only two of the four cues do any work.** I rendered the running state
at 1440×900 @1x, encoded it through H.264 at 2500 kbps (`libx264 -preset
veryfast`, yuv420p), decoded a frame back and sampled pixels:

| pair | contrast after encode |
| --- | --- |
| running border vs completed border | **3.14 : 1** |
| running border vs its own fill | 3.89 : 1 |
| running fill vs completed fill | **1.06 : 1** |
| completed border vs completed fill | 1.32 : 1 |
| glow pixel vs panel background | **1.03 : 1** (Δrgb 7, 1, 15) |

The violet border survives the encode intact — it decoded as `rgb(153, 96, 211)`
against a completed card's `rgb(44, 48, 53)`. Together with the violet `RUNNING`
pill text and the `step N` badge switching from muted to violet, the running row
is unmistakable. Verified visually on the decoded frame; it reads at a glance.

The other two cues are dead weight:

- `background: rgba(168,85,247,0.14)` decodes to a 1.06 : 1 difference from the
  completed card. It is below the threshold of noticing, and it is the element
  most likely to be smeared by rate control under motion.
- `boxShadow: 0 0 22px rgba(168,85,247,0.22)` decodes to a 7-level red / 15-level
  blue delta. It is not visible, on this encode or on a consumer display.

If this component survives, keep the border and the pulsing dot, drop the glow,
and either raise the fill alpha to something measurable or remove it.

One defect: **the pulse has no `prefers-reduced-motion` guard.** The `@keyframes
webmcpPulse` block runs unconditionally. The brief requires every animation to
survive that media query.

### Q3 — are the `not-allowed` / `no-speech` messages the right length and tone?

The copy itself is fine. "Microphone access was denied. Allow it in your browser,
then try again." is two clauses and reads cleanly; "No speech was heard. Try
again." is short enough not to hold a frame. Neither is jargon, neither blames
the user, neither is cute. No change needed to the words.

The *behaviour* around them is wrong for an on-camera moment, and it is a
base-branch problem rather than this PR's:

1. **The errors are permanent.** `onerror` appends `{ kind: 'error' }` to
   `entries`, and nothing ever removes it. Every subsequent turn renders below a
   red `role="alert"` line that is no longer true. One stray `no-speech` — which
   Chrome raises on a few seconds of silence — poisons the rest of the take.
   Clear voice errors on the next successful `onresult` or on the next submit.
2. **The default branch fires on deliberate stops.** Clicking the mic button to
   stop can surface `aborted`, which falls to `'Voice input stopped. Try
   again.'` — telling someone who chose to stop that they should try again.
   Return `null` for `aborted` and render nothing.

### Q4 — the machine-local `playwright-core` path, and is `--speak` faithful?

**The playwright path is not acceptable as written.** `PLAYWRIGHT_CORE ??
'/Users/erniesg/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs'`
is not merely machine-local, it is *user*-local and cache-hash-local — it will
not resolve on a second Mac, let alone this Linux VM, and because the import is a
bare top-level `await import` the failure is an unhandled ESM stack trace rather
than the readable message the rest of the file is careful about. The override
env var is the right escape hatch; the default is wrong. Either resolve it with
`createRequire(import.meta.url).resolve('playwright-core')` and fall back to the
env var, or make the default `'playwright-core'` and let Node's resolver find
the workspace copy — `playwright-core@1.56.1` is already in this repo's pnpm
store. The current form guarantees the next person's first run fails
incomprehensibly.

**`--speak` is not a faithful reproduction — it is broken.** It chunks the
instruction into thirds and `setInput`s each chunk *replacing* the last, then
presses Enter. But the form's `onSubmit` reads `input.trim()`, so the agent
receives only the final chunk. Demonstrated:

```
chunks the harness sends:      ["I want something to hang above",
                                "the sofa in my living room.",
                                "Warm, not busy, nothing grim."]
input value just before Enter: "Warm, not busy, nothing grim."
what the agent actually received: ["YOU  Warm, not busy, nothing grim."]
```

Three distinct problems in that one behaviour:

- The agent is driven by a third of the instruction. The best demo prompt in the
  handoff becomes "Warm, not busy, nothing grim." — no sofa, no room, no wall.
- `beats.json` records `transcript: <the full instruction>`. The artifact states
  something that did not happen, which is exactly what §10 of the brief forbids.
- It does not match the recogniser anyway. `agent-prompt.tsx` concatenates
  `event.results`, so real interim text arrives as growing prefixes ("I want
  something to hang above" → "…the sofa in my living room." → the whole
  sentence), not as disjoint fragments. And the real final path calls
  `setInput(''); void run(settled)` directly, bypassing the form.

The fix is one line — accumulate the chunks rather than replace them — after
which pressing Enter *is* equivalent to the recogniser's final path, because
`run()` is what both reach. Worth doing; it is a genuinely useful mode.

Two further fidelity gaps in `--speak`: it never sets `listening`, so the
"● listening" indicator the voice work exists to make filmable is absent from
the footage; and the file header's note that headless Chromium cannot do real
speech recognition is clear and correct, but should also say that `--speak`
reproduces the *text* path only and shows no listening state.

**One more fragility in the harness, unrelated to `--speak`:** `readEntries()`
derives status from `li.textContent.includes('running')`. The `li` contains the
tool's serialised input, so a query like `"figures running"` or a summary
containing the word "error" is misread. A misread `running` never clears, the
quiet-detection never fires, and the run spins to the 180 s deadline. Read the
Pill's own text node, or read the store.

## 5. Verdict per commit

### `71d8acef` — test lint fix → **cherry-pick onto `deploy-nga-open-access` now**

23 lines, correct (a constructor that returns an object hands that object back
from `new`), behaviour-preserving, and it fixes an eslint error that is on the
base branch *today*. Free. Take it independently of everything else in this PR.

### `643ef43a` — `scripts/demo/capture.mjs` → **split into its own PR, merge after three fixes**

This is the valuable part of #71 and it deserves to be judged on its own. It
works: I got a video, six step screenshots, a well-shaped `beats.json` and a
correct ffmpeg remux out of a real six-tool agent chain. The structure is sound —
quiet-detection with a deadline, an approval-gate click in the poll loop, failure
messages at each precondition, no new workspace dependencies, output gitignored.

Blocking:

1. Resolve `playwright-core` properly; the hardcoded `/Users/erniesg/...` default
   makes the script unrunnable for anyone else and fails outside the error
   handler.
2. Accumulate the `--speak` chunks, and stop recording a `transcript` in
   `beats.json` that the page did not receive.
3. Parse status from the Pill rather than `textContent.includes`.

Non-blocking: `recordVideo` ignores `deviceScaleFactor`, so "1440×900 @2x video"
in the header is true of the screenshots and not the video; and the panel's
injected `@keyframes` block lands in the `[capture] final panel:` log because
that log reads `aside.textContent`.

### `c3ba2ad8` — activity panel visual state → **close it; do not merge, do not rebase**

Three reasons, in descending order of force.

1. **It edits the one file the brief puts off limits.** §0: "Nobody touches
   `apps/web/app/components/webmcp/agent-activity-panel.tsx` — a human is editing
   it locally and it will conflict." This commit is a 164-line rewrite of exactly
   that file, including a restructure of the whole `activity.map()` body. It is
   the guaranteed-conflict case, not a marginal one.
2. **The component is scheduled for removal.** §7.4: the ledger filmstrip
   replaces the chat. Triage item 9 goes further — if the filmstrip will not
   land, *hide the activity panel entirely rather than show a chat*. Both branches
   of that decision end with this panel off screen. Neither ends with a nicer
   step counter on it.
3. **The step badge duplicates what replaces it.** "step 3 of 6" is a text
   rendering of progress through an operation; the filmstrip renders the same
   thing as pictures, one frame per turn, which is the whole reason the owner
   wants it. Shipping both is shipping the lame version next to the good one.

Merging it costs a conflict with a human's in-flight work to improve a component
that two separate sections of the brief say is going away. The author could not
have known that, and the work itself is competent — the running border measures
3.14 : 1 through an H.264 encode, which is a real result. Carry that number
forward into the filmstrip's provenance ink and let the commit go.

## 6. On the PR's own last question

> The pinned note (`agentResults.note`) already renders above the thumbnails and
> above the tool log — Task B's requirement 3 needed no change — please confirm.

Confirmed, but the point is moot: per §7.4 that note becomes the wall label above
the board, not a line inside the panel.

## 7. What I did not do

- Did not approve, merge, push to `webmcp/voice-activity-capture`, or deploy
  anything. Comments-only review posted to PR #71.
- Did not test real speech recognition; headless Chromium cannot, which is the
  premise of the harness and I have no reason to doubt it. The `no-speech`
  frequency claim in Q3 is reasoning from Chrome's documented behaviour, not
  something I measured here.
- Did not verify the search results themselves — the local dev server has no
  search credential, so every search tool returned `UNAUTHORIZED`. That is
  orthogonal to everything under review.
- Installed `chromium-headless-shell` into `~/.cache/ms-playwright` on this VM to
  run the harness. Nothing was added to the repo.
