# R2 Asset Queue Proof

depends-on: 002

## Goal

Prove the NGA asset path can download, stage, and upload representative public artwork media through R2 or the configured object-store lane without committing binaries.

## Acceptance tests

- The asset ledger identifies image count, downloaded bytes, and target object keys without writing large files into Git.
- R2 binding names, bucket names, and credential names are documented by name only.
- After #18 is accepted and R2 is configured, a bounded staging upload writes no more than two NGA records through R2 and records the uploaded object keys.
- Queue batch sizing and retry behavior are recorded for at least one sample batch.
- The proof does not apply D1 SQL, enqueue queue messages, generate captions, upsert vectors, or deploy.

## Validation command

Plan and local download proof, safe before secrets are configured:

```bash
pnpm open:dry-run -- --providers=nga --sample-size=5 --sample-caption=any --out=tmp/nga-launch-dry-run.json
pnpm open:assets -- --manifest tmp/nga-launch-dry-run.json --db tmp/nga-launch-assets.sqlite --out-dir tmp/nga-launch-assets --providers=nga --limit=10 --init --status
pnpm open:assets -- --db tmp/nga-launch-assets.sqlite --out-dir tmp/nga-launch-assets --download --providers=nga --download-limit=10 --concurrency=4 --status
pnpm open:queue -- --manifest tmp/nga-launch-dry-run.json --out-dir tmp/nga-launch-queue --limit=10 --asset-mode=r2
pnpm test
```

Bounded staging upload proof, only after the R2 gate is accepted and the approved secret store exposes Cloudflare auth plus `ANVIL_R2_BUCKET`:

```bash
test -n "$ANVIL_R2_BUCKET"
pnpm open:apply -- --manifest tmp/nga-launch-dry-run.json --out-dir tmp/nga-r2-upload-proof --limit=2 --asset-mode=r2 --bucket "$ANVIL_R2_BUCKET" --download --upload --upload-concurrency=1
```

Do not add `--apply-d1`, `--apply`, `--upsert-vectors`, or queue `--enqueue` to this issue's proof.

## Allowed secrets

Only secret names may appear, such as `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `ANVIL_R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, or `R2_ENDPOINT`. Do not write values.

## Artifact outputs

- Asset ledger/status summary with counts and byte totals.
- Queue batch plan or dry-run log.
- `tmp/nga-r2-upload-proof/asset-manifest.json` for the bounded upload proof, including object keys, content types, byte sizes, and SHA-256 hashes.
- `.agent/evidence/<run>/manifest.json` with large files listed as artifacts or caveats, not commits.

## Stop conditions

Stop if media download requires non-public access, if files exceed the repo storage policy, if object-store credentials are missing for a non-plan run, or if the next proposed command would apply D1, enqueue queue messages, upsert vectors, generate paid captions, or deploy.

## Human clarification protocol

Ask whether to run a live staging upload only after the plan-only evidence names object keys and rollback/delete behavior. The first accepted upload should be bounded to two NGA records and use the staging bucket named by `ANVIL_R2_BUCKET`.

## Recommended response

Use object storage for artwork media and keep local files in `tmp/` or evidence storage only.

## Trade-offs

Dry-run asset planning does not prove CDN behavior, but it prevents accidental binary commits and estimates launch cost.

## Free-form response

Add notes about largest sample asset, total planned bytes, object key naming, and whether the bounded upload proof was skipped, accepted, or held.
