# R2 Asset Queue Proof

depends-on: 002

## Goal

Prove the NGA asset path can download, stage, and upload representative public artwork media through R2 or the configured object-store lane without committing binaries.

## Acceptance tests

- The asset ledger identifies image count, downloaded bytes, and target object keys without writing large files into Git.
- R2 binding names and bucket names are documented by name only.
- Queue batch sizing and retry behavior are recorded for at least one sample batch.
- R2 readiness is documented as a prerequisite for paid/quota-consuming caption or vector work.

## Validation command

```bash
pnpm open:assets -- --manifest=tmp/nga-dry-run.json --db=tmp/nga-assets-ledger.sqlite --out-dir=tmp/nga-assets --providers=nga --init --status
pnpm open:assets -- --db=tmp/nga-assets-ledger.sqlite --out-dir=tmp/nga-assets --providers=nga --download --download-limit=2 --concurrency=2 --status
pnpm test
```

## Allowed secrets

Only secret names may appear, such as `CLOUDFLARE_API_TOKEN` or `R2_ACCESS_KEY_ID`. Do not write values.

## Artifact outputs

- Asset ledger/status summary with counts and byte totals.
- Queue batch plan or dry-run log.
- `.agent/evidence/<run>/manifest.json` with large files listed as artifacts or caveats, not commits.

## Stop conditions

Stop if media download requires non-public access, if files exceed the repo storage policy, if object-store credentials are missing for a non-plan run, or if a downstream expensive operation would run before R2 readiness is proven.

## Human clarification protocol

Ask whether to run a live staging upload only after the plan-only evidence names object keys and rollback/delete behavior. Recommended v1 decision is to configure R2 first, then approve only a bounded staging upload for 5 NGA records / 10 assets after the R2 bucket exists and storage secrets are configured.

## Recommended response

Use object storage for artwork media and keep local files in `tmp/` or evidence storage only. Keep D1 apply, queue enqueue, paid/bulk caption or embedding work, vector upsert, deploy, and full ingest blocked until the bounded staging upload evidence is attached to issue #21.

## Trade-offs

Dry-run asset planning does not prove CDN behavior, but it prevents accidental binary commits and estimates launch cost.

## Free-form response

Add notes about largest sample asset, total planned bytes, object key naming, approved bucket name, first batch size, and rollback owner.
