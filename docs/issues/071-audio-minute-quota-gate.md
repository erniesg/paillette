# Audio-minute quota gate, before any live session goes public

## Goal

Meter and cap live-session audio before it is reachable by an unauthenticated
visitor. The existing agent ceiling counts **model calls**; a live session is
billed by **minutes of audio in and out**. Those are different meters, and the
one already in place does not cover the new cost at all.

`AGENT_MODEL_CALLS_PER_HOUR` (default 40, staging 600) bounds
`POST /api/public-agent/turn`. A live session does not go through that route, so
today an open microphone on a public page has no ceiling of any kind. One tab
left open in a noisy room is an unbounded bill, and it looks exactly like normal
use.

## Acceptance tests

- A per-caller audio budget exists, measured in seconds of session time, and is
  enforced server-side when the session token is minted — not in client code.
- A caller who has spent the budget is refused a new token with a readable
  reason, and the page degrades to the typed path rather than presenting a
  broken control.
- An open session is closed server-side when the budget is exhausted mid-call,
  and the human is told once, in one sentence.
- A site-wide daily ceiling exists independently of the per-caller one, so a
  handful of callers cannot exhaust the account between them.
- Both ceilings are configurable per environment the way the model-call ceiling
  is, with the default set for production safety and staging raised for filming.
- Budget state survives a Worker restart (KV or D1, not memory).
- Tests cover: token refused when over budget, session terminated mid-call,
  site-wide ceiling independent of per-caller, and a fresh caller unaffected by
  another caller's spend.

## Design notes

- Mint short-lived session tokens from the Worker. The provider key never
  reaches the browser, and the mint point is the natural place to check budget —
  one gate, not two.
- Meter wall-clock session duration rather than trying to count audio frames;
  it is the thing the provider bills and the thing a human can reason about.
- Push-to-talk bounds cost structurally in a way open-mic does not. If open-mic
  is chosen in 070, this gate carries more weight, not less.
- Record spend as an event the way search quota already is, so the cost of a
  filmed rehearsal is visible afterwards rather than inferred from an invoice.

## Validation command

```bash
pnpm --filter api test
pnpm --filter web typecheck
```

## Allowed secrets

Names only: `OPENAI_API_KEY` or `GEMINI_API_KEY`. Values stay in the configured
secret store. No key, token or session credential may be logged, committed, or
returned to the browser beyond the short-lived session token itself.

## Stop conditions

Stop before enabling any live audio path on a public unauthenticated route while
this gate is unlanded. Stop before implementing the budget check in client code,
where it is advisory rather than enforced.

## Human clarification protocol

Ask for the intended per-caller and daily ceilings before implementing; they are
a spending decision, not an engineering one. Provide a cost estimate at the
chosen provider's current per-minute rate, verified against that provider's
documentation at build time, so the numbers are a decision rather than a guess.
