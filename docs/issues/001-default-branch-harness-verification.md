# Default Branch Rucksack Harness Verification

## Goal

After the Rucksack harness lands on `master`, verify that the default branch can run the issue ledger, autopilot status, build handoff, and evidence artifact paths without relying on the NGA ingest branch.

## Acceptance tests

- `rucksack autopilot status erniesg/paillette --repo-root . --execute` reports the default-branch workflows as available after this harness is merged.
- `scripts/agent-evidence` runs from a clean checkout and includes the `workflow-contracts` lane.
- The GitHub Actions evidence artifacts include `.agent/evidence/*/manifest.json` even though `.agent` is a hidden directory.
- No secret values are written to files, logs, issues, PR comments, or manifests.

## Validation command

```bash
node --test scripts/__tests__/rucksack-workflows.test.mjs
scripts/agent-evidence
PYTHONPATH=/path/to/rucksack/src python3 -m rucksack autopilot status erniesg/paillette --repo-root . --execute
```

## Allowed secrets

None. This issue verifies workflow presence, labels, evidence artifacts, and queue state only.

## Artifact outputs

- `.agent/evidence/<run>/manifest.json`
- GitHub Actions artifact download command for the evidence run.
- Rucksack autopilot status output copied into the issue or PR.

## Stop conditions

Stop if verification would require deploy secrets, Cloudflare tokens, R2 credentials, Codex/Claude subscription login, or live provider mutation.

## Human clarification protocol

If default-branch workflows remain unavailable after merge, ask the maintainer whether the harness PR was merged, blocked by branch protection, or disabled in repository Actions settings.

## Recommended response

Keep this issue as a post-merge smoke check for the harness itself. NGA ingest, R2 upload, caption generation, and vector embedding decisions remain in the separate launch queue.

## Trade-offs

This issue intentionally verifies only the default-branch harness. It does not prove that the NGA ingest branch is launch-ready, but it lets the repo run Rucksack schedules and VM handoffs before the larger NGA PR is merged.

## Free-form response

Record the workflow run URLs, artifact download commands, manifest result, and any remaining repository settings needed before scheduled queue drains can run unattended.
