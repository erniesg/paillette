# V2 Embedding Bakeoff

Generated: 2026-05-26T17:38:19.342895+00:00

## Corpus Gate

- v2 ETL corpus: 7979 artworks
- imageable v2 rows: 7711
- captioned v2 rows: 7752
- NGS-validated rows: 7884
- rows needing NGS source validation: 95
- web-image enrichment rows: 5
- reviewer-approved legacy-image rows: 30
- active exclude_from_v2 rows: 7 (2011-02233, GI-0389, GI-0578, GI-0685, GI-0738, GI-0739, GI-0791)

Existing vector coverage over v2:

| vector set | total | in v2 | missing v2 |
| --- | ---: | ---: | ---: |
| jina | 8023 | 7567 | 412 |
| caption | 8023 | 7567 | 412 |
| caption_v5_text_small | 8023 | 7567 | 412 |
| v5_omni_small | 8023 | 7567 | 412 |

## Candidate Metrics

| candidate | avg results/query | source-backed top10 | no-title top10 | metadata exact @1/@5/@10 | medium exact @10 | text-overlap top10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| v1_jina_image_legacy_corpus | 20.0 | 96.61% | 0.71% | 14.29% / 28.57% / 42.86% | 100.00% | 32.05% |
| v1_caption_legacy_corpus | 20.0 | 88.39% | 6.07% | 42.86% / 71.43% / 85.71% | 100.00% | 38.83% |
| v1_current_ngs_metadata_only | 19.64 | 100.00% | 0.00% | 100.00% / 100.00% / 100.00% | 100.00% | 46.14% |
| v2_metadata_only_text_enriched | 19.66 | 100.00% | 0.00% | 100.00% / 100.00% / 100.00% | 100.00% | 53.24% |
| v2_jina_image_filtered | 19.12 | 100.00% | 0.00% | 14.29% / 28.57% / 42.86% | 100.00% | 33.03% |
| v2_caption_filtered | 17.88 | 100.00% | 0.00% | 42.86% / 71.43% / 85.71% | 100.00% | 44.00% |
| v2_hybrid_rrf_jina_caption_metadata | 20.0 | 100.00% | 0.00% | 85.71% / 100.00% / 100.00% | 100.00% | 47.40% |
| v2_routed_rrf_jina_caption_metadata | 19.66 | 100.00% | 0.00% | 85.71% / 100.00% / 100.00% | 100.00% | 49.84% |

## Codex Ratings

Scale: 0-3 staging readiness rating from Codex, separate from the metric score and not a fresh human relevance judgement.

| candidate | rating | approval | rationale |
| --- | ---: | --- | --- |
| v1_jina_image_legacy_corpus | 1.6/3 | baseline only | Strong visual channel from the previous eval, but it is tied to the legacy corpus and still leaks stale/no-title rows. |
| v1_caption_legacy_corpus | 1.7/3 | baseline only | Better factual retrieval than image-only, but still inherits legacy-corpus leakage and is not the v2 path. |
| v1_current_ngs_metadata_only | 2.0/3 | safe rollback | Good deterministic exact-search behavior and clean corpus safety, but it is not an embedding candidate and misses visual discovery. |
| v2_metadata_only_text_enriched | 2.1/3 | safe fallback | Best exact/text baseline on the v2 corpus, useful as a fallback, but not sufficient for multimodal search. |
| v2_jina_image_filtered | 2.2/3 | staging candidate | Best single visual embedding channel after v2 corpus filtering, but exact artist/title/accession queries remain weak. |
| v2_caption_filtered | 2.0/3 | staging candidate | Useful factual/semantic channel, but weaker visual behavior and fewer returned hits after v2 filtering. |
| v2_hybrid_rrf_jina_caption_metadata | 2.4/3 | staging winner | Best v2 direction because it combines visual, caption, and deterministic metadata channels; not traffic-approved until missing embeddings and real v2 index hits are measured. |
| v2_routed_rrf_jina_caption_metadata | 2.6/3 | preferred conservative route | Use fixed hybrid RRF as the default, with narrow overrides for exact metadata, colour, medium/date, and formal-visual queries so broad semantic/occasion/mood prompts keep caption recall. |

## Dual-Judge Projection

These are carried forward from the existing Claude+Codex judged montage eval, not newly judged v2 results.

- jina image channel average: 2.509 / 3
- caption channel average: 2.232 / 3
- best-of image/caption upper bound: 2.741 / 3

## Recommendation

Winner for user approval: `v2_routed_rrf_jina_caption_metadata`.

The staging recommendation is a conservative routed RRF: fixed hybrid RRF remains the default for broad semantic, occasion, mood, and motif queries; narrow route overrides apply only to high-confidence accession, artist, title, colour, medium/date, and formal-visual queries. That keeps caption recall where it helps while preventing exact and colour intent from being diluted by the wrong channel.

Decision rule: candidates must be v2, source-backed, free of no-title rows in the top 10, and include at least one embedding channel. The score then combines carried-forward dual-judge channel quality (60%), exact metadata/medium checks (30%), text-overlap diagnostics (10%), and a small route-awareness bonus for avoiding known cross-channel pollution. Metadata-only is retained as a baseline, not selected as the embedding/index winner.

Approval status: not ready for routing cutover until the missing v2 embeddings are generated and the routed candidate is judged or smoke-tested against production-fusion behavior.

Use v2 as an additive staging path only: keep `VECTORIZE` and `CAPTION_VECTORIZE` as v1, load v2 into `VECTORIZE_V2` and `CAPTION_VECTORIZE_V2`, then set `EMBEDDING_INDEX_VERSION=v2` and `SEARCH_FUSION_MODE=hybrid` for the API process being tested. Rollback for ranking is `SEARCH_FUSION_MODE=legacy`; rollback for indexes is `EMBEDDING_INDEX_VERSION=v1`.

## Notes

- This bakeoff uses existing query result files for the image/caption channels, filtered to the v2 ETL corpus. The missing v2 rows need a final embedding pass before staging cutover.
- NGS validation requires both in-catalog metadata and a National Gallery Singapore source URL. Rows without that proof are listed in `ngs_validation.invalid` in the JSON artifact.
- Metadata-only rows remain searchable through the structured metadata channel even when no image vector exists.
- The report is scoped to staging because the v2 Vectorize bindings are only defined for `[env.staging]`.
- Independent Claude Code review is recorded in `eval/v2-bakeoff-claude-review.md`.
- Codex review and ratings are recorded in `eval/v2-bakeoff-codex-review.md`.
- The script writes no Vectorize data and does not alter D1/R2.
