# V2 Omni Comparison

Generated: 2026-05-27T08:45:38.891582+00:00

## Scope

This compares the v2 decided routed RRF approach against Jina v5 omni variants using the same v2 corpus filter as `eval/v2_bakeoff.py`.
It uses existing local result files, not fresh Vectorize hits, so it is an offline staging diagnostic.

## Vector Coverage

| vector set | total | in v2 | missing v2 |
| --- | ---: | ---: | ---: |
| jina | 8023 | 7567 | 412 |
| caption | 8023 | 7567 | 412 |
| caption_v5_text_small | 8023 | 7567 | 412 |
| v5_omni_small | 8023 | 7567 | 412 |

## Candidates

- `decided_bge_routed`: Jina CLIP v2 image + original BGE caption channel + metadata.
- `decided_jina_text_routed`: Jina CLIP v2 image + Jina v5 text-small caption channel + metadata.
- `omni_image_only`: Jina v5 omni-small image vectors only, no metadata/caption.
- `omni_image_metadata`: Jina v5 omni-small image vectors + metadata routing.
- `omni_family_routed`: Jina v5 omni-small image vectors + Jina v5 text-small caption vectors + metadata.

## Metrics

| candidate | avg results/query | source-backed top10 | no-title top10 | metadata exact @1/@5/@10 | medium exact @10 | text-overlap top10 | channel counts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| decided_bge_routed | 19.66 | 100.00% | 0.00% | 85.71% / 100.00% / 100.00% | 100.00% | 49.84% | `{"caption": 263, "jina_image": 231, "metadata": 331}` |
| decided_jina_text_routed | 19.66 | 100.00% | 0.00% | 85.71% / 100.00% / 100.00% | 100.00% | 49.90% | `{"caption": 292, "jina_image": 236, "metadata": 339}` |
| omni_image_only | 18.7 | 100.00% | 0.00% | 28.57% / 42.86% / 57.14% | 85.71% | 30.98% | `{}` |
| omni_image_metadata | 20.0 | 100.00% | 0.00% | 71.43% / 100.00% / 100.00% | 100.00% | 43.54% | `{"metadata": 307, "omni_image": 310}` |
| omni_family_routed | 19.66 | 100.00% | 0.00% | 100.00% / 100.00% / 100.00% | 100.00% | 49.60% | `{"caption": 304, "metadata": 337, "omni_image": 240}` |

## Readout

`omni_family_routed` is the clean Jina-v5-family alternative, but this offline diagnostic should not replace judged relevance. Compare exact metadata @10 100.00% vs 100.00%, medium @10 100.00% vs 100.00%, and text overlap 49.60% vs 49.90%. A final call still needs a small judged montage or live Vectorize smoke test because these metrics do not measure visual relevance directly.

## Notes

- `v5_omni_small` here means `jina-embeddings-v5-omni-small` image vectors queried by text with the same model.
- `caption_v5_text_small` is used for the Jina caption channel because Jina documents the v5 omni space as aligned with v5 text-small; it is the cheaper text-only path for text inputs.
- Each result list is capped at top 20.
