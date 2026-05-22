"""Shared helpers for the Paillette embedding eval."""
import json
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "corpus.jsonl"
IMAGES = HERE / "images"
VECTORS = HERE / "vectors"
RESULTS = HERE / "results"
QUERIES = HERE / "queries.yaml"


def load_corpus():
    """Artwork dicts that have a fetched image, in stable id order."""
    rows = []
    for line in CORPUS.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        img = IMAGES / f"{r['id']}.webp"
        if img.exists() and img.stat().st_size > 0:
            r["_image"] = str(img)
            rows.append(r)
    return rows


def load_queries():
    import yaml
    return yaml.safe_load(QUERIES.read_text())["queries"]


def l2_normalize(x):
    x = np.asarray(x, dtype=np.float32)
    n = np.linalg.norm(x, axis=-1, keepdims=True)
    return x / np.clip(n, 1e-8, None)


def save_vectors(approach, ids, vecs):
    VECTORS.mkdir(exist_ok=True)
    np.savez(VECTORS / f"{approach}.npz",
             ids=np.array(ids, dtype=object), vecs=l2_normalize(vecs))


def load_vectors(approach):
    d = np.load(VECTORS / f"{approach}.npz", allow_pickle=True)
    return [str(x) for x in d["ids"]], l2_normalize(d["vecs"])
