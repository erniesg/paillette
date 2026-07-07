# Public Search Open Access Smoke

depends-on: 002

## Goal

Add or run a public search smoke that proves open-access NGA records can be filtered and inspected through the Paillette search surface without treating the `open` API alias as a human-facing UI route.

## Acceptance tests

- Fixture/API search can use `open` or `open-access-art` as an org alias only when it records the upstream equivalent as `/orgs/open-access-art/search/text`.
- Human-facing staging UI proof must use the canonical route tracked by issue 010, currently `https://paillette-stg.berlayar.ai/collections/open-access-art/search`, or the deployed short equivalent `https://paillette-stg.berlayar.ai/open-access-art/search`.
- Do not use `/open/search`, `/collections/open/search`, singular `/collection/open-access-art/search`, `/collections/open-access-art/nga/search`, or `/ngs/search` as NGA Washington UI proof routes unless a future route change explicitly adds them and records redirect behavior.
- At least one NGA result exposes title, image/crop reference, provenance, and collection metadata.
- The smoke can run against local or staging fixtures without production-only credentials.

## Validation command

```bash
pnpm test
pnpm typecheck
```

## Allowed secrets

None for fixture smoke tests. Staging endpoint names may be referenced without tokens.

## Artifact outputs

- Test file or smoke log.
- Screenshot or JSON response sample when browser/API smoke is available.
- `.agent/evidence/<run>/manifest.json` when available.

## Stop conditions

Stop if the only way to validate search is to expose private datasets, private tokens, or unreviewed production writes.

## Human clarification protocol

Ask which public route is launch-critical only if multiple current search routes can serve NGA and no existing README/docs pick one.

## Recommended response

Prefer a fixture-backed API smoke first, then use issue 010 for browser/staging route proof once the UI route is deployed and reviewed.

## Trade-offs

Fixture search coverage is cheaper than full staging ingest, but it may miss production indexing delays.

## Free-form response

Record the selected API alias or UI route, filter parameters, and any missing fields needed before launch.
