# Decisions

Do not store secret values here.

## Pending

1. R2/storage unlock for NGA asset proof
   - Live HITL issue: https://github.com/erniesg/paillette/issues/18
   - Hosted unlock portal scaffold: `infra/cloudflare/rucksack-unlock-portal`.
   - Branch caveat: the scaffold is present in this checkout; deploy from this checkout or push/merge it before relying on another runner.
   - Setup command after Cloudflare/GitHub access is approved: `cd infra/cloudflare/rucksack-unlock-portal && npm install && npx wrangler types && npx wrangler secret put GITHUB_TOKEN && npx wrangler deploy`.
   - Configure `RUCKSACK_UNLOCK_BASE_URL` to the deployed Worker URL before sending GitHub/Discord pings with hosted unlock links.
   - Required names only: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `ANVIL_R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `GITHUB_TOKEN`.
   - Recommendation: approve only a bounded staging upload proof first; hold queue enqueue, D1 apply, vector upsert, deploy, and full ingest until evidence and rollback are recorded.

2. Embedding provider for NGA image vectors
   - Options: local model on trusted machine, Jina API with `JINA_API_KEY`, or defer image vectors for metadata/caption-only launch.
   - Current estimate from `tmp/nga-launch-dry-run.json`: 63,228 NGA works and roughly 252,912,000 Jina image tokens at one tile per image.
   - Gate command: `pnpm open:gate -- --manifest tmp/nga-launch-dry-run.json --image-embeddings=jina --caption-generation=defer --caption-embeddings=defer --approve-bulk`.
   - Live HITL issue: https://github.com/erniesg/paillette/issues/20#issuecomment-4777803760
   - Recommendation: local-first benchmark for cost control, then approve Jina only if quality/speed is insufficient.

3. Caption provider for 1,527 NGA rows missing `assistivetext`
   - Options: local MLX Qwen captioning on the trusted machine, paid/API captioning, or launch with institution text only and mark missing generated captions as backlog.
   - Current proof: 5 missing-caption rows prepared with `eval/caption_open_access_art.py --prepare-only`.
   - Gate command: `pnpm open:gate -- --manifest tmp/nga-launch-dry-run.json --image-embeddings=defer --caption-generation=local --caption-embeddings=defer`.
   - Recommendation: run a 200-500 row local benchmark before bulk generation.

4. Staging apply approval
   - Required before `pnpm open:apply -- --upload`, `--apply-d1`, or `--upsert-vectors`.
   - Required secrets by name: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and resource-specific queue/index names such as `CLOUDFLARE_QUEUE_ID`.

5. Notification surface
   - Options: Discord webhook notification only, Discord bot with decision buttons, GitHub-only issue comments, or dashboard later.
   - Recommendation: start with GitHub as canonical state and `DISCORD_WEBHOOK_URL` for concise pings that link back to issues/evidence.

## Answered

- Use `nga` only for National Gallery of Art, Washington; keep `ngs` reserved for National Gallery Singapore.
- Store large generated ingest outputs in local VM cache/object storage, not git.
