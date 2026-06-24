# Current Task

- Issue/PR: GitHub issues #16-#21, local specs in `docs/issues/`
- Branch: `codex/open-access-art-ingest`
- Lane: portable now; trusted-vm for local caption/model work; deploy only after HITL approval
- Objective: Use Rucksack to launch the NGA slice of Paillette's `open-access-art` collection with dry-run, local asset proof, caption/vector cost gate, and staged deploy evidence.
- Last checkpoint: `.agent/state/latest-checkpoint.md`
- Next action: Use PR #24, `.agent/state/decisions.md`, and `docs/nga-launch-readiness.md` to ask for the recommended v1 decision: deploy/use the Rucksack unlock portal if browser-based setup is needed, approve only a bounded R2 staging upload after bucket/secret setup, defer caption/vector provider work unless explicitly approved, and keep launch issue #21 held until the evidence is attached. Live R2 upload/enqueue now fails unless an approved bucket is passed with `--bucket` or recorded as a nonempty `.agent/storage.yaml` bucket.
- Human decision needed: yes
