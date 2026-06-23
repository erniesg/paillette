# Decisions

Do not store secret values here.

## Pending

1. Embedding provider for NGA image vectors
   - Options: local model on trusted machine, Jina API with `JINA_API_KEY`, or defer image vectors for metadata/caption-only launch.
   - Current estimate from `tmp/nga-launch-dry-run.json`: 63,228 NGA works and roughly 252,912,000 Jina image tokens at one tile per image.
   - Recommendation: local-first benchmark for cost control, then approve Jina only if quality/speed is insufficient.

2. Caption provider for 1,527 NGA rows missing `assistivetext`
   - Options: local MLX Qwen captioning on the trusted machine, paid/API captioning, or launch with institution text only and mark missing generated captions as backlog.
   - Current proof: 5 missing-caption rows prepared with `eval/caption_open_access_art.py --prepare-only`.
   - Recommendation: run a 200-500 row local benchmark before bulk generation.

3. Staging apply approval
   - Required before `pnpm open:apply -- --upload`, `--apply-d1`, or `--upsert-vectors`.
   - Required secrets by name: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and resource-specific queue/index names such as `CLOUDFLARE_QUEUE_ID`.

4. Notification surface
   - Options: Discord webhook notification only, Discord bot with decision buttons, GitHub-only issue comments, or dashboard later.
   - Recommendation: start with GitHub as canonical state and `DISCORD_WEBHOOK_URL` for concise pings that link back to issues/evidence.

## Answered

- Use `nga` only for National Gallery of Art, Washington; keep `ngs` reserved for National Gallery Singapore.
- Store large generated ingest outputs in local VM cache/object storage, not git.
