# Open Access NGA Dry Run

## Goal

Run a small NGA open-access ingestion dry-run and prove Paillette can count candidate artworks, captions, and provider metadata without mutating production data.

## Acceptance tests

- `open:dry-run` runs for provider `nga` with a small sample size and writes a local manifest under `tmp/`.
- The manifest includes provider, accession or object id, title, image URL or asset reference, and caption/provenance fields for every sampled artwork.
- The dry-run summary records skipped items and why they were skipped.

## Validation command

```bash
pnpm open:dry-run -- --providers=nga --sample-size=5 --out=tmp/nga-dry-run.json
pnpm test
pnpm typecheck
```

## Allowed secrets

None for the dry-run. Use public NGA collection access only.

## Artifact outputs

- `tmp/nga-dry-run.json`
- Dry-run console output copied into the issue or evidence manifest.
- `.agent/evidence/<run>/manifest.json` when available.

## Stop conditions

Stop if the run would write to production D1, enqueue production work, upload assets, or require a private provider token.

## Human clarification protocol

Ask for provider scope only if NGA exposes multiple incompatible open-access endpoints and the safest default cannot be inferred from existing scripts.

## Recommended response

Keep the sample small and deterministic, then summarize counts, skipped reasons, and any schema mismatch before proposing broader ingestion.

## Trade-offs

A sample of five artworks is not launch coverage, but it proves the parser and manifest shape before spending queue or asset bandwidth.

## Free-form response

Add notes about collection filters, sample IDs, and any metadata fields that need follow-up mapping.
