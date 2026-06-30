# Launch Evidence And Rollback

depends-on: 003,004,005,008

## Goal

Collect the evidence pack needed to launch the NGA collection and document rollback or disablement steps for data, assets, and search exposure.

## Acceptance tests

- Evidence links cover dry-run, D1 plan, asset plan, public search smoke, cost gate, and hosted unlock portal activation or hold decision.
- `tmp/rucksack-human-gates-readiness.json` summarizes #26/#18/#20 readiness before launch review or repeated human pings.
- Rollback notes identify how to hide the collection, remove queued batches, and delete staged object keys if needed.
- No screenshots, manifests, or logs contain secret values.

## Validation command

```bash
node scripts/rucksack-human-gates-readiness.mjs --repo erniesg/paillette --manifest tmp/nga-launch-dry-run.json --out tmp/rucksack-human-gates-readiness.json
pnpm test
pnpm typecheck
```

## Allowed secrets

No secret values. Use only secret names and links to approved GitHub artifacts or object-store evidence.

## Artifact outputs

- `docs/nga-launch-readiness.md` launch checklist and evidence markdown.
- `tmp/rucksack-human-gates-readiness.json` with current #26/#18/#20 missing names and decisions.
- Search/API screenshot or JSON sample.
- Rollback notes with reviewed commands in dry-run form.

## Stop conditions

Stop before live launch if any upstream evidence issue is missing, if rollback is unclear, or if generated artifacts exceed storage policy.

## Human clarification protocol

Ask the human to approve live launch only after all evidence links and rollback notes are present. If #18 or #20 is not resolved, keep launch held and point to `docs/nga-launch-readiness.md` for the recommended v1 decision packet.

## Recommended response

Summarize launch readiness in one comment with links to evidence and a clear approve/hold decision path.

## Trade-offs

The launch pack adds process overhead, but it gives autonomous agents a concrete definition of done for production-facing public art.

## Free-form response

Add final launch caveats, unresolved risks, and the recommended approve/hold decision. The default hold decision is: defer vectors/caption generation, complete a bounded R2 staging upload first, then request launch approval with branch, environment, bucket, first batch size, and rollback owner.
