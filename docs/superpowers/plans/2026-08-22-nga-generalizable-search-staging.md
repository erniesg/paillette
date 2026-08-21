# NGA Generalizable Search Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and stage a versioned relation-aware NGA search plan plus truthful image search with hard structured constraints.

**Architecture:** Compile NGA relational intent once into a shared typed plan consumed by routing, filters, cache identity, and UI interpretation. Separate UI editor state from submitted-result ownership, and extend uploaded-image search only with hard structured constraints and local palette ordering; semantic text-image fusion remains out of scope.

**Tech Stack:** TypeScript, Hono, Remix, React Query, Cloudflare D1/Vectorize/KV/Workers, Vitest, Playwright, Python staging evaluator.

**Spec:** `docs/superpowers/specs/2026-08-22-nga-generalizable-search-staging-design.md`

## Global Constraints

- Deploy staging API and web only; never deploy or promote production.
- Do not migrate or write D1, upsert vectors, change Vectorize metadata indexes, upload R2 assets, enqueue jobs, generate captions, or purge caches.
- Keep relation planning behind the existing NGA provider gate; NGS and non-NGA routing must remain unchanged.
- Hard constraints must be applied during every retrieval channel and verified again after enrichment.
- Explicit constraints are authoritative; explicit `{}` removes inferred filters.
- Uploaded image bytes and results remain uncached; public image responses use `Cache-Control: no-store`.
- Use TDD for every production behavior and record RED then GREEN evidence.
- Capture staging rollback identities before deploying either Worker.
- Stop on any hard-constraint, auth/scope, cache-identity, relation-direction, or environment-identity failure.

---

### Task 1: Canonical relation plan and parser

**Files:**
- Modify: `packages/types/src/public-search-core.ts`
- Modify: `apps/api/src/utils/nga-search-intent.ts`
- Modify: `apps/api/src/utils/nga-search-intent.test.ts`
- Modify: `eval/nga-constraint-queries.yaml`

**Interfaces:**
- Produces: `PublicSearchRelation`, `NgaSearchPlan`, parser `nga-v5`, and `compileNgaSearchPlan(query, explicitConstraints?)`.
- Consumes: existing vocabulary normalization and `PublicSearchConstraints`.

- [ ] Add literal failing parser tests for active/passive `depicts`, `features`, and `derived_from`, role-attached media/dates, classification lists, attribution controls, unsupported ambiguity, and explicit `{}`.
- [ ] Run `pnpm --filter @paillette/api test -- src/utils/nga-search-intent.test.ts` and record expected failures caused by absent relation/plan output.
- [ ] Add shared relation/plan types and implement the smallest span-based compiler using declarative connector definitions and existing canonical vocabularies.
- [ ] Bump the parser literal to `nga-v5`; update existing fixtures only where relation semantics intentionally changed.
- [ ] Re-run the focused parser tests and the 92-case fixture loader; keep all unrelated expectations green.
- [ ] Commit only Task 1 files with `feat(search): compile NGA relational intent`.

### Task 2: Relation-aware routing, result filtering, and versioned caches

**Files:**
- Modify: `apps/api/src/routes/search.ts`
- Modify: `apps/api/tests/routes/search.test.ts`
- Modify: `apps/api/src/utils/public-search-result-cache.ts`
- Modify: `apps/api/src/utils/public-search-result-cache.test.ts`
- Modify: `packages/types/src/public-search-core.ts`
- Modify: `apps/web/app/lib/public-text-search-plan.ts`
- Modify: `apps/web/app/lib/__tests__/public-text-search-plan.test.ts`
- Modify: `apps/web/app/lib/public-search.server.ts`
- Modify: `apps/web/app/lib/__tests__/public-search.server.test.ts`
- Modify: `apps/web/public/search-spotlights/nga/*`
- Modify: `apps/web/app/lib/search-spotlights.ts`

**Interfaces:**
- Consumes: Task 1 `NgaSearchPlan`.
- Produces: relational route mode, canonical cache identity, public contract `27`, API result key `v6`, immutable v27 spotlight path.

- [ ] Add failing route fixtures containing Painting, Sculpture, Drawing, and Photograph distractors; assert active/passive paraphrases use the same work constraint, relational routes are not `medium_exact`, final rows comply, and non-relational controls remain unchanged.
- [ ] Add failing cache tests proving relation direction and plan version affect identity while canonical active/passive paraphrases can share the retrieval identity.
- [ ] Run focused API route/cache and web cache-key tests; record the expected failures.
- [ ] Integrate the compiled NGA plan at the provider gate and make the router consume typed mode/retrieval text rather than retokenizing relational subject classifications.
- [ ] Bump parser/contract/cache versions and create the content-addressed v27 spotlight asset without changing its artwork rankings.
- [ ] Re-run route, cache, contract, spotlight, and NGS/non-NGA regression suites.
- [ ] Commit only Task 2 files with `fix(search): route NGA relations through canonical plans`.

### Task 3: Image constraints and authoritative request identity

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/routes/search.ts`
- Modify: `apps/api/tests/routes/search.test.ts`
- Modify: `apps/web/app/types.ts`
- Modify: `apps/web/app/routes/api.public-search.$orgId.image.ts`
- Create: `apps/web/app/routes/__tests__/public-search-image-route.test.ts`
- Create: `apps/web/app/lib/public-image-search-plan.ts`
- Create: `apps/web/app/lib/__tests__/public-image-search-plan.test.ts`

**Interfaces:**
- Produces: multipart `constraints` field, digest-based client identity, `buildPublicImageSearchPlan`, no-store proxy responses.
- Consumes: canonical constraint normalization and the existing shared hard-constraint matcher.

- [ ] Add failing API and proxy tests for canonical constraints, Vectorize filters, D1 backstop, malformed JSON/unknown fields, invalid MIME, zero-byte/oversize files, `minScore=0`, and no embedding spend on invalid requests.
- [ ] Add failing image-plan tests proving same bytes/different filename share identity, different bytes/same filename do not collide, and canonical-equivalent constraints share identity.
- [ ] Run focused API/proxy/image-plan tests and record expected failures.
- [ ] Implement independent proxy/API validation, server digest identity, structured Vectorize filter, final enriched-row backstop, telemetry, and `Cache-Control: no-store`.
- [ ] Re-run focused tests plus unconstrained image and NGS/private-scope regressions.
- [ ] Commit only Task 3 files with `feat(search): constrain NGA image retrieval`.

### Task 4: Truthful search composer and image-mode layout

**Files:**
- Create: `apps/web/app/lib/public-search-composer.ts`
- Create: `apps/web/app/lib/__tests__/public-search-composer.test.ts`
- Modify: `apps/web/app/routes/galleries.$galleryId.search.tsx`
- Modify: `apps/web/app/routes/__tests__/search-masonry-layout.test.ts`
- Modify: `apps/web/e2e/search-cost-latency.spec.ts`

**Interfaces:**
- Produces: `EditorMode`, `SubmittedSearch`, state derivation helpers, accessible staged image composer.
- Consumes: Task 3 image plan and the current completed text interpretation's hard constraints.

- [ ] Add failing composer/unit/E2E tests for editor-only Image state, prior result ownership, image submission, snapshotted constraints, truthful interpretation/order chips, no passive request, and no premature empty state.
- [ ] Add failing tests for same-name image replacement, upload rejection, object-URL cleanup, `aria-pressed`, accessible uploader/status/error, and local palette ordering without a request.
- [ ] Run focused web unit/E2E tests and record expected failures.
- [ ] Implement the discriminated submitted-search state, compact pre-upload layout, progressive result controls, accessible error/status handling, and object-URL lifecycle.
- [ ] Re-run focused web tests and passive-network checks.
- [ ] Commit only Task 4 files with `fix(search): separate NGA editor and result state`.

### Task 5: Staging evaluation assets and gate

**Files:**
- Create: `eval/nga-staging-cases.yaml`
- Create: `eval/nga-image-fixtures.json`
- Create: `eval/nga_staging_gate.py`
- Create: `apps/web/e2e/nga-staging-gate.spec.ts`
- Modify: `tmp/nga-v3-release-validation/evaluate.mjs` or extract a committed reusable evaluator under `eval/`.

**Interfaces:**
- Produces: host-locked staging runner, pilot/full reports, raw result and hard-constraint evidence, browser screenshots/traces.
- Consumes: parser/plan v5/v1 interpretation and Task 3 image constraints.

- [ ] Add failing evaluator tests/fixtures proving relation-direction mismatch, hard-constraint violation, wrong host/environment, NGS exposure, and image cache collision make the gate fail.
- [ ] Run evaluator unit tests and record expected failures.
- [ ] Implement a runner that accepts only the exact staging API/web hosts, verifies staging health, executes a five-case pilot before the full matrix, checks every row's hard constraints, and records cache/degradation metadata.
- [ ] Add 0-3 manual relevance labels for the bounded relation pilot and compute Precision@5, MRR, and nDCG@10 without treating similarity scores as truth.
- [ ] Add the live anonymous-browser spec for pre-upload Image state, constrained image results, colour ordering, and locked NGS behavior.
- [ ] Run evaluator unit tests locally with fixtures.
- [ ] Commit only Task 5 files with `test(search): add NGA staging evaluation gate`.

### Task 6: Whole-branch verification and independent review

**Files:**
- Modify only files required to address reviewed Critical/Important findings.

- [ ] Run focused parser, route, cache, image, composer, proxy, evaluator, and NGS regression tests.
- [ ] Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`, and `git diff --check`.
- [ ] Run `scripts/agent-evidence` and record its manifest path.
- [ ] Generate a full diff review package and obtain an independent code-review verdict; fix every Critical/Important issue and re-review the fix range once.
- [ ] Confirm the branch contains intentional commits only and `.impeccable/` remains uncommitted review evidence.

### Task 7: Staging-only deployment and evaluation

**Files:**
- Generate: `.agent/evidence/nga-staging/<candidate-sha>/<run-id>/**`

- [ ] Capture current staging and production API/web deployment/version identities and staging health; write rollback evidence without secrets.
- [ ] Deploy the reviewed API commit with `pnpm --filter @paillette/api deploy:staging`.
- [ ] Verify exact API staging version and `health.environment=staging`; stop or roll back on mismatch.
- [ ] Deploy the reviewed web commit with `pnpm --filter @paillette/web deploy:staging`.
- [ ] Verify exact web staging version and route health; stop or roll back on mismatch.
- [ ] Run the five-case staging pilot. Inspect raw rows and manually grade relation relevance before continuing.
- [ ] If the pilot passes, run the full structured/relational/image/cache/browser/NGS matrix and hash the evidence artifacts.
- [ ] Confirm production deployment identities are unchanged.
- [ ] Report the staging verdict, limitations, rollback identities, exact commands, and artifact paths; stop without production promotion.
