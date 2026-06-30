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
- R2 readiness is documented as a prerequisite for paid/quota-consuming caption or vector work.
- R2 readiness emits a structured JSON report before any upload, paid caption, vector, queue, D1, or deploy work proceeds.

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
node scripts/open-access-art-r2-readiness.mjs --out tmp/nga-r2-readiness.json
pnpm open:apply -- --manifest tmp/nga-launch-dry-run.json --out-dir tmp/nga-r2-upload-proof --limit=2 --asset-mode=r2 --download --upload --upload-concurrency=1
```

Do not add `--apply-d1`, `--apply`, `--upsert-vectors`, or queue `--enqueue` to this issue's proof.

Expected R2 readiness exits:

- `0`: bucket and required Cloudflare/R2 names are present.
- `3`: blocked by missing secret/auth names such as `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, or `R2_ENDPOINT`.
- `4`: blocked by missing human bucket decision in `ANVIL_R2_BUCKET` or `.agent/storage.yaml`.

## Allowed secrets

Only secret names may appear, such as `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `ANVIL_R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, or `R2_ENDPOINT`. Do not write values.

## Artifact outputs

- Asset ledger/status summary with counts and byte totals.
- Queue batch plan or dry-run log.
- `tmp/nga-r2-readiness.json` with required names, missing names, exit code, and redaction checks.
- `tmp/nga-r2-upload-proof/asset-manifest.json` for the bounded upload proof, including object keys, content types, byte sizes, and SHA-256 hashes.
- `.agent/evidence/<run>/manifest.json` with large files listed as artifacts or caveats, not commits.

## Stop conditions

Stop if media download requires non-public access, if files exceed the repo storage policy, if R2 readiness exits `3` or `4`, if object-store credentials are missing for a non-plan run, if a downstream expensive operation would run before R2 readiness is proven, or if the next proposed command would apply D1, enqueue queue messages, upsert vectors, generate paid captions, or deploy.

## Human clarification protocol

Ask whether to run a live staging upload only after the plan-only evidence names object keys and rollback/delete behavior. Recommended v1 decision is to configure R2 first, then approve only a bounded staging upload after the R2 bucket exists and storage secrets are configured. The strict remote-agent proof is two NGA records; use a larger first batch only if the human explicitly approves it.

## Recommended response

Use object storage for artwork media and keep local files in `tmp/` or evidence storage only. Keep D1 apply, queue enqueue, paid/bulk caption or embedding work, vector upsert, deploy, and full ingest blocked until the bounded staging upload evidence is attached to issue #21.

## Trade-offs

Dry-run asset planning does not prove CDN behavior, but it prevents accidental binary commits and estimates launch cost.

## Free-form response

Add notes about largest sample asset, total planned bytes, object key naming, whether the bounded upload proof was skipped, accepted, or held, approved bucket name, first batch size, and rollback owner.
