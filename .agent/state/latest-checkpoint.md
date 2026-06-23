# Latest Checkpoint

Date: 2026-06-23
Branch: `codex/open-access-art-ingest`

## What Changed

- Added Rucksack VM/autopilot harness in commit `e321f729`.
- Cleared the local `type-check` blocker in `apps/web/app/routes/pretext.tsx` by adding strict-index guards.
- Ran an NGA-only dry run, bounded asset queue proof, bounded local asset download proof, and missing-caption preparation proof.
- Added `pnpm open:gate` so caption/vector provider choices, missing secrets, and bulk approvals are machine-checkable before paid or quota-consuming work.
- Refreshed generated Rucksack CI/deploy wrapper evidence handling so `.agent/evidence` is uploaded as a GitHub Actions artifact even when wrapper evidence is advisory.
- Recorded the NGA R2 storage contract in `.agent/storage.yaml` with secret names only and the `nga/` object prefix.
- Added a live storage approval gate so R2 `--upload` and queue `--enqueue` cannot silently use the default staging bucket; they require explicit `--bucket` or a nonempty approved `.agent/storage.yaml` bucket.
- Refreshed issue #16/#17 evidence from the current NGA public data path and generated a seed-only D1 preview without writes, uploads, queue enqueue, or secret values.
- Added a fixture-backed public search smoke for issue #19 that proves the `open` route resolves to `open-access-art` and preserves an NGA result's image, provenance, collection, accession, institution, and source URL metadata.

## Evidence

- Full portable harness evidence: `.agent/evidence/20260623T093107855Z/manifest.json`
  - `lint`, `type-check`, `test`, and `build` all passed.
  - Manifest is dirty because local app edits remain uncommitted.
- Rucksack assessment:
  - `PYTHONPATH=src python3 -m rucksack autopilot assess erniesg/paillette --repo-root /Users/erniesg/code/erniesg/paillette --json`
  - Status: `ready`; queue: 6 issue specs ready.
- NGA dry run:
  - `pnpm open:dry-run -- --providers=nga --sample-size=5 --sample-caption=any --out=tmp/nga-dry-run.json`
  - Candidate works: 63,251.
  - Institution/assistive caption coverage: 61,701 present, 1,550 missing.
  - Sample records: 5; all sampled records include title, image/thumbnail, caption text, accession number, and source URL.
- Seed-only D1 preview:
  - `pnpm open:apply -- --manifest=tmp/nga-dry-run.json --out-dir tmp/nga-apply-plan --plan-only`
  - Result: plan-only output for 5 NGA records, 5 cached records, 0 external records.
  - Generated local SQL rows: 1 `users`, 1 `orgs`, 1 `org_users`, 1 `collections`, 5 `artworks`, 10 `assets`, and 5 `collection_artworks`.
  - Asset mode: `r2`; no assets uploaded and no D1 writes applied.
- Public search smoke:
  - Added `apps/web/app/routes/__tests__/public-search-text-route.test.ts` coverage for `orgId=open`.
  - Proves upstream proxy target `/orgs/open-access-art/search/text` and returned NGA fixture metadata including `provider=nga`, source institution, source collection, accession number, source URL, image URL, and thumbnail URL.
  - Targeted validation: `pnpm --filter @paillette/web test -- app/routes/__tests__/public-search-text-route.test.ts` passed.
- NGA asset proof:
  - `pnpm open:assets -- --manifest tmp/nga-launch-dry-run.json --db tmp/nga-launch-assets.sqlite --out-dir tmp/nga-launch-assets --providers=nga --limit=10 --init --status`
  - `pnpm open:assets -- --db tmp/nga-launch-assets.sqlite --out-dir tmp/nga-launch-assets --download --providers=nga --download-limit=10 --concurrency=4`
  - Result: 10/10 assets downloaded for 5 artworks, 1,527,787 bytes, 0 failed.
- NGA queue proof:
  - `pnpm open:queue -- --manifest tmp/nga-launch-dry-run.json --out-dir tmp/nga-launch-queue --limit=10 --asset-mode=r2`
  - Result: 10 messages, 1 batch, not enqueued.
- Missing-caption prep:
  - `pnpm open:dry-run -- --providers=nga --sample-size=5 --sample-caption=missing --out=tmp/nga-missing-caption-dry-run.json`
  - `python3 eval/caption_open_access_art.py --manifest tmp/nga-missing-caption-dry-run.json --out tmp/nga-caption-proof/captions.jsonl --metrics-out tmp/nga-caption-proof/metrics.json --image-dir tmp/nga-caption-proof/images --prepare-only`
  - Result: 5 missing-caption rows prepared; no model inference run.
- Cost gate:
  - `node --test scripts/__tests__/open-access-art-cost-gate.test.mjs`
  - `pnpm open:gate -- --manifest tmp/nga-launch-dry-run.json --image-embeddings=jina --caption-generation=defer --caption-embeddings=defer --approve-bulk --out tmp/nga-cost-gate-jina-missing-secret.json`
  - Result: exit `3` with required secret name `JINA_API_KEY`; no Jina request or secret value used.
- Storage/CI artifact contract:
  - `PYTHONPATH=/Users/erniesg/code/erniesg/rucksack/src python3 -m rucksack ci furnish erniesg/paillette --target vm --repo-root /tmp/paillette-pr22-merge --profile erniesg-ai-vm --force --execute`
  - `.github/workflows/ci.yml` uploads artifact `rucksack-ci-evidence-${{ github.run_id }}` from `.agent/evidence`.
  - `.github/workflows/deploy.yml` uploads artifact `rucksack-deploy-evidence-${{ github.run_id }}` from `.agent/evidence`.
  - `.agent/storage.yaml` records R2 secret names and the `nga/` prefix without a bucket value or credential values.
- Live storage guard:
  - `node --test scripts/__tests__/open-access-art-apply.test.mjs scripts/__tests__/open-access-art-queue.test.mjs`
  - `pnpm open:apply -- --manifest=tmp/nga-dry-run.json --out-dir tmp/nga-apply-live-gate --upload`
  - `pnpm open:queue -- --manifest tmp/nga-dry-run.json --out-dir tmp/nga-queue-live-gate --limit=1 --asset-mode=r2 --enqueue`
  - Expected result: both live commands fail before network upload/enqueue with `approved R2 bucket is required`; plan-only apply and queue generation remain allowed.
- Live GitHub HITL sync:
  - `rucksack github issues seed erniesg/paillette --issue-dir docs/issues --label rucksack-ledger --label rucksack-queued --execute`
  - `rucksack autopilot recommend erniesg/paillette --issue 20 --ping @erniesg --execute`
  - Result: issue #20 is labeled `rucksack-needs-decision` and `rucksack-needs-clarification`, with recommendation comment `https://github.com/erniesg/paillette/issues/20#issuecomment-4777803760`.
  - `PYTHONPATH=/Users/erniesg/code/erniesg/rucksack/src python3 -m rucksack autopilot recommend erniesg/paillette --issue 18 --ping @erniesg --execute`
  - Result: issue #18 is labeled `rucksack-needs-decision` and `rucksack-needs-clarification`, with storage approval comment `https://github.com/erniesg/paillette/issues/18#issuecomment-4778267231`.
- Live GitHub issue evidence sync after PR head `72b85812`:
  - Issue #16 moved to `rucksack-awaiting-review` with dry-run evidence comment `https://github.com/erniesg/paillette/issues/16#issuecomment-4778371513`.
  - Issue #17 moved to `rucksack-awaiting-review` with seed-only D1 preview evidence comment `https://github.com/erniesg/paillette/issues/17#issuecomment-4778374711`.
  - Issue #19 moved to `rucksack-awaiting-review` with public search smoke evidence comment `https://github.com/erniesg/paillette/issues/19#issuecomment-4778376724`.
  - Issue #21 moved to `rucksack-blocked` with dependency note `https://github.com/erniesg/paillette/issues/21#issuecomment-4778378654` until #18 and #20 are resolved.
- Fresh validation after issue #16/#17 refresh:
  - `pnpm test`: passed.
  - `pnpm typecheck`: passed.
  - `scripts/agent-evidence`: passed with `.agent/evidence/20260623T104046942Z/manifest.json`; lanes `lint`, `build`, `type-check`, and `test`, no caveats, dirty `false`.
- Fresh validation after live storage guard:
  - `node --test scripts/__tests__/open-access-art-apply.test.mjs scripts/__tests__/open-access-art-queue.test.mjs`: passed, 11 tests.
  - `pnpm open:apply -- --manifest=tmp/nga-dry-run.json --out-dir tmp/nga-apply-plan --plan-only`: passed, 5 NGA records planned.
  - `pnpm open:queue -- --manifest tmp/nga-dry-run.json --out-dir tmp/nga-launch-queue --limit=10 --asset-mode=r2`: passed, 10 messages in 1 batch, not enqueued.
  - `pnpm open:apply -- --manifest=tmp/nga-dry-run.json --out-dir tmp/nga-apply-live-gate --upload`: failed as intended before upload with `approved R2 bucket is required`.
  - `pnpm open:queue -- --manifest tmp/nga-dry-run.json --out-dir tmp/nga-queue-live-gate --limit=1 --asset-mode=r2 --enqueue`: failed as intended before enqueue with `approved R2 bucket is required`.
  - `pnpm test`: passed.
  - `pnpm typecheck`: passed.
  - `scripts/agent-evidence`: passed; latest manifests are written under `.agent/evidence/<timestamp>/manifest.json` with lanes `lint`, `build`, `type-check`, and `test`, no caveats, dirty `true` before commit.

## Current Gates

- Do not run `pnpm open:queue -- --enqueue` until an approved bucket is passed via `--bucket` or `.agent/storage.yaml`, and Cloudflare queue/account/token names are configured in the approved secret store.
- Do not run live object-store uploads until the actual R2 bucket is created/selected outside git, the bucket is passed via `--bucket` or committed as an approved nonempty `.agent/storage.yaml` bucket, and `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ENDPOINT` are set in the approved secret store.
- Do not run `pnpm open:apply -- --upload`, `--apply-d1`, `--upsert-vectors`, or deploy until a human approves staging resources.
- Do not run paid Jina embedding or bulk caption generation until the provider/batch-size decision in `.agent/state/decisions.md` is answered.
- Keep `tmp/` artifacts local or move durable evidence to GitHub artifacts/R2; do not commit generated images, SQLite ledgers, vectors, captions, or manifests.

## Resume

1. Review `.agent/state/decisions.md` and the live decision issues #18 and #20.
2. If the human approves the storage path on issue #18, create/select the R2 bucket outside git, set the listed R2 secret values, then run only a bounded staging upload first.
3. If the human approves local-first captions/vectors on issue #20, run a 200-500 row missing-caption preparation and local MLX caption benchmark on the trusted machine.
4. If the human approves Jina, set `JINA_API_KEY` in the approved secret store and run a small `--embed-images` or `--embed-captions` batch before scaling.
5. After staging secrets are configured, run a bounded staging apply with `--limit` before full NGA ingest.
6. Requeue issue #21 only after #18 and #20 are resolved and the awaiting-review evidence issues have been accepted.
