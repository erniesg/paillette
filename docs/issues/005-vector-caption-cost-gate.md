# Vector Caption Cost Gate

depends-on: 001

## Goal

Estimate embedding/caption cost and define the Jina or equivalent model secret gate before scaling NGA ingestion.

## Acceptance tests

- The issue output includes estimated artwork count, embedding count, and cost/rate-limit assumptions.
- Secret names for embedding or caption providers are documented without values.
- The implementation refuses to run paid embedding/caption work when required provider secrets are absent.

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

Stop before running paid batch generation, logging provider keys, or adding fallback API execution that bypasses the chosen secret gate.

## Human clarification protocol

Ask for approval before running any paid or quota-consuming caption/vector job beyond the sample estimate. Recommended v1 decision is to hold paid/quota-consuming work and launch with metadata plus institution captions only.

## Recommended response

Make the paid lane explicit and blocked-by-secret by default; keep public metadata ingestion separate from embedding generation. For v1, defer image embeddings, generated captions, and caption embeddings unless the human explicitly approves a bounded local or Jina benchmark.

## Trade-offs

Cost gates slow full launch, but they prevent silent spend and make batch size decisions reviewable.

## Free-form response

Add estimated per-provider cost, the recommended first safe batch size, and the explicit v1 decision: defer vectors/caption generation or approve a named bounded benchmark.
