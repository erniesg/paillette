# Staging Search Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore approved-user artwork images, preserve text retrieval while colour re-ranks it, and put a runnable text-search console at the top of the API docs.

**Architecture:** Internal API asset URLs are rewritten to the existing authenticated same-origin backend proxy. Search state stores the text query and colour target independently, while the existing palette sorter re-ranks the text result set. The docs reuse the existing endpoint request builder and proxy in a focused quick-search component.

**Tech Stack:** Remix, React 18, TypeScript, TanStack Query, Vitest, Cloudflare Workers, WorkOS AuthKit.

## Global Constraints

- Artwork images remain unavailable without an approved WorkOS-backed session.
- Colour re-ranks the active text candidate set and never applies a hard threshold.
- Clearing colour restores the same text query and text-ranked results.
- Existing REST endpoints, generated code samples, and MCP reference remain intact.
- Tests must be observed failing before production code is changed.

---

### Task 1: Authenticated artwork image URLs

**Files:**
- Modify: `apps/web/app/lib/public-artwork-metadata.ts`
- Test: `apps/web/app/lib/__tests__/public-artwork-metadata.test.ts`
- Test: `apps/web/app/routes/__tests__/access-proxy-routes.test.ts`

**Interfaces:**
- Consumes: canonical Paillette asset URL `/api/v1/assets/:id/content`.
- Produces: `toAuthenticatedAssetUrl(url: string | null): string | null`, returning `/api/backend/assets/:id/content` only for configured Paillette API asset hosts.

- [ ] **Step 1: Write failing URL-rewrite and streamed-image tests**

```ts
expect(
  toAuthenticatedAssetUrl(
    'https://paillette-api-stg.berlayar.ai/api/v1/assets/a/content'
  )
).toBe('/api/backend/assets/a/content');
expect(toAuthenticatedAssetUrl('https://images.example/a.jpg')).toBe(
  'https://images.example/a.jpg'
);
```

Add a proxy-route test whose WorkOS session has an access token and whose
upstream response is `image/jpeg`; assert status, body bytes, content type, and
`Cache-Control: private, no-store` are preserved.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --dir apps/web test -- app/lib/__tests__/public-artwork-metadata.test.ts app/routes/__tests__/access-proxy-routes.test.ts`

Expected: FAIL because `toAuthenticatedAssetUrl` is absent and public image getters still return the protected API origin.

- [ ] **Step 3: Implement the minimal rewrite**

```ts
export const toAuthenticatedAssetUrl = (value: string | null) => {
  if (!value) return null;
  const parsed = new URL(value);
  if (!/^paillette-api(?:-stg)?\.berlayar\.ai$/i.test(parsed.hostname)) {
    return value;
  }
  const match = parsed.pathname.match(/^\/api\/v1\/(assets\/[^/]+\/content)$/);
  return match ? `/api/backend/${match[1]}` : value;
};
```

Apply it to `getPublicImageUrl` and `getPublicThumbnailUrl` after catalogue
selection and placeholder suppression.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/public-artwork-metadata.ts apps/web/app/lib/__tests__/public-artwork-metadata.test.ts apps/web/app/routes/__tests__/access-proxy-routes.test.ts
git commit -m "fix: proxy authenticated artwork images"
```

### Task 2: Additive text-plus-colour state

**Files:**
- Modify: `apps/web/app/routes/galleries.$galleryId.search.tsx`
- Create: `apps/web/app/routes/__tests__/search-colour-refinement.test.ts`

**Interfaces:**
- Consumes: committed text query, optional search facet, selected colour id.
- Produces: URL params containing `q`, optional `field`, and optional `colour`; the existing `sortResults(..., 'colour', [selection])` re-ranks the unchanged text results.

- [ ] **Step 1: Write failing state and ranking tests**

```ts
expect(getSearchParamsForQuery('batik pattern', null, 'gold')).toEqual({
  q: 'batik pattern',
  colour: 'gold',
});
expect(getColourRefinementQuery('batik pattern', 'gold')).toBe(
  'batik pattern'
);
```

Add a two-result palette fixture and assert colour sort reverses the text rank
without changing the two candidate IDs.

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm --dir apps/web test -- app/routes/__tests__/search-colour-refinement.test.ts`

Expected: FAIL because query params cannot retain colour and colour selection replaces the text query.

- [ ] **Step 3: Implement independent text and colour state**

Extend `getSearchParamsForQuery` with `colour?: string | null`. Read `colour`
from URL state. When a committed text query exists, `selectColourSearch` keeps
`textQuery`, `committedTextQuery`, and `searchFacet`, sets colour sort state,
and updates the URL with both values. `clearColourSearch` removes only colour
and restores relevance sorting; colour-only search retains the existing colour
query behavior.

Render separate text and colour tokens in the active search control, with the
colour token labelled `rerank`.

- [ ] **Step 4: Run focused test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/app/routes/galleries.$galleryId.search.tsx' apps/web/app/routes/__tests__/search-colour-refinement.test.ts
git commit -m "fix: rerank text search by selected colour"
```

### Task 3: Search-first API docs

**Files:**
- Modify: `apps/web/app/routes/docs.api.tsx`
- Modify: `apps/web/app/lib/__tests__/docs-api.test.ts`

**Interfaces:**
- Consumes: existing `testApiKey`, environment selector, endpoint request builder, and `/api/docs/proxy`.
- Produces: one `Try text search` section near the overview with query input, run button, status, and formatted response.

- [ ] **Step 1: Write a failing docs-contract test**

```ts
expect(getQuickSearchEndpoint().path).toBe('/orgs/:orgId/search/text');
expect(getQuickSearchInitialValues().query).toBe('batik textile pattern');
```

Also assert the docs navigation puts `Try search` before `Authentication`.

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm --dir apps/web test -- app/lib/__tests__/docs-api.test.ts`

Expected: FAIL because the quick-search helpers and navigation item do not exist.

- [ ] **Step 3: Implement the focused console**

Reuse `buildEndpointRequest` and `/api/docs/proxy`. Keep one compact, full-width
working section with query and Run as the primary controls; show key status in
one line and keep the long authentication reference below it. Do not add cards,
new colours, or a second request-building system.

- [ ] **Step 4: Run focused test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/routes/docs.api.tsx apps/web/app/lib/__tests__/docs-api.test.ts
git commit -m "feat: add search-first API playground"
```

### Task 4: Evidence and staging verification

**Files:**
- Modify only if a verification failure exposes a tested defect.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: local evidence manifest and live staging proof.

- [ ] **Step 1: Run focused and full web gates**

```bash
pnpm --dir apps/web test
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run repository evidence**

Run: `scripts/agent-evidence`

Expected: a new `.agent/evidence/*/manifest.json` with every required gate passing.

- [ ] **Step 3: Deploy staging web**

Run: `pnpm --dir apps/web deploy:staging`

Expected: Wrangler reports a successful staging deployment.

- [ ] **Step 4: Verify live behavior**

Confirm an approved signed-in search renders actual image pixels, text query
plus colour keeps `q` and reorders the same result IDs, API docs can execute the
text query with the created staging key, REST search returns 200, MCP
`tools/list` returns 200, and anonymous/unapproved requests remain denied.

- [ ] **Step 5: Push the branch**

```bash
git push origin codex/prod-search-access
```

Expected: the remote branch advances to the verified head.
