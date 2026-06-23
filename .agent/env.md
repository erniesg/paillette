# Agent Environment

Names only. Do not write secret values in this file.

- Repository: `paillette`
- OS detected during scaffold: `macOS-15.6.1-arm64-arm-64bit`
- Package manager: `pnpm`
- Cloudflare Workers/Wrangler project detected.

Deploy/IaC hints detected:
- `cloudflare` (provider) from `apps/api/wrangler.toml`, `apps/web/wrangler.jsonc`; expected tools: `wrangler`.

Required secret/env names for deploy contexts:
- `cloudflare`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

Required secret/env names for NGA ingest, search, and notifications:
- `github repository`: `OPENAI_API_KEY` if the agent planner/build workflow uses OpenAI-backed planning.
- `github environment/staging`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- `github environment/production`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- `object storage/R2`: `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`; `.agent/storage.yaml` records only these names plus the `nga/` prefix.
- `cloudflare queue`: `CLOUDFLARE_QUEUE_ID` when `pnpm open:queue -- --enqueue` is used.
- `embedding provider`: `JINA_API_KEY` when running `pnpm open:apply -- --embed-images` or `--embed-captions`.
- `notifications`: `DISCORD_WEBHOOK_URL` only in the VM/service secret store or GitHub environment that sends notifications.

Storage policy:

- `rucksack storage inspect --repo-root .` should show `.agent/storage.yaml` present before any bulk download or upload.
- Create/select the actual R2 bucket outside git, then set the listed R2 secret values in GitHub Actions or Cloudflare/provider secret storage.
- Keep generated image downloads, SQLite ledgers, vectors, captions, manifests, and screenshots in `tmp/`, GitHub artifacts, or R2; do not commit them.

VM/local-only auth:
- Codex or Claude subscription login for long-running coding-agent sessions on the trusted VM.
- Wrangler browser login may be used interactively on the VM; CI/deploy lanes should use scoped Cloudflare API tokens.

Common account bootstrap checks:

- `gh auth status` for GitHub write/read operations.
- `bw status` for human Bitwarden vault status, if used interactively.
- `bws project list` for Bitwarden Secrets Manager machine access, if configured.
- `wrangler whoami` for Cloudflare projects.
- `tailscale status` for trusted VM access.
- `infra/vm/verify.sh` for reusable VM service, port, disk, memory, and Tailscale checks.

Agents should request human setup instead of asking for secrets in chat.
