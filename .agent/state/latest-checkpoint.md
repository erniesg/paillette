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

## Evidence

- Full portable harness evidence: `.agent/evidence/20260623T093107855Z/manifest.json`
  - `lint`, `type-check`, `test`, and `build` all passed.
  - Manifest is dirty because local app edits remain uncommitted.
- Rucksack assessment:
  - `PYTHONPATH=src python3 -m rucksack autopilot assess erniesg/paillette --repo-root /Users/erniesg/code/erniesg/paillette --json`
  - Status: `ready`; queue: 6 issue specs ready.
- NGA dry run:
  - `pnpm open:dry-run -- --providers=nga --sample-size=5 --sample-caption=any --out=tmp/nga-launch-dry-run.json`
  - Candidate works: 63,228.
  - Institution/assistive caption coverage: 61,701 present, 1,527 missing.
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
- Live GitHub HITL sync:
  - `rucksack github issues seed erniesg/paillette --issue-dir docs/issues --label rucksack-ledger --label rucksack-queued --execute`
  - `rucksack autopilot recommend erniesg/paillette --issue 20 --ping @erniesg --execute`
  - Result: issue #20 is labeled `rucksack-needs-decision` and `rucksack-needs-clarification`, with recommendation comment `https://github.com/erniesg/paillette/issues/20#issuecomment-4777803760`.

## Current Gates

- Do not run `pnpm open:queue -- --enqueue` until Cloudflare queue/account/token names are configured in the approved secret store.
- Do not run live object-store uploads until the actual R2 bucket is created/selected outside git and `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ENDPOINT` are set in the approved secret store.
- Do not run `pnpm open:apply -- --upload`, `--apply-d1`, `--upsert-vectors`, or deploy until a human approves staging resources.
- Do not run paid Jina embedding or bulk caption generation until the provider/batch-size decision in `.agent/state/decisions.md` is answered.
- Keep `tmp/` artifacts local or move durable evidence to GitHub artifacts/R2; do not commit generated images, SQLite ledgers, vectors, captions, or manifests.

## Resume

1. Review `.agent/state/decisions.md`.
2. If the human approves local-first, run a 200-500 row missing-caption preparation and local MLX caption benchmark on the trusted machine.
3. If the human approves Jina, set `JINA_API_KEY` in the approved secret store and run a small `--embed-images` or `--embed-captions` batch before scaling.
4. After staging secrets are configured, run a bounded staging apply with `--limit` before full NGA ingest.
