# NGA Structured Search Release Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NGA structured search locally publishable by repairing displayed-date filtering, query intent extraction, stale cache identities, evaluation enforcement, and incomplete backfill-plan handling.

**Architecture:** A framework-independent ESM date parser exported from `@paillette/types` becomes the single source for API, ingest, and backfill date ranges. The existing deterministic NGA intent parser gains phrase-aware vocabulary extraction and compound boundaries, while cache version changes make old result bodies unreachable and the backfill CLI fails closed on sample-only inputs.

**Tech Stack:** TypeScript 5.7, ESM JavaScript, Vitest 2, Node 20 `node:test`, Hono, Remix, Cloudflare KV/cache contracts, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-21-nga-structured-search-release-repair-design.md`

## Global Constraints

- Do not deploy, migrate data, purge caches, commit, push, or mutate staging or production.
- Preserve the user's existing uncommitted NGA fix and build on it; do not discard unrelated worktree changes.
- Use `apply_patch` for hand edits and test-first red/green cycles for every behavior change.
- Keep NGS public search disabled and its existing visibility behavior unchanged.
- A passing local suite does not prove staging because no deployment is authorized.

---

### Task 1: Unify NGA displayed-date normalization

**Files:**

- Create: `scripts/__tests__/nga-date-range.test.mjs`
- Create: `packages/types/src/nga-date-range.mjs`
- Create: `packages/types/src/nga-date-range.d.ts`
- Modify: `packages/types/package.json`
- Modify: `apps/api/src/utils/nga-search-intent.ts:1-246,494-525`
- Modify: `apps/api/src/utils/nga-search-intent.test.ts`
- Modify: `scripts/lib/open-access-art-ingest.mjs:1`
- Modify: `scripts/lib/nga-structured-search-backfill.mjs:1`
- Delete after green refactor: `scripts/lib/nga-date-range.mjs`
- Test: `scripts/__tests__/open-access-art-ingest.test.mjs`
- Test: `scripts/__tests__/nga-structured-search-backfill.test.mjs`

**Interfaces:**

- Produces: `deriveNgaDisplayDateRange(value: unknown): NgaDateRange | null` at package subpath `@paillette/types/nga-date-range`.
- Produces: `NgaDateRange = Readonly<{ startYear: number; endYear: number }>`.
- Consumes: no application framework, environment binding, filesystem, or network dependency.

- [ ] **Step 1: Add failing real-data grammar tests against the existing helper**

Create `scripts/__tests__/nga-date-range.test.mjs` importing `deriveNgaDisplayDateRange` from `../lib/nga-date-range.mjs`. Use hand-derived literals:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveNgaDisplayDateRange } from '../lib/nga-date-range.mjs';

test('derives inclusive ranges for NGA displayed-date grammar', () => {
  const cases = [
    ['c. 1783/1784', { startYear: 1783, endYear: 1784 }],
    ['1640s', { startYear: 1640, endYear: 1649 }],
    ['first quarter 18th century', { startYear: 1700, endYear: 1724 }],
    ['fourth quarter 18th century', { startYear: 1775, endYear: 1799 }],
    ['2nd half of the 18th century', { startYear: 1750, endYear: 1799 }],
    ['late 18th/early 19th century', { startYear: 1767, endYear: 1833 }],
    ['17th or 18th century', { startYear: 1600, endYear: 1799 }],
    ['after 1750, before 1800', { startYear: 1751, endYear: 1799 }],
  ];

  for (const [value, expected] of cases) {
    assert.deepEqual(deriveNgaDisplayDateRange(value), expected, value);
  }
});

test('fails closed for unknown and contradictory NGA displayed dates', () => {
  assert.equal(deriveNgaDisplayDateRange('date unknown'), null);
  assert.equal(deriveNgaDisplayDateRange('after 1800, before 1700'), null);
  assert.equal(deriveNgaDisplayDateRange('2nd century object number'), null);
});
```

- [ ] **Step 2: Run the new test and verify the expected failures**

Run:

```bash
node --test scripts/__tests__/nga-date-range.test.mjs
```

Expected: the existing helper fails at least the `2nd half`, separately qualified dual-century, and compound-boundary rows; the failure is an assertion mismatch, not a syntax/import error.

- [ ] **Step 3: Implement the minimal complete displayed-date grammar in the existing helper**

Keep the current `clean` function. Replace the century/boundary logic with these explicit concepts:

```js
const SEARCH_MIN_YEAR = 1000;
const SEARCH_MAX_YEAR = 2100;
const QUALIFIER_PATTERN =
  '(?:first quarter|second quarter|third quarter|fourth quarter|first half|second half|1st half|2nd half|early|mid|late)';

const boundedRange = (startYear, endYear) => {
  const start = Math.max(SEARCH_MIN_YEAR, startYear);
  const end = Math.min(SEARCH_MAX_YEAR, endYear);
  return start <= end ? { startYear: start, endYear: end } : null;
};

const boundaryRange = (text) => {
  const matches = [...text.matchAll(/\b(before|after)\s+(1[0-9]{3}|20[0-9]{2})\b/g)];
  if (!matches.length) return undefined;
  let startYear = SEARCH_MIN_YEAR;
  let endYear = SEARCH_MAX_YEAR;
  for (const match of matches) {
    const year = Number(match[2]);
    if (match[1] === 'after') startYear = Math.max(startYear, year + 1);
    if (match[1] === 'before') endYear = Math.min(endYear, year - 1);
  }
  return boundedRange(startYear, endYear);
};
```

Use this century-component regex only when the text contains `century`; it binds each qualifier to its following century number:

```js
const centuryComponentPattern = new RegExp(
  `\\b(?:(${QUALIFIER_PATTERN})(?:\\s+of(?:\\s+the)?)?\\s+)?` +
    '(\\d{1,2})(?:st|nd|rd|th)' +
    '(?=\\s*(?:century\\b|[/\\-]|\\bor\\b|\\band\\b))',
  'g'
);
```

Combine component ranges by minimum start and maximum end. `centuryRange` must add `first half`/`1st half` as offsets 0–49 and `second half`/`2nd half` as offsets 50–99. Evaluate boundaries before generic year extraction so both bounds are intersected. Return `null` for a contradictory bounded range.

- [ ] **Step 4: Run the helper and existing ingest/backfill tests green**

Run:

```bash
node --test scripts/__tests__/nga-date-range.test.mjs scripts/__tests__/nga-structured-search-backfill.test.mjs scripts/__tests__/open-access-art-ingest.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Add API tests proving runtime filtering uses the same grammar**

Extend `matchesNgaSearchConstraints` tests with hand-derived positive and negative cases:

```ts
it.each([
  ['first quarter 18th century', 1720, true],
  ['first quarter 18th century', 1750, false],
  ['fourth quarter 18th century', 1720, false],
  ['fourth quarter 18th century', 1780, true],
  ['2nd half of the 18th century', 1720, false],
  ['2nd half of the 18th century', 1775, true],
])('matches displayed date %s against query year %i as %s', (dateText, year, expected) => {
  expect(
    matchesNgaSearchConstraints(
      { dateText },
      { dateRange: { startYear: year, endYear: year } }
    )
  ).toBe(expected);
});
```

- [ ] **Step 6: Run the API test and verify it fails for quarter/half cases**

Run:

```bash
pnpm --filter @paillette/api test -- src/utils/nga-search-intent.test.ts
```

Expected: the current private API `displayedDateRange` accepts at least one wrong quarter/half case.

- [ ] **Step 7: Move the green parser into the shared package and update every consumer**

Move the behavior-preserving helper implementation to `packages/types/src/nga-date-range.mjs`. Add `packages/types/src/nga-date-range.d.ts`:

```ts
export type NgaDateRange = Readonly<{
  startYear: number;
  endYear: number;
}>;

export function deriveNgaDisplayDateRange(
  value: unknown
): NgaDateRange | null;
```

Add this package export:

```json
"./nga-date-range": "./src/nga-date-range.mjs"
```

Update the API and both Node consumers to import:

```ts
import { deriveNgaDisplayDateRange } from '@paillette/types/nga-date-range';
```

Delete the private API `displayedDateRange` function and call `deriveNgaDisplayDateRange` in `matchesNgaSearchConstraints`. Delete `scripts/lib/nga-date-range.mjs` only after all three consumers import the package subpath. Update the new Node test to import the package subpath as well.

- [ ] **Step 8: Verify the shared module across Node and TypeScript consumers**

Run:

```bash
node --test scripts/__tests__/nga-date-range.test.mjs scripts/__tests__/nga-structured-search-backfill.test.mjs scripts/__tests__/open-access-art-ingest.test.mjs
pnpm --filter @paillette/types typecheck
pnpm --filter @paillette/api test -- src/utils/nga-search-intent.test.ts
pnpm --filter @paillette/api typecheck
```

Expected: all commands pass with one date implementation and no import/type errors.

---

### Task 2: Execute the corpus and repair NGA intent parsing

**Files:**

- Modify: `apps/api/src/utils/nga-search-intent.test.ts`
- Modify: `apps/api/src/utils/nga-search-intent.ts:248-492`
- Modify: `packages/types/src/public-search-core.ts:18`
- Read as test input: `eval/nga-constraint-queries.yaml`

**Interfaces:**

- Consumes: `parseNgaSearchIntent(originalQuery, explicitConstraints?)` and the existing inline-map evaluation corpus.
- Produces: `PublicSearchInterpretation` with parser version `nga-v3`.
- Preserves: bounded safe typo correction and ordinary OR classification lists.

- [ ] **Step 1: Replace the corpus count-only test with executable expectations**

Add a test-only `CorpusQuery` type and loader that parses only the repository's one-record-per-line inline-map format. Split commas only when outside double quotes, convert `startYear` and `endYear` to numbers, and convert `ambiguous` to a boolean. Do not add a YAML runtime dependency.

For all loaded rows assert hand-declared positive and negative expectations:

```ts
for (const queryCase of loadConstraintCorpus()) {
  const intent = parseNgaSearchIntent(queryCase.text);
  const expectedDate =
    queryCase.startYear === undefined
      ? undefined
      : { startYear: queryCase.startYear, endYear: queryCase.endYear };

  expect(intent.constraints.dateRange, queryCase.id).toEqual(expectedDate);
  expect(intent.constraints.classifications, queryCase.id).toEqual(
    queryCase.classification ? [queryCase.classification] : undefined
  );
  expect(intent.constraints.mediumFamilies, queryCase.id).toEqual(
    queryCase.medium ? [queryCase.medium] : undefined
  );
  if (queryCase.semanticQuery !== undefined) {
    expect(intent.semanticQuery, queryCase.id).toBe(queryCase.semanticQuery);
  }
  if (queryCase.ambiguous) {
    expect(intent.constraints, queryCase.id).toEqual({});
  }
}
```

Keep the minimum corpus-size assertion as a separate inventory guard.

- [ ] **Step 2: Run the corpus and verify the two known phrase failures**

Run:

```bash
pnpm --filter @paillette/api test -- src/utils/nga-search-intent.test.ts
```

Expected: failures identify `class-06` (`decorative arts`) and `extra-14` (`decorative art from 1750`) without loader errors.

- [ ] **Step 3: Implement exact multiword vocabulary spans before token matching**

Add an exact-phrase matcher that escapes aliases, sorts longer aliases first, records `{ canonical, matched }`, and excludes occupied spans. Run it for classification aliases containing spaces before the existing token loop. Add each matched phrase to `removals`, remove those phrases from the text used by the token loop, and keep the full original normalized text for semantic construction.

Do not run edit-distance correction across whitespace. The only multiword classification added by this change is the already declared `Decorative Art` vocabulary.

- [ ] **Step 4: Run the corpus green**

Run the API intent test again. Expected: all 88 corpus rows and existing intent tests pass.

- [ ] **Step 5: Add failing relational and compound-boundary tests**

Add these literal cases:

```ts
it.each([
  ['painting showing a sculpture', 'painting showing a sculpture'],
  ['painting with a sculpture', 'painting with a sculpture'],
  ['sculpture depicted in a painting', 'sculpture depicted a painting'],
  ['drawing based on a photograph', 'drawing based on a photograph'],
])('keeps adversarial relational types semantic for %s', (query, semanticQuery) => {
  const intent = parseNgaSearchIntent(query);
  expect(intent.constraints.classifications).toBeUndefined();
  expect(intent.semanticQuery).toBe(semanticQuery);
});

it.each([
  ['after 1700 before 1800 paintings', 1701, 1799],
  ['before 1800 after 1700 paintings', 1701, 1799],
])('intersects query boundaries in %s', (query, startYear, endYear) => {
  expect(parseNgaSearchIntent(query).constraints).toEqual({
    dateRange: { startYear, endYear },
    classifications: ['Painting'],
  });
});
```

- [ ] **Step 6: Run the focused test and verify relational and boundary failures**

Expected: the four relational cases currently impose classifications, while the reversed compound-boundary case retains one date phrase or produces the broad first boundary.

- [ ] **Step 7: Generalize relational detection and intersect numeric boundaries**

Build `classificationTerm` from every escaped classification alias, longest first. Treat the following connector pattern as relational only when it appears between two classification terms:

```ts
const relationalConnector =
  '(?:of|in|depicting|after|showing|with|depicted\\s+in|based\\s+on)';
```

When relational, skip classification hard extraction but continue medium extraction and preserve classification words in the semantic query. Keep the existing semantic expansions for `painting of a sculpture`, Rembrandt attribution, and Italian Renaissance.

In `parseDateRange`, collect every numeric boundary match, start at 1000–2100, intersect each bound, and return every matched phrase for removal. Use the result shape `{ range: { startYear, endYear } | null, matched: string[] }`; a contradictory boundary returns `{ range: null, matched: [] }` so the function does not fall through and reinterpret one boundary year as an exact year. The caller adds removals and a hard constraint only when `range` is non-null. Update the single-match branches to expose `matched: [match[0]]` so removal is uniform.

- [ ] **Step 8: Version the parser and public interpretation type**

Change:

```ts
export const NGA_SEARCH_PARSER_VERSION = 'nga-v3' as const;
```

and:

```ts
parserVersion: 'nga-v1' | 'nga-v2' | 'nga-v3';
```

- [ ] **Step 9: Run parser, route, and type tests green**

Run:

```bash
pnpm --filter @paillette/api test -- src/utils/nga-search-intent.test.ts tests/routes/search.test.ts
pnpm --filter @paillette/api typecheck
pnpm --filter @paillette/types typecheck
```

Expected: all tests pass, all 88 corpus cases execute, and the parser reports `nga-v3`.

---

### Task 3: Make stale API and web cache entries unreachable

**Files:**

- Modify: `apps/api/src/utils/public-search-result-cache.test.ts`
- Modify: `apps/api/src/utils/public-search-result-cache.ts:8`
- Modify: `packages/types/src/public-search-core.ts:1`
- Modify: `apps/web/app/lib/__tests__/public-search.server.test.ts`
- Modify: `apps/web/app/lib/__tests__/public-search-contract.test.ts`
- Modify: `apps/web/app/lib/__tests__/search-spotlights.test.ts`
- Modify: `apps/web/app/lib/__tests__/nga-spotlight-generator.server.test.ts`
- Modify: `apps/web/e2e/search-cost-latency.spec.ts`
- Modify: `apps/web/app/lib/generated-search-spotlight-assets.ts`
- Modify and rename: `apps/web/public/search-spotlights/nga/v24-349c2aba50e2e9785653151581a9b2983e30715a4fe9b9b7c6bd6e46ea008c2d.json`

**Interfaces:**

- Produces: API result-cache keys under `public-search-result:v5:`.
- Produces: `PUBLIC_SEARCH_CONTRACT_VERSION = '25'`, which is also the web text-search cache version.
- Consumes: Task 2's `nga-v3` parser identity.

- [ ] **Step 1: Add a behavioral regression proving a v4 API entry is not addressed**

In `public-search-result-cache.test.ts`, create a cache whose `get` returns a stale-looking valid value only for keys beginning `public-search-result:v4:` and returns `null` otherwise. Call `getOrLoadPublicSearchResult` with `parserVersion: 'nga-v3'` and an exact date constraint. Assert that `load` runs and its fresh response is returned. This test catches reuse of the old key namespace, not merely a constant rename.

- [ ] **Step 2: Change existing web/contract expectations from 24 to 25 and verify red**

Update expected request URLs, spotlight paths, bundle contract literals, and public contract assertions to version 25 before production constants or assets. Run:

```bash
pnpm --filter @paillette/api test -- src/utils/public-search-result-cache.test.ts
pnpm --filter @paillette/web test -- app/lib/__tests__/public-search.server.test.ts app/lib/__tests__/public-search-contract.test.ts app/lib/__tests__/search-spotlights.test.ts app/lib/__tests__/nga-spotlight-generator.server.test.ts
```

Expected: API old-key behavior and web version/path assertions fail for the current v4/v24 implementation.

- [ ] **Step 3: Bump the API and public cache identities**

Set:

```ts
const PUBLIC_SEARCH_RESULT_CACHE_KEY_VERSION = 5;
```

and:

```ts
export const PUBLIC_SEARCH_CONTRACT_VERSION = '25' as const;
```

Keep schema versions and TTL durations unchanged.

- [ ] **Step 4: Re-version the immutable spotlight asset without changing its artwork payload**

Use `apply_patch` to change the asset's `contractVersion` from `24` to `25`. Compute the new SHA-256 from the actual bytes:

```bash
node --input-type=module -e "import {createHash} from 'node:crypto'; import {readFileSync} from 'node:fs'; const p='apps/web/public/search-spotlights/nga/v24-349c2aba50e2e9785653151581a9b2983e30715a4fe9b9b7c6bd6e46ea008c2d.json'; process.stdout.write(createHash('sha256').update(readFileSync(p)).digest('hex'))"
```

The one-byte contract change has a hand-verified resulting SHA-256 of `8980f5259910c5ba88efaea1e8b8cf6aaf2e1416c67f443f295c115c172cb290`. Rename the file to `v25-8980f5259910c5ba88efaea1e8b8cf6aaf2e1416c67f443f295c115c172cb290.json` and update `NGA_SEARCH_SPOTLIGHT_ASSET_PATH` to that exact path. Do not regenerate rankings from staging.

- [ ] **Step 5: Verify cache behavior and immutable asset integrity green**

Run:

```bash
pnpm --filter @paillette/api test -- src/utils/public-search-result-cache.test.ts tests/routes/search.test.ts
pnpm --filter @paillette/web test -- app/lib/__tests__/public-search.server.test.ts app/lib/__tests__/public-search-contract.test.ts app/lib/__tests__/search-spotlights.test.ts app/lib/__tests__/nga-spotlight-generator.server.test.ts
pnpm --filter @paillette/api typecheck
pnpm --filter @paillette/web typecheck
```

Expected: old v4/v24 entries are unreachable, the v25 asset hash test passes, and no cache TTL changes.

---

### Task 4: Make sample-only NGA backfills explicit and fail closed

**Files:**

- Create: `scripts/__tests__/backfill-nga-structured-search-cli.test.mjs`
- Modify: `scripts/backfill-nga-structured-search.mjs:18-93`
- Test: `scripts/__tests__/nga-structured-search-backfill.test.mjs`

**Interfaces:**

- Consumes: `--manifest`, optional `--fallback-plan`, optional `--limit`, and new boolean `--sample-only`.
- Produces summary fields: `sourceCandidateCount`, `availableRecordCount`, `recordCount`, `mode`, and `sourceCoverageComplete` in addition to existing paths/counts.
- Preserves: metadata-only SQL, vector enrichment, and fresh-record precedence.

- [ ] **Step 1: Add CLI integration tests using real temporary files and the real process**

Use `mkdtempSync(join(tmpdir(), 'paillette-nga-backfill-'))`, `spawnSync(process.execPath, [scriptPath, ...])`, and cleanup in `afterEach`. Include three cases with literal fixtures:

1. Manifest `candidateCount: 2` with one normalized sample and no fallback: exit nonzero, stderr contains `incomplete`, and output directory does not exist.
2. The same manifest with `--sample-only`: exit zero and summary equals `sourceCandidateCount: 2`, `availableRecordCount: 1`, `recordCount: 1`, `mode: 'sample'`, `sourceCoverageComplete: false`.
3. The same manifest plus a fallback plan containing the missing second ID: exit zero and summary equals `sourceCandidateCount: 2`, `availableRecordCount: 2`, `recordCount: 2`, `mode: 'full'`, `sourceCoverageComplete: true`.

Use complete minimal records with `id`, `date_text`, `classification`, and `medium`; assert process exit, filesystem side effects, and parsed summary rather than source text.

- [ ] **Step 2: Run the CLI test and verify current unsafe behavior**

Run:

```bash
node --test scripts/__tests__/backfill-nga-structured-search-cli.test.mjs
```

Expected: current CLI exits zero and creates a one-record output for the incomplete manifest, so the first test fails.

- [ ] **Step 3: Validate source coverage before creating output directories**

Read records only from `manifest.providers.nga.normalizedSamples`. Filter both fresh and fallback records to IDs beginning `open-access-art:nga:`, merge the optional fallback plan, then compute:

```js
const sourceCandidateCount = Number(manifest.providers?.nga?.candidateCount || 0);
const availableRecordCount = allRecords.length;
const sourceCoverageComplete = availableRecordCount >= sourceCandidateCount;
const sampleOnly = args.has('sample-only');

if (!sourceCoverageComplete && !sampleOnly) {
  throw new Error(
    `NGA backfill source is incomplete: ${availableRecordCount} authoritative records for ${sourceCandidateCount} candidates; provide --fallback-plan or use --sample-only for a pilot`
  );
}
```

Run this before `mkdirSync`. Validate `limit` and chunk size as nonnegative/positive finite integers. Apply `limit` only after the source-coverage decision.

- [ ] **Step 4: Extend summary accounting**

Write these exact summary properties:

```js
const summary = {
  manifest: resolve(manifestPath),
  sourceCandidateCount,
  availableRecordCount,
  recordCount: records.length,
  mode: sampleOnly ? 'sample' : 'full',
  sourceCoverageComplete,
  sqlFiles,
  vectorFiles,
  enrichedVectorCount,
};
```

- [ ] **Step 5: Run CLI and helper tests green**

Run:

```bash
node --test scripts/__tests__/backfill-nga-structured-search-cli.test.mjs scripts/__tests__/nga-structured-search-backfill.test.mjs
```

Expected: incomplete normal mode fails before output, explicit pilots are labeled, and a complete fallback plan succeeds.

---

### Task 5: Prove combined hard constraints and NGS non-regression

**Files:**

- Modify: `apps/api/tests/routes/search.test.ts`
- Test without behavior changes: `apps/web/app/lib/__tests__/public-search.server.test.ts`
- Test without behavior changes: `apps/web/app/routes/__tests__/public-org-search-loader.test.ts`
- Test without behavior changes: `apps/web/app/routes/__tests__/artwork-detail-route.test.ts`
- Generate local evidence only: `tmp/nga-fix-validation-v2/backfill/summary.json`

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces: route-level evidence that no returned row violates extracted date, classification, or medium constraints.

- [ ] **Step 1: Add a failing combined-constraint route test**

Create four literal NGA rows for query `oil paintings after 1700 before 1800`: one valid 1750 oil painting and three rows each violating exactly one of date, classification, or medium. Give every row an authoritative `date_text`, `classification`, `medium`, and NGA provider metadata. Assert:

```ts
expect(payload.data.interpretation).toMatchObject({
  parserVersion: 'nga-v3',
  constraints: {
    dateRange: { startYear: 1701, endYear: 1799 },
    classifications: ['Painting'],
    mediumFamilies: ['oil'],
  },
});
expect(payload.data.results.map((row: { id: string }) => row.id)).toEqual([
  'nga-valid-oil-painting-1750',
]);
```

This catches removal of any single hard-filter branch with independent fixture data.

- [ ] **Step 2: Run the route test red, then green through the preceding fixes**

Run:

```bash
pnpm --filter @paillette/api test -- tests/routes/search.test.ts
```

Expected before Task 2 is green: compound bounds are misinterpreted. Expected after Tasks 1–3: only the valid row is returned.

- [ ] **Step 3: Run all focused NGA and NGS regression suites**

Run:

```bash
pnpm --filter @paillette/api test -- src/utils/nga-search-intent.test.ts src/utils/public-search-result-cache.test.ts tests/routes/search.test.ts
node --test scripts/__tests__/nga-date-range.test.mjs scripts/__tests__/nga-structured-search-backfill.test.mjs scripts/__tests__/open-access-art-ingest.test.mjs scripts/__tests__/backfill-nga-structured-search-cli.test.mjs
pnpm --filter @paillette/web test -- app/lib/__tests__/public-search.server.test.ts app/lib/__tests__/public-search-contract.test.ts app/lib/__tests__/search-spotlights.test.ts app/lib/__tests__/nga-spotlight-generator.server.test.ts app/routes/__tests__/public-org-search-loader.test.ts app/routes/__tests__/artwork-detail-route.test.ts
```

Expected: all focused suites pass; `isAllowedPublicSearchRouteId('ngs')` remains false and NGA remains allowed.

- [ ] **Step 4: Generate an unmistakable local sample-pilot artifact**

Run against the existing local dry-run manifest:

```bash
node scripts/backfill-nga-structured-search.mjs --manifest=tmp/nga-fix-validation/dry-run-manifest.json --sample-only --limit=5 --out-dir=tmp/nga-fix-validation-v2/backfill
```

Expected summary: `sourceCandidateCount: 63419`, `availableRecordCount: 5`, `recordCount: 5`, `mode: 'sample'`, `sourceCoverageComplete: false`. Do not apply the generated SQL.

- [ ] **Step 5: Run repository-wide verification from the exact worktree state**

Run:

```bash
git diff --check
scripts/agent-evidence
```

Expected: formatting check passes and the evidence manifest records passing lint, workflow contracts, build, type-check, and test lanes.

- [ ] **Step 6: Review the final diff and report limitations**

Run:

```bash
git status --short --branch
git diff --stat
git diff --name-only
```

Report focused test counts, the new evidence manifest path, the sample-pilot summary path, and the remaining limitation that staging still runs unchanged code. Do not claim live deployment validation, first-publish GO, or backfill readiness from the five-record pilot.
