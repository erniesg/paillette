# Agent-turn latency: measured, not yet cut

Issue #79 (spec `docs/issues/076-measure-and-cut-agent-turn-latency.md`).
Branch `nga/latency`, staging web `420c476b`, api `429de2c1`, 2026-09-24.

## Where this stands

**The instrumentation is done and deployed. The twenty timed turns and the cuts
are not, because staging has no model to time.** OpenAI refuses the key staging
uses with HTTP 429 `credit_balance_exhausted`: the account has no credit left.
Every agent turn and every `write_labels` call on staging fails until the owner
tops it up. I found this on the first timed turn, and nothing in this report
comes from a model call that succeeded.

The code, read from `wrangler tail --env staging` at 14:22 UTC:

```
POST https://paillette-api-stg.berlayar.ai/api/public-agent/turn - Ok
  (warn) openai: 429 (credit_balance_exhausted)
  (log) --> POST /api/public-agent/turn 429 2s
```

Until then the page told people "The model provider is rate-limiting this site
right now. Try again shortly." That was wrong, because waiting does not fix an
empty account. The route now returns `AGENT_PROVIDER_CREDIT_SPENT` (503) and
says the account needs topping up. I checked it on staging with the curl
command below.

## What every turn now records

| Where | What |
|---|---|
| `apps/api/src/routes/agent.ts` | `data.timing` on every call: `modelMs` (time waiting on OpenAI), `routeMs`, prompt/completion/cached tokens as OpenAI reports them, and the character sizes of the system prompt, gesture sentence, tool schemas and messages. Also a `Server-Timing` header. |
| `apps/web/app/lib/webmcp/turn-timing.ts` | One record per turn: each model call's round trip plus the server's figures, each tool's execution time, the nudges and their keys, Enter→note, Enter→end, and a breakdown into model, tools, nudges and other. The breakdown is computed in one place, so the harness and the console cannot disagree on it. |
| `sessionStorage` `paillette:agent-timing:v1` | Kept beside the flags (`paillette:flags:v1`), newest 60 turns, fail-soft. |
| `__paillette_webmcp.timing()` | Under `?webmcp-debug`: prints a `console.table` of the turns and returns them. `{clear: true}` empties the store after reading. |
| `node docs/night/verify-demo-path.mjs --timing` | Types 10 fresh asks, 5 redeals over one pick and two rejects, and 5 statement corrections, each in a fresh context. Writes the page's own records to `e2e-evidence/latency/<label>.json`. A turn that `write_labels` refused under the hourly cap is kept, marked `discarded`, and rerun after the hour turns over. |

The client half is verified on staging. The one turn I ran,
`e2e-evidence/latency/blocked-smoke.json`, was recorded by the page and read
back through the harness: one model call, 2,949 ms round trip, `outcome:
"error"`, and `server: null` because a 429 carries no timing block. The server
half is covered by tests only. No successful call has returned a timing block
on staging.

## Tests

- API: 47 files, 872 tests pass. New tests: `agent.test.ts` (2) and
  `openai.test.ts` (+3).
- Web: 110 files, 1,440 tests pass (after `pnpm --filter web build`).
  New tests: `turn-timing.test.ts` (7), `agent-prompt.test.tsx` (+2) and
  `debug-harness.test.ts` (+2).
- `tsc --noEmit` is clean for both apps. `eslint` is clean on the changed
  files.
- I made each new check fail first:
  - Removing `timing` from the route response failed both route tests.
  - Removing `saveTurnTiming` from the loop failed both loop tests.
  - Removing the out-of-credit match failed its test.

## Not done, and why

- **The twenty turns, p50/p95 per class, and the time breakdown.** All need
  model calls.
- **The two cuts.** The spec says to make the cuts the numbers justify and
  revert any that do not move them. With no numbers, I made no cuts. I have one
  hypothesis and have not tested it. In `blockers-evidence/census.json`, all
  **9 of 9** typed turns opened with a `get_view_context` round trip before
  doing anything else. If the breakdown confirms that first call is a large
  share of redeal time, the first cut is to send the view with the first request
  (cut (a) applied to the read that actually comes first). The second is (d):
  skip the reply call after a nudge whose post-condition the board already
  meets. Both wait on the baseline.

## Once the account has credit

```bash
# 1. It answers
curl -s -X POST https://paillette-stg.berlayar.ai/api/public-agent/turn \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}],"tools":[{"type":"function","function":{"name":"get_view_context","parameters":{"type":"object","properties":{}}}}]}'
# expect {"success":true,"data":{"message":…,"timing":{"modelMs":…}}}

# 2. Baseline: about 150 model calls, ~100 NGA searches, 10–15 write_labels
CHROME_PATH=~/.cache/ms-playwright/chromium-1228/chrome-linux/chrome \
  node docs/night/verify-demo-path.mjs --timing --label=baseline
node docs/night/latency-runs.mjs --summarise docs/night/e2e-evidence/latency/baseline.json
```

`CHROME_PATH` is needed on this VM because the workspace's Playwright expects
chromium-1194 and only 1228 is installed.
