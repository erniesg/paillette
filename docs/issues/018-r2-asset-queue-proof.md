# R2 Asset Queue Proof

Issue #18 proves the public NGA media path without committing binaries or
running downstream mutation lanes.

## Commands

Safe local plan and download proof:

```bash
pnpm open:dry-run -- --providers=nga --sample-size=5 --sample-caption=any --out=tmp/nga-launch-dry-run.json
pnpm open:assets -- --manifest tmp/nga-launch-dry-run.json --db tmp/nga-launch-assets.sqlite --out-dir tmp/nga-launch-assets --providers=nga --limit=10 --init --status
pnpm open:assets -- --db tmp/nga-launch-assets.sqlite --out-dir tmp/nga-launch-assets --download --providers=nga --download-limit=10 --concurrency=4 --status
pnpm open:queue -- --manifest tmp/nga-launch-dry-run.json --out-dir tmp/nga-launch-queue --limit=10 --asset-mode=r2
```

The bounded staging upload is held until R2 readiness exits `0`:

```bash
node scripts/open-access-art-r2-readiness.mjs --out tmp/nga-r2-readiness.json
pnpm open:apply -- --manifest tmp/nga-launch-dry-run.json --out-dir tmp/nga-r2-upload-proof --limit=2 --asset-mode=r2 --download --upload --upload-concurrency=1
```

Do not add `--apply-d1`, `--apply`, `--upsert-vectors`, or `--enqueue` for this
proof.

## Object Storage Names

- R2 binding name: `IMAGES`
- Staging bucket name: `paillette-assets-stg`
- Production bucket name: `paillette-assets`
- Approved upload bucket env name: `ANVIL_R2_BUCKET`
- Tracked non-secret fallback: `.agent/storage.yaml` `object_storage.bucket`
- Credential names: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`
- Object key prefix: `generated/open-access/nga/`

Only names are documented here. Secret values and runtime bucket env values must
remain in the approved secret store.

## Safety Gates

R2 readiness is a prerequisite for live upload, paid caption generation, vector
upsert, queue enqueue, D1 apply, and deploy work. The readiness command writes a
structured JSON report with required names, missing names, exit code, and
redaction checks before any upload can proceed.

Readiness exit `4` means no bucket decision was found in either
`ANVIL_R2_BUCKET` or `.agent/storage.yaml`. Exit `3` means the bucket is known
but Cloudflare/R2 secret or auth names are still missing.

The queue command writes a dry-run batch plan with batch size and retry behavior.
It does not enqueue messages.
