"""Build exact-count v2 Vectorize artifacts for NGS staging.

This script materializes the final v2 image/caption vector sets from the app
SQLite DB. It can seed from existing eval vectors, embed only missing rows via
Jina, and write a complete NPZ that `eval/export_vectorize.py` can export.

Examples:
  python eval/build_v2_vectorize.py image \
    --app-db /tmp/paillette-v2-bakeoff.sqlite \
    --preprocess-manifest ~/Downloads/paillette-ngs-local-sam3-review/ngs-v2-image-preprocess-decisions.jsonl \
    --seed-vector eval/vectors/jina.npz \
    --out-name jina_v2_full \
    --expected-count 7711

  python eval/build_v2_vectorize.py caption \
    --app-db /tmp/paillette-v2-bakeoff.sqlite \
    --seed-vector eval/vectors/caption_v5_text_small.npz \
    --out-name caption_v5_text_small_v2_full \
    --expected-count 7752
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sqlite3
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from lib import VECTORS, l2_normalize


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
JINA_EMBEDDINGS_URL = "https://api.jina.ai/v1/embeddings"
DEFAULT_APP_DB = Path("/tmp/paillette-v2-bakeoff.sqlite")
DEFAULT_PREPROCESS_MANIFEST = (
    Path.home()
    / "Downloads"
    / "paillette-ngs-local-sam3-review"
    / "ngs-v2-image-preprocess-decisions.jsonl"
)
DEFAULT_DIMENSIONS = 1024


@dataclass(frozen=True)
class V2Row:
    id: str
    org_id: str
    image_url: str | None
    embedding_id: str | None
    caption: str | None


def parse_env_file(path: Path | None) -> None:
    if not path or not path.exists():
        return

    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if key in os.environ:
            continue
        os.environ[key] = value.strip().strip('"').strip("'")


def parse_json(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def generated_caption_text(custom_metadata: str | None) -> str | None:
    metadata = parse_json(custom_metadata) or {}
    generated_caption = metadata.get("generated_caption")
    if not isinstance(generated_caption, dict):
        return None
    text = str(generated_caption.get("text") or "").strip()
    return text or None


def load_app_rows(app_db: Path) -> list[V2Row]:
    con = sqlite3.connect(app_db)
    con.row_factory = sqlite3.Row
    rows = []
    for row in con.execute(
        """
        SELECT id, org_id, image_url, embedding_id, custom_metadata
        FROM artworks
        WHERE deleted_at IS NULL
        ORDER BY id
        """
    ):
        rows.append(
            V2Row(
                id=str(row["id"]),
                org_id=str(row["org_id"]),
                image_url=row["image_url"],
                embedding_id=row["embedding_id"],
                caption=generated_caption_text(row["custom_metadata"]),
            )
        )
    con.close()
    return rows


def is_imageable(row: V2Row) -> bool:
    return bool(
        row.image_url
        and str(row.image_url).strip()
        and row.embedding_id
        and str(row.embedding_id).strip()
    )


def load_preprocess_manifest(path: Path) -> dict[str, dict[str, Any]]:
    manifest: dict[str, dict[str, Any]] = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        artwork_id = row.get("artworkId")
        if not artwork_id:
            raise RuntimeError(f"manifest row missing artworkId: {row}")
        if row.get("decision") != "use_original":
            raise RuntimeError(
                f"unexpected preprocessing decision for {artwork_id}: "
                f"{row.get('decision')}"
            )
        manifest[str(artwork_id)] = row
    return manifest


def selected_image_path(manifest_row: dict[str, Any]) -> Path:
    selected = manifest_row.get("selectedImage")
    if not isinstance(selected, dict) or not selected.get("path"):
        raise RuntimeError(
            f"manifest row missing selectedImage.path for "
            f"{manifest_row.get('artworkId')}"
        )
    path = Path(str(selected["path"]))
    if not path.is_absolute():
        path = ROOT / path
    if not path.exists():
        raise RuntimeError(f"selected image path does not exist: {path}")
    return path


def load_npz_vectors(path: Path, dimensions: int) -> dict[str, np.ndarray]:
    data = np.load(path, allow_pickle=True)
    ids = [str(item) for item in data["ids"]]
    vecs = l2_normalize(data["vecs"]).astype(np.float32)
    if vecs.shape[1] != dimensions:
        raise RuntimeError(
            f"{path} has {vecs.shape[1]} dimensions, expected {dimensions}"
        )
    return {artwork_id: vecs[index] for index, artwork_id in enumerate(ids)}


def read_checkpoint(path: Path, dimensions: int) -> dict[str, np.ndarray]:
    if not path.exists():
        return {}

    vectors: dict[str, np.ndarray] = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        vector = np.asarray(row["values"], dtype=np.float32)
        if vector.shape != (dimensions,):
            raise RuntimeError(
                f"checkpoint vector {row.get('id')} has shape {vector.shape}, "
                f"expected {(dimensions,)}"
            )
        vectors[str(row["id"])] = vector
    return vectors


def append_checkpoint(path: Path, artwork_id: str, vector: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        handle.write(
            json.dumps(
                {"id": artwork_id, "values": vector.astype(float).tolist()},
                separators=(",", ":"),
            )
        )
        handle.write("\n")


def require_jina_api_key() -> str:
    key = os.environ.get("JINA_API_KEY")
    if not key:
        raise SystemExit("JINA_API_KEY is required")
    return key


def request_embeddings(
    api_key: str,
    model: str,
    inputs: list[Any],
    task: str | None,
    dimensions: int,
) -> list[list[float]]:
    body: dict[str, Any] = {
        "model": model,
        "input": inputs,
        "normalized": True,
        "embedding_type": "float",
        "truncate": True,
        "dimensions": dimensions,
    }
    if task:
        body["task"] = task

    data = json.dumps(body).encode("utf-8")
    retryable = {429, 500, 502, 503, 504}
    for attempt in range(6):
        request = urllib.request.Request(
            JINA_EMBEDDINGS_URL,
            data=data,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "Content-Type": "application/json",
                "User-Agent": "paillette-v2-vectorize/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if error.code not in retryable or attempt == 5:
                raise RuntimeError(f"Jina API error {error.code}: {detail}") from error

            retry_after = error.headers.get("Retry-After")
            wait_s = (
                int(retry_after)
                if retry_after and retry_after.isdigit()
                else (65 if error.code == 429 else min(2**attempt, 30))
            )
            print(f"  Jina API {error.code}; retrying in {wait_s}s", flush=True)
            time.sleep(wait_s)

    vectors = []
    for row in payload.get("data", []):
        embedding = row.get("embedding")
        if not isinstance(embedding, list) or len(embedding) != dimensions:
            raise RuntimeError(
                f"unexpected embedding payload for {model}: "
                f"{type(embedding).__name__}"
            )
        vectors.append(embedding)
    if len(vectors) != len(inputs):
        raise RuntimeError(f"expected {len(inputs)} embeddings, got {len(vectors)}")
    return vectors


def image_input(path: Path) -> dict[str, str]:
    return {"image": base64.b64encode(path.read_bytes()).decode("ascii")}


def save_npz(out_name: str, ids: list[str], vectors: list[np.ndarray]) -> Path:
    VECTORS.mkdir(exist_ok=True)
    path = VECTORS / f"{out_name}.npz"
    vecs = l2_normalize(np.asarray(vectors, dtype=np.float32))
    np.savez(path, ids=np.asarray(ids, dtype=object), vecs=vecs)
    return path


def default_seed_vector(channel: str) -> Path:
    return VECTORS / ("jina.npz" if channel == "image" else "caption_v5_text_small.npz")


def default_out_name(channel: str) -> str:
    return "jina_v2_full" if channel == "image" else "caption_v5_text_small_v2_full"


def default_model(channel: str) -> str:
    return "jina-clip-v2" if channel == "image" else "jina-embeddings-v5-text-small"


def default_task(channel: str) -> str | None:
    return None if channel == "image" else "retrieval.passage"


def build(args: argparse.Namespace) -> None:
    parse_env_file(args.env_file)
    api_key = require_jina_api_key()

    app_rows = load_app_rows(args.app_db)
    selected_rows = [
        row
        for row in app_rows
        if (is_imageable(row) if args.channel == "image" else bool(row.caption))
    ]

    manifest = None
    if args.channel == "image":
        manifest = load_preprocess_manifest(args.preprocess_manifest)
        missing_manifest = [row.id for row in selected_rows if row.id not in manifest]
        if missing_manifest:
            raise RuntimeError(
                f"preprocess manifest is missing {len(missing_manifest)} image rows; "
                f"first: {missing_manifest[:5]}"
            )
        if len(manifest) != len(selected_rows):
            raise RuntimeError(
                f"manifest rows ({len(manifest)}) do not match selected image rows "
                f"({len(selected_rows)})"
            )

    if args.expected_count is not None and len(selected_rows) != args.expected_count:
        raise RuntimeError(
            f"selected {len(selected_rows)} {args.channel} rows, "
            f"expected {args.expected_count}"
        )

    vectors: dict[str, np.ndarray] = {}
    seed_count = 0
    if args.seed_vector and args.seed_vector.exists():
        seed_vectors = load_npz_vectors(args.seed_vector, args.dimensions)
        for row in selected_rows:
            vector = seed_vectors.get(row.id)
            if vector is not None:
                vectors[row.id] = vector
                seed_count += 1

    checkpoint_count = 0
    checkpoint_vectors = read_checkpoint(args.checkpoint, args.dimensions)
    for row in selected_rows:
        vector = checkpoint_vectors.get(row.id)
        if vector is not None:
            vectors[row.id] = vector
            checkpoint_count += 1

    pending = [row for row in selected_rows if row.id not in vectors]
    print(
        f"{args.channel}: selected={len(selected_rows)} seed={seed_count} "
        f"checkpoint={checkpoint_count} pending={len(pending)}",
        flush=True,
    )

    started = time.time()
    for index in range(0, len(pending), args.batch_size):
        batch = pending[index : index + args.batch_size]
        if args.channel == "image":
            assert manifest is not None
            inputs = [image_input(selected_image_path(manifest[row.id])) for row in batch]
        else:
            inputs = [row.caption for row in batch]

        raw_vectors = request_embeddings(
            api_key,
            args.model,
            inputs,
            args.task,
            args.dimensions,
        )
        normalized = l2_normalize(np.asarray(raw_vectors, dtype=np.float32))
        for row, vector in zip(batch, normalized):
            vectors[row.id] = vector
            append_checkpoint(args.checkpoint, row.id, vector)

        print(
            f"  {args.model} {min(index + args.batch_size, len(pending))}/"
            f"{len(pending)} missing",
            flush=True,
        )
        if args.sleep:
            time.sleep(args.sleep)

    ordered_ids = [row.id for row in selected_rows]
    missing = [artwork_id for artwork_id in ordered_ids if artwork_id not in vectors]
    if missing:
        raise RuntimeError(f"missing {len(missing)} vectors after build: {missing[:5]}")

    out_path = save_npz(args.out_name, ordered_ids, [vectors[artwork_id] for artwork_id in ordered_ids])
    print(
        f"-> {out_path} ({len(ordered_ids)} vectors, {args.dimensions}d, "
        f"{time.time() - started:.0f}s)",
        flush=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("channel", choices=["image", "caption"])
    parser.add_argument("--app-db", type=Path, default=DEFAULT_APP_DB)
    parser.add_argument(
        "--preprocess-manifest",
        type=Path,
        default=DEFAULT_PREPROCESS_MANIFEST,
    )
    parser.add_argument("--env-file", type=Path, default=HERE / ".env")
    parser.add_argument("--model")
    parser.add_argument("--task")
    parser.add_argument("--dimensions", type=int, default=DEFAULT_DIMENSIONS)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--sleep", type=float, default=0)
    parser.add_argument("--seed-vector", type=Path)
    parser.add_argument("--out-name")
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--expected-count", type=int)
    args = parser.parse_args()

    args.model = args.model or default_model(args.channel)
    if args.task is None:
        args.task = default_task(args.channel)
    args.batch_size = args.batch_size or (4 if args.channel == "image" else 64)
    args.seed_vector = args.seed_vector or default_seed_vector(args.channel)
    args.out_name = args.out_name or default_out_name(args.channel)
    args.checkpoint = args.checkpoint or VECTORS / f"{args.out_name}.checkpoint.jsonl"

    build(args)


if __name__ == "__main__":
    main()
