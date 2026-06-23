# Launch Evidence And Rollback

depends-on: 003,004,005

## Goal

Collect the evidence pack needed to launch the NGA collection and document rollback or disablement steps for data, assets, and search exposure.

## Acceptance tests

- Evidence links cover dry-run, D1 plan, asset plan, public search smoke, and cost gate.
- Rollback notes identify how to hide the collection, remove queued batches, and delete staged object keys if needed.
- No screenshots, manifests, or logs contain secret values.

## Validation command

```bash
pnpm test
pnpm typecheck
```

## Allowed secrets

No secret values. Use only secret names and links to approved GitHub artifacts or object-store evidence.

## Artifact outputs

- `docs/nga-launch-readiness.md` launch checklist and evidence markdown.
- Search/API screenshot or JSON sample.
- Rollback notes with reviewed commands in dry-run form.

## Stop conditions

Stop before live launch if any upstream evidence issue is missing, if rollback is unclear, or if generated artifacts exceed storage policy.

## Human clarification protocol

Ask the human to approve live launch only after all evidence links and rollback notes are present.

## Recommended response

Summarize launch readiness in one comment with links to evidence and a clear approve/hold decision path.

## Trade-offs

The launch pack adds process overhead, but it gives autonomous agents a concrete definition of done for production-facing public art.

## Free-form response

Add final launch caveats, unresolved risks, and the recommended approve/hold decision.
