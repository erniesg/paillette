# Seed Only D1 Preview

depends-on: 001

## Goal

Use the NGA dry-run manifest to exercise Paillette's `open:apply` plan-only path and prove the D1 write plan is seed-only and reversible.

## Acceptance tests

- `open:apply` accepts the dry-run manifest with `--plan-only`.
- The plan names D1 tables or migrations but does not write production data.
- The preview output includes row counts for artworks, images, captions, and provenance records.

## Validation command

```bash
pnpm open:apply -- --manifest=tmp/nga-dry-run.json --plan-only
pnpm test
pnpm typecheck
```

## Allowed secrets

Only secret names may be referenced in docs, such as `CLOUDFLARE_API_TOKEN`; no secret values are needed for plan-only validation.

## Artifact outputs

- `tmp/nga-apply-plan.json` or equivalent plan output.
- Console summary with D1 table counts.
- `.agent/evidence/<run>/manifest.json` when available.

## Stop conditions

Stop before applying live D1 writes, running production migrations, or committing generated database dumps.

## Human clarification protocol

Ask whether to promote beyond plan-only only after the preview plan is reviewed with counts and rollback notes.

## Recommended response

Keep this issue limited to proving the write plan and create a separate approval issue for live seed execution.

## Trade-offs

Plan-only validation cannot prove production latency, but it catches schema and mapping mistakes without mutating data.

## Free-form response

Record whether the apply plan is ready for a staging seed and which tables remain uncertain.
