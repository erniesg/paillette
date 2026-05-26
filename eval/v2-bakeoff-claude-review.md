## Verdict

The revised bakeoff is honest staging-only analysis, not a cutover gate. It correctly disclaims that it filters v1 vector results onto the v2 corpus rather than measuring real v2 index behavior, and the production code wires v1/v2 routing behind explicit env flags with safe NGS defaults. The methodology is sound for "should v2 staging proceed?" but the winner declaration overstates what was actually measured.

## Remaining blockers

- 412 v2 rows still need embeddings across both image and caption channels. Until those are generated and upserted to `paillette-embeddings-v2-stg` / `paillette-caption-embeddings-v2-stg`, there is no complete v2 index to route to. `export_vectorize.py` only exports existing vectors; this changeset does not create the missing ones.
- No actual v2-index hits were measured. The v2 candidates in `eval/v2_bakeoff.py` are v1 result files passed through the v2 corpus filter. The report recommendation rests on a smoke test that still has to happen.
- Production `wrangler.toml` has no v2 bindings. Only `[env.staging]` defines `VECTORIZE_V2` / `CAPTION_VECTORIZE_V2`; production cutover needs a separate config change beyond env vars.

## Non-blocking Concerns

- The judged-quality term overstates hybrid because it uses a per-query best-of image/caption upper-bound, not measured RRF output.
- Hybrid regresses exact metadata @1 from metadata-only, so any switch to `SEARCH_FUSION_MODE=hybrid` should be paired with a judged exact-query set.
- Bakeoff fusion is close to production fusion but not identical for temporal queries, where production gives metadata a stronger boost.
- Caption vectors must be generated with the same model as the production query-side caption embedder or search will silently degrade.
- `export_vectorize.py` currently hard-codes `createdAt` metadata for exported vectors.

## Recommendation

Do not treat the report as approval to switch traffic. Generate missing v2 embeddings, upsert them into staging v2 indices, smoke-test the staging API with `EMBEDDING_INDEX_VERSION=v2` and `SEARCH_FUSION_MODE=hybrid`, then re-run the bakeoff using actual v2 index hits and re-judge the hybrid candidate before deciding whether NGS should move from `legacy` to `hybrid`.
