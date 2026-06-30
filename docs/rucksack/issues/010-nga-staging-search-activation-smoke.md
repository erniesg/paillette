# NGA Staging Search Activation Smoke

depends-on: 003,004,006

## Goal

Prove that National Gallery of Art, Washington records can be searched through the correct Paillette staging public search surface after the ingest/search branch and R2 proof are reviewed.

This issue must not conflate National Gallery Singapore with National Gallery of Art, Washington:

- `https://paillette-stg.berlayar.ai/ngs/search` is the existing National Gallery Singapore public route.
- `ngs` is reserved for National Gallery Singapore.
- NGA Washington records belong under the Open Access Art aggregate/source flow, not the `ngs` route.
- The canonical collection-form staging UI route is `https://paillette-stg.berlayar.ai/collections/open-access-art/search`.
- `https://paillette-stg.berlayar.ai/open-access-art/search` is the current short deployed UI equivalent.
- Provider or institution identity belongs in API/results metadata and filters, not in an extra UI path segment.
- Do not use `https://paillette-stg.berlayar.ai/collections/open-access-art/nga/search` or `https://paillette-stg.berlayar.ai/collection/open-access-art/nga/search` as passing UI proof routes unless a future route change explicitly adds them.
- `open` is an API/org alias only. Do not use `https://paillette-stg.berlayar.ai/open/search` or `https://paillette-stg.berlayar.ai/collections/open/search` as UI proof routes unless a future route change explicitly adds them.
- Singular `https://paillette-stg.berlayar.ai/collection/open-access-art/search` is not a valid deployed route today.

## Acceptance tests

- Record `https://paillette-stg.berlayar.ai/collections/open-access-art/search` as the canonical collection-form UI route for Open Access Art / NGA Washington search, with `https://paillette-stg.berlayar.ai/open-access-art/search` as the short deployed equivalent.
- The selected public UI route renders the public search experience and returns NGA Washington / Open Access Art records after the dependent ingest/search work is available.
- The internal public text-search smoke uses the app route shape `/api/public-search/:orgId/text` only as an API/org alias path. `:orgId` may be `open` or `open-access-art`, but the canonical upstream request to record is `/orgs/open-access-art/search/text` or the current equivalent.
- At least one result includes title, image URL or thumbnail URL, accession/source record id, source institution or provider metadata identifying National Gallery of Art / `nga`, source collection when available, and source URL.
- Do not use `/ngs/search` to prove NGA Washington search. Keep `/ngs/search` only as a National Gallery Singapore regression/control smoke if needed.
- Do not use `/open/search`, `/collections/open/search`, `/collections/open-access-art/nga/search`, singular `/collection/open-access-art/search`, or singular `/collection/open-access-art/nga/search` as passing UI routes unless a future PR intentionally adds those routes and records the redirect behavior.
- Search output excludes known hidden/private records according to the public visibility filter.
- The smoke records the selected route, query, environment, result count, redirect/preferred-route behavior, and a redacted JSON response sample or screenshot.
- The smoke does not require production-only credentials and does not perform D1 writes, queue enqueue, R2 uploads, vector upserts, caption generation, or deploys.

## Validation command

Use the existing fixture smoke before staging credentials exist:

```bash
pnpm --filter @paillette/web test -- app/routes/__tests__/public-search-text-route.test.ts
pnpm test
pnpm typecheck
```

After #18 and the ingest/search PR are reviewed, add a bounded staging smoke command or documented manual smoke using only approved staging endpoint names. Keep secret values out of logs, screenshots, issue comments, PRs, manifests, and docs. Automated staging smokes should include `usageContext: { "auto": true }` when using `/api/public-search/.../text` so they do not create public usage events.

## Allowed secrets

None for fixture smoke tests. For staging smoke, only reference approved secret names such as `PAILLETTE_PUBLIC_SEARCH_API_KEY`, `PAILLETTE_API_URL`, `API_URL`, or `VITE_API_URL`; never write values.

## Artifact outputs

- `docs/nga-staging-search-smoke.md` or an equivalent launch-readiness section with the canonical staging UI route, internal API route alias, query, environment, result count, and redacted sample.
- Optional screenshot or JSON sample with no secret values.
- `.agent/evidence/<run>/manifest.json` when available.

## Stop conditions

Stop if the only working route found for NGA Washington is `/ngs/search`, if the only proposed passing route is `/open/search`, `/collections/open/search`, `/collections/open-access-art/nga/search`, singular `/collection/open-access-art/search`, or singular `/collection/open-access-art/nga/search`, if this would duplicate the draft search implementation from PR #22 on `master`, expose private data, require production-only credentials, mutate staging/prod data, upload assets, enqueue jobs, upsert vectors, generate paid captions, or deploy before review approval.

## Human clarification protocol

If the staging route is not deployed yet, keep this issue blocked and point to the PR/issue dependencies. If future Open Access Art UI routes are added, record the canonical route, any redirects, and the preferred route id before proceeding.

## Recommended response

Treat #19 as fixture/API search contract proof, #18 as storage proof, and this issue as the post-review staging activation smoke. Do not claim live NGA search is launched until this issue has a staging artifact and #21 is updated.

## Trade-offs

A fixture smoke proves the route contract cheaply, but a staging smoke is still needed to catch deployment, auth, cache, route alias, and data-indexing issues.

## Free-form response

Record the staging host, canonical UI route, short route, internal API alias, result metadata, query, environment, redirect behavior, and any remaining launch caveats.
