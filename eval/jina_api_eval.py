"""Embed/evaluate NGS search candidates through Jina's hosted embedding API.

Examples:
  JINA_API_KEY=... python jina_api_eval.py embed-images v5_omni_small jina-embeddings-v5-omni-small --limit 200
  JINA_API_KEY=... python jina_api_eval.py embed-captions caption_v5_text_small jina-embeddings-v5-text-small
  JINA_API_KEY=... python jina_api_eval.py run v5_omni_small jina-embeddings-v5-omni-small
"""
import argparse
import base64
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

from lib import HERE, RESULTS, load_corpus, load_queries, load_vectors, l2_normalize, save_vectors


API_URL = "https://api.jina.ai/v1/embeddings"
DEFAULT_DIMS = {
    "jina-clip-v2": 1024,
    "jina-embeddings-v3": 1024,
    "jina-embeddings-v4": 2048,
    "jina-embeddings-v5-omni-small": 1024,
    "jina-embeddings-v5-text-small": 1024,
    "jina-embeddings-v5-omni-nano": 768,
    "jina-embeddings-v5-text-nano": 768,
}


def require_key():
    key = os.environ.get("JINA_API_KEY")
    if not key:
        raise SystemExit("JINA_API_KEY is required")
    return key


def request_embeddings(api_key, model, inputs, task, dimensions):
    body = {
        "model": model,
        "input": inputs,
        "normalized": True,
        "embedding_type": "float",
        "truncate": True,
    }
    if task:
        body["task"] = task
    if dimensions:
        body["dimensions"] = dimensions

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "paillette-eval/1.0",
        },
        method="POST",
    )
    retryable = {429, 500, 502, 503, 504}
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")
            if err.code not in retryable or attempt == 5:
                raise RuntimeError(f"Jina API error {err.code}: {detail}") from err

            retry_after = err.headers.get("Retry-After")
            wait_s = int(retry_after) if retry_after and retry_after.isdigit() else 65
            if err.code != 429:
                wait_s = min(2 ** attempt, 30)
            print(f"  Jina API {err.code}; retrying in {wait_s}s", flush=True)
            time.sleep(wait_s)

    vectors = []
    for row in payload.get("data", []):
        emb = row.get("embedding")
        if not isinstance(emb, list):
            raise RuntimeError(f"unexpected embedding payload for model {model}")
        vectors.append(emb)
    if len(vectors) != len(inputs):
        raise RuntimeError(f"expected {len(inputs)} embeddings, got {len(vectors)}")
    return vectors


def batched_embeddings(api_key, model, inputs, task, dimensions, batch_size, sleep_s=0):
    out = []
    started = time.time()
    for i in range(0, len(inputs), batch_size):
        batch = inputs[i:i + batch_size]
        out.extend(request_embeddings(api_key, model, batch, task, dimensions))
        print(f"  {model} {min(i + batch_size, len(inputs))}/{len(inputs)}", flush=True)
        if sleep_s:
            time.sleep(sleep_s)
    vecs = l2_normalize(np.asarray(out, dtype=np.float32))
    print(f"  embedded {len(inputs)} inputs in {time.time() - started:.0f}s", flush=True)
    return vecs


def image_input(path):
    return {"image": base64.b64encode(Path(path).read_bytes()).decode("ascii")}


def load_caption_rows():
    corpus_ids = {row["id"] for row in load_corpus()}
    rows = []
    path = HERE / "captions.jsonl"
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("id") in corpus_ids and row.get("caption"):
            rows.append(row)
    return rows


def embed_images(args):
    api_key = require_key()
    corpus = load_corpus()
    if args.limit:
        corpus = corpus[:args.limit]
    inputs = [image_input(row["_image"]) for row in corpus]
    dims = args.dimensions or DEFAULT_DIMS.get(args.model, 1024)
    vecs = batched_embeddings(
        api_key,
        args.model,
        inputs,
        args.task,
        dims,
        args.batch_size,
        args.sleep,
    )
    save_vectors(args.name, [row["id"] for row in corpus], vecs)
    print(f"-> eval/vectors/{args.name}.npz {vecs.shape}")


def embed_captions(args):
    api_key = require_key()
    rows = load_caption_rows()
    if args.limit:
        rows = rows[:args.limit]
    dims = args.dimensions or DEFAULT_DIMS.get(args.model, 1024)
    vecs = batched_embeddings(
        api_key,
        args.model,
        [row["caption"] for row in rows],
        args.task,
        dims,
        args.batch_size,
        args.sleep,
    )
    save_vectors(args.name, [row["id"] for row in rows], vecs)
    print(f"-> eval/vectors/{args.name}.npz {vecs.shape}")


def run_eval(args):
    api_key = require_key()
    corpus = load_corpus()
    by_id = {row["id"]: row for row in corpus}
    ids, vecs = load_vectors(args.name)
    idx = {aid: i for i, aid in enumerate(ids)}
    dims = args.dimensions or vecs.shape[1]

    described = [row for row in corpus if row.get("description") and row["id"] in idx]
    recall = {1: 0, 5: 0, 10: 0}
    rr = 0.0
    if described:
        desc_vecs = batched_embeddings(
            api_key,
            args.model,
            [row["description"] for row in described],
            "retrieval.query",
            dims,
            args.batch_size,
            args.sleep,
        )
        sims = desc_vecs @ vecs.T
        for i, row in enumerate(described):
            order = np.argsort(-sims[i])
            rank = int(np.where(order == idx[row["id"]])[0][0]) + 1
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

    queries = load_queries()
    qvecs = batched_embeddings(
        api_key,
        args.model,
        [q["text"] for q in queries],
        "retrieval.query",
        dims,
        args.batch_size,
        args.sleep,
    )
    qsims = qvecs @ vecs.T
    query_results = []
    for i, query in enumerate(queries):
        order = np.argsort(-qsims[i])[:20]
        hits = []
        for j in order:
            artwork = by_id.get(ids[j], {})
            hits.append({
                "id": ids[j],
                "score": round(float(qsims[i][j]), 4),
                "title": artwork.get("title"),
                "artist": artwork.get("artist"),
                "date_text": artwork.get("date_text"),
            })
        query_results.append({**query, "results": hits})

    RESULTS.mkdir(exist_ok=True)
    out = {"approach": args.name, "model": args.model, "metrics": metrics, "queries": query_results}
    (RESULTS / f"{args.name}.json").write_text(json.dumps(out, indent=2))
    print(f"[{args.name}] desc->corpus R@1={metrics['recall@1']:.3f} "
          f"R@5={metrics['recall@5']:.3f} R@10={metrics['recall@10']:.3f} "
          f"MRR={metrics['mrr']:.3f}")
    print(f"-> eval/results/{args.name}.json")


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    def add_common(p, default_batch):
        p.add_argument("name", help="vector/result name, e.g. v5_omni_small")
        p.add_argument("model", help="Jina model id")
        p.add_argument("--dimensions", type=int)
        p.add_argument("--batch-size", type=int, default=default_batch)
        p.add_argument("--limit", type=int)
        p.add_argument("--sleep", type=float, default=0)

    p = sub.add_parser("embed-images")
    add_common(p, 4)
    p.add_argument("--task", default="retrieval.passage")
    p.set_defaults(func=embed_images)

    p = sub.add_parser("embed-captions")
    add_common(p, 64)
    p.add_argument("--task", default="retrieval.passage")
    p.set_defaults(func=embed_captions)

    p = sub.add_parser("run")
    add_common(p, 64)
    p.set_defaults(func=run_eval)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
