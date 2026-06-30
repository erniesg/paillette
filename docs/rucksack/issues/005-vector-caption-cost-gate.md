# Vector Caption Cost Gate

depends-on: 003

## Goal

Estimate embedding/caption cost and define the Jina or equivalent model secret gate before scaling NGA ingestion.

## Acceptance tests

- The issue output includes estimated artwork count, embedding count, and cost/rate-limit assumptions.
- The R2/object-storage asset lane is configured or explicitly held before any paid caption/vector job runs.
- Secret names for embedding or caption providers are documented without values.
- The implementation refuses to run paid embedding/caption work when required provider secrets are absent.
- If an API provider is selected, Rucksack pings for the required secret name such as `JINA_API_KEY` and stops until it is configured in the approved secret store.
- If local image embeddings are selected, Rucksack verifies the local PyTorch/Transformers runtime and marks missing setup as human-required rather than falling back to paid API work.
- If local caption generation is selected, Rucksack verifies local model/runtime availability and marks missing setup as human-required rather than falling back to paid API work.
- If local model weights are missing, Rucksack emits a no-download cache-readiness artifact and pings for human approval instead of starting a large model download.
- The issue records one explicit path: defer generated vectors/captions for v1, approve a bounded Jina benchmark, or select and hold a bounded local benchmark until #18 R2 proof and local runtime verification are complete.

## Validation command

```bash
node --test scripts/__tests__/open-access-art-cost-gate.test.mjs
pnpm open:gate -- --manifest tmp/nga-launch-dry-run.json --image-embeddings=defer --caption-generation=defer --caption-embeddings=defer --out tmp/nga-cost-gate-defer-v1.json
pnpm open:gate -- --manifest tmp/nga-launch-dry-run.json --image-embeddings=jina --caption-generation=defer --caption-embeddings=defer --approve-bulk --out tmp/nga-cost-gate-jina-missing-secret.json
pnpm open:gate -- --manifest tmp/nga-launch-dry-run.json --image-embeddings=defer --caption-generation=local --caption-embeddings=defer --out tmp/nga-cost-gate-local-caption-decision.json
python3 eval/benchmark-local-image-embeddings.py --check-runtime --model jinaai/jina-clip-v2 --trust-remote-code --out tmp/nga-image-embedding-proof/runtime.json
python3 eval/benchmark-local-image-embeddings.py --check-model-cache --model jinaai/jina-clip-v2 --trust-remote-code --out tmp/nga-image-embedding-proof/model-cache.json
python3 eval/caption_open_access_art.py --check-runtime --metrics-out tmp/nga-caption-proof/runtime.json
python3 eval/caption_open_access_art.py --check-model-cache --metrics-out tmp/nga-caption-proof/model-cache.json
pnpm open:dry-run -- --providers=nga --sample-size=5 --sample-caption=missing --out=tmp/nga-missing-caption-dry-run.json
python3 eval/caption_open_access_art.py --manifest tmp/nga-missing-caption-dry-run.json --out tmp/nga-caption-proof/captions.jsonl --metrics-out tmp/nga-caption-proof/metrics.json --image-dir tmp/nga-caption-proof/images --limit=5 --prepare-only
pnpm test
pnpm typecheck
```

The Jina validation command is expected to exit `3` when `JINA_API_KEY` is not configured. That is the desired missing-secret gate; it must not call Jina or print secret values. The local image-embedding and local-caption checks are expected to exit `4` until the trusted-machine runtime and model caches are verified. These checks must not load model weights, download model files, embed images, generate captions, or call provider APIs. The prepare-only caption command may download a five-row missing-caption sample to `tmp/nga-caption-proof/images`; it must not load MLX, run model inference, or write generated captions.

## Allowed secrets

Only names such as `JINA_API_KEY` or provider-specific key names may be documented. Values must stay in the configured secret store.

## Artifact outputs

- Cost estimate note or JSON artifact, for example `tmp/nga-cost-gate-jina-missing-secret.json`.
- Image-embedding runtime-check artifact at `tmp/nga-image-embedding-proof/runtime.json`.
- Image-embedding model-cache artifact at `tmp/nga-image-embedding-proof/model-cache.json`.
- Runtime-check artifact at `tmp/nga-caption-proof/runtime.json`.
- Caption model-cache artifact at `tmp/nga-caption-proof/model-cache.json`.
- Prepare-only local caption proof files under `tmp/nga-caption-proof/`.
- Test output proving missing-secret behavior.
- `.agent/evidence/<run>/manifest.json` when available.

## Stop conditions

Stop before running paid batch generation, logging provider keys, writing generated media to Git, adding fallback API execution that bypasses the chosen secret gate, downloading large model weights without human approval, or running local bulk caption generation without verified local model/runtime/cache setup.

## Human clarification protocol

Ask for approval before running any paid or quota-consuming caption/vector job beyond the sample estimate. If the approved path needs an API key, ping for the key by name only and collect it through the approved secret store. If the approved path is local captioning, ping for local model/runtime/cache setup or model download approval if missing. Recommended v1 decision is to hold paid/quota-consuming work and launch with metadata plus institution captions only.

## Recommended response

Make the paid lane explicit and blocked-by-secret by default; keep public metadata ingestion separate from embedding generation. For v1, defer image embeddings, generated captions, and caption embeddings unless the human explicitly approves a bounded local or Jina benchmark. Missing `JINA_API_KEY` or missing local model/runtime setup is a HITL pause, not a reason to continue with another provider.

## Trade-offs

Cost gates slow full launch, but they prevent silent spend and ensure storage/rollback is ready before generated caption/vector artifacts exist.

## Free-form response

Add estimated per-provider cost, the confirmed storage gate status, the recommended first safe batch size, and the explicit v1 decision: defer vectors/caption generation or approve a named bounded benchmark.
