# Hosted Unlock Portal Activation

## Goal

Activate the hosted Rucksack unlock portal, or explicitly hold it, so humans can unlock NGA R2 and caption/vector gates from GitHub or Discord without SSHing back into the VM.

## Acceptance tests

- The repo contains the unlock portal scaffold under `infra/cloudflare/rucksack-unlock-portal`.
- The portal is constrained to `erniesg/paillette` with `ALLOWED_REPOS`, protected by Cloudflare Access, and uses a Worker secret named `GITHUB_TOKEN` sourced from `RUCKSACK_UNLOCK_PORTAL_GITHUB_TOKEN` in the trusted deploy shell.
- The portal fails closed when `GITHUB_TOKEN` is missing and rejects cross-origin unlock form submissions.
- `unlock-portal-readiness-check` writes `tmp/unlock-portal-readiness.json` and returns a structured exit code before any Worker secret write or deploy attempt.
- The trusted Rucksack runtime has `RUCKSACK_UNLOCK_BASE_URL` set after deploy, the status refresh passes `--unlock-base-url`, or the issue is explicitly held with browser-only GitHub secret setup as the fallback.
- A fresh `rucksack autopilot status erniesg/paillette --execute --notify-github --repo-root .` updates #18 and #20 with either per-issue unlock links or an explicit missing-portal state.
- No secret values are written to files, logs, manifests, GitHub issues, PR comments, or Discord messages.

## Validation command

Secretless scaffold check, safe before the Worker is deployed:

```bash
node scripts/rucksack-unlock-portal-readiness.mjs --repo erniesg/paillette --out tmp/unlock-portal-readiness.json
PYTHONPATH=/path/to/rucksack/src python3 -m rucksack autopilot status erniesg/paillette --repo-root . --execute --notify-github
```

Hosted deploy, only after Cloudflare Access and a scoped GitHub writer token are approved through the secret store:

```bash
node scripts/rucksack-unlock-portal-readiness.mjs --repo erniesg/paillette --out tmp/unlock-portal-readiness.json
cd infra/cloudflare/rucksack-unlock-portal
npm install
npx wrangler types
printf '%s' "$RUCKSACK_UNLOCK_PORTAL_GITHUB_TOKEN" | npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
PYTHONPATH=/path/to/rucksack/src python3 -m rucksack autopilot status erniesg/paillette --repo-root . --execute --notify-github --unlock-base-url https://<worker>.<account>.workers.dev
```

Expected readiness exits: `0` ready, `2` scaffold/configuration failure, `3` missing trusted runner auth or secret name, `4` missing human Cloudflare Access confirmation.

Do not paste token, webhook, R2, Cloudflare, Jina, or app env values into the issue.

## Allowed secrets

Only names may appear, such as `GITHUB_TOKEN`, `RUCKSACK_UNLOCK_PORTAL_GITHUB_TOKEN`, `RUCKSACK_UNLOCK_PORTAL_ACCESS_CONFIRMED`, `RUCKSACK_UNLOCK_BASE_URL`, `DISCORD_WEBHOOK_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `ANVIL_R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, or `JINA_API_KEY`. Values must stay in the approved secret store. `RUCKSACK_UNLOCK_PORTAL_ACCESS_CONFIRMED` is a non-secret trusted-runtime confirmation, not a credential.

## Artifact outputs

- Unlock portal deploy URL or an explicit hold decision.
- `tmp/unlock-portal-readiness.json` with names-only readiness, missing-auth, or human-decision state.
- Updated GitHub digest links for #18 and #20.
- Cloudflare Access policy name or screenshot reference, stored as evidence without secrets.
- `.agent/evidence/<run>/manifest.json` when available.

## Stop conditions

Stop if `unlock-portal-readiness-check` exits `2`, `3`, or `4`; if Cloudflare auth is unavailable; if `RUCKSACK_UNLOCK_PORTAL_GITHUB_TOKEN` is unavailable in the trusted deploy shell; if Cloudflare Access is not protecting the portal; if `ALLOWED_REPOS` is empty or broader than the approved repo set; if the GitHub token scope is unclear; if submitting app env values would replace an existing bundle without human acknowledgement; or if any command would print or store secret values.

## Human clarification protocol

Ask the human to choose one path: deploy the hosted portal, use browser-only GitHub/Cloudflare secret setup for this launch, or hold the launch gates. If the portal is deployed, ask for the Worker URL to be stored as `RUCKSACK_UNLOCK_BASE_URL` in the trusted Rucksack runtime or passed as `--unlock-base-url` when refreshing pings. If the portal is held, refresh GitHub with `--notify-github` so the digest states that hosted unlock is missing and lists the browser-only fallback.

## Recommended response

Prefer deploying the hosted portal before expecting unattended GitHub or Discord pings to collect missing R2 or Jina setup. Keep GitHub issues as the canonical decision log, Discord as a mirror, and the portal as the browser UI for entering approved secret values into GitHub/Cloudflare secret stores.

## Trade-offs

The portal adds Cloudflare Access and token-management setup, but it removes the need for the human to return to the VM when Rucksack reaches a secret or provider gate.

## Free-form response

Record whether the portal was deployed or held, the non-secret Worker URL or fallback path, the approved repo allowlist, the Access policy evidence, and the refreshed issue digest URLs.
