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

Required secret/env names for the Rucksack control plane:
- `github repository`: `OPENAI_API_KEY` if the issue-ledger planner or `codex-action` provider is enabled.
- `github environment/staging`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `RUCKSACK_APP_ENV` when staging deploy lanes are enabled.
- `github environment/production`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `RUCKSACK_APP_ENV` when production deploy lanes are enabled.

Required secret/env names for NGA ingest, search, and notifications:
- `object storage/R2`: `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`; `.agent/storage.yaml` records only these names plus the `nga/` prefix.
- `cloudflare queue`: `CLOUDFLARE_QUEUE_ID` when `pnpm open:queue -- --enqueue` is used.
- `object storage`: `ANVIL_R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` before issue #18 can run an R2 upload proof.
- `embedding provider`: `JINA_API_KEY` when issue #20 approves Jina-backed `pnpm open:apply -- --embed-images` or `--embed-captions`.
- `notifications`: `DISCORD_WEBHOOK_URL` only in the VM/service secret store or GitHub environment that sends notifications.
- `unlock portal`: `GITHUB_TOKEN` as a Cloudflare Worker secret for the generated unlock portal; `RUCKSACK_UNLOCK_BASE_URL` in the trusted VM/service environment after deploy, or pass the non-secret Worker URL with `--unlock-base-url` for one-off status refreshes.

Human unlock surfaces:

- GitHub issues are canonical for accept/hold decisions, audit trail, and resuming blocked work.
- Discord is a notification mirror. It should link to the GitHub issue, evidence, and hosted unlock page; do not paste secret values into Discord.
- The generated Cloudflare unlock portal lives at `infra/cloudflare/rucksack-unlock-portal` and is the browser UI for entering GitHub/Cloudflare/R2/Jina values into the approved target secret store.
- Deploy the unlock portal with Cloudflare Access enabled before expecting unattended GitHub/Discord pings to collect missing setup:

```bash
cd infra/cloudflare/rucksack-unlock-portal
npm install
npx wrangler types
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

- After deploy, set `RUCKSACK_UNLOCK_BASE_URL` to the Worker URL in the VM/service environment, or pass `--unlock-base-url https://<worker>.<account>.workers.dev` during a one-off `rucksack autopilot status ... --notify-github` refresh, so Rucksack can include hosted unlock links in GitHub and Discord pings.
- Local `rucksack autopilot unlock-ui ... --resource r2` can be opened before the bucket is known; enter the approved bucket name in the form so Rucksack can generate the R2 resource setup step after submission.
- For NGA launch work, unlock issue #18 R2/storage first. Do not start paid or bulk caption/vector work for issue #20 until #18 has either passed a bounded staging upload proof or has been explicitly held by a human.

Storage policy:

- `rucksack storage inspect --repo-root .` should show `.agent/storage.yaml` present before any bulk download or upload.
- Create/select the actual R2 bucket outside git, then set the listed R2 secret values in GitHub Actions or Cloudflare/provider secret storage.
- Keep generated images, SQLite ledgers, vectors, captions, manifests, screenshots, and traces in `tmp/`, GitHub artifacts, or R2; do not commit them.

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
