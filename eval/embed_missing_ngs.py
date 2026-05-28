#!/usr/bin/env python3
"""Create local Jina CLIP image vectors for NGS missing-image backfill rows."""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageFile
from transformers import AutoModel


DEFAULT_ORG_ID = "cf98791d-f3cc-4f9f-b40c-a350efadbd05"
MODEL = "jinaai/jina-clip-v2"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

ImageFile.LOAD_TRUNCATED_IMAGES = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--plan",
        default="tmp/ngs-missing-images-backfill/backfill-plan.json",
        type=Path,
    )
    parser.add_argument(
        "--out",
        default="tmp/ngs-missing-images-backfill/image-vectors.ndjson",
        type=Path,
    )
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--image-role", choices=["thumb", "original"], default="thumb")
    parser.add_argument("--org-id", default=DEFAULT_ORG_ID)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def load_rows(plan_path: Path, image_role: str) -> list[dict]:
    payload = json.loads(plan_path.read_text())
    rows = payload["rows"] if isinstance(payload, dict) else payload
    path_key = "preparedThumbnailPath" if image_role == "thumb" else "preparedImagePath"
    loaded = []
    for row in rows:
        image_path = row.get(path_key) or row.get("preparedImagePath")
        if not image_path or not Path(image_path).exists():
            continue
        loaded.append({**row, "_embedding_image_path": image_path})
    return loaded


def l2_normalize(values: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(values, axis=-1, keepdims=True)
    return values / np.clip(norm, 1e-8, None)


def year_from_date_text(value: str | None) -> int:
    if not value:
        return 0
    import re

    match = re.search(r"\b(1[5-9]\d{2}|20\d{2})\b", str(value))
    return int(match.group(1)) if match else 0


def vector_line(row: dict, vector: np.ndarray, org_id: str) -> str:
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )
    return json.dumps(
        {
            "id": row["id"],
            "values": vector.astype(float).tolist(),
            "metadata": {
                "orgId": org_id,
                "galleryId": org_id,
                "artworkId": row["id"],
                "channel": "image",
                "sourceKind": "image_embedding",
                "sourceField": "image_url",
                "model": "jina-clip-v2",
                "embeddingVersion": "v2",
                "title": row.get("title") or "",
                "artist": row.get("artist") or "",
                "medium": row.get("medium") or "",
                "classification": "",
                "year": year_from_date_text(row.get("dateText")),
                "dateText": row.get("dateText") or "",
                "accessionNumber": row["id"],
                "sourceInstitution": "National Gallery Singapore",
                "sourceCollection": "National Collection",
                "sourceUrl": row.get("ngsPageUrl") or "",
                "createdAt": created_at,
            },
        },
        separators=(",", ":"),
    )


def main() -> None:
    args = parse_args()
    rows = load_rows(args.plan, args.image_role)
    if args.limit:
        rows = rows[: args.limit]
    args.out.parent.mkdir(parents=True, exist_ok=True)

    print(f"loading {MODEL} on {DEVICE}", flush=True)
    model = AutoModel.from_pretrained(MODEL, trust_remote_code=True)
    model.to(DEVICE).eval()

    lines = []
    started = time.time()
    with torch.no_grad():
        for index in range(0, len(rows), args.batch_size):
            batch = rows[index : index + args.batch_size]
            images = [
                Image.open(row["_embedding_image_path"]).convert("RGB")
                for row in batch
            ]
            vectors = np.asarray(model.encode_image(images), dtype=np.float32)
            vectors = l2_normalize(vectors)
            for row, vector in zip(batch, vectors):
                lines.append(vector_line(row, vector, args.org_id))
            print(
                f"embedded {min(index + args.batch_size, len(rows))}/{len(rows)}",
                flush=True,
            )

    args.out.write_text("\n".join(lines) + "\n")
    print(f"DONE -> {args.out} ({len(rows)} vectors, {time.time() - started:.1f}s)")


if __name__ == "__main__":
    main()
