# NGA Artist, Attribution, and Relation Staging Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair authoritative NGA artist metadata, catalogue-backed attribution search, and evidence-aware relation results, then deploy and validate the exact reviewed change on staging only.

**Architecture:** Join one immutable NGA open-data snapshot into a pure normalized artist-relation model, persist the official primary artist plus all relationship metadata, and patch existing staging image-vector metadata without changing vector values. Extend the versioned NGA plan with typed attribution and relation-evidence status, route claims through source-appropriate evidence, and fail closed when the catalogue cannot verify historical derivation.

**Tech Stack:** Node.js 20 ESM, TypeScript, Hono, Remix/React, Cloudflare D1/Vectorize/KV/Workers, Vitest, Node test runner, Python `unittest`, Playwright, SHA-256 evidence manifests.

**Spec:** `docs/superpowers/specs/2026-08-22-nga-artist-attribution-relation-staging-design.md`

## Global Constraints

- Deploy and mutate staging only; production deployment, data, vectors, and caches remain untouched.
- Use NGA source commit `79d114c2186ca38af27a9478717f1e509d799495` and SHA-256 every required CSV before preparation.
- Repair exactly the existing 63,253 staged IDs; do not ingest upstream additions or metadata-only records.
- Add no D1 migration and no new artist/relation table.
- Keep the v1 hard `artistIds` contract primary-artist-only; preserve all contributors in `custom_metadata.ngaArtists.relationships`.
- Skip the caption-vector channel for NGA requests with `artistIds` in this release because the staging caption index cannot filter `primaryArtistId`; change no metadata indexes.
- Never change vector IDs, values, dimensions, counts, model metadata, or unrelated metadata.
- Never use image similarity, generated captions, ownership provenance, or ingest lineage to prove attribution or historical derivation.
- Use TDD for every production behavior: capture a focused RED result before implementation and a focused GREEN result after it.
- Keep NGA behavior behind the existing provider gate; NGS and non-NGA routing must remain unchanged.
- Bump parser to `nga-v7`, plan to `nga-plan-v2`, public contract to `29`, and API result-cache key to `v8` together.
- Do not purge caches; the cache namespace bump makes old entries unreachable and recoverable.
- Preserve the pre-existing untracked `.impeccable/` directory and all unrelated user changes.
- Stop on a source mismatch, hard-constraint violation, unsupported claim, partial D1/vector state, vector-value change, NGS exposure, non-NGA mutation, or production identity change.

---

### Task 1: Pure NGA artist relationship normalization

**Files:**
- Create: `scripts/lib/nga-artist-metadata.mjs`
- Create: `scripts/__tests__/nga-artist-metadata.test.mjs`
- Modify: `scripts/lib/open-access-art-ingest.mjs:37-172,332-374`
- Modify: `scripts/__tests__/open-access-art-ingest.test.mjs:1-75`

**Interfaces:**
- Consumes: literal rows from NGA `objects_constituents.csv`, `constituents.csv`, and `constituents_altnames.csv`.
- Produces: `buildNgaArtistMetadata({ relationships, constituents, alternativeNames, requiredObjectIds }) -> Map<string, { primaryArtistId: string; relationships: NgaArtistRelationMetadata[] }>`.
- Produces: `normalizeNgaArtwork({ object, image, artistMetadata })`, with no fallback to `object.primaryartistid`.

- [ ] **Step 1: Write failing official-schema normalization tests**

```js
test('selects NGA display order and preserves every official artist role', () => {
  const result = buildNgaArtistMetadata({
    requiredObjectIds: new Set(['110821']),
    relationships: [
      { objectid: '110821', constituentid: '2402', displayorder: '2', roletype: 'artist', role: 'artist after', prefix: '', suffix: '' },
      { objectid: '110821', constituentid: '23812', displayorder: '1', roletype: 'artist', role: 'artist', prefix: '', suffix: '' },
    ],
    constituents: [
      { constituentid: '23812', preferreddisplayname: 'Sadeler, Justus', forwarddisplayname: 'Justus Sadeler' },
      { constituentid: '2402', preferreddisplayname: 'Bril, Paul', forwarddisplayname: 'Paul Bril' },
    ],
    alternativeNames: [
      { constituentid: '2402', forwarddisplayname: 'Paulus Bril', nametype: 'Variant' },
    ],
  }).get('110821');

  assert.equal(result.primaryArtistId, '23812');
  assert.deepEqual(result.relationships.map((row) => [row.constituentId, row.displayOrder, row.role]), [
    ['23812', 1, 'artist'],
    ['2402', 2, 'artist after'],
  ]);
  assert.deepEqual(result.relationships[1].alternativeNames, ['Paulus Bril']);
});
```

Add separate tests for input-order independence, exact duplicate removal, non-artist exclusion, Unicode/whitespace normalization, malformed IDs/orders, missing required objects, unresolved constituents, and lowest-order ties.

- [ ] **Step 2: Run the focused tests and capture RED**

Run:

```bash
node --test scripts/__tests__/nga-artist-metadata.test.mjs scripts/__tests__/open-access-art-ingest.test.mjs
```

Expected: FAIL because `nga-artist-metadata.mjs` and `buildNgaArtistMetadata` do not exist and the current ingest fixture relies on fictitious `primaryartistid` fields.

- [ ] **Step 3: Implement the pure normalizer**

Implement deterministic validation and selection in `nga-artist-metadata.mjs`. Export these exact names:

```js
export const NGA_ARTIST_METADATA_KEY = 'ngaArtists';
export function mergeNgaArtistCustomMetadata(existing, artistMetadata, sourceCommit) {
  return {
    ...(existing || {}),
    [NGA_ARTIST_METADATA_KEY]: {
      sourceCommit,
      relationships: artistMetadata.relationships,
    },
  };
}
```

`buildNgaArtistMetadata` must throw messages containing `malformed objectid`, `malformed constituentid`, `malformed displayorder`, `missing artist relationship`, `unresolved constituent`, or `minimum displayorder tie`, enabling exact failure assertions.

Change `normalizeNgaArtwork` to take `artistMetadata`, set `primary_artist_id`, add `field_sources.primary_artist_id = 'nga.objects_constituents'`, and merge the normalized relation payload under `custom_metadata.ngaArtists`. Delete the fabricated `object?.primaryartistid` and `object?.artistalternativenames` reads.

- [ ] **Step 4: Run focused tests and capture GREEN**

Run:

```bash
node --test scripts/__tests__/nga-artist-metadata.test.mjs scripts/__tests__/open-access-art-ingest.test.mjs
```

Expected: PASS with the official-header fixtures and all failure-mode tests.

- [ ] **Step 5: Commit the isolated data-contract change**

```bash
git add scripts/lib/nga-artist-metadata.mjs scripts/lib/open-access-art-ingest.mjs scripts/__tests__/nga-artist-metadata.test.mjs scripts/__tests__/open-access-art-ingest.test.mjs
git commit -m "fix(ingest): join authoritative NGA artist relations"
```

### Task 2: Immutable source preparation and guarded backfill artifacts

**Files:**
- Modify: `scripts/open-access-art-dry-run.mjs:1-330`
- Create: `scripts/prepare-nga-artist-backfill.mjs`
- Create: `scripts/capture-nga-artist-backfill-preflight.mjs`
- Create: `scripts/apply-nga-artist-backfill.mjs`
- Create: `scripts/lib/nga-artist-backfill.mjs`
- Create: `scripts/__tests__/prepare-nga-artist-backfill.test.mjs`
- Create: `scripts/__tests__/apply-nga-artist-backfill.test.mjs`
- Modify: `scripts/lib/nga-structured-search-backfill.mjs:63-120`
- Modify: `scripts/__tests__/nga-structured-search-backfill.test.mjs`

**Interfaces:**
- Consumes: Task 1 `buildNgaArtistMetadata`, the pinned five-file NGA snapshot, an exact staged-ID manifest, and original staging image-vector NDJSON.
- Produces: content-addressed `source-manifest.json`, `mapping.json`, guarded SQL chunks, enriched image-vector chunks, original rollback vector chunks, and `artifact-manifest.json`.
- Produces: `buildNgaArtistUpdateSql(record, expectedOrgId) -> string` and `enrichNgaArtistVector(vector, record) -> { enriched, rollback }`.
- Produces: a read-only staging preflight capturer and a dry-run-by-default apply CLI that resolve every artifact from the hashed manifest and reject production names/bindings.

- [ ] **Step 1: Add failing preparation and mutation-scope tests**

```js
test('guards every artist update by org, provider, prefix, and exact id', () => {
  const sql = buildNgaArtistUpdateSql({
    id: 'open-access-art:nga:131994',
    primaryArtistId: '1364',
    customMetadata: { provider: 'nga', ngaArtists: { sourceCommit: SOURCE_COMMIT, relationships: [] } },
    fieldSources: { primary_artist_id: 'nga.objects_constituents' },
  }, 'eabbf000-708e-4d4c-8ac8-966b59d4fcac');

  assert.match(sql, /org_id = 'eabbf000-708e-4d4c-8ac8-966b59d4fcac'/);
  assert.match(sql, /json_extract\(custom_metadata, '\$\.provider'\) = 'nga'/);
  assert.match(sql, /id LIKE 'open-access-art:nga:%'/);
  assert.match(sql, /id = 'open-access-art:nga:131994'/);
});
```

CLI tests must prove: dry-run is the default; all five SHA-256 digests are required; mixed commits, header drift, incomplete 63,253-ID coverage, upstream additions, duplicate staged IDs, unresolved constituents, and vector-ID gaps fail before output; values and unrelated metadata remain equal; pilot scope is exactly the five approved IDs. Apply tests must prove `production`, production resource names, a missing `--confirm-manifest-sha256`, a mismatched hash, manifest paths outside the artifact root, unordered chunks, and an absent `--execute` flag cannot mutate anything.

- [ ] **Step 2: Run the focused tests and capture RED**

```bash
node --test scripts/__tests__/capture-nga-artist-backfill.test.mjs scripts/__tests__/prepare-nga-artist-backfill.test.mjs scripts/__tests__/apply-nga-artist-backfill.test.mjs scripts/__tests__/nga-structured-search-backfill.test.mjs
```

Expected: FAIL because the preparer and guarded artist update functions do not exist.

- [ ] **Step 3: Implement immutable fetching and artifact construction**

Add `--nga-source-commit` to the dry-run loader and construct raw URLs as:

```js
const ngaDataUrl = (commit, filename) =>
  `https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/${commit}/data/${filename}`;
```

`prepare-nga-artist-backfill.mjs` must require these named options; `--staged-records` and `--image-vectors` are repeatable so the full run can combine the original five-row pilot capture with a later 63,248-row capture:

```text
--source-commit
--staged-records
--image-vectors
--expected-org-id
--out-dir
--phase
```

Use `mkdtemp` for intermediate downloads, SHA-256 each response before parsing, and write output only after all invariants pass. The pilot allowlist is `131994,110821,11236,38,579`; full scope is every exact staged ID.

`enrichNgaArtistVector` must deep-clone the source vector, change only `metadata.primaryArtistId`, and hash both full `values` arrays. `buildNgaArtistUpdateSql` must use a tested `sqlJsonLiteral(value)` escaper and emit `json_patch(coalesce(custom_metadata, '{}'), json(${sqlJsonLiteral(customMetadataPatch)}))` plus the equivalent `field_sources` expression; it updates only `primary_artist_id`, `custom_metadata`, `field_sources`, and `updated_at`, and contains all four scope guards.

`capture-nga-artist-backfill-preflight.mjs` accepts only `--environment=staging`, the exact staging D1/index names from `apps/api/wrangler.toml`, `--phase=pilot|full`, `--capture-kind=preflight|post-apply`, optional `--exclude-ids-file`, and an empty `--out-dir`; a preflight capture persists and hash-binds a usable D1 Time Travel recovery point before fetching the D1 rows and image vectors by explicit manifest IDs. `apply-nga-artist-backfill.mjs` accepts the same environment/resource allowlist plus `--manifest`, `--confirm-manifest-sha256`, optional `--execute`, and the required execute-only `--post-apply-out-dir`. Without `--execute`, it prints the exact serial command plan and writes nothing remotely. With `--execute`, it uses the manifest's ordered file list rather than a glob, requires each D1 chunk's exact changed-row count, records every Wrangler JSON response, re-exports the applied D1/vector state, and succeeds only after recursive hash and semantic verification.

- [ ] **Step 4: Run focused tests and verify deterministic artifacts**

```bash
node --test scripts/__tests__/capture-nga-artist-backfill.test.mjs scripts/__tests__/prepare-nga-artist-backfill.test.mjs scripts/__tests__/apply-nga-artist-backfill.test.mjs scripts/__tests__/nga-structured-search-backfill.test.mjs
git diff --check
```

Expected: PASS. Running the same fixture twice must produce identical mapping, SQL, and vector payload hashes after excluding the declared generation timestamp.

- [ ] **Step 5: Commit the preparer**

```bash
git add scripts/open-access-art-dry-run.mjs scripts/prepare-nga-artist-backfill.mjs scripts/capture-nga-artist-backfill-preflight.mjs scripts/apply-nga-artist-backfill.mjs scripts/lib/nga-artist-backfill.mjs scripts/lib/nga-structured-search-backfill.mjs scripts/__tests__/capture-nga-artist-backfill.test.mjs scripts/__tests__/prepare-nga-artist-backfill.test.mjs scripts/__tests__/apply-nga-artist-backfill.test.mjs scripts/__tests__/nga-structured-search-backfill.test.mjs
git commit -m "feat(search): prepare guarded NGA artist backfill"
```

### Task 3: Versioned attribution intent and canonical cache identity

**Files:**
- Modify: `packages/types/src/public-search-core.ts:1-160`
- Modify: `apps/api/src/utils/nga-search-intent.ts:1-1180`
- Modify: `apps/api/src/utils/nga-search-intent.test.ts`
- Modify: `apps/api/src/utils/public-search-result-cache.ts:1-230`
- Modify: `apps/api/src/utils/public-search-result-cache.test.ts`
- Modify: `apps/web/app/lib/public-text-search-plan.ts`
- Modify: `apps/web/app/lib/__tests__/public-text-search-plan.test.ts`

**Interfaces:**
- Produces: `NgaAttributionIntent`, `PublicSearchRelationEvidence`, plan `nga-plan-v2`, parser `nga-v7`, contract `29`, cache key `v8`.
- Produces: `parseNgaAttributionIntent(query, occupiedSpans) -> NgaAttributionIntent | null` and `canonicalNgaAttribution(intent) -> NgaAttributionIntent`.

- [ ] **Step 1: Write failing contract/parser/cache tests**

```ts
expect(compileNgaSearchPlan('drawings attributed to Rembrandt')).toMatchObject({
  version: 'nga-plan-v2',
  mode: 'attribution',
  constraints: { classifications: ['Drawing'] },
  attribution: { relationship: 'attributed_to', targetText: 'Rembrandt' },
});

expect(compileNgaSearchPlan('PAINTING — after Rembrandt')).toEqual(
  compileNgaSearchPlan('painting after rembrandt')
);

expect(compileNgaSearchPlan('painting not after Rembrandt').attribution).toBeUndefined();
```

Cover `by`, `after`, `attributed to`, `workshop/studio/circle/school/follower of`; combined date/classification/medium constraints; multiword names; punctuation/dashes; safe typos outside names; targetless/control-word phrases; `painting after photograph` remaining `derived_from`; and bare ambiguous `Rembrandt` remaining outside forced attribution mode.

Cache tests must show canonical attribution variants share a key, different role/target pairs do not, `nga-plan-v1`/v7 keys are unreachable, and attribution participates in the cold-miss identity.

- [ ] **Step 2: Run focused tests and capture RED**

```bash
pnpm --filter @paillette/api test -- src/utils/nga-search-intent.test.ts src/utils/public-search-result-cache.test.ts
pnpm --filter @paillette/web test -- app/lib/__tests__/public-text-search-plan.test.ts
```

Expected: FAIL on absent attribution mode/types and old version literals.

- [ ] **Step 3: Implement the smallest typed grammar**

Add these shared types:

```ts
export type NgaAttributionIntent = {
  relationship: 'direct' | 'after' | 'attributed_to' | 'workshop_of' | 'studio_of' | 'circle_of' | 'school_of' | 'follower_of';
  targetText: string;
};

export type PublicSearchRelationEvidence = {
  policy: 'visible_subject' | 'catalogue_derivation';
  status: 'candidate' | 'verified' | 'unverified';
};
```

Extend `NgaSearchPlan.mode` with `attribution`, add optional `attribution` and `relationEvidence`, and add the same optional fields to `PublicSearchInterpretation`. Use declarative ordered patterns whose matches are rejected when they overlap existing negation or artwork-classification-to-classification relation spans. Normalize target text with NFC, punctuation/dash folding, and whitespace collapse while retaining display casing in the interpretation.

Bump all four versions exactly as specified. Include canonical attribution and evidence policy in `serializePublicSearchResultCacheIdentity`.

- [ ] **Step 4: Run focused tests and capture GREEN**

```bash
pnpm --filter @paillette/api test -- src/utils/nga-search-intent.test.ts src/utils/public-search-result-cache.test.ts
pnpm --filter @paillette/web test -- app/lib/__tests__/public-text-search-plan.test.ts
```

Expected: PASS with unchanged non-attribution parser fixtures.

- [ ] **Step 5: Commit the contract/parser change**

```bash
git add packages/types/src/public-search-core.ts apps/api/src/utils/nga-search-intent.ts apps/api/src/utils/nga-search-intent.test.ts apps/api/src/utils/public-search-result-cache.ts apps/api/src/utils/public-search-result-cache.test.ts apps/web/app/lib/public-text-search-plan.ts apps/web/app/lib/__tests__/public-text-search-plan.test.ts
git commit -m "feat(search): compile NGA attribution intent"
```

### Task 4: Catalogue-backed attribution and evidence-aware relation retrieval

**Files:**
- Create: `apps/api/src/utils/nga-search-evidence.ts`
- Create: `apps/api/src/utils/nga-search-evidence.test.ts`
- Modify: `apps/api/src/routes/search.ts:580-700,1440-1665,1800-2200,2360-2570`
- Modify: `apps/api/tests/routes/search.test.ts`
- Modify: `apps/api/src/types.ts`

**Interfaces:**
- Consumes: Task 3 `NgaAttributionIntent`, `PublicSearchRelation`, and `PublicSearchRelationEvidence`.
- Produces: `searchNgaAttributionMatches(db, scope, intent, constraints, topK)` and `filterNgaRelationEvidence(results, plan) -> ArtworkSearchResult[]`.
- Produces: `metadata.relationEvidence` per returned relational result and interpretation-level verified/unverified status.

- [ ] **Step 1: Write failing route and pure evidence tests**

```ts
it('does not use visual channels as attribution proof', async () => {
  const response = await runNgaText('painting after Rembrandt', {
    metadataRows: [{ id: 'official', artist: 'after Rembrandt van Rijn', classification: 'Painting' }],
    imageMatches: [{ id: 'frans-hals', score: 0.99 }],
    captionMatches: [{ id: 'van-dyck', score: 0.98 }],
  });
  expect(response.results.map((row) => row.id)).toEqual(['official']);
  expect(response.results[0].metadata.relationEvidence).toMatchObject({ source: 'catalogue_artist', verified: true });
});
```

Add cases proving: role and all target tokens are required; official alternative names work; secondary official `artist after` relationships may satisfy an `after` query; explicit `artistIds` still match primary only; artist-constrained caption search is deliberately skipped when the caption index cannot filter; visible relations accept explicit institution descriptions or image+caption agreement; image-only/caption-only weak tails are excluded; derived-from rejects generated captions and image matches; institution description containing connector plus source type is accepted; active/passive canonical plans return the same ordered IDs; hard constraints are rechecked after hydration.

- [ ] **Step 2: Run focused tests and capture RED**

```bash
pnpm --filter @paillette/api test -- src/utils/nga-search-evidence.test.ts tests/routes/search.test.ts
```

Expected: FAIL because attribution still uses balanced retrieval and relation fusion lacks evidence filtering.

- [ ] **Step 3: Implement source-appropriate retrieval**

Keep SQL construction in `search.ts` but isolate normalization/proof predicates in `nga-search-evidence.ts`:

```ts
export function matchesNgaAttributionEvidence(metadata, intent): boolean;
export function classifyNgaRelationEvidence(result, relation):
  | { verified: true; source: 'institution_metadata' | 'image_caption_agreement' }
  | { verified: false; source: null };
export function filterNgaRelationEvidence(results, plan): ArtworkSearchResult[];
```

Attribution mode executes a D1 metadata lane over official `artist` plus `custom_metadata.ngaArtists.relationships`; it does not execute image/caption lanes. Any NGA search with explicit `artistIds` also sets caption-channel weight to zero, because the v1 caption index has no `primaryArtistId` filter contract. `direct` restricts the matching relation to `primary_artist_id`; qualified roles may inspect all stored relationships. Use normalized token-boundary matching, never substring-only name matching.

For visible relations, retain rows with explicit institution title/description subject evidence or contributions from both `jina_image` and `caption`; sort institution evidence first, then existing stable fused order. For derived-from, retain only explicit institution metadata containing a recognized derivation connector and source classification. If none remain, return zero rows and set interpretation evidence status to `unverified`.

- [ ] **Step 4: Run focused API tests and capture GREEN**

```bash
pnpm --filter @paillette/api test -- src/utils/nga-search-evidence.test.ts tests/routes/search.test.ts src/utils/nga-search-intent.test.ts src/utils/public-search-result-cache.test.ts
pnpm --filter @paillette/api typecheck
```

Expected: PASS with no NGS/non-NGA route changes.

- [ ] **Step 5: Commit the retrieval behavior**

```bash
git add apps/api/src/utils/nga-search-evidence.ts apps/api/src/utils/nga-search-evidence.test.ts apps/api/src/routes/search.ts apps/api/tests/routes/search.test.ts apps/api/src/types.ts
git commit -m "fix(search): require NGA catalogue evidence for claims"
```

### Task 5: Truthful web interpretation, empty state, and v29 spotlight

**Files:**
- Modify: `apps/web/app/routes/galleries.$galleryId.search.tsx:1380-1460,3060-3160`
- Modify: `apps/web/app/routes/__tests__/search-masonry-layout.test.ts`
- Modify: `apps/web/app/lib/public-search-composer.ts`
- Modify: `apps/web/app/lib/__tests__/public-search-composer.test.ts`
- Modify: `apps/web/app/lib/search-spotlights.ts`
- Create: the content-addressed `v29-${sha256}.json` asset under `apps/web/public/search-spotlights/nga/`
- Modify: `apps/web/app/lib/__tests__/search-spotlights.test.ts`
- Modify: `apps/web/app/lib/__tests__/public-search-contract.test.ts`

**Interfaces:**
- Consumes: v29 interpretation attribution and relation-evidence status.
- Produces: truthful chips/summary and the exact empty copy `No catalogue-verified matches.` / `The indexed NGA catalogue does not verify this historical relationship.`.

- [ ] **Step 1: Add failing presentation and contract tests**

```ts
expect(getSearchEmptyState({
  relation: { kind: 'derived_from', workClassification: 'Drawing', sourceClassification: 'Photograph' },
  relationEvidence: { policy: 'catalogue_derivation', status: 'unverified' },
})).toEqual({
  title: 'No catalogue-verified matches.',
  detail: 'The indexed NGA catalogue does not verify this historical relationship.',
  canLowerThreshold: false,
});
```

Assert attribution chips show `After · Rembrandt` or `Attributed to · Rembrandt`, unsupported derivation never shows “lower minimum score,” existing image empty state still offers replace/lower controls, Image editor layout remains compact after result ownership, and v29 spotlight content is byte-equivalent to v28 except contract metadata and content-addressed filename.

- [ ] **Step 2: Run focused web tests and capture RED**

```bash
pnpm --filter @paillette/web test -- app/lib/__tests__/public-search-composer.test.ts app/routes/__tests__/search-masonry-layout.test.ts app/lib/__tests__/search-spotlights.test.ts app/lib/__tests__/public-search-contract.test.ts
```

Expected: FAIL on old generic empty copy and absent attribution presentation.

- [ ] **Step 3: Implement pure presentation helpers and wire the page**

Add pure `getSearchEmptyState` and `getInterpretationChips` helpers to `public-search-composer.ts`; keep JSX declarative. Generate the v29 spotlight through the existing `pnpm --filter @paillette/web spotlights:nga` path, verify the filename digest, and delete no previous immutable spotlight assets.

- [ ] **Step 4: Run focused web tests and capture GREEN**

```bash
pnpm --filter @paillette/web test -- app/lib/__tests__/public-search-composer.test.ts app/routes/__tests__/search-masonry-layout.test.ts app/lib/__tests__/search-spotlights.test.ts app/lib/__tests__/public-search-contract.test.ts
pnpm --filter @paillette/web typecheck
```

Expected: PASS with no passive image request and no pre-submission result toolbar regression.

- [ ] **Step 5: Commit the web contract**

```bash
git add apps/web/app/routes/galleries.\$galleryId.search.tsx apps/web/app/routes/__tests__/search-masonry-layout.test.ts apps/web/app/lib/public-search-composer.ts apps/web/app/lib/__tests__/public-search-composer.test.ts apps/web/app/lib/search-spotlights.ts apps/web/public/search-spotlights/nga apps/web/app/lib/__tests__/search-spotlights.test.ts apps/web/app/lib/__tests__/public-search-contract.test.ts
git commit -m "fix(search): explain NGA relation evidence truthfully"
```

### Task 6: Strong-relevance and artist-data release gates

**Files:**
- Modify: `eval/nga_staging_gate.py:30-80,760-950,1420-1540,1900-2050,3820-3890`
- Modify: `eval/test_nga_staging_gate.py`
- Modify: `eval/nga-staging-cases.yaml`
- Modify: `eval/nga-image-fixtures.json`
- Modify: `apps/web/e2e/nga-staging-gate.spec.ts`
- Modify: `apps/web/test/nga-staging-request-budget.test.ts`

**Interfaces:**
- Produces: strong relevance where grades `>= 2`, verified-empty derived-relation assertions, artist backfill identity checks, and browser evidence for attribution/empty-state behavior.
- Consumes: parser `nga-v7`, plan `nga-plan-v2`, contract `29`, cache `v8`, and the Task 2 backfill manifest.

- [ ] **Step 1: Add failing evaluator tests**

```py
def test_weak_only_labels_fail_strong_relevance(self):
    metrics = compute_relevance_metrics([1, 1, 1, 1, 1], strong_threshold=2)
    self.assertEqual(metrics["strongPrecisionAt5"], 0.0)
    self.assertFalse(evaluate_strong_relevance(metrics, minimum_strong_results=1)["passed"])
```

Add tests proving: derived-from verified-empty passes only with `relationEvidence.status == "unverified"` and zero rows; any unsupported derived row fails; artist fixture `131994`/`1364` must rank within top three; wrong ID excludes it and leaks zero rows; every artist-constrained row has the requested primary ID; mapping count/hash and vector-value preservation are bound into the deployment identity; production identity change fails; missing Playwright artist/empty-state evidence fails rehash.

- [ ] **Step 2: Run evaluator tests and capture RED**

```bash
python3 -m unittest eval.test_nga_staging_gate
pnpm --filter @paillette/web test -- test/nga-staging-request-budget.test.ts
```

Expected: FAIL on absent strong metrics, evidence status checks, and artist-data identity binding.

- [ ] **Step 3: Implement gate semantics and cases**

Set expected versions to `nga-v7`, `nga-plan-v2`, contract `29`, cache `v8`. Add live cases for direct `by`, every supported attribution role family, multiword artists, case/punctuation/dash variants, combined constraints, ambiguous controls, primary-vs-secondary ID controls, visible-relation weak-tail exclusion, and derived-from verified-empty behavior. Every valid positive legacy or new text case defaults to at least one result, including every positive pilot text case; only explicitly unresolved, `expectedZeroResults`, or verified-empty cases may omit that requirement. A visible-relation grade-0 result anywhere in the evaluated returned list is a stop condition even when its head contains a strong result. The pilot live inventory is exactly four text cases plus positive, wrong-primary, and secondary-only artist-ID image controls, for exactly 12 Python public requests including cache, repeat, and NGS probes. Keep request pacing at no more than nine anonymous requests per minute and update the declared browser request budget with its exact test count.

- [ ] **Step 4: Run evaluator tests and capture GREEN**

```bash
python3 -m unittest eval.test_nga_staging_gate
pnpm --filter @paillette/web test -- test/nga-staging-request-budget.test.ts
```

Expected: PASS, including negative tests that make every new stop condition fail closed.

- [ ] **Step 5: Commit the release gate**

```bash
git add eval/nga_staging_gate.py eval/test_nga_staging_gate.py eval/nga-staging-cases.yaml eval/nga-image-fixtures.json apps/web/e2e/nga-staging-gate.spec.ts apps/web/test/nga-staging-request-budget.test.ts
git commit -m "test(search): gate NGA artist and relation evidence"
```

### Task 7: Exact-head local verification and independent review

**Files:**
- Modify only files required to correct Critical or Important review findings.
- Generate: the timestamped evidence manifest written by `scripts/agent-evidence`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: one reviewed exact commit and a complete local evidence manifest suitable for staging deployment.

- [ ] **Step 1: Run every focused suite**

```bash
node --test scripts/__tests__/nga-artist-metadata.test.mjs scripts/__tests__/open-access-art-ingest.test.mjs scripts/__tests__/capture-nga-artist-backfill.test.mjs scripts/__tests__/prepare-nga-artist-backfill.test.mjs scripts/__tests__/apply-nga-artist-backfill.test.mjs scripts/__tests__/nga-structured-search-backfill.test.mjs
pnpm --filter @paillette/api test -- src/utils/nga-search-intent.test.ts src/utils/public-search-result-cache.test.ts src/utils/nga-search-evidence.test.ts tests/routes/search.test.ts
pnpm --filter @paillette/web test -- app/lib/__tests__/public-text-search-plan.test.ts app/lib/__tests__/public-search-composer.test.ts app/routes/__tests__/search-masonry-layout.test.ts app/lib/__tests__/search-spotlights.test.ts app/lib/__tests__/public-search-contract.test.ts test/nga-staging-request-budget.test.ts
python3 -m unittest eval.test_nga_staging_gate
```

Expected: all focused tests pass.

- [ ] **Step 2: Run repository verification**

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
git diff --check
scripts/agent-evidence
```

Expected: every required lane exits zero and `scripts/agent-evidence` writes a passing manifest.

- [ ] **Step 3: Perform independent exact-head review**

Review the range `7593f0c5..HEAD` for data-scope safety, vector preservation, parser ambiguity, unsupported claims, cache identity, NGS/non-NGA regression, and evaluator false positives. Repair every Critical or Important finding with focused RED/GREEN evidence, commit each repair, and re-review the repair range once.

- [ ] **Step 4: Verify branch hygiene**

```bash
git status --short --branch
git log --oneline --decorate -12
git diff 7593f0c5..HEAD --check
```

Expected: the branch contains intentional commits only; `.impeccable/` is the only unrelated untracked path.

### Task 8: Staging deployment, five-row pilot, full backfill, and live gate

**Files:**
- Generate: the `preflight`, `backfill`, and `candidate` subtrees under the task-specific absolute `NGA_ARTIST_EVIDENCE_ROOT` created below

**Interfaces:**
- Consumes: exact reviewed HEAD, Task 2 preparer, Task 6 gate, and the already approved staging-only mutation authority.
- Produces: deployed staging API/web identities, recoverable pilot/full backfill evidence, and final staging GO/NO-GO. Production remains unchanged.

- [ ] **Step 1: Capture immutable preflight and rollback evidence**

Use a new evidence root whose path contains `git rev-parse HEAD` and UTC timestamp. Record, without secrets:

```bash
NGA_ARTIST_EVIDENCE_ROOT="$(pwd)/.agent/evidence/nga-staging/$(git rev-parse HEAD)/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p \
  "$NGA_ARTIST_EVIDENCE_ROOT/preflight" \
  "$NGA_ARTIST_EVIDENCE_ROOT/backfill" \
  "$NGA_ARTIST_EVIDENCE_ROOT/candidate/production-identity/pilot" \
  "$NGA_ARTIST_EVIDENCE_ROOT/candidate/production-identity/full"
test "$(realpath "$NGA_ARTIST_EVIDENCE_ROOT")" != "$(git rev-parse --show-toplevel)"
pnpm --dir apps/api exec wrangler versions list --env staging --json
pnpm --dir apps/web exec wrangler versions list --env staging --json
pnpm --dir apps/api exec wrangler versions list --env production --json
pnpm --dir apps/web exec wrangler versions list --env production --json
pnpm --dir apps/api exec wrangler deployments list --env production --json
pnpm --dir apps/web exec wrangler deployments list --env production --json
pnpm --dir apps/api exec wrangler vectorize info paillette-embeddings-v2-stg --env staging
pnpm --dir apps/api exec wrangler vectorize list-metadata-index paillette-embeddings-v2-stg --env staging
pnpm --dir apps/api exec wrangler vectorize info paillette-caption-embeddings-v2-stg --env staging
pnpm --dir apps/api exec wrangler vectorize list-metadata-index paillette-caption-embeddings-v2-stg --env staging
```

Echo and retain the resolved absolute `NGA_ARTIST_EVIDENCE_ROOT` in `preflight/evidence-root.txt`. Then run:

```bash
node scripts/capture-nga-artist-backfill-preflight.mjs \
  --environment=staging \
  --phase=pilot \
  --capture-kind=preflight \
  --out-dir="$NGA_ARTIST_EVIDENCE_ROOT/preflight/pilot"
```

This command first obtains a usable D1 recovery point, captures the exact D1 rows and vectors, and persists them together with `d1-time-travel.json` and `preflight-manifest.json` binding every complete JSON/NDJSON input. A missing, unusable, or hash-mismatched D1 recovery point is a stop condition. The durable bundle must exist and pass its recursive rehash before any apply. Do not reuse artifacts whose filename says production or whose index/deployment identity is unproven. The pilot capture remains the authoritative rollback source for those five IDs after they are patched.

Canonicalize the production API/web `versions list` results into
`preflight/production-identity.json` using schema
`nga-production-identity-v1`, capture role `trusted_preflight`, and exact
production service/origin/deployment/version fields. Before each staging
mutation, write the corresponding independently captured canonical `before`
record to `candidate/production-identity/pilot/before.json` or
`candidate/production-identity/full/before.json`. After each mutation and its
verification, write a fresh canonical `after` record to the same phase's
`after.json`. Create every capture with exclusive-create semantics; never
replace a pilot capture while preparing the full phase. The evaluator resolves
the phase-specific fixed paths, rehashes the original bytes, requires every
capture's canonical resource identity to equal the trusted preflight
field-for-field, and rejects cross-phase paths, path escapes, caller-supplied
equal hashes, and unknown schema fields.

Obtain fresh production version/deployment responses for every `before` and
`after` capture and construct a new canonical record; never copy bytes from an
earlier phase. Before each exclusive create, parse the prior capture timestamp
and wait for the UTC clock to advance when necessary. The required global
chronology is `trustedPreflight <= pilot before < pilot after < full before <
full after`. The four pilot/full `before`/`after` byte digests must all be
distinct, including full `before` versus full `after`; an equal or reversed
timestamp or reused digest is a stop condition.

The canonical resource object has exactly `api` and `web`; each entry has
exactly `environment`, `service`, `origin`, `deploymentId`, and `versionId`.
Use the deployment-list output for `deploymentId` and the version-list output
for `versionId`; do not reuse one identifier for both fields.

- [ ] **Step 2: Prepare and inspect five-row artifacts without applying**

```bash
node scripts/prepare-nga-artist-backfill.mjs \
  --source-commit=79d114c2186ca38af27a9478717f1e509d799495 \
  --staged-records="$NGA_ARTIST_EVIDENCE_ROOT/preflight/pilot/staged-nga-records.json" \
  --image-vectors="$NGA_ARTIST_EVIDENCE_ROOT/preflight/pilot/image-vectors" \
  --expected-org-id=eabbf000-708e-4d4c-8ac8-966b59d4fcac \
  --out-dir="$NGA_ARTIST_EVIDENCE_ROOT/backfill/pilot" \
  --phase=pilot
```

Verify the variable still equals the absolute path recorded in `preflight/evidence-root.txt` before any later command. Verify five mappings, five guarded SQL updates, five enriched vectors, five complete original D1 rollback records, five rollback vectors, source hashes, value hashes, and the final artifact-manifest hash.

- [ ] **Step 3: Deploy the exact reviewed API and web to staging**

```bash
pnpm --filter @paillette/api deploy:staging
pnpm --filter @paillette/web deploy:staging
```

Verify `https://paillette-api-stg.berlayar.ai/health` reports staging and the new
parser/plan/cache/contract versions, and verify the anonymous staging web loads
contract 29. The web must be present before the strict pilot rehash because the
pilot manifest requires all nine bound Playwright artifacts. Confirm production
version identity is unchanged before continuing.

- [ ] **Step 4: Apply the pilot D1 and image-vector patches**

Immediately before the pilot apply, require
`candidate/production-identity/pilot/before.json` not to exist and create it
with role `before` using the exact canonical production resource schema from
Step 1. A pre-existing file is a stop condition; do not overwrite it.

```bash
NGA_ARTIST_PILOT_MANIFEST="$NGA_ARTIST_EVIDENCE_ROOT/backfill/pilot/artifact-manifest.json"
NGA_ARTIST_PILOT_SHA="$(shasum -a 256 "$NGA_ARTIST_PILOT_MANIFEST" | awk '{print $1}')"
node scripts/apply-nga-artist-backfill.mjs \
  --environment=staging \
  --phase=pilot \
  --manifest="$NGA_ARTIST_PILOT_MANIFEST" \
  --confirm-manifest-sha256="$NGA_ARTIST_PILOT_SHA" \
  --post-apply-out-dir="$NGA_ARTIST_EVIDENCE_ROOT/candidate/post-apply/pilot" \
  --execute
```

The apply script itself requires exactly five changed D1 rows, immediately re-exports the five rows/vectors, recursively rehashes that post-apply state, and writes `nga-post-apply-verification-v2` evidence. It copies every executed Wrangler response into deterministic paths `candidate/post-apply/pilot/apply-responses/0001.json` onward and binds those files in exact manifest order with their SHA-256 digests, SQL artifact paths, per-chunk expected/actual `meta.changes`, and exact expected/actual total of five. The evaluator rehashes each raw response, reparses `stdout`, and recomputes the per-chunk and total change counts; a missing, tampered, reordered, duplicated, or inconsistent response is a stop condition even when final state is correct. The script also requires exact primary IDs, relation metadata, idempotent SQL row state, unchanged vector value hashes, unchanged counts, and zero unrelated field changes before exiting zero. Separately prove direct Vectorize filter success. On any failure, stop and request rollback authorization using the hash-bound D1 Time Travel recovery point, complete original D1 rows, and rollback vector NDJSON; do not continue to the full backfill.

Immediately after those pilot verification checks succeed, require
`candidate/production-identity/pilot/after.json` not to exist and create it
with role `after` using that same exact schema. A pre-existing file is a stop
condition; do not overwrite it.

- [ ] **Step 5: Run and inspect the pilot live gate**

Create a deployment identity JSON binding the exact reviewed API/web staging
versions, candidate git SHA, and an `nga-artist-data-binding-v3` object. That
object references `backfill/pilot/artifact-manifest.json`,
`preflight/pilot/preflight-manifest.json`, and
`candidate/post-apply/pilot/verification.json` by fixed relative path and
actual SHA-256, plus `preflight/production-identity.json` and the pilot-specific
`before.json`/`after.json` paths and their actual SHA-256 digests. Write this
exact object once to `candidate/pilot-deployment-identity.json`; the full phase
uses a different file and must not replace it. Do not copy counts or aggregate
vector hashes into the deployment identity: the evaluator reads the Task 2
manifest bytes, recursively rehashes its declared mapping/vector/rollback
files, and recomputes their semantic counts and preserved values. First run
discovery without `--fail-on-gates`, inspect the exact returned IDs, and grade the two declared
visible-relation cases on the 0–3 rubric:

```bash
python3 eval/nga_staging_gate.py \
  --phase pilot \
  --snapshot candidate \
  --api-base-url https://paillette-api-stg.berlayar.ai \
  --web-base-url https://paillette-stg.berlayar.ai \
  --out-dir "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot-discovery" \
  --deployment-identity "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot-deployment-identity.json" \
  --public-search-requests-per-minute 9
```

Write the exact-ID labels to `candidate/pilot-relevance-labels.json`, then run a
fresh official pilot. Candidate evidence is never rehashed permissively, so the
official run must include strong manual labels and every recomputed hard gate
must pass. The pilot executes exactly 12 Python public requests—four text,
three cache, three artist-ID images, one stable image repeat, and one NGS
probe—through the rolling nine-per-minute pacer. Before starting it, wait until
the discovery bundle's exact `nextRunNotBefore` timestamp; this executable
handoff is derived from the last
raw public-search request timestamp and covers every text, image, cache-repeat,
negative, and NGS probe made by that discovery process:

```bash
python3 - "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot-discovery/request-cooldown-handoff.json" <<'PY'
import datetime, json, pathlib, sys, time
handoff = json.loads(pathlib.Path(sys.argv[1]).read_text())
not_before = datetime.datetime.fromisoformat(
    handoff["nextRunNotBefore"].replace("Z", "+00:00")
)
delay = (not_before - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
if delay > 0:
    time.sleep(delay)
PY
```

After Python completes, wait until the exact `playwrightNotBefore`
timestamp in the official pilot `playwright-handoff.json`; do not rerun or
replace the Python bundle during the 60-second cooldown. Then run Playwright
with both paths resolving inside that same official pilot bundle:

```bash
python3 eval/nga_staging_gate.py \
  --phase pilot \
  --snapshot candidate \
  --api-base-url https://paillette-api-stg.berlayar.ai \
  --web-base-url https://paillette-stg.berlayar.ai \
  --out-dir "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot" \
  --deployment-identity "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot-deployment-identity.json" \
  --relevance-labels "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot-relevance-labels.json" \
  --previous-request-handoff "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot-discovery/request-cooldown-handoff.json" \
  --fail-on-gates \
  --public-search-requests-per-minute 9

python3 - "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot/playwright-handoff.json" <<'PY'
import datetime, json, pathlib, sys, time
handoff = json.loads(pathlib.Path(sys.argv[1]).read_text())
not_before = datetime.datetime.fromisoformat(
    handoff["playwrightNotBefore"].replace("Z", "+00:00")
)
delay = (not_before - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
if delay > 0:
    time.sleep(delay)
PY

NGA_STAGING_RUN_BINDING="$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot/playwright-handoff.json" \
NGA_STAGING_EVIDENCE_DIR="$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot/playwright" \
pnpm --dir apps/web exec playwright test --config playwright.staging.config.ts

python3 eval/nga_staging_gate.py rehash \
  --out-dir "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot"
```

Preserve the pilot deployment identity bytes before preparing the full
identity. Record its canonical JSON SHA-256 as
`pilotDeploymentIdentityHash` in both the reviewed pilot inspection and the
later full deployment identity. The pilot inspection must match that exact
hash to the pilot summary and raw deployment-identity artifact; it never uses
the later full deployment identity hash.

Manually inspect raw artist, attribution, visible-relation, derived-empty,
cache, NGS, and both new browser artifacts. Write the hashed pilot inspection
decision against this official pilot manifest. Continue only if every
hard/evidence/manual/browser/identity gate passes.

- [ ] **Step 6: Prepare and apply the full staging backfill**

Capture the remaining 63,248 staged IDs after the pilot while excluding the five pilot IDs, then combine both original captures during preparation:

```bash
node scripts/capture-nga-artist-backfill-preflight.mjs \
  --environment=staging \
  --phase=full \
  --capture-kind=preflight \
  --exclude-ids-file="$NGA_ARTIST_EVIDENCE_ROOT/preflight/pilot/ids.json" \
  --out-dir="$NGA_ARTIST_EVIDENCE_ROOT/preflight/full-remaining"

node scripts/prepare-nga-artist-backfill.mjs \
  --source-commit=79d114c2186ca38af27a9478717f1e509d799495 \
  --staged-records="$NGA_ARTIST_EVIDENCE_ROOT/preflight/pilot/staged-nga-records.json" \
  --staged-records="$NGA_ARTIST_EVIDENCE_ROOT/preflight/full-remaining/staged-nga-records.json" \
  --image-vectors="$NGA_ARTIST_EVIDENCE_ROOT/preflight/pilot/image-vectors" \
  --image-vectors="$NGA_ARTIST_EVIDENCE_ROOT/preflight/full-remaining/image-vectors" \
  --expected-org-id=eabbf000-708e-4d4c-8ac8-966b59d4fcac \
  --out-dir="$NGA_ARTIST_EVIDENCE_ROOT/backfill/full" \
  --phase=full

NGA_ARTIST_FULL_MANIFEST="$NGA_ARTIST_EVIDENCE_ROOT/backfill/full/artifact-manifest.json"
NGA_ARTIST_FULL_SHA="$(shasum -a 256 "$NGA_ARTIST_FULL_MANIFEST" | awk '{print $1}')"
```

Immediately before the full apply, require
`candidate/production-identity/full/before.json` not to exist and create it
with role `before`. This is a new phase-specific capture, not a reference to or
replacement of either pilot capture.

```bash
node scripts/apply-nga-artist-backfill.mjs \
  --environment=staging \
  --phase=full \
  --manifest="$NGA_ARTIST_FULL_MANIFEST" \
  --confirm-manifest-sha256="$NGA_ARTIST_FULL_SHA" \
  --post-apply-out-dir="$NGA_ARTIST_EVIDENCE_ROOT/candidate/post-apply/full" \
  --execute
```

The apply script resolves each chunk to an explicit real path under the hashed artifact root; it uses no shell glob. It requires exactly 63,248 D1 changes because the five pilot rows are already idempotent, then re-exports and verifies the full 63,253-row D1/vector state before exiting zero. Its `nga-post-apply-verification-v2` file binds every deterministic `candidate/post-apply/full/apply-responses/NNNN.json` response in execution order and records per-chunk and total expected/actual D1 changes. The evaluator rehashes and reparses every response and independently requires the exact 63,248 total; final state without that historical change-count evidence is insufficient. Final invariants are exactly 63,253 valid primary IDs, zero source mismatches, unchanged vector counts/value hashes, zero non-NGA changes, and unchanged titles/artists/dates/media/rights/URLs/assets/collection membership.

Immediately after the full apply and those verification checks succeed—and
before Step 7, full discovery, or any official gate—write a fresh
`candidate/production-identity/full/after.json` capture with role `after`,
requiring the path not to exist before the exclusive write. Recompute its
content digest, and create the full-phase deployment identity once at
`candidate/full-deployment-identity.json`. Bind the actual
`backfill/full/artifact-manifest.json`, both pilot and full-remaining preflight
manifest paths/digests, `candidate/post-apply/full/verification.json`, and the fresh
full-after digest. Keep the trusted preflight and every pilot capture byte and
digest fixed. The full identity must retain the reviewed API/web
deployment and version identities, parser/plan/contract/cache versions, source
commit, production resource identities, and `pilotDeploymentIdentityHash`.
The evaluator compares all immutable identity values canonically. Only the
explicitly phase-specific artist-manifest descriptor, production before/after
descriptor paths and byte digests, the later `capturedAt`, and the added pilot
identity hash may differ. The raw production resources in every capture must
remain canonically equal.

- [ ] **Step 7: Reconfirm the exact reviewed web on staging**

Do not redeploy if the exact reviewed web from Step 3 is still active. Verify
the live web contract is `29`, the staged route loads anonymously, and API/web
deployment identities still bind to the same candidate SHA. If staging web
identity drifted, stop and repeat the reviewed deployment/identity checks before
running the full gate.

- [ ] **Step 8: Run full discovery, grade exact IDs, then run the official Python and browser gates**

```bash
python3 eval/nga_staging_gate.py \
  --phase full \
  --snapshot candidate \
  --api-base-url https://paillette-api-stg.berlayar.ai \
  --web-base-url https://paillette-stg.berlayar.ai \
  --out-dir "$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-discovery" \
  --deployment-identity "$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-deployment-identity.json" \
  --pilot-inspection "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot-inspection.json" \
  --public-search-requests-per-minute 9
```

Grade the declared top results by exact artwork ID on the 0-3 rubric and
write/hash `candidate/relevance-labels.json`. Wait on the full discovery
process's exact raw-timestamp handoff before starting the separate official
process:

```bash
python3 - "$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-discovery/request-cooldown-handoff.json" <<'PY'
import datetime, json, pathlib, sys, time
handoff = json.loads(pathlib.Path(sys.argv[1]).read_text())
not_before = datetime.datetime.fromisoformat(
    handoff["nextRunNotBefore"].replace("Z", "+00:00")
)
delay = (not_before - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
if delay > 0:
    time.sleep(delay)
PY
```

Run the official Python gate,
then wait until the full official bundle's exact `playwrightNotBefore`
timestamp. Keep the Python bundle unchanged during the 60-second cooldown;
write the Playwright report/artifacts only below its `playwright/` subdirectory,
then rehash that same bundle:

```bash
python3 eval/nga_staging_gate.py \
  --phase full \
  --snapshot candidate \
  --api-base-url https://paillette-api-stg.berlayar.ai \
  --web-base-url https://paillette-stg.berlayar.ai \
  --out-dir "$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-official" \
  --deployment-identity "$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-deployment-identity.json" \
  --relevance-labels "$NGA_ARTIST_EVIDENCE_ROOT/candidate/relevance-labels.json" \
  --pilot-inspection "$NGA_ARTIST_EVIDENCE_ROOT/candidate/pilot-inspection.json" \
  --previous-request-handoff "$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-discovery/request-cooldown-handoff.json" \
  --fail-on-gates \
  --public-search-requests-per-minute 9

python3 - "$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-official/playwright-handoff.json" <<'PY'
import datetime, json, pathlib, sys, time
handoff = json.loads(pathlib.Path(sys.argv[1]).read_text())
not_before = datetime.datetime.fromisoformat(
    handoff["playwrightNotBefore"].replace("Z", "+00:00")
)
delay = (not_before - datetime.datetime.now(datetime.timezone.utc)).total_seconds()
if delay > 0:
    time.sleep(delay)
PY

NGA_STAGING_RUN_BINDING="$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-official/playwright-handoff.json" \
NGA_STAGING_EVIDENCE_DIR="$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-official/playwright" \
pnpm --dir apps/web exec playwright test --config playwright.staging.config.ts

python3 eval/nga_staging_gate.py rehash --out-dir "$NGA_ARTIST_EVIDENCE_ROOT/candidate/full-official"
```

The full gate requires 100% parser/hard/image/NGS/browser compliance, strong visible-relation positives, catalogue-backed attribution, verified-empty derivation where no official positive exists, correct MISS/repeat HIT behavior, and a passing rehash.

The fixed evidence root marker, manifest phase, Task 2 preflight phases,
mapping/vector/rollback record counts, and value-hash count must all resolve to
exactly 63,253; the pilot identity must resolve to exactly the five approved
IDs. Candidate rehash is never permissive: raw hard gates, strong manual
relevance, aggregate summary, identity evidence, and all nine browser tests
must pass. Only an explicitly identified `baseline` snapshot may retain failed
recomputed RED evidence.

- [ ] **Step 9: Confirm the production boundary and report**

Re-run both production `versions list` commands and compare their canonical hashes to preflight. Query no production search endpoint and mutate no production resource. Report exact commit/deployment IDs, D1 bookmark, backfill manifest hashes, commands, local/live coverage, limitations, artifact paths, and a staging GO or NO-GO. End with a separate production recommendation; do not promote production.
