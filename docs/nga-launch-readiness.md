# NGA Launch Readiness

Status: hold until storage, provider, and launch approvals are resolved.
Last updated: 2026-06-23.

This is the launch evidence pack for adding National Gallery of Art,
Washington records to the `open-access-art` collection. It is a review and
rollback checklist, not approval to run live writes, uploads, queue enqueue,
vector upserts, or deploys.

## Current State

| Area | Evidence | State |
|---|---|---|
| Harness PR | https://github.com/erniesg/paillette/pull/22 | Draft, checks green as of 2026-06-23. |
| Dry-run mapping | Issue #16, `tmp/nga-dry-run.json`, `.agent/evidence/20260623T112236152Z/manifest.json` | Awaiting review. |
| Seed-only D1 plan | Issue #17, `tmp/nga-apply-plan/` | Awaiting review, no D1 writes. |
| Public search smoke | Issue #19, route fixture coverage for `orgId=open` | Awaiting review. |
| R2 asset and queue proof | Issue #18, `tmp/nga-launch-queue/` | Needs storage decision before live upload or enqueue. |
| Caption and vector cost gate | Issue #20, `tmp/nga-cost-gate-jina-missing-secret.json` | Needs provider and cost decision before paid or quota-consuming work. |
| Launch and rollback | Issue #21, this document | Blocked until #18 and #20 are approved and reviewed. |

## Proven Counts

From the current NGA dry run and cost gate:

- Candidate NGA works: 63,251.
- Institution caption coverage: 61,701 present, 1,550 missing.
- Sample dry run: 5 records with image, thumbnail, source URL, accession,
  provenance fields, and institution caption text.
- Asset proof: 10 sample assets downloaded locally, 1,527,787 bytes total, 0
  failures.
- Queue proof: 10 R2-mode asset messages, 1 batch, not enqueued.
- Jina image embedding estimate: 253,004,000 image embedding tokens.
- Cloudflare estimate from current gate: about 36.19 GB R2 storage and about
  USD 1.59 monthly Cloudflare storage/query exposure before provider API cost.

Recalculate these numbers from a fresh manifest before any full launch, because
provider records and image tiling assumptions can change.

## Required Human Decisions

1. Storage bucket and bounded upload
   - Decide or create the R2 bucket outside git.
   - Keep `.agent/storage.yaml` as the reviewed policy source.
   - Live upload and live queue enqueue must stay blocked unless an approved
     bucket is supplied with `--bucket` or committed as a nonempty
     `object_storage.bucket`.

2. Image embedding provider
   - Options: local machine benchmark, Jina API with `JINA_API_KEY`, or defer
     image vectors for a metadata/caption-first launch.
   - The current Jina lane exits `3` with required secret name `JINA_API_KEY`
     when the key is absent.

3. Caption generation provider
   - Options: local MLX/Qwen benchmark, paid/API captioning, or launch with
     institution captions only and track the 1,550 missing rows as backlog.
   - Do not run bulk caption inference until the provider and first batch size
     are approved.

4. Staging apply approval
   - Required before `--apply-d1`, `--upload`, `--upsert-vectors`, or queue
     enqueue.
   - Start with a bounded staging batch after secrets and bucket are configured.

5. Launch approval
   - Required after #18, #20, and the review-ready evidence issues are accepted.
   - Approval should name the exact branch, environment, bucket, first batch
     size, and rollback owner.

## Recommended V1 Decision

Recommended initial launch posture:

- Launch metadata and institution captions first.
- Defer generated captions for the 1,550 missing-caption rows.
- Defer image vectors and generated-caption vectors.
- Configure and verify R2 readiness before any paid, quota-consuming, or bulk
  caption/vector work.
- Approve only a bounded R2 staging upload after bucket and secret setup.
- Keep D1 apply, queue enqueue, vector upsert, and deploy blocked until the
  bounded staging upload evidence is attached to issue #21.

This keeps the public NGA collection launch on the proven open-access metadata
path while preserving a separate caption/vector workstream for local or Jina
benchmarks.

Paste-ready decision for issue #20:

```text
/rucksack hold
Decision: launch v1 with metadata plus institution captions only.
Image embeddings: defer.
Caption generation: defer.
Caption embeddings: defer.
Reason: avoid paid/quota-consuming provider work until launch evidence and a
bounded local/Jina benchmark are reviewed.
```

If the human later chooses Jina or another API provider, Rucksack should stop
and ping for the provider secret by name, for example `JINA_API_KEY`. The value
must be collected through the approved secret store, not chat or issue text. If
the human chooses local captioning, Rucksack should verify the local model,
runtime, and storage path first; missing model weights or local runtime setup
should be treated as `rucksack-needs-human`, not silently replaced with paid API
calls.

Paste-ready decision for issue #18 after the bucket exists and secrets are set:

```text
/rucksack accept
Decision: approve bounded staging upload proof only.
Bucket: <approved-r2-bucket>
First batch: 5 NGA records / 10 assets.
Allowed commands: storage setup, bounded `open:apply --download --upload`, and
evidence capture.
Still blocked: D1 apply, queue enqueue, vector upsert, deploy, and full ingest.
Rollback owner: <owner>
```

Paste-ready hold for issue #21 until the bounded staging upload evidence is
attached:

```text
/rucksack hold
Reason: launch remains blocked until #18 has bounded R2 staging-upload evidence
and #20 provider/cost scope is held or accepted for v1.
```

## Secret Names

Only configure these through GitHub, Cloudflare, the VM, or the approved secret
store. Do not write values into repo files, issues, PR comments, logs, or
manifests.

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_QUEUE_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`
- `JINA_API_KEY`

## Safe Next Commands

These commands are safe review commands because they do not write production
data, upload to object storage, enqueue Cloudflare queue messages, or call Jina
when `JINA_API_KEY` is missing.

```bash
pnpm open:dry-run -- --providers=nga --sample-size=5 --sample-caption=any --out=tmp/nga-dry-run.json
pnpm open:apply -- --manifest=tmp/nga-dry-run.json --out-dir tmp/nga-apply-plan --plan-only
pnpm open:queue -- --manifest tmp/nga-dry-run.json --out-dir tmp/nga-launch-queue --limit=10 --asset-mode=r2
pnpm open:gate -- --manifest tmp/nga-dry-run.json --image-embeddings=jina --caption-generation=defer --caption-embeddings=defer --approve-bulk --out tmp/nga-cost-gate-jina-missing-secret.json
```

Expected paid-provider gate while `JINA_API_KEY` is absent: exit `3` with
`JINA_API_KEY` named as missing and no provider request.

## Storage Setup Commands

After a human creates or selects the R2 bucket outside git, configure names and
secret destinations with Rucksack. These commands still must not include secret
values in logs, docs, issues, or commits.

```bash
rucksack storage init --repo-root . --provider r2 --bucket <approved-r2-bucket> --prefix nga/ --execute
rucksack ci resources setup erniesg/paillette --resource r2 --mode existing --bucket <approved-r2-bucket> --environment live --execute
rucksack ci env collect --environment live --repo-root . --execute
rucksack ci inspect erniesg/paillette --target workers --environment live --repo-root .
rucksack ci setup erniesg/paillette --target workers --environment live --repo-root . --execute --yes
```

For the first bounded staging upload proof, use the approved bucket and a small
sample only:

```bash
pnpm open:apply -- --manifest=tmp/nga-dry-run.json --out-dir tmp/nga-staging-upload --limit 5 --download --upload --bucket <approved-r2-bucket>
scripts/agent-evidence
```

Do not add `--apply-d1`, `--enqueue`, `--embed-images`, `--embed-captions`,
`--upsert-vectors`, or `wrangler deploy` to this first staging proof.

## R2-Ready Before Expensive Ops

Cheap planning and estimates may run before R2 is ready:

- `open:dry-run`
- `open:apply --plan-only`
- `open:queue` without `--enqueue`
- `open:gate` when it exits before provider calls because provider secrets are
  absent

These operations must wait until R2 readiness is configured and the bounded
staging upload evidence is attached to issue #21:

- paid or quota-consuming caption generation
- paid or quota-consuming image or caption embedding
- local bulk caption generation beyond a tiny benchmark
- `open:apply --upload`
- `open:queue --enqueue`
- `open:apply --apply-d1`
- `open:apply --upsert-vectors`
- deploy or launch approval

R2 readiness means: approved bucket name, `nga/` prefix, secret values present in
the approved store by name, successful bounded upload evidence, object keys
recorded, and rollback/delete owner named.

## Blocked Commands

Do not run these without the matching human approval and secret setup:

```bash
pnpm open:apply -- --manifest=tmp/nga-dry-run.json --upload
pnpm open:apply -- --manifest=tmp/nga-dry-run.json --apply-d1
pnpm open:apply -- --manifest=tmp/nga-dry-run.json --embed-images
pnpm open:apply -- --manifest=tmp/nga-dry-run.json --embed-captions
pnpm open:apply -- --manifest=tmp/nga-dry-run.json --upsert-vectors
pnpm open:queue -- --manifest tmp/nga-dry-run.json --asset-mode=r2 --enqueue
wrangler deploy
```

## Rollback Plan

No live state has been changed by the current evidence pack, so the immediate
rollback is to discard local `tmp/` outputs and hold #21 blocked.

For a future bounded staging run, record the exact batch manifest, object keys,
D1 SQL files, queue batches, vector IDs, PR, and evidence manifest before
starting. If the batch must be rolled back:

1. Hide or disable the public collection route before deleting data.
2. Stop queue enqueue and consumers for the NGA open-access batch.
3. Delete only the object keys listed in the approved batch manifest.
4. Delete or mark inactive only the D1 rows generated from the approved batch
   manifest.
5. Remove only vector IDs generated by that batch.
6. Attach the rollback command log and post-run evidence manifest to issue #21.

Do not run destructive deletion commands from a pull request or without a human
review of the exact IDs and object keys.

## Launch Decision Template

Use this template on issue #21 after upstream evidence is accepted:

```text
/rucksack hold
Reason: launch remains blocked until #18 storage approval and #20 provider/cost
approval are resolved.
```

When ready to approve a bounded staging run, include:

```text
/rucksack accept
Environment:
Bucket:
First batch size:
Image embedding provider:
Caption provider:
Rollback owner:
```
