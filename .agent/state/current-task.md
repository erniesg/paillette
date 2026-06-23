# Current Task

- Issue/PR: GitHub issues #16-#21, local specs in `docs/issues/`
- Branch: `codex/open-access-art-ingest`
- Lane: portable now; trusted-vm for local caption/model work; deploy only after HITL approval
- Objective: Use Rucksack to launch the NGA slice of Paillette's `open-access-art` collection with dry-run, local asset proof, caption/vector cost gate, and staged deploy evidence.
- Last checkpoint: `.agent/state/latest-checkpoint.md`
- Next action: Wait for human decisions on storage issue #18 and vector/caption issue #20 before any paid, quota-consuming, upload, queue enqueue, or D1 apply job. Live R2 upload/enqueue now fails unless an approved bucket is passed with `--bucket` or recorded as a nonempty `.agent/storage.yaml` bucket.
- Human decision needed: yes
