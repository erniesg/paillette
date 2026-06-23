# Vector Caption Cost Gate

depends-on: 001

## Goal

Estimate embedding/caption cost and define the Jina or equivalent model secret gate before scaling NGA ingestion.

## Acceptance tests

- The issue output includes estimated artwork count, embedding count, and cost/rate-limit assumptions.
- Secret names for embedding or caption providers are documented without values.
- The implementation refuses to run paid embedding/caption work when required provider secrets are absent.
- If an API provider is selected, Rucksack pings for the required secret name such as `JINA_API_KEY` and stops until it is configured in the approved secret store.
- If local caption generation is selected, Rucksack verifies local model/runtime availability and marks missing setup as human-required rather than falling back to paid API work.

## Validation command

```bash
node --test scripts/__tests__/open-access-art-cost-gate.test.mjs
pnpm open:gate -- --manifest tmp/nga-dry-run.json --image-embeddings=jina --caption-generation=defer --caption-embeddings=defer --approve-bulk
pnpm test
pnpm typecheck
```

The Jina validation command is expected to exit `3` when `JINA_API_KEY` is not
configured. That is the desired missing-secret gate; it must not call Jina or
print secret values.

## Allowed secrets

Only names such as `JINA_API_KEY` or provider-specific key names may be documented. Values must stay in the configured secret store.

## Artifact outputs

- Cost estimate note or JSON artifact, for example `tmp/nga-cost-gate-jina-missing-secret.json`.
- Test output proving missing-secret behavior.
- `.agent/evidence/<run>/manifest.json` when available.

## Stop conditions

Stop before running paid batch generation, logging provider keys, adding fallback API execution that bypasses the chosen secret gate, or running local bulk caption generation without verified local model/runtime setup.

## Human clarification protocol

Ask for approval before running any paid or quota-consuming caption/vector job beyond the sample estimate. If the approved path needs an API key, ping for the key by name only and collect it through the approved secret store. If the approved path is local captioning, ping for local model/runtime setup if missing. Recommended v1 decision is to hold paid/quota-consuming work and launch with metadata plus institution captions only.

## Recommended response

Make the paid lane explicit and blocked-by-secret by default; keep public metadata ingestion separate from embedding generation. For v1, defer image embeddings, generated captions, and caption embeddings unless the human explicitly approves a bounded local or Jina benchmark. Missing `JINA_API_KEY` or missing local model/runtime setup is a HITL pause, not a reason to continue with another provider.

## Trade-offs

Cost gates slow full launch, but they prevent silent spend and make batch size decisions reviewable.

## Free-form response

Add estimated per-provider cost, the recommended first safe batch size, and the explicit v1 decision: defer vectors/caption generation or approve a named bounded benchmark.
