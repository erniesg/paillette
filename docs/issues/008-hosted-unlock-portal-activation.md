# Hosted Unlock Portal Activation

## Goal

Activate the hosted Rucksack unlock portal, or explicitly hold it, so humans can unlock NGA R2 and caption/vector gates from GitHub or Discord without SSHing back into the VM.

## Acceptance tests

- The repo contains the unlock portal scaffold under `infra/cloudflare/rucksack-unlock-portal`.
- The portal is constrained to `erniesg/paillette` with `ALLOWED_REPOS`, protected by Cloudflare Access, and uses a Worker secret named `GITHUB_TOKEN`.
- The trusted Rucksack runtime has `RUCKSACK_UNLOCK_BASE_URL` set after deploy, or the issue is explicitly held with browser-only GitHub secret setup as the fallback.
- A fresh `rucksack autopilot status erniesg/paillette --execute --notify-github --repo-root .` updates #18 and #20 with either per-issue unlock links or an explicit missing-portal state.
- No secret values are written to files, logs, manifests, GitHub issues, PR comments, or Discord messages.

## Validation command

Secretless scaffold check, safe before the Worker is deployed:

```bash
test -f infra/cloudflare/rucksack-unlock-portal/wrangler.jsonc
test -f infra/cloudflare/rucksack-unlock-portal/src/index.js
test -f infra/cloudflare/rucksack-unlock-portal/README.md
cd infra/cloudflare/rucksack-unlock-portal
node --check src/index.js
node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync("wrangler.jsonc","utf8")); const repos=String(c.vars?.ALLOWED_REPOS||"").split(",").map((s)=>s.trim()).filter(Boolean); if(!repos.includes("erniesg/paillette")){ console.error("ALLOWED_REPOS must include erniesg/paillette"); process.exit(2); }'
PYTHONPATH=/path/to/rucksack/src python3 -m rucksack autopilot status erniesg/paillette --repo-root . --execute --notify-github
```

Hosted deploy, only after Cloudflare Access and a scoped GitHub writer token are approved through the secret store:

```bash
cd infra/cloudflare/rucksack-unlock-portal
npm install
npx wrangler types
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

Do not paste token, webhook, R2, Cloudflare, Jina, or app env values into the issue.

## Allowed secrets

Only names may appear, such as `GITHUB_TOKEN`, `RUCKSACK_UNLOCK_BASE_URL`, `DISCORD_WEBHOOK_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `ANVIL_R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, or `JINA_API_KEY`. Values must stay in the approved secret store.

## Artifact outputs

- Unlock portal deploy URL or an explicit hold decision.
- Updated GitHub digest links for #18 and #20.
- Cloudflare Access policy name or screenshot reference, stored as evidence without secrets.
- `.agent/evidence/<run>/manifest.json` when available.

## Stop conditions

Stop if Cloudflare auth is unavailable, if Cloudflare Access is not protecting the portal, if `ALLOWED_REPOS` is empty or broader than the approved repo set, if the GitHub token scope is unclear, if submitting app env values would replace an existing bundle without human acknowledgement, or if any command would print or store secret values.

## Human clarification protocol

Ask the human to choose one path: deploy the hosted portal, use browser-only GitHub/Cloudflare secret setup for this launch, or hold the launch gates. If the portal is deployed, ask for the Worker URL to be stored as `RUCKSACK_UNLOCK_BASE_URL` in the trusted Rucksack runtime. If the portal is held, refresh GitHub with `--notify-github` so the digest states that hosted unlock is missing and lists the browser-only fallback.

## Recommended response

Prefer deploying the hosted portal before expecting unattended GitHub or Discord pings to collect missing R2 or Jina setup. Keep GitHub issues as the canonical decision log, Discord as a mirror, and the portal as the browser UI for entering approved secret values into GitHub/Cloudflare secret stores.

## Trade-offs

The portal adds Cloudflare Access and token-management setup, but it removes the need for the human to return to the VM when Rucksack reaches a secret or provider gate.

## Free-form response

Record whether the portal was deployed or held, the non-secret Worker URL or fallback path, the approved repo allowlist, the Access policy evidence, and the refreshed issue digest URLs.
