# NGA Generalizable Search Staging Design

## Goal

Repair NGA relational search and image-mode state using one explicit, versioned search interpretation, then deploy the exact reviewed API and web builds to staging only. Production is out of scope.

## Problem statement

NGA structured search currently understands dates, classifications, media, artists, and safe corrections, but it discards grammatical roles when two artwork classifications appear around a relation. For example, `painting showing a sculpture` suppresses both classification constraints, after which the independent router treats `sculpture` as a medium/classification keyword and promotes Sculpture records. The parser and router therefore disagree because they infer intent independently.

The public search UI has the same structural issue in state form: `searchMode` identifies both the open editor and the owner of submitted results. Merely opening Image marks the page active, abandons prior text results, mounts the results toolbar, leaks stale interpretation and colour state, and can report no results before an image request exists. The image request supports no structured constraints, and its browser query identity uses only the filename.

## Scope

### Included

- A canonical NGA relation object for `depicts`, `features`, and `derived_from` classification-to-classification phrases.
- Direction-aware active and passive relation parsing.
- Hard classification constraints derived only from the returned work/carrier role.
- One NGA search plan consumed by both interpretation and routing; relational queries must not be independently reclassified as `medium_exact`.
- Explicit constraints remain authoritative. An explicit empty object removes inferred hard filters while retaining relation metadata.
- Parser `nga-v5`, plan `nga-plan-v1`, public contract `27`, and API result-cache namespace `v6`.
- A v27 immutable NGA spotlight asset whose result payload is unchanged except for its contract version and content-addressed filename.
- Separate UI editor state and submitted-search ownership.
- No results toolbar or generic empty-result message before an image is submitted.
- Image search with snapshotted hard date/classification/medium/artist constraints, enforced in Vectorize and again after D1 enrichment.
- Digest-based browser identity for uploaded images.
- Truthful local palette ordering of image or text results.
- Image validation, accessible upload feedback, object-URL cleanup, and `Cache-Control: no-store` on the public image proxy.
- A staging-only evaluation gate covering hard constraints, relations, cache behavior, browser state, image constraints, and NGS non-regression.
- Direct deployments of both Cloudflare staging Workers that serve `paillette-api-stg.berlayar.ai` and `paillette-stg.berlayar.ai`, after local review and evidence.

### Excluded

- Production deployment or promotion.
- Semantic text plus uploaded-image rank fusion.
- Learned or user-configurable fusion weights.
- Persistent uploaded-image/result caching.
- Database migrations, D1 writes, vector upserts, metadata-index changes, R2 uploads, queue jobs, generated captions, or cache purges.
- Full NGA metadata-only catalogue expansion.

## Search contract

The shared public-search contract gains:

```ts
type PublicSearchRelation =
  | {
      kind: 'depicts' | 'features';
      workClassification: string;
      subjectClassification: string;
    }
  | {
      kind: 'derived_from';
      workClassification: string;
      sourceClassification: string;
    };

type NgaSearchPlan = {
  version: 'nga-plan-v1';
  mode: 'structured' | 'semantic' | 'relational';
  retrievalQuery: string;
  constraints: PublicSearchConstraints;
  relation?: PublicSearchRelation;
};
```

`PublicSearchInterpretation` exposes the optional relation. Canonical relation fields use existing canonical NGA classification names.

### Relation grammar

- `work showing/depicting/of subject` becomes `depicts`.
- `subject shown/depicted in work` becomes the same canonical `depicts` relation.
- `work with subject` becomes `features`.
- `work based on source` and the reversed `source used as the basis for work` become `derived_from`.
- `after` is derivation only when both sides are known artwork classifications. `painting after Rembrandt` remains attribution language with a Painting filter.
- `and`/`or` classification lists remain multi-classification hard constraints.
- Unsupported or ambiguous constructions fail closed: no accidental classification OR, relation, or medium-exact route; the ambiguity is reported through `unresolved`.
- Subject/source materials do not become work media. `oil painting showing a bronze sculpture` filters Painting + oil, not bronze.
- Work-attached dates become hard dates. Subject-attached dates remain semantic.

### Routing

The NGA route compiles the plan once. The retrieval query and typed mode feed the router. A relational plan uses balanced image/caption/metadata candidate retrieval and current structured filters; it never derives `medium_exact` from the subject/source classification token. Existing non-NGA and NGS routing is unchanged.

## Image contract

The multipart public image request accepts:

- `image`: required JPEG, PNG, or WebP, non-empty, maximum 10 MiB.
- `topK` and `minScore`: existing bounded controls; `minScore=0` must serialize.
- `constraints`: optional canonical JSON `PublicSearchConstraints`.

The web proxy and API independently validate the request before embedding spend. The API computes the authoritative SHA-256 digest. The image Vectorize query receives structured filters, and enriched rows are checked again by the shared hard-constraint matcher before return.

No uploaded bytes or image results are persistently cached. The proxy responds `Cache-Control: no-store`. The client query identity includes contract version, org, SHA-256 bytes digest, canonical constraints, topK, and minScore. The server cold-miss/rate-limit identity includes the server digest, canonical constraints, model/index identity, and request controls.

## UI state model

```ts
type EditorMode = 'text' | 'image' | 'colour';

type SubmittedSearch =
  | { kind: 'text'; query: string; facet: SearchFacet | null }
  | { kind: 'colour'; query: string; colour: string; refinement: 'local-palette' }
  | { kind: 'image'; digest: string; constraints?: PublicSearchConstraints };
```

Browse remains orthogonal. Editor mode selects the visible input; submitted search owns query enablement, results, summaries, interpretation, and empty/error states.

- Opening Image without a file submits nothing.
- Existing text results may remain visible while Image is merely being edited, with explicit copy stating this.
- Submitting an image snapshots only hard constraints from the currently completed text interpretation. Residual semantic text is not shown or claimed as an image refinement.
- Image results show only constraints that were sent and accepted.
- Colour is labeled `Palette order`, not a hard filter or combined semantic refinement.
- Result controls render only for a submitted search or browse state.
- Upload rejection preserves existing results, exposes an accessible error, and does not spend an embedding request.

## Evaluation

### Local gates

- Existing 92-query NGA parser/constraint fixture remains green after updating relational expectations.
- New relation grammar and route fixtures cover active/passive reversals, subject/work inversion, dates and media attached to either role, attribution controls, lists, and unsupported ambiguity.
- Image route tests prove proxy/API validation, canonical constraint forwarding, Vectorize filter construction, final D1 backstop, digest identity, zero-score serialization, and NGS/private scope behavior.
- UI unit/E2E tests prove no passive request or false empty state, submitted-result ownership, truthful chips, same-filename/different-byte identity, colour ordering without a network request, upload errors, and cleanup.
- Full repository evidence must pass before deployment.

### Staging pilot

Run at least these five cases first:

1. `painting showing a sculpture`: relation `Painting depicts Sculpture`; every row is a Painting; top results are manually graded.
2. `sculpture depicted in a painting`: canonicalizes to the same plan and constraints.
3. `paintings and sculptures`: remains an explicit two-classification list.
4. `oil paintings of ships before 1800`: every row satisfies date, medium, and classification.
5. A pinned NGA image plus explicit Painting/date constraints: every row satisfies both constraints; repeat bytes are stable; same filename with different bytes does not collide.

Any HTTP/auth failure, hard-constraint violation, wrong relation direction, degraded cacheable response, NGS exposure, or cache collision stops the rollout.

### Full staging matrix

- All existing parser/hard-constraint fixtures and historical live query categories.
- At least 24 relational/adversarial live text queries.
- Image constraint cases across date, classification, medium, artist, repeated bytes, different bytes with the same filename, invalid MIME, zero-byte, and oversized payload.
- Cache MISS/repeat HIT or KV-FRESH behavior for text; image remains no-store.
- Anonymous browser checks for Image pre-upload, upload/results, active interpretation, and colour ordering.
- NGS page remains private and no anonymous NGS public-search request succeeds.

Hard constraints and security require 100% compliance. Relation ranking is reported separately using 0-3 labels, Precision@5, MRR, and nDCG@10; staging must materially improve the relation category without a meaningful regression in the unchanged query categories. Labels are assigned to returned artworks, not inferred from scores.

## Deployment and rollback

Before deployment, capture git SHA plus the current API and web staging deployment/version IDs. Deploy API first and web second from the exact reviewed commit with the repository package commands:

```bash
pnpm --filter @paillette/api deploy:staging
pnpm --filter @paillette/web deploy:staging
```

Verify API staging health reports `environment: staging` before and after. The two predeploy staging Worker identities are the rollback targets. Production deployment/version identities are captured read-only and must remain unchanged. This task stops after the staging verdict.

## Success criteria

- No relational query direction is lost.
- No result violates an extracted or explicit hard constraint.
- Image constraints are real, not decorative UI state.
- Selecting a search editor without submitting does not create results, errors, or network traffic.
- Cache identities distinguish semantic versions, canonical relations, constraints, and image bytes.
- NGS and non-NGA behavior does not regress.
- Both staging Workers run the same reviewed git commit.
- Production is unchanged.
