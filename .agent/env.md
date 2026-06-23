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

Common account bootstrap checks:

- `gh auth status` for GitHub write/read operations.
- `bw status` for human Bitwarden vault status, if used interactively.
- `bws project list` for Bitwarden Secrets Manager machine access, if configured.
- `wrangler whoami` for Cloudflare projects.
- `tailscale status` for trusted VM access.
- `infra/vm/verify.sh` for reusable VM service, port, disk, memory, and Tailscale checks.

Agents should request human setup instead of asking for secrets in chat.
