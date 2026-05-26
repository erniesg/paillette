# Codex V2 Bakeoff Ratings

Scale: 0-3 staging readiness rating. These ratings combine the existing judged channel quality, v2 corpus safety, exact-query coverage, and operational readiness. They are not a replacement for fresh judged v2-index results.

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

## Codex Recommendation

My pick for the v2 staging winner is `v2_routed_rrf_jina_caption_metadata` at 2.6/3.

I would not approve traffic cutover from this artifact alone. The next gate is generating the 412 missing v2 embeddings, upserting both staging v2 indices, measuring actual routed RRF output, and re-judging the routed candidate against metadata-only and image-only baselines.
