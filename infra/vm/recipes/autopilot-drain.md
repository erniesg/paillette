# Rucksack Autopilot Drain Timer

This repo includes a user-level systemd timer for a trusted VM to drain
VM-routed GitHub Issues into detached Codex/Claude sessions.

Prerequisites on the VM:

```bash
command -v rucksack
command -v gh
rucksack github token erniesg/paillette --role developer --execute >/dev/null
```

Install or update the timer from the repository root:

```bash
rucksack vm autopilot install-timer erniesg/paillette --repo-root . --profile dev-vm --execute
```

Manual equivalent:

```bash
mkdir -p ~/.config/systemd/user
cp infra/vm/systemd/rucksack-autopilot-erniesg-paillette-drain.service ~/.config/systemd/user/
cp infra/vm/systemd/rucksack-autopilot-erniesg-paillette-drain.timer ~/.config/systemd/user/
loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user enable --now rucksack-autopilot-erniesg-paillette-drain.timer
systemctl --user list-timers rucksack-autopilot-erniesg-paillette-drain.timer
systemctl --user status rucksack-autopilot-erniesg-paillette-drain.timer
```

`loginctl enable-linger "$USER"` lets the trusted VM keep the user timer active
after the SSH session disconnects.

Inspect runs:

```bash
journalctl --user -u rucksack-autopilot-erniesg-paillette-drain.service -f
```

Manual equivalent:

```bash
rucksack autopilot work-queue erniesg/paillette --provider vm-codex --max-workers 2 --local --execute
```

When GitHub comments a `vm-codex` or `claude` provider handoff, run the VM
issue worker from the trusted machine:

```bash
rucksack autopilot work erniesg/paillette --issue ISSUE_NUMBER --provider vm-codex --execute
```

The worker uses the existing VM checkout and local `gh`/agent auth stores,
pushes a provider branch, and opens or reuses a PR.

The Codex VM worker uses `--sandbox danger-full-access` because common free OCI
VMs cannot run Codex's bubblewrap workspace sandbox. Use it only on trusted or
disposable VM worktrees with repo-scoped credentials.

The timer file contains only repo names and command flags. It mints a
short-lived repo-scoped Rucksack GitHub App token at runtime; keep App PEMs and
provider auth stores on the VM, not in this repository.
