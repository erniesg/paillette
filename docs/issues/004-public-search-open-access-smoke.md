# Public Search Open Access Smoke

depends-on: 002

## Goal

Add or run a public search smoke that proves open-access NGA records can be filtered and inspected through the Paillette search surface.

## Acceptance tests

- Public search can filter to the open-access collection or provider.
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

Prefer a fixture-backed API smoke first, then add a browser screenshot if the UI route is stable.

## Trade-offs

Fixture search coverage is cheaper than full staging ingest, but it may miss production indexing delays.

## Free-form response

Record selected route, filter parameters, and any missing fields needed before launch.
