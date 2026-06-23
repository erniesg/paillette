# Decisions

Do not store secret values here.

## Pending

1. Embedding provider for NGA image vectors
   - Options: local model on trusted machine, Jina API with `JINA_API_KEY`, or defer image vectors for metadata/caption-only launch.
   - Current estimate from `tmp/nga-dry-run.json`: 63,251 NGA works. Recalculate provider token/cost estimates from the exact manifest before any paid batch because image tiling depends on provider/model settings.
   - Gate command: `pnpm open:gate -- --manifest tmp/nga-launch-dry-run.json --image-embeddings=jina --caption-generation=defer --caption-embeddings=defer --approve-bulk`.
   - Live HITL issue: https://github.com/erniesg/paillette/issues/20#issuecomment-4777803760
   - Recommendation: local-first benchmark for cost control, then approve Jina only if quality/speed is insufficient.

2. Caption provider for 1,550 NGA rows missing `assistivetext`
   - Options: local MLX Qwen captioning on the trusted machine, paid/API captioning, or launch with institution text only and mark missing generated captions as backlog.
   - Current proof: 5 missing-caption rows prepared with `eval/caption_open_access_art.py --prepare-only`.
   - Gate command: `pnpm open:gate -- --manifest tmp/nga-launch-dry-run.json --image-embeddings=defer --caption-generation=local --caption-embeddings=defer`.
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
