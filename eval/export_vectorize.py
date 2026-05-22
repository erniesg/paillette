"""Export eval vectors as Cloudflare Vectorize NDJSON.

Example:
  python eval/export_vectorize.py jina --channel image --model jina-clip-v2
  pnpm --dir apps/api exec wrangler vectorize upsert paillette-embeddings-stg \
    --file /tmp/paillette-vectorize-jina.ndjson --batch-size 500
"""
import argparse
import json
from pathlib import Path

from lib import load_corpus, load_vectors


DEFAULT_NGS_ORG_ID = "00000000-0000-4000-8000-000000000101"


def year_from_date_text(value):
    if not value:
        return None
    digits = "".join(ch if ch.isdigit() else " " for ch in str(value)).split()
    for item in digits:
        if len(item) == 4:
            return int(item)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("name", help="eval vector name, e.g. jina or v5_omni_small")
    parser.add_argument("--channel", required=True, choices=["image", "caption"])
    parser.add_argument("--model", required=True)
    parser.add_argument("--org-id", default=DEFAULT_NGS_ORG_ID)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    corpus_by_id = {row["id"]: row for row in load_corpus()}
    ids, vecs = load_vectors(args.name)
    if args.limit:
        ids = ids[:args.limit]
        vecs = vecs[:args.limit]

    out = args.out or Path(f"/tmp/paillette-vectorize-{args.name}.ndjson")
    out.parent.mkdir(parents=True, exist_ok=True)

    with out.open("w") as fh:
        for artwork_id, vector in zip(ids, vecs):
            row = corpus_by_id.get(artwork_id, {})
            metadata = {
                "orgId": args.org_id,
                "galleryId": args.org_id,
                "artworkId": artwork_id,
                "channel": args.channel,
                "model": args.model,
                "title": row.get("title") or "",
                "artist": row.get("artist") or "",
                "classification": row.get("classification") or "",
                "year": year_from_date_text(row.get("date_text")) or 0,
                "createdAt": "2026-05-22T00:00:00.000Z",
            }
            fh.write(json.dumps({
                "id": artwork_id,
                "values": vector.astype(float).tolist(),
                "metadata": metadata,
            }, separators=(",", ":")))
            fh.write("\n")

    print(f"-> {out} ({len(ids)} vectors)")


if __name__ == "__main__":
    main()
