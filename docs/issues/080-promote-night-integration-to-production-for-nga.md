# Promote `night/integration` to production for the NGA collection

depends-on: 072,073,075

## Goal

Production (`paillette.berlayar.ai`) runs a 28 August build. It has no agent,
no exhibitions, no short links and no room. `night/integration` is 258 commits
ahead of `master`. Getting the end-to-end NGA experience in front of real
visitors is a promotion, and it has four parts that are not code.

Found 2026-09-24, names only:

- Production D1 has migrations 0001 to 0015 and 0021 applied; it lacks
  0016 to 0020 and 0022 (`shareable_exhibitions`). `wrangler d1 migrations
  apply paillette-db --env production --remote` would apply all six; 0017 is
  the WorkOS auth migration, so check it against the live auth state first.
- The production API Worker has no `OPENAI_API_KEY` and no
  `QUERY_EMBEDDING_API_TOKEN`. Without the first, the agent returns 503 and
  labels fail; without the second, `redeal` and `search_by_exemplars` cannot
  reach the query-embedding service.
- Production sets neither `AGENT_MODEL_CALLS_PER_HOUR` nor
  `OPENAI_DAILY_CALL_LIMIT`, so it would run at 40 per client-hour and 500 per
  site-day. Decide the production numbers after 075 lands.
- `.github/workflows/deploy.yml` runs on push to `master` and, because the repo
  variable `RUCKSACK_DEPLOY_ENABLED` is `true`, calls `infra/vm/deploy.sh`, a
  compose deploy to a VM path. The app is two Cloudflare Workers deployed with
  `wrangler`. Confirm what that job does on a master push before merging 258
  commits into `master`, or the merge will trigger a deploy nobody intended.

## Acceptance tests

- A written checklist in `docs/nga-production-promotion.md` with, in order:
  the master merge plan (PR from `night/integration`), the deploy.yml decision,
  the six migrations and what each touches, the two secrets, the two vars, the
  two `wrangler deploy` commands, the smoke probes (`/nga/search`, a typed turn,
  publish, `/e/:code`, `/e/:code?v=room`), and the rollback (previous version
  IDs from `wrangler deployments list`).
- The checklist is executed on staging first as a rehearsal from a clean state,
  and the probe outputs are attached.
- Production is touched only after the owner approves the checklist in the
  issue. Every production step is logged with its command and output, secrets
  as names only.

## Validation command

```bash
(cd apps/api && npx wrangler d1 migrations list paillette-db --env production --remote)
(cd apps/api && npx wrangler secret list --env production)
(cd apps/api && npx wrangler deployments list --env production)
curl -s -o /dev/null -w '%{http_code}\n' https://paillette.berlayar.ai/nga/search
```

## Allowed secrets

`OPENAI_API_KEY` and `QUERY_EMBEDDING_API_TOKEN` on the production Worker, set
by the owner with `wrangler secret put <NAME> --env production` from `apps/api`.
Never in the repo, never in the issue.

## Artifact outputs

- `docs/nga-production-promotion.md`.
- The staging rehearsal log and, after approval, the production log.

## Stop conditions

Stop before any production migration, secret, or deploy until the owner has
approved the checklist in this issue. Stop before merging to `master` until the
deploy.yml question is answered.

## Human clarification protocol

Label `rucksack-needs-human` once the checklist is written. The owner sets the
two secrets and replies "approved" on the issue; nothing else is theirs to do.
