"""Export eval vectors as Cloudflare Vectorize NDJSON.

Example:
  python eval/export_vectorize.py jina --channel image --model jina-clip-v2
  pnpm --dir apps/api exec wrangler vectorize upsert paillette-embeddings-stg \
    --file /tmp/paillette-vectorize-jina.ndjson --batch-size 500
"""
import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from lib import load_corpus, load_vectors


DEFAULT_NGS_ORG_ID = "cf98791d-f3cc-4f9f-b40c-a350efadbd05"


def year_from_date_text(value):
    if not value:
        return None
    digits = "".join(ch if ch.isdigit() else " " for ch in str(value)).split()
    for item in digits:
        if len(item) == 4:
            return int(item)
    return None


def load_app_rows(app_db):
    if not app_db:
        return None

    con = sqlite3.connect(app_db)
    con.row_factory = sqlite3.Row
    rows = {}
    for row in con.execute(
        """
        SELECT
          id,
          org_id,
          title,
          artist,
          year,
          date_text,
          medium,
          classification,
          accession_number,
          source_url,
          source_institution,
          source_collection,
          embedding_id,
          custom_metadata
        FROM artworks
        WHERE deleted_at IS NULL
        """
    ):
        rows[row["id"]] = dict(row)
    con.close()
    return rows


def caption_text(row):
    if not row:
        return None
    try:
        metadata = json.loads(row.get("custom_metadata") or "{}")
    except json.JSONDecodeError:
        return None
    generated_caption = metadata.get("generated_caption")
    if isinstance(generated_caption, dict):
        return generated_caption.get("text")
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("name", help="eval vector name, e.g. jina or v5_omni_small")
    parser.add_argument("--channel", required=True, choices=["image", "caption"])
    parser.add_argument("--model", required=True)
    parser.add_argument("--version", default="v1", help="embedding/index version metadata")
    parser.add_argument("--candidate", help="candidate label, e.g. v2_hybrid_rrf")
    parser.add_argument("--id-prefix", default="", help="optional vector id prefix")
    parser.add_argument("--app-db", type=Path, help="app SQLite DB used to filter/export v2 rows")
    parser.add_argument("--created-at", help="metadata timestamp for exported vectors")
    parser.add_argument("--org-id", default=DEFAULT_NGS_ORG_ID)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    created_at = args.created_at or datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    corpus_by_id = {row["id"]: row for row in load_corpus()}
    app_rows = load_app_rows(args.app_db)
    ids, vecs = load_vectors(args.name)
    if app_rows is not None:
        ids_and_vecs = [(artwork_id, vector) for artwork_id, vector in zip(ids, vecs) if artwork_id in app_rows]
        if args.channel == "image":
            ids_and_vecs = [
                (artwork_id, vector)
                for artwork_id, vector in ids_and_vecs
                if app_rows[artwork_id].get("embedding_id")
            ]
        if args.channel == "caption":
            ids_and_vecs = [
                (artwork_id, vector)
                for artwork_id, vector in ids_and_vecs
                if caption_text(app_rows[artwork_id])
            ]
        ids = [artwork_id for artwork_id, _ in ids_and_vecs]
        vecs = [vector for _, vector in ids_and_vecs]
    if args.limit:
        ids = ids[:args.limit]
        vecs = vecs[:args.limit]

    out = args.out or Path(f"/tmp/paillette-vectorize-{args.name}.ndjson")
    out.parent.mkdir(parents=True, exist_ok=True)

    with out.open("w") as fh:
        for artwork_id, vector in zip(ids, vecs):
            app_row = app_rows.get(artwork_id) if app_rows is not None else None
            row = app_row or corpus_by_id.get(artwork_id, {})
            metadata = {
                "orgId": row.get("org_id") or args.org_id,
                "galleryId": row.get("org_id") or args.org_id,
                "artworkId": artwork_id,
                "channel": args.channel,
                "model": args.model,
                "embeddingVersion": args.version,
                "title": row.get("title") or "",
                "artist": row.get("artist") or "",
                "medium": row.get("medium") or "",
                "classification": row.get("classification") or "",
                "year": row.get("year") or year_from_date_text(row.get("date_text")) or 0,
                "dateText": row.get("date_text") or "",
                "accessionNumber": row.get("accession_number") or artwork_id,
                "sourceInstitution": row.get("source_institution") or "",
                "sourceCollection": row.get("source_collection") or "",
                "sourceUrl": row.get("source_url") or "",
                "createdAt": created_at,
            }
            if args.candidate:
                metadata["candidate"] = args.candidate
            fh.write(json.dumps({
                "id": f"{args.id_prefix}{artwork_id}",
                "values": vector.astype(float).tolist(),
                "metadata": metadata,
            }, separators=(",", ":")))
            fh.write("\n")

    print(f"-> {out} ({len(ids)} vectors)")


if __name__ == "__main__":
    main()
