"""Retrieval + automatic metrics for one embedding approach.

Usage: python run_eval.py <approach>

Produces two things:
  1. description -> image self-retrieval (FULLY AUTOMATIC, no judging) — for the
     ~1,130 artworks with a real curatorial description, does its description
     retrieve its own image? Recall@k / MRR.
     Caveat: rewards long-context text encoders (jina handles the full ~930-char
     description; siglip/openclip truncate hard). The query eval below is the
     fair, apples-to-apples comparison.
  2. top-20 results for each of the 24 queries in queries.yaml — handed to the
     AI judge panel next.
"""
import sys
import json
import numpy as np

from lib import load_corpus, load_queries, load_vectors, l2_normalize, RESULTS
from embed import get_embedder


def main():
    approach = sys.argv[1] if len(sys.argv) > 1 else "jina"
    corpus = load_corpus()
    by_id = {r["id"]: r for r in corpus}
    ids, vecs = load_vectors(approach)
    idx = {aid: i for i, aid in enumerate(ids)}

    emb = get_embedder(approach)  # text tower, for query-side embedding

    # --- Metric: description -> image self-retrieval -----------------------
    described = [r for r in corpus if r.get("description") and r["id"] in idx]
    dvecs = l2_normalize(emb.embed_texts([r["description"] for r in described]))
    sims = dvecs @ vecs.T
    recall = {1: 0, 5: 0, 10: 0}
    rr = 0.0
    for i, r in enumerate(described):
        order = np.argsort(-sims[i])
        rank = int(np.where(order == idx[r["id"]])[0][0]) + 1
        rr += 1.0 / rank
        for k in recall:
            recall[k] += int(rank <= k)
    n = max(len(described), 1)
    metrics = {
        "described_n": len(described),
        "recall@1": recall[1] / n,
        "recall@5": recall[5] / n,
        "recall@10": recall[10] / n,
        "mrr": rr / n,
    }
    print(f"[{approach}] desc->image over {len(described)}: "
          f"R@1={metrics['recall@1']:.3f} R@5={metrics['recall@5']:.3f} "
          f"R@10={metrics['recall@10']:.3f} MRR={metrics['mrr']:.3f}")

    # --- Query retrieval: top-20 per query ---------------------------------
    queries = load_queries()
    qvecs = l2_normalize(emb.embed_texts([q["text"] for q in queries]))
    qsims = qvecs @ vecs.T
    query_results = []
    for i, q in enumerate(queries):
        order = np.argsort(-qsims[i])[:20]
        hits = [{
            "id": ids[j],
            "score": round(float(qsims[i][j]), 4),
            "title": by_id[ids[j]]["title"],
            "artist": by_id[ids[j]]["artist"],
            "date_text": by_id[ids[j]]["date_text"],
        } for j in order]
        query_results.append({**q, "results": hits})

    RESULTS.mkdir(exist_ok=True)
    out = {"approach": approach, "metrics": metrics, "queries": query_results}
    (RESULTS / f"{approach}.json").write_text(json.dumps(out, indent=2))
    print(f"[{approach}] -> eval/results/{approach}.json")


if __name__ == "__main__":
    main()
