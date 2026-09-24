# Measure agent-turn latency, then cut it

## Goal

A typed instruction takes 12 to 33 seconds to produce its note and costs four
or five model calls; a redeal note takes 8 to 14 seconds for three (e2e report
iteration 5). Nothing on the agent path measures time: there is no timing in
`apps/api/src/routes/agent.ts`, `utils/openai.ts`, the web proxy or the client
loop in `components/webmcp/agent-prompt.tsx`. Search routes already return
`queryTime`; the agent path returns nothing.

You cannot cut what you do not measure. Instrument first, then make the cuts
the numbers justify.

## Acceptance tests

- Every agent turn returns a `timing` block: model wall time per call, tool
  execution time per tool call (client-side), number of model calls, number of
  nudges, and total wall time from Enter to note. Stored in `sessionStorage`
  with the flags journal and printed by the existing debug harness.
- `docs/night/e2e-evidence/latency/` holds twenty timed turns against staging
  on the NGA collection: ten fresh asks, five redeals with flags, five statement
  corrections, with a p50 and p95 for each class and a breakdown of where the
  time goes (model vs tools vs nudges).
- At least two of these cuts are made and re-measured, whichever the breakdown
  supports: (a) run the first fan-out searches in parallel with the model's
  first reply rather than after it; (b) trim the system prompt and the gesture
  payload to what the run actually needs and measure input tokens before and
  after; (c) stream the note so the human reads while tools finish; (d) skip a
  nudge round when the post-condition is already met on the board.
- Report the p50 before and after for each class. If a cut does not move the
  number, say so and revert it.

## Validation command

```bash
pnpm --filter api test
pnpm --filter web test
node docs/night/verify-demo-path.mjs --timing
```

## Allowed secrets

None new. Uses the existing `OPENAI_API_KEY` on staging.

## Artifact outputs

- PR into `night/integration`.
- `docs/night/latency-report.md` with the numbers and the two runs' raw JSON.

## Stop conditions

Stop before changing the model or provider; that is issue 077. Stop if a cut
would remove a post-condition nudge without measuring what the nudge catches.

## Human clarification protocol

None expected.
