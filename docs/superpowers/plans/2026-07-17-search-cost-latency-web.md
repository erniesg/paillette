# Search Cost and Latency Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate passive NGA search traffic and make text-plus-colour refinement rerank stored palettes locally without changing the base semantic query.

**Architecture:** A shared public-search contract owns version `18` and the strict spotlight schema. The route builds one colour-independent text request, uses a memoized CIEDE2000 ranker for the returned browser slice, and loads one immutable same-origin spotlight artifact instead of executing idle searches. NGA's public route alias remains separate from its canonical organization UUID.

**Tech Stack:** TypeScript, Remix, React Query, Zod, Vitest, Playwright, Cloudflare static assets, `@paillette/color-extraction`.

## Global Constraints

- `PUBLIC_SEARCH_CONTRACT_VERSION` is exactly `'18'` and is exported from `@paillette/types/public-search`.
- Public query normalization is Unicode NFC, trim, and collapsed internal whitespace; case is preserved.
- Text plus colour sends no `visualRefinement`, and colour is absent from the React Query identity.
- A deep link with text plus colour performs one unrefined base-text request and locally ranks exactly the returned browser slice.
- Pure colour still calls `/api/public-search/:orgId/text` with the colour description as its query.
- Local ranking uses minimum CIEDE2000 distance to any valid palette swatch, keeps all candidates, is stable on ties, and puts missing palettes last.
- NGA spotlight runtime data comes only from `/search-spotlights/nga/v18.json`; artifact failure never falls back to live search.
- The spotlight artifact has exactly four imageable NGA cards per suggestion and is no larger than 256 KiB UTF-8.
- Existing unrelated dirty-worktree changes are preserved; route edits remain narrow and no whole-file formatting is allowed.

---

### Task 1: Shared contract and NGA route identity

**Files:**

- Create: `packages/types/src/public-search.ts`
- Modify: `packages/types/package.json`
- Modify: `packages/types/src/index.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/app/lib/api.ts`
- Modify: `apps/web/app/lib/__tests__/api-aliases.test.ts`
- Create: `apps/web/app/lib/__tests__/public-search-contract.test.ts`
- Modify: `apps/web/app/routes/$orgId.search.tsx`
- Modify: `apps/web/app/routes/galleries.$galleryId.search.tsx`
- Modify: `apps/web/app/lib/public-search-cache.ts`

**Interfaces:**

- Produces: `PUBLIC_SEARCH_CONTRACT_VERSION`, `normalizePublicSearchText`, `PublicSearchSpotlightBundleSchema`, `getPublicSearchRouteId`.
- Consumes: existing `getPreferredOrgRouteId`, `ArtworkSearchResult`, and loader data contracts.

- [ ] **Step 1: Write failing contract and alias tests**

Add assertions that NFC/whitespace variants normalize equally, case remains distinct, spotlight bundles reject duplicate suggestion IDs or non-four-card entries, and `getPublicSearchRouteId('nga', sharedUuid)` returns `nga` while ordinary routes return the canonical UUID.

```ts
expect(normalizePublicSearchText('  stormy\tsea  ')).toBe('stormy sea');
expect(normalizePublicSearchText('Stormy Sea')).not.toBe(
  normalizePublicSearchText('stormy sea')
);
expect(getPublicSearchRouteId('nga', 'open-access-art')).toBe('nga');
expect(getPublicSearchRouteId('ngs', 'ngs-uuid')).toBe('ngs-uuid');
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @paillette/web test -- app/lib/__tests__/api-aliases.test.ts app/lib/__tests__/public-search-contract.test.ts
```

Expected: FAIL because the shared contract, schema, and route-ID helper do not exist.

- [ ] **Step 3: Implement the shared contract and strict schema**

Create `packages/types/src/public-search.ts` with these public values and schemas:

```ts
export const PUBLIC_SEARCH_CONTRACT_VERSION = '18' as const;
export const PUBLIC_SEARCH_SPOTLIGHT_SCHEMA_VERSION = 1 as const;
export const PUBLIC_SEARCH_SPOTLIGHT_MAX_BYTES = 256 * 1024;
export const PUBLIC_SEARCH_CANONICAL_TOP_K = 100 as const;
export const PUBLIC_SEARCH_CANONICAL_MIN_SCORE = 0 as const;

export const normalizePublicSearchText = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/gu, ' ');

export const PublicSearchSpotlightArtworkSchema = z
  .object({
    id: z.string().min(1),
    orgId: z.string().min(1),
    title: z.string().min(1),
    artist: z.string().min(1).optional(),
    year: z.number().int().optional(),
    imageUrl: z.string().url().nullable().optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    similarity: z.number().min(0).max(1),
    source: z
      .object({
        provider: z.literal('nga'),
        institution: z.string().min(1),
        recordId: z.string().min(1).optional(),
        url: z.string().url().optional(),
        accessionNumber: z.string().min(1).optional(),
        rights: z.string().min(1).optional(),
      })
      .strict(),
    palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(32),
  })
  .strict()
  .refine((card) => Boolean(card.thumbnailUrl || card.imageUrl), {
    message: 'Spotlight artwork requires an image',
  });
```

Define a strict suggestion schema with `id`, `type`, `label`, optional `detail`, `dot`, `query`, optional `facet`, optional `colourId`, and `artworks: z.array(...).length(4)`. Define a strict bundle with schema version `1`, contract version `'18'`, provider `'nga'`, non-empty corpus version, ISO generation timestamp, `{topK: 30, minScore: 0.2}`, and unique suggestion IDs.

- [ ] **Step 4: Export the contract and add web dependencies**

Expose `./public-search` from `packages/types/package.json`, export it from `packages/types/src/index.ts`, add these exact workspace dependencies to `apps/web/package.json`, and update only the `apps/web` importer in `pnpm-lock.yaml`:

```json
{
  "@paillette/color-extraction": "workspace:*",
  "@paillette/types": "workspace:*"
}
```

Change `apps/web/app/lib/public-search-cache.ts` to a compatibility re-export:

```ts
export { PUBLIC_SEARCH_CONTRACT_VERSION as PUBLIC_TEXT_SEARCH_CACHE_VERSION } from '@paillette/types/public-search';
```

- [ ] **Step 5: Preserve the public NGA alias in loader data**

Add to `apps/web/app/lib/api.ts`:

```ts
export const getPublicSearchRouteId = (
  routeId: string,
  canonicalOrgId: string
) => (isOpenAccessNgaAlias(routeId) ? 'nga' : canonicalOrgId);
```

Both search loaders return `publicSearchOrgId`. The page destructures it with `galleryId` fallback and uses it only for public text, image, browse, cache, and spotlight traffic; artwork interaction metadata retains the canonical `galleryId`.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @paillette/web test -- app/lib/__tests__/api-aliases.test.ts app/lib/__tests__/public-search-contract.test.ts
pnpm --filter @paillette/web typecheck
```

Expected: contract/alias tests PASS and typecheck exits `0`.

---

### Task 2: Colour-independent request plan and local CIEDE2000 ranker

**Files:**

- Modify: `packages/color-extraction/package.json`
- Create: `apps/web/app/lib/public-text-search-plan.ts`
- Create: `apps/web/app/lib/local-colour-refinement.ts`
- Create: `apps/web/app/lib/__tests__/public-text-search-plan.test.ts`
- Create: `apps/web/app/lib/__tests__/local-colour-refinement.test.ts`
- Modify: `apps/web/app/routes/galleries.$galleryId.search.tsx`
- Modify: `apps/web/app/routes/__tests__/search-masonry-layout.test.ts`

**Interfaces:**

- Consumes: `PUBLIC_TEXT_SEARCH_CACHE_VERSION`, `SearchTextRequest`, existing `collectPalette`, selected colour hex, and the returned React Query result slice.
- Produces: `buildPublicTextSearchPlan`, `rankByPaletteColour`, and a query plan that never contains `visualRefinement`.

- [ ] **Step 1: Write failing request-plan tests**

```ts
const text = buildPublicTextSearchPlan({
  orgId: 'nga',
  facet: null,
  committedTextQuery: 'angels',
  colourQuery: '',
  topK: 30,
  minScore: 0.2,
});
const combined = buildPublicTextSearchPlan({
  orgId: 'nga',
  facet: null,
  committedTextQuery: 'angels',
  colourQuery: 'dark navy blue',
  topK: 30,
  minScore: 0.2,
});
expect(combined).toEqual(text);
expect(combined?.request).not.toHaveProperty('visualRefinement');
expect(
  buildPublicTextSearchPlan({
    orgId: 'nga',
    facet: null,
    committedTextQuery: '',
    colourQuery: 'dark navy blue',
    topK: 30,
    minScore: 0.2,
  })?.request.query
).toBe('dark navy blue');
```

- [ ] **Step 2: Write failing ranker tests**

Test a real `ColorSimilarity.deltaE2000` ordering, stable equal-distance ties, missing palettes last, unchanged membership/input order, and a spy palette reader called exactly once per result.

```ts
const ranked = rankByPaletteColour(
  [blueWork, redWork, missingWork],
  '#244f9e',
  (work) => work.palette
);
expect(ranked.map((work) => work.id)).toEqual(['blue', 'red', 'missing']);
expect(original.map((work) => work.id)).toEqual(['blue', 'red', 'missing']);
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm --filter @paillette/web test -- app/lib/__tests__/public-text-search-plan.test.ts app/lib/__tests__/local-colour-refinement.test.ts
```

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Export browser-safe similarity and implement the plan**

Add this package subpath without importing the extraction entry point:

```json
"exports": {
  ".": "./src/index.ts",
  "./similarity": "./src/color-similarity.ts"
}
```

Implement `buildPublicTextSearchPlan` so `committedTextQuery || colourQuery` is normalized once and both the request and key exclude colour whenever committed text exists:

```ts
export const buildPublicTextSearchPlan = (
  input: PublicTextSearchPlanInput
): PublicTextSearchPlan | null => {
  const query = normalizePublicSearchText(
    input.committedTextQuery || input.colourQuery
  );
  if (!query) return null;
  const request = {
    query,
    topK: input.topK,
    minScore: input.minScore,
    ...(input.facet ? { facet: input.facet } : {}),
  };
  return {
    request,
    queryKey: [
      'search',
      'text',
      PUBLIC_SEARCH_CONTRACT_VERSION,
      input.orgId,
      input.facet || 'semantic',
      query,
      input.topK,
      input.minScore,
    ] as const,
  };
};
```

- [ ] **Step 5: Implement one-pass palette ranking**

```ts
export const rankByPaletteColour = <T>(
  items: readonly T[],
  targetHex: string,
  getPalette: (item: T) => readonly string[]
): T[] =>
  items
    .map((item, index) => {
      const distances = getPalette(item).map((swatch) =>
        ColorSimilarity.deltaE2000(targetHex, swatch)
      );
      return {
        item,
        index,
        distance: distances.length ? Math.min(...distances) : Infinity,
      };
    })
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ item }) => item);
```

Invalid swatches are filtered by the route's existing palette parser before this function. The function never mutates the React Query array.

- [ ] **Step 6: Wire the route without a colour-dependent query**

Replace `primaryTextSearchQuery`, colour-dependent query keys, and the `visualRefinement` request field with `buildPublicTextSearchPlan`. Set `retry: false`. Keep URL colour state, but route selected-colour sorting through `rankByPaletteColour(results, selected.hex, collectPalette)` before other comparator modes.

Update suggestion request expectations so a colour suggestion retains `colour` but always has `visualRefinement: null`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
pnpm --filter @paillette/web test -- app/lib/__tests__/public-text-search-plan.test.ts app/lib/__tests__/local-colour-refinement.test.ts app/routes/__tests__/search-masonry-layout.test.ts
pnpm --filter @paillette/web typecheck
```

Expected: all focused tests PASS and typecheck exits `0`.

---

### Task 3: Immutable NGA spotlight bundle and generator

**Files:**

- Create: `apps/web/app/lib/nga-spotlight-definitions.ts`
- Create: `apps/web/app/lib/search-spotlights.ts`
- Create: `apps/web/app/lib/nga-spotlight-generator.server.ts`
- Create: `apps/web/app/lib/__tests__/search-spotlights.test.ts`
- Create: `apps/web/app/lib/__tests__/nga-spotlight-generator.server.test.ts`
- Create: `scripts/generate-nga-search-spotlights.ts`
- Create: `apps/web/public/_headers`
- Modify: `apps/web/package.json`

**Interfaces:**

- Consumes: strict shared schema, the 11 existing NGA suggestion definitions, public text search responses, and the local palette ranker.
- Produces: `getSearchSpotlightPath`, `loadSearchSpotlightBundle`, `getSpotlightArtworks`, `generateNgaSpotlightBundle`.

- [ ] **Step 1: Write failing loader tests**

Test that one valid bundle loads and adapts to four `ArtworkSearchResult` values. Test that HTTP 404, malformed JSON, contract mismatch, wrong provider, fewer than four cards, duplicate IDs, and a serialized payload over 256 KiB all return `null` without a second fetch.

- [ ] **Step 2: Write failing generator tests**

Use an injected `search(definition)` function and fixed clock. Assert exactly one request for each of the 11 definitions, `topK: 30`, `minScore: 0.2`, no visual refinement, facet preservation, local colour ordering for the blue suggestion, rejection of a non-NGA card, exactly four output cards, and a request-count report.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm --filter @paillette/web test -- app/lib/__tests__/search-spotlights.test.ts app/lib/__tests__/nga-spotlight-generator.server.test.ts
```

Expected: FAIL because loader, definitions, and generator are absent.

- [ ] **Step 4: Implement explicit stable definitions**

Create 11 NGA definitions with IDs:

```ts
export const NGA_SPOTLIGHT_DEFINITIONS = [
  {
    id: 'stormy-seas-ships',
    type: 'motif',
    label: 'stormy seas and ships',
    query: 'a stormy sea with ships',
    dot: '#4c78a8',
  },
  {
    id: 'paintings-collection',
    type: 'metadata',
    label: 'paintings across the collection',
    query: 'Painting',
    dot: '#8a9a7a',
    facet: 'classification',
  },
  {
    id: 'ginevra-de-benci',
    type: 'metadata',
    label: "Ginevra de' Benci",
    query: "Leonardo da Vinci Ginevra de' Benci",
    dot: '#6e8ea8',
  },
  {
    id: 'the-annunciation',
    type: 'metadata',
    label: 'The Annunciation',
    query: 'Jan van Eyck The Annunciation',
    dot: '#365f9c',
  },
  {
    id: 'feast-of-the-gods',
    type: 'metadata',
    label: 'The Feast of the Gods',
    query: 'Giovanni Bellini Titian The Feast of the Gods',
    dot: '#cda636',
  },
  {
    id: 'women-profile',
    type: 'motif',
    label: 'women in profile',
    query: 'a portrait of a woman in profile',
    dot: '#8a9a7a',
  },
  {
    id: 'mother-child',
    type: 'motif',
    label: 'mother and child',
    query: 'a mother holding a child',
    dot: '#bf5631',
  },
  {
    id: 'quiet-interiors',
    type: 'mood',
    label: 'quiet domestic interiors',
    query: 'a quiet domestic interior',
    dot: '#6a5238',
  },
  {
    id: 'index-american-design',
    type: 'metadata',
    label: 'Index of American Design',
    query: 'Index of American Design',
    dot: '#8c5a3c',
  },
  {
    id: 'photographs',
    type: 'medium',
    label: 'photographs',
    query: 'Photograph',
    dot: '#6a5238',
  },
  {
    id: 'blue-painted-ornament',
    type: 'colour',
    label: 'blue painted ornament',
    query: 'blue painted ornament',
    dot: '#4c78a8',
    colourId: 'custom:#4c78a8',
  },
] as const;
```

- [ ] **Step 5: Implement bounded runtime loading**

`getSearchSpotlightPath('nga')` returns `/search-spotlights/nga/v18.json`. `loadSearchSpotlightBundle` calls the injected fetch exactly once with an abort signal, rejects non-OK/malformed/over-size payloads, parses the strict schema, and returns `null` on failure. `getSpotlightArtworks` matches the definition ID and converts allowlisted card/source/palette fields to `ArtworkSearchResult` metadata.

- [ ] **Step 6: Implement injected generation and thin CLI**

`generateNgaSpotlightBundle` searches each definition once, rejects `metadata.provider !== 'nga'`, chooses imageable unique cards, locally ranks the colour definition, compacts allowlisted fields, schema-validates, enforces 256 KiB, and returns `{ bundle, searchRequestCount: 11 }`.

The CLI requires `--api-base-url`, `--corpus-version`, and `--allow-search-requests`; it writes `apps/web/public/search-spotlights/nga/v18.json.tmp`, then renames it atomically. No normal build or visitor request invokes it.

Add:

```json
"spotlights:nga": "tsx ../../scripts/generate-nga-search-spotlights.ts"
```

and direct `tsx` dev dependency `^4.20.6` to `apps/web/package.json`.

- [ ] **Step 7: Add immutable asset headers and verify GREEN**

Create `apps/web/public/_headers`:

```text
/search-spotlights/*
  Cache-Control: public, max-age=31536000, immutable
```

Run:

```bash
pnpm --filter @paillette/web test -- app/lib/__tests__/search-spotlights.test.ts app/lib/__tests__/nga-spotlight-generator.server.test.ts
pnpm --filter @paillette/web typecheck
```

Expected: all focused tests PASS and typecheck exits `0`.

---

### Task 4: Remove passive live search and integrate spotlight rotation

**Files:**

- Modify: `apps/web/app/routes/galleries.$galleryId.search.tsx`
- Modify: `apps/web/app/routes/$orgId.search.tsx`
- Create: `apps/web/e2e/search-cost-latency.spec.ts`

**Interfaces:**

- Consumes: `publicSearchOrgId`, `buildPublicTextSearchPlan`, `loadSearchSpotlightBundle`, `getSpotlightArtworks`, and existing suggestion rotation UI.
- Produces: a landing page whose passive lifecycle never calls `/api/public-search/**`.

- [ ] **Step 1: Write the failing request-count test**

Intercept `/api/public-search/**` and `/search-spotlights/nga/v18.json`. Assert landing plus timer-driven rotation produces zero public-search requests, a normal suggestion click produces one, a colour suggestion sends base text without `visualRefinement`, and a classification suggestion retains `facet: 'classification'`.

- [ ] **Step 2: Run the request-count test and verify RED**

Run:

```bash
pnpm --filter @paillette/web test:e2e -- e2e/search-cost-latency.spec.ts
```

Expected: FAIL because the current idle and suggestion-prefetch effects call public search.

- [ ] **Step 3: Replace passive queries with one artifact query**

Remove `useQueryClient`, idle-delay/prefetch constants, `allowIdleShowcaseQuery`, `suggestionPrefetchRequests`, the prefetch effect, and the live `idleShowcaseQuery`. Add one React Query request:

```ts
const spotlightBundleQuery = useQuery({
  queryKey: ['search-spotlights', PUBLIC_SEARCH_CONTRACT_VERSION, 'nga'],
  queryFn: () => loadSearchSpotlightBundle('nga'),
  enabled: hasMounted && !hasActiveSearch && preferredRouteId === 'nga',
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
});
```

Derive the active four cards from the in-memory bundle and `getSuggestionKey`. If the bundle is `null`, pass `[]` to the showcase while keeping the suggestion labels. Do not invoke `publicSearchText` from any passive effect or fallback.

- [ ] **Step 4: Emit the same-origin preload header**

Return Remix `json` from the NGA loader with:

```ts
headers: {
  Link: '</search-spotlights/nga/v18.json>; rel=preload; as=fetch; crossorigin',
}
```

Ordinary gallery routes omit the header.

- [ ] **Step 5: Verify GREEN and the built bundle boundary**

Run:

```bash
pnpm --filter @paillette/web test:e2e -- e2e/search-cost-latency.spec.ts
pnpm --filter @paillette/web test -- app/lib/__tests__/public-text-search-plan.test.ts app/lib/__tests__/local-colour-refinement.test.ts app/lib/__tests__/search-spotlights.test.ts app/routes/__tests__/search-masonry-layout.test.ts
pnpm --filter @paillette/web typecheck
pnpm --filter @paillette/web build
```

Expected: request-count and unit tests PASS, typecheck exits `0`, and the build succeeds without pulling `node-vibrant` into the search route chunk.

---

### Task 5: Web verification and evidence

**Files:**

- Modify only if verification exposes a regression in the files above.

**Interfaces:**

- Consumes: all prior task outputs.
- Produces: fresh test, lint, typecheck, build, and repository evidence.

- [ ] **Step 1: Run the complete web suite**

```bash
pnpm --filter @paillette/web test
```

Expected: all web test files PASS; the pre-existing baseline-browser-mapping age warning may remain.

- [ ] **Step 2: Run static verification**

```bash
pnpm --filter @paillette/web lint
pnpm --filter @paillette/web typecheck
pnpm --filter @paillette/web build
```

Expected: each command exits `0`.

- [ ] **Step 3: Run repository evidence**

```bash
scripts/agent-evidence
```

Expected: evidence manifest is created and required checks report success. Preserve unrelated dirty files and report any pre-existing failures exactly.
