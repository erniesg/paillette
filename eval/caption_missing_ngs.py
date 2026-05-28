#!/usr/bin/env python3
"""Caption NGS missing-image backfill rows from a prepared backfill plan.

This mirrors eval/caption.py but reads the selected image paths from
tmp/ngs-missing-images-backfill/backfill-plan.json, so newly recovered NGS
images can get generated captions before caption-vector upsert.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import time
from pathlib import Path

from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config


MODEL = "mlx-community/Qwen3-VL-30B-A3B-Instruct-4bit"
PROMPT_VERSION = "cap-ngs-missing-v1"

QUESTION = """You are writing a factual description of an artwork for a search index.

VERIFIED FACTS:
{facts}

Look at the image. Write one factual paragraph of about 90 to 120 words.
Include the artist, title, date and medium when provided. Describe the literal
subject, composition, visible technique, dominant colours, and mood. Use only
what the facts state or what is visible in the image. Do not invent names,
places, dates, events, inscriptions, or meanings."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--plan",
        default="tmp/ngs-missing-images-backfill/backfill-plan.json",
        type=Path,
    )
    parser.add_argument(
        "--out",
        default="tmp/ngs-missing-images-backfill/captions.jsonl",
        type=Path,
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument("--shuffle", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def load_rows(plan_path: Path) -> list[dict]:
    payload = json.loads(plan_path.read_text())
    rows = payload["rows"] if isinstance(payload, dict) else payload
    return [
        row
        for row in rows
        if row.get("preparedImagePath") and Path(row["preparedImagePath"]).exists()
    ]


def existing_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    ids = set()
    for line in path.read_text().splitlines():
        if line.strip():
            ids.add(json.loads(line)["id"])
    return ids


def facts_block(row: dict) -> str:
    facts = []
    for label, key in [
        ("Accession", "id"),
        ("Title", "title"),
        ("Artist", "artist"),
        ("Date", "dateText"),
        ("Medium", "medium"),
    ]:
        value = row.get(key)
        if value:
            facts.append(f"- {label}: {value}")
    if row.get("ngsPageUrl"):
        facts.append(f"- Source: {row['ngsPageUrl']}")
    return "\n".join(facts) if facts else "- No catalogue metadata provided."


def main() -> None:
    args = parse_args()
    rows = load_rows(args.plan)
    if args.shuffle:
        random.seed(args.seed)
        random.shuffle(rows)
    if args.limit:
        rows = rows[: args.limit]

    done = existing_ids(args.out)
    todo = [row for row in rows if row["id"] not in done]
    args.out.parent.mkdir(parents=True, exist_ok=True)

    print(
        f"captioning {len(todo)} rows ({len(done)} already done) with {MODEL}",
        flush=True,
    )
    model, processor = load(MODEL)
    config = load_config(MODEL)

    started = time.time()
    with args.out.open("a") as handle:
        for index, row in enumerate(todo, start=1):
            prompt = apply_chat_template(
                processor,
                config,
                QUESTION.format(facts=facts_block(row)),
                num_images=1,
            )
            text = ""
            try:
                image_path = row.get("preparedThumbnailPath") or row["preparedImagePath"]
                result = generate(
                    model,
                    processor,
                    prompt,
                    image=[str(Path(image_path).resolve())],
                    max_tokens=220,
                    temperature=0.0,
                    verbose=False,
                )
                text = (result.text if hasattr(result, "text") else str(result)).strip()
            except Exception as error:
                print(f"FAIL {row['id']}: {error}", flush=True)

            handle.write(
                json.dumps(
                    {
                        "id": row["id"],
                        "caption": text,
                        "model": MODEL,
                        "prompt_version": PROMPT_VERSION,
                        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                        "sources": [
                            value
                            for value in [row.get("ngsPageUrl"), row.get("ngsImageUrl")]
                            if value
                        ],
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            handle.flush()

            if index <= 3 or index % 25 == 0:
                seconds_each = (time.time() - started) / index
                print(
                    f"{index}/{len(todo)} {seconds_each:.1f}s/img {row['id']}: {text[:100]}",
                    flush=True,
                )

    print(f"DONE -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
