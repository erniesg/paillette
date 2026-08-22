# NGA Artist, Attribution, and Relation Staging Repair Design

## Goal

Repair the remaining NGA first-publish search failures without adding collection-specific query hacks: populate authoritative primary-artist identifiers, preserve all official artist relationships, route artist-attribution language through catalogue evidence, and apply different evidence rules to visible-subject and historical-derivation relations. Deploy and mutate staging only. Production remains frozen.

## Release status and evidence

The exact reviewed commit `1619b483046112773f9aff30271c9e73764df2a4` passes 134 of 134 live text cases and five of six live image cases. The sole hard failure is the image search case that uploads NGA object `131994` and constrains results to artist constituent `1364`; it returns zero rows.

The failure is systemic. The NGA loader fetches `objects.csv` and `published_images.csv`, then reads `objects.primaryartistid`, a column that does not exist. The official relationship is in `objects_constituents.csv`. Consequently, all 63,253 staged NGA rows have a null `artworks.primary_artist_id`, and their image-vector metadata has an empty `primaryArtistId`.

At the immutable NGA source commit `79d114c2186ca38af27a9478717f1e509d799495`:

- all 63,253 staged object IDs have at least one `roletype=artist` relationship;
- those objects have 75,131 artist-relation rows and 7,538 distinct related artist constituents;
- 53,934 objects have one artist relation and 9,319 have multiple relations;
- every object has one unique lowest numeric `displayorder` after exact duplicate removal;
- all referenced artist constituents resolve in `constituents.csv`;
- object `131994` selects constituent `1364`, object `11236` selects `1974`, and object `110821` selects `23812` while retaining secondary relation `2402` with role `artist after`.

The existing live relation ranking also exposes an evidence problem. Visible-subject queries such as `painting showing a sculpture` have a small number of strong results followed by visually similar but unsupported suggestions. Historical queries such as `drawing based on photograph` return generic drawings even though neither image similarity nor a generated visual caption can establish that a photograph was the historical source. Artist-attribution queries such as `painting after Rembrandt` fall through to balanced semantic retrieval instead of searching the official catalogue attribution.

## Scope

### Included

- An immutable, hash-verified NGA metadata snapshot containing `objects.csv`, `published_images.csv`, `objects_constituents.csv`, `constituents.csv`, and `constituents_altnames.csv` from one repository commit.
- Deterministic primary-artist selection from the official relationship ordering.
- Preservation of every official artist relation, qualifier, resolved name, and alternative name in NGA artwork custom metadata.
- A guarded, dry-run-by-default staging backfill for D1 `primary_artist_id`, the NGA artist metadata stored in `custom_metadata`, and the corresponding image-vector `primaryArtistId` metadata.
- Typed parsing and catalogue-backed retrieval for direct artist and attribution phrases, including `by`, `after`, `attributed to`, `workshop of`, `studio of`, `circle of`, `school of`, and `follower of`.
- Evidence-aware relation retrieval: visible-subject relations may use visual evidence, while historical derivation must use explicit institution-sourced catalogue evidence.
- Truthful interpretation and empty-result copy when the indexed catalogue cannot verify a historical relation.
- Evaluator hardening so weakly related results do not count as successful first-publish relevance.
- A five-row staging data pilot, a full staging backfill only after the pilot passes, exact-head staging deployment, and the complete local/live/browser/cache/NGS gate.

### Excluded

- Production deployment, production data mutation, or production cache mutation.
- A new D1 artist or artwork-relation table.
- Treating every contributor ID as a hard `artistIds` constraint. The v1 constraint remains explicitly `primary artist`; all contributor relations are preserved for a later contract.
- Guessing a unique artist identity from an ambiguous bare name.
- Using image embeddings, generated captions, ownership provenance, or ingest lineage as proof of historical derivation or attribution.
- Curated scholarly enrichment when the official NGA open-data snapshot contains no derivation evidence.
- New image embeddings, image downloads, R2 writes, collection expansion, or ingestion of metadata-only NGA objects.
- Production promotion. A separate explicit decision is required after the staging report.

## Authoritative artist data contract

### Immutable source

Preparation must pin one NGA repository commit and record the SHA-256 digest and row count of each of the five source CSV files. It must reject mixed commits, missing files, hash mismatches, malformed CSV headers, or a source candidate set that differs from the declared manifest.

The staging repair operates on the exact 63,253 artwork IDs already staged. Upstream additions are reported but not silently inserted. This prevents a metadata repair from becoming an unreviewed collection expansion.

### Relationship normalization

For every staged NGA object:

1. Validate decimal `objectid`, decimal `constituentid`, `roletype`, `role`, and integer `displayorder`.
2. Keep only rows whose normalized `roletype` is `artist`.
3. Deduplicate exact `(objectid, constituentid, displayorder, role, prefix, suffix)` rows.
4. Resolve every remaining constituent through `constituents.csv` and its names through `constituents_altnames.csv`.
5. Sort by numeric `displayorder`.
6. Select the unique lowest-order relation as `primary_artist_id`.
7. Fail preparation for a missing artist relation, unresolved constituent, malformed order, or lowest-order tie. Never break a tie by input order, role priority, or constituent ID.

The normalizer receives the joined artist data explicitly. It must not retain a fallback to the nonexistent `objects.primaryartistid` field. Tests use literal official CSV headers so a fabricated fixture cannot mask the source-schema defect again.

### Persisted metadata

The existing scalar `artworks.primary_artist_id` stores the selected decimal constituent ID string. `field_sources.primary_artist_id` records `nga.objects_constituents`.

All normalized artist relations are merged into, not substituted for, existing `custom_metadata` under this contract:

```ts
type NgaArtistRelationMetadata = {
  constituentId: string;
  displayOrder: number;
  roleType: 'artist';
  role: string;
  prefix: string | null;
  suffix: string | null;
  preferredDisplayName: string;
  forwardDisplayName: string;
  alternativeNames: string[];
};

type NgaArtistMetadata = {
  sourceCommit: string;
  relationships: NgaArtistRelationMetadata[];
};
```

Names are NFC-normalized, whitespace-collapsed, deduplicated without losing their official display form, and sorted deterministically after preferred names. Existing provider, asset, caption, and source metadata must remain byte-equivalent after canonical JSON serialization except for the approved NGA artist addition.

Only `primaryArtistId` is copied into image-vector filter metadata. No vector value, vector ID, dimension, model identity, or unrelated metadata may change. Caption-vector behavior must be explicit: an artist-constrained request skips the caption channel if that index cannot filter on `primaryArtistId`; it must not silently return an error or empty candidate set. The image index plus the final D1 check remain the two hard-filter enforcement layers for image search.

## Artist and attribution search contract

The shared NGA plan and public interpretation gain an optional typed attribution intent:

```ts
type NgaAttributionIntent = {
  relationship:
    | 'direct'
    | 'after'
    | 'attributed_to'
    | 'workshop_of'
    | 'studio_of'
    | 'circle_of'
    | 'school_of'
    | 'follower_of';
  targetText: string;
};
```

The plan gains an `attribution` mode rather than disguising the intent as semantic retrieval. The public contract, parser version, plan identity, spotlight asset, and result-cache namespace are bumped together. Canonical attribution data participates in cache identity; casing, punctuation, Unicode dashes, and whitespace variants that parse identically share the same identity.

### Parsing rules

- Work classification, date, and medium phrases continue to become hard constraints.
- `painting after Rembrandt` becomes a Painting constraint plus `{ relationship: 'after', targetText: 'Rembrandt' }`. It does not become `derived_from Photograph` or a generic semantic query.
- `drawings attributed to Rembrandt` becomes a Drawing constraint plus `attributed_to`.
- `paintings by Guercino` becomes a Painting constraint plus `direct`.
- The same intent is produced for supported academic and conversational paraphrases regardless of case, punctuation, apostrophe, hyphen, en dash, or em dash normalization.
- Relation markers inside a negated attribution phrase do not create a positive attribution intent.
- A target containing only control words, a classification, a medium, or a date is unresolved and does not force an artist lane.
- Bare names without a supported carrier/attribution construction retain existing artist-facet behavior. Ambiguous names are not silently resolved to a single constituent.

### Retrieval and proof

Attribution retrieval searches official catalogue artist/attribution text and normalized NGA artist metadata. A result must match the requested role family and every meaningful target token in an official name or official alternative name. Direct `by` queries match the primary official relationship; role-qualified queries may match any preserved official artist relationship with the corresponding role/prefix family.

Metadata-backed attribution matches are ordered before any optional semantic fallback. Image similarity and generated captions never satisfy or boost an attribution claim. If the official catalogue contains no matching relationship, the search returns no claimed attribution match and the interpretation reports that the target could not be verified. This rule prefers honest low recall over unrelated high recall.

Explicit `artistIds` remain hard primary-artist constraints and continue to be enforced in the vector filter, D1 candidate query, and final hydrated-result backstop. The API must never present a secondary contributor match as satisfying a primary-artist ID filter.

## Relation evidence policy

### Visible-subject relations

`depicts` and `features` ask what is visibly present in the returned work. Image embeddings, institution assistive text, generated visual captions, and catalogue metadata are relevant evidence, but weak single-channel similarity should not fill the result list.

A returned visible-relation result must satisfy the carrier work's hard constraints and at least one strong-evidence rule:

- institution-sourced title or description explicitly contains the normalized subject concept; or
- the result is independently retrieved by both the image and caption channels for the canonical relation query.

Institution-sourced explicit matches rank first, followed by cross-channel visual matches. Metadata, image, or generated-caption evidence may be displayed as the basis for the suggestion. Results that appear in only one visual channel without explicit catalogue support are excluded from the relational result set. Active and passive paraphrases that canonicalize to the same relation must produce the same ordered IDs.

### Historical-derivation relations

`derived_from` asks about how a work was made or what source work it used. Only institution-sourced catalogue fields may verify this claim. A qualifying field must contain both a supported derivation connector and the requested source classification after normalized token-boundary matching.

Image embeddings, generated captions, visual similarity, generic ownership provenance, and ingest lineage are excluded as proof. They may not satisfy, rank, or label a historical-derivation match. When no catalogue-verified results exist, the API returns an empty result set with the parsed relation intact and a machine-readable unverified evidence status. The web empty state says that no catalogue-verified matches were found; it does not suggest lowering a visual similarity threshold.

This phase does not promise useful derived-from recall. If the official NGA snapshot lacks explicit relation fields, improving recall requires a separately reviewed scholarly enrichment project.

## Backfill and staging mutation safety

The backfill planner is dry-run by default and creates a content-addressed manifest before any external write. The manifest records source commit/hashes, exact staged scope, selected primary mappings, all relation payload hashes, generated SQL hashes, vector metadata patch hashes, preflight counts, and the expected post-apply invariants.

Generated D1 updates are scoped by all of the following: exact staging organization ID, provider `nga`, ID prefix `open-access-art:nga:`, and exact artwork ID. The apply path rejects production bindings and a deployment identity that differs from the reviewed staging manifest.

Before the pilot, capture:

- a D1 Time Travel bookmark or equivalent recoverable pre-apply point;
- staged D1 row counts and the five complete pilot rows;
- image and caption Vectorize counts, metadata-index definitions, and the five original image vectors;
- exact API/web staging and production deployment identities;
- the current branch, commit, and clean-worktree status, excluding the pre-existing `.impeccable/` directory.

### Five-row pilot

The staging pilot contains exactly:

- `open-access-art:nga:131994` — primary `1364`, current positive image fixture;
- `open-access-art:nga:110821` — primary `23812`, secondary `2402` with `artist after`;
- `open-access-art:nga:11236` — primary `1974`, ordinary artist;
- `open-access-art:nga:38` — official `Attributed to` qualifier;
- `open-access-art:nga:579` — official `Workshop of` qualifier.

The pilot passes only when exactly five scoped D1 rows change, repeat application is idempotent, relation payloads match the source snapshot, image-vector value hashes are unchanged, direct `primaryArtistId` filters return the expected IDs, wrong-ID controls leak no rows, object `131994` is returned within the top three for artist ID `1364`, NGS remains forbidden, and production identities remain unchanged.

### Full backfill

After the pilot passes, apply the remaining 63,248 D1 updates and all existing staged NGA image-vector metadata patches in guarded manifest chunks. Final counts must be exactly 63,253 nonblank valid primary IDs, zero source mismatches, zero non-NGA mutations, unchanged vector counts, and unchanged vector value hashes. Titles, displayed artist strings, dates, media, rights, URLs, assets, and collection membership remain unchanged.

No cache purge is required. The result-cache namespace bump makes old entries unreachable while preserving rollback. Partial D1/vector state is treated as a failed rollout and restored using the captured pre-apply evidence.

## Evaluation and release gate

### Test-first local work

- Replace the fabricated NGA artist fixture with official-header rows.
- Test input-order independence, duplicate removal, non-artist exclusion, malformed identifiers/orders, missing relations, minimum-order ties, multi-artist preservation, qualifier preservation, aliases, and exact primary selection.
- Prove prepared D1 and vector artifacts preserve unrelated metadata and vector values.
- Test guarded SQL scope, dry-run default, manifest hashes, idempotency, incomplete coverage rejection, and staging-binding rejection.
- Test attribution parsing across direct and qualified roles, active user and academic phrasing, case/punctuation/dash variants, safe non-name controls, negation, ambiguity, and combined date/classification/medium constraints.
- Test that official role/name metadata can satisfy attribution, while image and generated-caption matches cannot.
- Test visible-relation strong-evidence filtering and active/passive ordered-result equivalence.
- Test that historical derivation requires institution-sourced explicit connector-plus-source evidence and otherwise returns the unverified empty state.
- Preserve every existing NGA, non-NGA, NGS, public proxy, cache, image, browser-state, and typecheck suite.

### Evaluator changes

The live grader currently counts every relevance grade above zero as relevant, allowing uniformly weak suggestions to pass. Add a strong-result metric whose relevant threshold is grade 2 or higher. Relation and attribution release cases require at least one strong result where a verified positive exists; derived-from cases may instead require a truthful verified-empty response when the source snapshot contains no known positive.

Add positive and negative artist-ID image controls, self-retrieval assertions, role-qualified attribution cases, ambiguous-name controls, visible-relation weak-tail controls, and historical-derivation evidence controls. Manual labels attach to exact artwork IDs and are stored with the evidence bundle.

### Full staging acceptance

- All parser and hard-constraint cases pass with zero violations.
- All image cases pass, including positive/wrong artist ID controls and unchanged image/date/classification/medium behavior.
- Visible-relation queries return at least one grade-2-or-3 result when the fixture declares a known positive, and do not return grade-0 weak-tail items within the evaluated top results.
- Attribution queries place official role/name matches before unrelated work and return no unsupported claimed matches.
- Derived-from queries return only catalogue-verified results or the explicit verified-empty state.
- Cache cold identity is a miss, the exact repeat is a hit or KV-fresh result, canonical paraphrases are stable, and the prior namespace is not reused.
- Anonymous browser checks show truthful interpretation and empty-state copy, preserve the repaired image editor/result layout, and record no successful anonymous NGS request.
- NGS remains HTTP 403 with `PUBLIC_SEARCH_SCOPE_FORBIDDEN`.
- Unchanged non-relation query result IDs/order and existing macro relevance metrics do not materially regress.
- `scripts/agent-evidence` and the complete artifact-manifest rehash pass at the exact deployed commit.
- Staging API and web report the reviewed commit; production deployment and data identities are byte-for-byte unchanged.

Any source mismatch, hard-constraint violation, unsupported attribution/derivation claim, vector-value change, cache collision, NGS exposure, unexpected non-NGA mutation, or production identity change is a stop condition.

## Deployment and rollback

The reviewed API is deployed to staging first. Data preparation and the five-row pilot then run against that exact API/data contract. After the pilot passes, the full staging metadata backfill runs, followed by the web staging deployment and the complete live/browser gate.

Rollback restores the captured staging D1 point, reapplies the five or full set of original vector records as appropriate, and redeploys the captured pre-change API/web staging versions. The namespace bump leaves prior cache data available without a destructive purge. Rollback itself must be explicitly authorized if required.

Production is not promoted by this design. The final report ends with a staging GO or NO-GO and a separate production recommendation.

## Success criteria

- The image artist case returns authoritative matches and every returned row satisfies the hard primary-artist ID.
- Artist and attribution language is handled by reusable grammar and official relationship data, not proper-name rewrites.
- Multi-artist records retain their complete official relation structure even though the v1 hard constraint remains primary-only.
- `painting showing a sculpture` presents supported visible-subject suggestions without a weak unrelated tail.
- `drawing based on photograph` never presents visual resemblance as verified historical derivation.
- All hard constraints, active/passive equivalence, cache behavior, browser behavior, and NGS isolation remain correct.
- The full reviewed change and data repair are deployed and validated on staging only.
- Production remains unchanged.
