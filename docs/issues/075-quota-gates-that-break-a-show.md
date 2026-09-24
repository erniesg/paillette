# Quota gates that break a show: rolling windows, honest state, and never a blank wall

## Goal

Three server-side caps were sized for a submission demo and now break the
end-to-end flow:

- `write_labels` is capped at 10 calls per client per fixed clock hour
  (`MAX_LABEL_CALLS_PER_CLIENT_PER_HOUR` in `apps/api/src/routes/labels.ts`).
  That is about two statement-correction runs; the third publishes a show with
  blank walls (claims report §6, `/e/kaxeFU4`).
- The NGA public-search quota is a lifetime counter with a 1000 cap. It hit
  1000/1000 mid-run on staging and had to be reset by hand, and cached answers
  still count (merge report §4, §6.1).
- Agent model calls default to 40 per client per hour and 500 per site per day
  (`agent.ts`, `openai.ts`); staging overrides them to 600 and 5000 in
  `wrangler.toml`, production sets neither.

The caps themselves are right to have. The shapes are wrong.

## Acceptance tests

- Label calls use a rolling 60-minute window keyed by client, with the limit an
  env var (`LABEL_CALLS_PER_HOUR`) that staging sets high enough for a full
  correction session (state the number you chose and why).
- The NGA search quota is per client per rolling day, not lifetime per
  deployment, and a cache hit does not decrement it. The existing D1 quota
  tables (migrations 0018, 0020) are extended or replaced with a migration;
  say which and why.
- When any cap is spent, the page shows one terse state on the activity glyph
  and the agent's note says what was not done. A show is never published with
  unlabelled works silently: the copy-link flow lists the works without labels
  and offers to wait or publish anyway.
- `/api/public-usage/nga` returns the four remaining budgets for the caller
  (labels, agent calls, search, daily site) with the same shape the page reads.
- Tests: a fixed-hour boundary no longer resets the label window; a cache hit
  leaves the search quota unchanged; publishing with a missing label surfaces
  the notice.

## Validation command

```bash
pnpm --filter api test
pnpm --filter web test
(cd apps/api && npx wrangler d1 migrations apply paillette-db-stg --env staging --remote)
(cd apps/api && npx wrangler deploy --env staging)
```

## Allowed secrets

None new.

## Artifact outputs

- PR into `night/integration` with the migration.
- A short note in the PR on the staging limits chosen, with the arithmetic for
  one full curation session.

## Stop conditions

Stop before any production migration or deploy. Stop if the change would make
the daily site cap unbounded; it is the spend guard.

## Human clarification protocol

None expected.
