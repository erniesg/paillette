# Jev spike: sub-second provisional marks and a brief-aware rerank

depends-on: 076

## Goal

Every judgment the agent makes today goes through `gpt-5.6-terra` chat
completions, including the parts that are not writing: deciding which of twelve
works fit the brief, which to reject and why, which region a work belongs in,
whether an ask wants rooms (`asksForRooms` is currently a regex). TypeSafe's
System One model, Jev, returns typed answers and calibrated probabilities over
text state in about 100 ms per request, with all questions in one request
evaluated in parallel. It does not generate text, so it cannot write a note, a
title, a statement or a label. It can decide.

The hypothesis to test: the human presses `P` or `X`, and within half a second
the agent's provisional marks and reasons-by-axis appear on the board, before
the writing model has even been called; and the exemplar shortlist from
`redeal` is reranked against the statement text, not only against vectors.

Facts to build on (checked 2026-09-24 against docs.typesafe.ai): endpoint
`POST /v1/systemone`, bearer key, `state` + `questions` (Choice / Score / Noul),
64k tokens per request, 32k for state, price $0.042 per million input tokens
with output free, 1,200 requests per minute, text only. SDK `@typesafe-ai/sdk`
0.6.0, Node 20+, fetch-based; Cloudflare Workers support is not stated by the
vendor, so verify it in a Worker first.

## Acceptance tests

- A Worker route `POST /api/public-judge` that takes the twelve board works
  (title, artist, medium, date, stored description) plus the human's statement
  and their picks and rejects, and asks in one request: per work, a Noul "fits
  the show as stated" and a Choice over the agent's axis vocabulary (palette,
  medium, subject, period, none); plus one Noul "the ask wants the show divided
  into rooms". Returns probabilities, never prose.
- The board renders these as provisional marks in the agent's ink within 500 ms
  p50 of the keypress on staging, measured with the timing block from 076.
  Marks below a stated threshold are not drawn; the threshold and its
  calibration on twenty hand-labelled boards are in the report.
- `redeal` optionally reranks its exemplar shortlist with one Noul per candidate
  against the statement; A/B on the claims-lane harness (`agent-marks.mjs` and
  the statement-correction runs): does the human accept more agent marks, and
  does the redeal note name the right axis more often? Report both numbers,
  before and after, with run counts.
- The Jev path fails open: no key, 429, or timeout leaves the board exactly as
  today. The writing model still writes every note, label and statement.
- Cost per full curation session is computed from `usage` and reported next to
  the OpenAI count for the same session.
- Flag-gated (`JUDGE_PROVIDER=typesafe`), off by default until the numbers say
  otherwise.

## Validation command

```bash
pnpm --filter api test
pnpm --filter web test
(cd apps/api && npx wrangler deploy --env staging)
node docs/night/verify-demo-path.mjs --timing --judge
```

## Allowed secrets

`TYPESAFE_API_KEY` on the staging Worker only, set by the owner with
`wrangler secret put TYPESAFE_API_KEY --env staging`. Never in the browser,
never in the repo. Until it is present the issue is `rucksack-needs-human`.

## Artifact outputs

- PR into `night/integration`.
- `docs/night/jev-report.md`: latency p50/p95, calibration on the twenty boards,
  A/B numbers, cost per session, and a plain verdict on whether to keep it.

## Stop conditions

Stop before letting Jev write anything the human reads as prose. Stop before
turning it on by default. Stop if the Worker cannot reach the API after one
honest attempt at `nodejs_compat`; report that instead of polyfilling.

## Human clarification protocol

The owner provisions the key; the exact command is above. Nothing else needs a
decision.
