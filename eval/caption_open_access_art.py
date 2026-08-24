#!/usr/bin/env python3
"""Caption Open Access Art rows that lack institution-provided text.

Reads either an open-access dry-run manifest or an apply plan. The script filters
to rows whose normalized `caption.hasInstitutionCaption` is false, downloads only
those images, and records latency for a bounded local MLX VLM benchmark.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import time
import urllib.request
from pathlib import Path
from typing import Iterable


DEFAULT_MODEL = "mlx-community/Qwen3-VL-30B-A3B-Instruct-4bit"
PROMPT_VERSION = "open-access-art-cap-v1"

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
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--plan", type=Path)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("tmp/open-access-art-caption-benchmark/captions.jsonl"),
    )
    parser.add_argument(
        "--metrics-out",
        type=Path,
        default=Path("tmp/open-access-art-caption-benchmark/metrics.json"),
    )
    parser.add_argument(
        "--image-dir",
        type=Path,
        default=Path("tmp/open-access-art-caption-benchmark/images"),
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--shuffle", action="store_true")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--skip-providers", default="")
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    if not args.manifest and not args.plan:
      parser.error("--manifest or --plan is required")
    return args


def load_payload(path: Path) -> dict:
    return json.loads(path.read_text())


def records_from_manifest(payload: dict) -> list[dict]:
    records: list[dict] = []
    for provider_payload in (payload.get("providers") or {}).values():
        records.extend(provider_payload.get("normalizedSamples") or [])
    return records


def records_from_plan(payload: dict) -> list[dict]:
    return payload.get("records") or payload.get("rows") or []


def is_missing_caption(row: dict) -> bool:
    caption = row.get("caption") or {}
    if caption.get("hasInstitutionCaption") is False:
        return True
    open_access = (row.get("customMetadata") or row.get("custom_metadata") or {}).get(
        "openAccessArt",
        {},
    )
    institution_caption = open_access.get("institutionCaption") or {}
    return institution_caption.get("hasInstitutionCaption") is False


def provider(row: dict) -> str:
    metadata = row.get("custom_metadata") or row.get("customMetadata") or {}
    return str(metadata.get("provider") or row.get("provider") or "").lower()


def image_url(row: dict) -> str:
    return row.get("sourceImageUrl") or row.get("image_url") or row.get("imageUrl") or ""


def image_path_for(row: dict, image_dir: Path) -> Path:
    suffix = ".jpg"
    url = image_url(row)
    for candidate in [".jpg", ".jpeg", ".png", ".webp"]:
        if url.lower().split("?", 1)[0].endswith(candidate):
            suffix = ".jpg" if candidate == ".jpeg" else candidate
            break
    safe_id = (
        str(row["id"])
        .replace("/", "_")
        .replace(":", "_")
        .replace(" ", "_")
    )
    return image_dir / f"{safe_id}{suffix}"


def download_image(row: dict, image_dir: Path) -> Path:
    path = image_path_for(row, image_dir)
    if path.exists():
        return path
    url = image_url(row)
    if not url:
        raise RuntimeError(f"missing image URL for {row.get('id')}")
    image_dir.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        url,
        headers={"Accept": "image/avif,image/webp,image/*,*/*;q=0.8"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        path.write_bytes(response.read())
    return path


def facts_block(row: dict) -> str:
    facts = []
    for label, key in [
        ("Provider", "source_institution"),
        ("Title", "title"),
        ("Artist", "artist"),
        ("Date", "date_text"),
        ("Medium", "medium"),
        ("Classification", "classification"),
        ("Accession", "accession_number"),
        ("Rights", "rights"),
        ("Source URL", "source_url"),
    ]:
        value = row.get(key)
        if value:
            facts.append(f"- {label}: {value}")
    return "\n".join(facts) if facts else "- No catalogue metadata provided."


def existing_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    ids = set()
    for line in path.read_text().splitlines():
        if line.strip():
            ids.add(json.loads(line)["id"])
    return ids


def prepare_rows(args: argparse.Namespace) -> list[dict]:
    payload = load_payload(args.plan or args.manifest)
    rows = records_from_plan(payload) if args.plan else records_from_manifest(payload)
    skip = {
        value.strip().lower()
        for value in args.skip_providers.split(",")
        if value.strip()
    }
    rows = [
        row
        for row in rows
        if row.get("id") and is_missing_caption(row) and provider(row) not in skip
    ]
    if args.shuffle:
        random.seed(args.seed)
        random.shuffle(rows)
    if args.limit:
        rows = rows[: args.limit]
    for row in rows:
        row["_local_image_path"] = str(download_image(row, args.image_dir))
    return rows


def write_inputs(rows: Iterable[dict], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    args = parse_args()
    rows = prepare_rows(args)
    write_inputs(rows, args.metrics_out.with_suffix(".inputs.jsonl"))
    if args.prepare_only:
        args.metrics_out.parent.mkdir(parents=True, exist_ok=True)
        args.metrics_out.write_text(
            json.dumps(
                {
                    "prepared": len(rows),
                    "model": args.model,
                    "prompt_version": PROMPT_VERSION,
                    "prepare_only": True,
                },
                indent=2,
            )
            + "\n"
        )
        print(f"prepared {len(rows)} missing-caption rows")
        return

    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template
    from mlx_vlm.utils import load_config

    done = existing_ids(args.out)
    todo = [row for row in rows if row["id"] not in done]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    print(f"captioning {len(todo)} rows ({len(done)} already done) with {args.model}")

    model, processor = load(args.model)
    config = load_config(args.model)
    timings = []
    started = time.time()

    with args.out.open("a") as handle:
        for index, row in enumerate(todo, start=1):
            prompt = apply_chat_template(
                processor,
                config,
                QUESTION.format(facts=facts_block(row)),
                num_images=1,
            )
            item_started = time.time()
            text = ""
            error = None
            try:
                result = generate(
                    model,
                    processor,
                    prompt,
                    image=[str(Path(row["_local_image_path"]).resolve())],
                    max_tokens=220,
                    temperature=0.0,
                    verbose=False,
                )
                text = (result.text if hasattr(result, "text") else str(result)).strip()
            except Exception as exc:
                error = str(exc)
                print(f"FAIL {row['id']}: {error}", flush=True)
            elapsed = time.time() - item_started
            timings.append(elapsed)
            handle.write(
                json.dumps(
                    {
                        "id": row["id"],
                        "caption": text,
                        "model": args.model,
                        "prompt_version": PROMPT_VERSION,
                        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                        "sources": [
                            value
                            for value in [row.get("source_url"), image_url(row)]
                            if value
                        ],
                        "latency_seconds": elapsed,
                        "error": error,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            handle.flush()
            print(
                f"{index}/{len(todo)} {elapsed:.1f}s/img {row['id']}: {text[:100]}",
                flush=True,
            )

    total = time.time() - started
    args.metrics_out.parent.mkdir(parents=True, exist_ok=True)
    args.metrics_out.write_text(
        json.dumps(
            {
                "rows": len(todo),
                "model": args.model,
                "prompt_version": PROMPT_VERSION,
                "total_seconds": total,
                "seconds_per_image": sum(timings) / len(timings) if timings else None,
                "latencies": timings,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"DONE -> {args.out}")


if __name__ == "__main__":
    main()
