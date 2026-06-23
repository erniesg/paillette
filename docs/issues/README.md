# Rucksack Issue Ledger

This directory stores reviewable markdown issue specs for `erniesg/paillette`.

Generate or update specs with:

```bash
rucksack github issues plan erniesg/paillette --repo-root . --issue-dir docs/issues --execute
```

After reviewing the generated specs, seed or update GitHub issues:

```bash
rucksack github issues seed erniesg/paillette --issue-dir docs/issues --label rucksack-ledger --label rucksack-queued --execute
gh workflow run rucksack-autopilot.yml --repo erniesg/paillette -f action=queue
```

The GitHub issues are the live queue. Use `/rucksack run #123`, `/rucksack queue`,
or labels such as `rucksack-queued` and `rucksack-run` to dispatch work. When
Rucksack asks for a decision, reply `/rucksack accept`, `/rucksack approve`, or
`/rucksack resolve` on the issue to clear decision/blocker labels and queue it.

Issue specs may include optional top-level metadata immediately under the
`# Title`:

```yaml
provider: claude
depends-on: 001,002
```

`provider` routes one issue to `codex-action`, `vm-codex`, or `claude` while
unmarked issues use the repo default. `depends-on` keeps an issue queued until
each dependency is closed or labeled `rucksack-awaiting-review`; dependency
cycles are rejected when specs are seeded.

## Label state machine

These labels are Rucksack's GitHub Issues state machine. They are not topic
tags; they let GitHub Actions, a trusted VM, and humans recover queue state from
the repository without a separate database.

| Label | Meaning |
|---|---|
| `rucksack-ledger` | Generated or synced from markdown specs. |
| `rucksack-queued` | Ready for the queue drain. |
| `rucksack-run` | Manual run-this-now trigger. |
| `rucksack-running` | Build workflow is running or leased. |
| `rucksack-needs-clarification` | Definition of done is unclear; ask/ping before building. |
| `rucksack-needs-decision` | Rucksack recommended a path and needs human approval. |
| `rucksack-needs-human` | Human login/secret/action is required. |
| `rucksack-provider-limited` | Provider quota or subscription limit paused this issue. |
| `rucksack-out-of-work` | No ready implementation work remains; recommend or seed more. |
| `rucksack-blocked` | Failed, held, or waiting on external action. |
| `rucksack-awaiting-review` | PR/evidence is ready for review. |

The installed `.github/workflows/rucksack-ledger.yml` workflow can refresh this
directory from repo context through the Codex app-server planner, seed/update
GitHub issues, and open a review PR for changed specs.
