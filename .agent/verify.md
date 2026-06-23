# Verification

Before claiming completion, run the evidence command and attach the manifest.

```bash
scripts/agent-evidence
```

Optional lanes are opt-in:

```bash
scripts/agent-evidence --e2e
scripts/agent-evidence --only=lint,type-check
# If wrapped in npm, pass flags after `--`: npm run agent:evidence -- --e2e
```

Validation lanes discovered:

- `lint`: `pnpm run lint` (required)
- `type-check`: `pnpm run typecheck` (required)
- `test`: `pnpm run test` (required)
- `build`: `pnpm run build` (required)

Deploy contract:

- `.agent/deploy.yaml` records provider-neutral deploy and infrastructure gates.
- Deploy, rollback, and infrastructure apply lanes require trusted context and human approval.
- `scripts/agent-evidence` does not execute secret-bearing deploy commands.
- When `.agent/storage.yaml` exists, `scripts/agent-evidence` records large untracked files over `repo_limit_mb` as manifest caveats and artifact entries.
- `infra/vm/verify.sh` is the reusable trusted-VM health and hardening check.
- Rucksack HITL setup uses GitHub issues as canonical state, Discord as a notification mirror, and the generated Cloudflare unlock portal as the browser UI for entering approved secret values into the target secret store.
- For the NGA launch queue, issue #18 R2/storage readiness must be accepted or explicitly held before issue #20 runs paid or bulk caption/vector work.
- Detected deploy/IaC hints:
  - `cloudflare` via `wrangler` from `apps/api/wrangler.toml, apps/web/wrangler.jsonc`.

Exit taxonomy:

- `0`: required validation passed
- `1`: required validation failed
- `2`: blocked by missing dependency or environment setup
- `3`: blocked by missing auth/secret or subscription/browser state
- `4`: blocked by required human decision
