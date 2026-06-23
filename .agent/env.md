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
- `cloudflare queue`: `CLOUDFLARE_QUEUE_ID` when `pnpm open:queue -- --enqueue` is used.
- `embedding provider`: `JINA_API_KEY` when running `pnpm open:apply -- --embed-images` or `--embed-captions`.
- `notifications`: `DISCORD_WEBHOOK_URL` only in the VM/service secret store or GitHub environment that sends notifications.

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
