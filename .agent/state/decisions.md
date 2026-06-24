# Decisions

Do not store secret values here.

## Pending

### Recommended v1 Answers

Use this as the default human decision packet unless the operator chooses a
different launch posture:

- Remote checkpoint: draft PR #24
  (`codex/open-access-art-ingest-rucksack-checkpoint`) contains the Rucksack
  unlock portal scaffold and the latest bounded R2 proof commands for remote
  agents.
- Issue #18: after the actual R2 bucket exists and the listed secret names are
  configured, accept only a bounded staging upload proof. Keep D1 apply, queue
  enqueue, vector upsert, deploy, and full ingest blocked until that evidence is
  attached to #21.
- Issue #20: hold paid/quota-consuming caption and vector work for v1. Launch
  with metadata plus institution captions only; defer image embeddings, caption
  generation, and caption embeddings unless a bounded local or Jina benchmark is
  explicitly approved.
- Issue #21: hold launch until #18 has bounded staging-upload evidence and #20
  is explicitly held or accepted for v1.
- Ordering rule: cheap planning/cost estimation can run before R2 readiness, but
  paid/quota-consuming caption or embedding work must wait until #18 has an
  approved bucket, configured secret-store values by name, bounded upload
  evidence, recorded object keys, and a rollback owner.
- Provider credential rule: when a human selects an API provider, Rucksack must
  stop and ping for the required secret name, such as `JINA_API_KEY`; collect the
  value through the approved secret store, never chat or issue text. When a
  human selects local captioning, Rucksack must verify local model/runtime setup
  and treat missing weights or runtime as `rucksack-needs-human`.

### R2/storage unlock for NGA asset proof

- Live HITL issue: https://github.com/erniesg/paillette/issues/18
- Remote checkpoint PR: https://github.com/erniesg/paillette/pull/24
- Hosted unlock portal scaffold: `infra/cloudflare/rucksack-unlock-portal`.
- Setup command after Cloudflare/GitHub access is approved:

```bash
cd infra/cloudflare/rucksack-unlock-portal
npm install
npx wrangler types
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

- Configure `RUCKSACK_UNLOCK_BASE_URL` to the deployed Worker URL before sending
  GitHub/Discord pings with hosted unlock links.
- Required names only: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  `ANVIL_R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`,
  `GITHUB_TOKEN`.
- Recommendation: approve only a bounded staging upload proof first; hold queue
  enqueue, D1 apply, vector upsert, deploy, and full ingest until evidence and
  rollback are recorded.

Storage setup commands after bucket selection:

```bash
rucksack storage init --repo-root . --provider r2 --bucket <approved-r2-bucket> --prefix nga/ --execute
rucksack ci resources setup erniesg/paillette --resource r2 --mode existing --bucket <approved-r2-bucket> --environment live --execute
rucksack ci env collect --environment live --repo-root . --execute
rucksack ci inspect erniesg/paillette --target workers --environment live --repo-root .
rucksack ci setup erniesg/paillette --target workers --environment live --repo-root . --execute --yes
```

First bounded staging upload proof:

```bash
pnpm open:apply -- --manifest=tmp/nga-dry-run.json --out-dir tmp/nga-staging-upload --limit 5 --download --upload --bucket <approved-r2-bucket>
scripts/agent-evidence
```

PR #24 also exposes a stricter `nga-r2-upload-proof` command for a two-record
proof from `.agent/commands.yaml`. Use the stricter command when validating the
unlock portal path; use the five-record command only when the human explicitly
approves that first batch size.

Do not include secret values in this file, issues, logs, manifests, or commits.

### Open Decisions

1. Embedding provider for NGA image vectors
   - Options: local model on trusted machine, Jina API with `JINA_API_KEY`, or defer image vectors for metadata/caption-only launch.
   - Current estimate from `tmp/nga-dry-run.json`: 63,251 NGA works. Recalculate provider token/cost estimates from the exact manifest before any paid batch because image tiling depends on provider/model settings.
   - Gate command: `pnpm open:gate -- --manifest tmp/nga-dry-run.json --image-embeddings=jina --caption-generation=defer --caption-embeddings=defer --approve-bulk`.
   - Runtime prerequisite: do not run paid or quota-consuming image embedding until #18 proves R2 readiness and the bounded staging upload evidence is attached to #21.
   - Secret handshake: if Jina is selected, ping the human for `JINA_API_KEY` setup and use the approved secret store; do not ask for the value in chat.
   - Live HITL issue: https://github.com/erniesg/paillette/issues/20#issuecomment-4777803760
   - Recommendation: local-first benchmark for cost control, then approve Jina only if quality/speed is insufficient.

2. Caption provider for 1,550 NGA rows missing `assistivetext`
   - Options: local MLX Qwen captioning on the trusted machine, paid/API captioning, or launch with institution text only and mark missing generated captions as backlog.
   - Current proof: 5 missing-caption rows prepared with `eval/caption_open_access_art.py --prepare-only`.
   - Gate command: `pnpm open:gate -- --manifest tmp/nga-dry-run.json --image-embeddings=defer --caption-generation=local --caption-embeddings=defer`.
   - Runtime prerequisite: do not run bulk caption generation until #18 proves R2 readiness and the bounded staging upload evidence is attached to #21.
   - Local handshake: if local MLX/Qwen captioning is selected, verify the model weights and runtime locally before the batch; if missing, ping the human rather than falling back to API captioning.
   - Recommendation: run a 200-500 row local benchmark before bulk generation.

3. Staging apply approval
   - Required before `pnpm open:apply -- --upload`, `--apply-d1`, or `--upsert-vectors`.
   - Required secrets by name: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and resource-specific queue/index names such as `CLOUDFLARE_QUEUE_ID`.

4. NGA object storage bucket and live upload approval
   - Required before `pnpm open:queue -- --enqueue` or `pnpm open:apply -- --upload`.
   - Required storage contract: `.agent/storage.yaml` records R2 with prefix `nga/`, empty bucket, and secret names `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`.
   - Runtime gate: live `pnpm open:apply -- --upload` and `pnpm open:queue -- --enqueue` must fail unless `--bucket <bucket>` is passed or `.agent/storage.yaml` has a nonempty approved `object_storage.bucket`.
   - Current proof: 10 of 10 sample assets downloaded locally and 10 R2-mode queue messages planned in one batch.
   - Live HITL issue: https://github.com/erniesg/paillette/issues/18#issuecomment-4778267231
   - Recommendation: choose/create the actual R2 bucket outside git, set the listed secret values in the approved secret store, then approve only a bounded staging upload before scaling.

5. Notification surface
   - Options: Discord webhook notification only, Discord bot with decision buttons, GitHub-only issue comments, or dashboard later.
   - Recommendation: start with GitHub as canonical state and `DISCORD_WEBHOOK_URL` for concise pings that link back to issues/evidence.

## Answered

- Use `nga` only for National Gallery of Art, Washington; keep `ngs` reserved for National Gallery Singapore.
- Store large generated ingest outputs in local VM cache/object storage, not git.
