# Embedding eval — findings (round 2)

## What was tested
Three retrieval approaches over the **8,023-image NGS corpus**, across **56 queries / 8 intent types**:
- **jina** — jina-clip-v2 image embeddings (1024-d); query via its text tower
- **openclip** — OpenCLIP ViT-H-14 image embeddings (1024-d)
- **caption→embed** — each artwork captioned by a local VLM (Qwen3-VL-30B-A3B, grounded on real NGS metadata), captions embedded with bge-large; query embedded the same way

## Method
retrieval → per-query montages (`montages/`) → **two independent judges rated all 56 queries** 0–3 holistically per approach: **Claude** (`judgements/claude.json`) and **Codex** (`judgements/codex.json`). The judges **agree 85% exactly / 100% within 1 point** — the finding is reliable, not a single-judge artifact. Live dual-judge matrix: open `review.html`.

## Result — the approaches are complementary
Per-intent, avg 0–3 (Claude, all 56 — Codex tracks it within 1 pt):

| intent   | jina | openclip | caption→embed |
|----------|------|----------|---------------|
| keyword  | 2.7  | 2.7      | 2.7           |
| occasion | 1.9  | 2.0      | 2.1           |
| motif    | **2.9** | **2.9** | 2.0        |
| mood     | 3.0  | 2.4      | 3.0           |
| style    | 2.9  | 2.4      | 2.3           |
| medium   | **3.0** | **3.0** | 2.0        |
| metadata | 1.1  | 1.1      | **2.6**       |
| color    | **3.0** | 2.7   | 1.9           |
| **overall** | **2.55** | 2.41 | 2.32     |

**The pattern is clear and consistent across all 56:**
- **Image-CLIP wins the *visual* intents** — motif, medium, colour, visually-distinct style. A pattern / texture / colour / medium has a direct visual signature the image embedding captures; caption text ("dominant colour: red") is fuzzier.
- **caption→embed wins the *factual* intents** — metadata (artist, title, date). The caption is grounded on NGS metadata, so "Cheong Soo Pieng" / "1950s" / a title is literally *in the caption text* → a text query matches it. Image-CLIP has no idea who an artist is. (Exception: `metadata` queries that *also* have a visual signature, e.g. "sculptures", image-CLIP gets too.)
- **keyword & mood — a wash**, all three comparable.
- **Hard floor:** *exact accession numbers* — all three ~0. The number is in no embedding's reach. Needs an exact metadata lookup, not embeddings.

## Recommendation: hybrid
image-CLIP and caption→embed **win different intents — they're complementary**. The production answer is to **fuse them** — image vector for visual queries, caption vector for factual/semantic ones — via reciprocal-rank fusion, **plus a structured-metadata exact-match channel** for artist / accession / title / date.
- Image side: **jina-clip-v2** — 1024-d (matches the existing Vectorize index), multilingual (SEA art), best overall (2.55).
- caption→embed is also the more **interpretable** approach — captions are human-readable, so retrieval is debuggable.

## Caveats (honest)
- All 56 queries, dual-judged — but **holistic montage-level ratings**, not formal nDCG/rank-discounted scoring. The harness supports going deeper.
- **Hybrid not separately benchmarked** — recommended on the complementarity evidence, not measured. The structured-metadata channel likewise. A hybrid row is the obvious next eval.
- The auto desc→image metric (caption R@10 0.87 vs image-CLIP ~0.28) **overstates caption** — for caption it's text-to-text matching, structurally easier. The montage review is the real comparison.
- 8k NGS corpus only — cross-institution generalisation untested. Held-out test queries are marked in `query_split.json`.
