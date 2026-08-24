# NGA Structured Search Release Repair Design

## Purpose

Make NGA structured search safe for its first publish by repairing the release-blocking parser, date-filtering, cache-identity, evaluation, and backfill-readiness defects found during the independent release review. This work remains local: it does not deploy, migrate data, purge caches, commit, push, or mutate staging or production.

## Scope

The repair covers five connected concerns:

1. NGA query intent parsing for hard date, classification, and medium constraints.
2. NGA displayed-date normalization used by runtime result filtering and ingestion/backfill metadata.
3. Cache identities that must change whenever parsing or result-filtering semantics change.
4. Executable evaluation coverage for the maintained NGA constraint corpus and newly discovered adversarial cases.
5. Backfill-plan safety when an open-access dry-run manifest contains samples rather than the full candidate corpus.

NGS behavior is not changed. Its public-search route remains disabled, and existing scope and visibility tests must continue to pass.

## Design Decisions

### Shared displayed-date normalization

There will be one framework-independent ESM implementation exported through `@paillette/types/nga-date-range`. The shared package will provide a typed `deriveNgaDisplayDateRange(value)` function returning an inclusive `{ startYear, endYear }` interval or `null` when the displayed date cannot safely define a hard constraint.

Both the API constraint matcher and the Node ingestion/backfill helpers will consume this function. The current private API parser and script-local implementation will be removed so they cannot drift.

The grammar will support:

- exact years, slash or dash year intervals, decades, `before`, and `after`;
- early, mid, and late century thirds;
- first through fourth century quarters;
- first and second century halves, including numeric forms such as `2nd half`;
- dual-century descriptions whose qualifiers apply to the century they precede, such as `late 18th/early 19th century`;
- multiple compatible boundaries by intersection, so `after 1750, before 1800` becomes 1751–1799;
- unknown or unparseable dates as `null`, preventing broad fallback years from being treated as authoritative displayed dates.

Intervals remain inclusive and bounded to the search contract's accepted 1000–2100 range. Contradictory boundaries return `null` rather than inventing a range.

### Query intent parsing

Controlled-vocabulary extraction will become phrase-aware. Exact multiword aliases such as `decorative art` and `decorative arts` will be matched before single-token classification and medium aliases. Matched spans, not individual substrings, will be removed from the semantic query.

Safe typo correction remains limited to the bounded vocabulary and its existing edit-distance thresholds. No general spelling correction or artist-name rewriting will be introduced.

Relational object-type language will be detected as a semantic clause when two classification terms are connected by attribution, depiction, containment, or derivation language. The covered forms include the existing `of`, `in`, `depicting`, and `after` forms plus `showing`, `with`, `depicted in`, and `based on`. In such clauses the parser will not impose classification hard filters, and it will preserve the object-type terms in the semantic query. Ordinary lists such as `paintings and sculptures` retain their existing multi-classification behavior.

Query date parsing will intersect compatible `before` and `after` boundaries regardless of order. Existing exact-year, range, decade, circa, and century behavior remains unchanged. Ambiguous historical or attribution phrases such as `18th-century style` and `works after Rembrandt` remain semantic rather than numeric constraints.

The parser version becomes `nga-v3`, and the shared public type will explicitly admit that version.

### Cache rollout safety

Changing result-filtering semantics without changing cache identity can replay stale rows for up to seven days. The repair therefore changes all three relevant identities:

- NGA parser version from `nga-v2` to `nga-v3`;
- API public-search result-cache key version from 4 to 5;
- public-search contract/web cache version from 24 to 25.

The immutable NGA spotlight asset will be re-versioned locally to contract 25 with a content-correct hash and matching generated path. These version changes make old cache entries unreachable; no cache purge is required or authorized.

Tests will assert the new versions and prove that parser/constraint identity changes produce a different API cache key.

### Executable evaluation

The API parser test will read every inline query record in `eval/nga-constraint-queries.yaml` and assert every declared expectation rather than merely counting records. The test-only loader will parse the file's deliberately constrained inline-map format without adding a production dependency.

For each corpus record, declared dates, classification, medium, semantic query, and ambiguity expectations will be checked. Additional focused cases will cover:

- phrase-aware `Decorative Art` extraction;
- punctuation, case, Unicode dashes, and existing safe typos;
- combined date/classification/medium constraints;
- relational language found during adversarial review;
- compound date boundaries in both orders;
- real NGA displayed-date forms for quarters, halves, and qualified dual centuries;
- rejection of every returned artwork that violates an extracted hard constraint.

Tests will be written and observed failing before each production change. Focused suites will be run after each repair, followed by the repository evidence command.

### Backfill plan safety

`backfill-nga-structured-search.mjs` will distinguish a full plan from a sample pilot before creating output files. It will compare the NGA provider's declared `candidateCount` with the unique authoritative records available from the manifest and optional fallback plan.

If the available source is incomplete, normal mode will fail with an actionable error. An explicit `--sample-only` flag will permit a pilot. `--limit` limits output size but does not silently authorize an incomplete source.

The summary will include source candidate count, available unique record count, emitted record count, mode (`full` or `sample`), and whether source coverage is complete. A full run must not claim readiness unless source coverage is complete. Existing metadata-only SQL and vector-enrichment behavior remains unchanged.

CLI integration tests will verify fail-closed behavior, explicit sample mode, complete fallback-plan mode, and summary accounting. Validation may generate local pilot artifacts, but it will not apply SQL or vectors.

## Data Flow

1. A public NGA query is normalized and parsed into semantic text plus versioned hard constraints.
2. The parser version and constraints participate in the API cache key; the web request cache uses the new public contract version.
3. Retrieval produces candidates, and runtime filtering applies every hard constraint.
4. Date filtering derives the authoritative interval from the artwork's displayed date through the shared parser. If a displayed date is present but cannot be parsed, the artwork is rejected for date-constrained searches.
5. Ingestion and backfill derive stored date bounds through the same shared function, keeping newly enriched metadata consistent with runtime filtering.

## Error Handling

- Unknown displayed dates produce `null` and fail closed under a date constraint.
- Contradictory query boundaries produce no invented date range; the unresolved text remains semantic.
- Ambiguous relational classification language produces no classification hard constraint.
- Incomplete backfill inputs fail before output directories or readiness summaries are created unless `--sample-only` is explicit.
- Existing validation errors for malformed explicit constraints remain unchanged.

## Validation and Acceptance Criteria

The repair is accepted locally when all of the following are true:

1. All 88 maintained evaluation queries execute and satisfy every declared expectation.
2. All new adversarial parser and displayed-date tests pass.
3. Cache identity tests prove old parser/result/web identities are unreachable.
4. Backfill CLI tests prove incomplete sources fail closed and sample pilots are unmistakably labeled.
5. API route tests prove returned NGA rows satisfy every extracted hard constraint.
6. NGS scope, visibility, and public-route tests remain unchanged and passing.
7. `git diff --check` and `scripts/agent-evidence` pass from the repaired worktree.

Local success does not prove staging behavior because the repair will not be deployed. The final report will separate local evidence from unchanged staging evidence and will list that deployment validation as an explicit remaining release step.

## Non-Goals

- No fuzzy artist/entity resolution, provenance parser, or natural-language model is added.
- No ranking model, embedding corpus, or search UI redesign is changed.
- No database migration, vector upload, cache purge, deploy, or production/staging mutation occurs.
- No NGS public access is enabled.
