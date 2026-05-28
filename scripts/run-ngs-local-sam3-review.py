#!/usr/bin/env python3
"""Run local SAM3 over the NGS image-extraction queue with per-item checkpoints."""

import argparse
import importlib.util
import json
import math
import sys
import time
from pathlib import Path


DEFAULT_SAM3_REPO = "/Users/erniesg/Downloads/paillette-sam3-apple"
DEFAULT_CHECKPOINT = (
    "/Users/erniesg/.cache/huggingface/hub/models--facebook--sam3/"
    "snapshots/3c879f39826c281e95690f02c7821c4de09afae7/sam3.pt"
)
DEFAULT_BPE = "/Users/erniesg/Downloads/paillette-sam3-apple/assets/bpe_simple_vocab_16e6.txt.gz"


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run local SAM3 review on NGS extraction candidates."
    )
    parser.add_argument(
        "--input-dir",
        default="/Users/erniesg/Downloads/paillette-ngs-local-sam3-review/input",
    )
    parser.add_argument(
        "--mapping",
        default="/Users/erniesg/Downloads/paillette-ngs-local-sam3-review/input-mapping.json",
    )
    parser.add_argument(
        "--output-dir",
        default="/Users/erniesg/Downloads/paillette-ngs-local-sam3-review",
    )
    parser.add_argument("--sam3-repo", default=DEFAULT_SAM3_REPO)
    parser.add_argument("--checkpoint", default=DEFAULT_CHECKPOINT)
    parser.add_argument("--bpe", default=DEFAULT_BPE)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--max-dim", type=int, default=512)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sheet-size", type=int, default=40)
    parser.add_argument("--border-refine", action="store_true")
    parser.add_argument(
        "--prompts",
        default="artwork only,inner artwork,picture inside frame,photograph only,printed image",
        help="Comma-separated SAM3 text prompts. Use 'default' for the full HCC prompt set.",
    )
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--retry-errors", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report_jsonl = output_dir / "sam3-review-results.jsonl"
    report_json = output_dir / "sam3-review-results.json"
    summary_json = output_dir / "sam3-review-summary.json"
    progress_json = output_dir / "sam3-review-progress.json"
    contact_dir = output_dir / "sam3-review-contact-sheets"
    contact_dir.mkdir(parents=True, exist_ok=True)

    hcc = load_hcc_module()
    queue = load_queue(args)
    if args.limit:
        queue = queue[: args.limit]

    existing = [] if args.no_resume else read_jsonl(report_jsonl)
    processed_names = {
        row.get("name")
        for row in existing
        if row.get("name") and (not args.retry_errors or row.get("ok"))
    }
    completed = [row for row in existing if row.get("name") in processed_names]

    print(f"queue={len(queue)}")
    print(f"already_completed={len(processed_names)}")
    print(f"report_jsonl={report_jsonl}")

    sys.path.insert(0, args.sam3_repo)
    from sam3.model.sam3_image_processor import Sam3Processor
    from sam3.model_builder import build_sam3_image_model

    prompts = parse_prompts(args.prompts)
    if prompts:
        hcc.DEFAULT_PROMPTS = prompts
    print(f"prompts={len(hcc.DEFAULT_PROMPTS)}")

    device = hcc.resolve_device(args.device)
    print(f"device={device}")
    print("loading_sam3=1")
    loaded_at = time.time()
    model = build_sam3_image_model(
        device=device,
        checkpoint_path=args.checkpoint,
        load_from_HF=False,
        bpe_path=args.bpe,
        eval_mode=True,
        enable_inst_interactivity=False,
    )
    processor = Sam3Processor(model, device=device, confidence_threshold=0.05)
    print(f"loaded_sam3_seconds={time.time() - loaded_at:.1f}")

    started = time.time()
    processed_this_run = 0
    mode = "w" if args.no_resume else "a"
    with report_jsonl.open(mode) as output:
        for index, item in enumerate(queue, start=1):
            file_path = Path(item["inputPath"])
            if file_path.name in processed_names:
                continue

            item_started = time.time()
            try:
                result = hcc.process_image(file_path, args, processor)
            except Exception as exc:
                result = {
                    "file": str(file_path),
                    "name": file_path.name,
                    "ok": False,
                    "error": str(exc),
                    "action": "error",
                }

            result["queue_index"] = index
            result["seconds"] = round(time.time() - item_started, 3)
            result["artwork"] = {
                key: item.get(key)
                for key in (
                    "artworkId",
                    "accessionNumber",
                    "title",
                    "artist",
                    "classification",
                    "medium",
                    "dateText",
                    "sourceUrl",
                    "sam3Priority",
                    "reasons",
                )
            }
            output.write(json.dumps(result, separators=(",", ":")) + "\n")
            output.flush()

            completed.append(result)
            processed_names.add(file_path.name)
            processed_this_run += 1
            write_progress(
                progress_json,
                queue,
                completed,
                processed_this_run,
                started,
                report_jsonl,
            )

            chosen = result.get("selected", {})
            box = result.get("final_box") or []
            print(
                f"{len(completed)}/{len(queue)} {file_path.name} "
                f"{result.get('action')} {result.get('reason')} "
                f"{chosen.get('prompt')} {box} {result['seconds']:.1f}s",
                flush=True,
            )

    final_rows = read_jsonl(report_jsonl)
    write_json(report_json, final_rows)
    sheets = hcc.write_contact_sheets(final_rows, contact_dir, args.sheet_size)
    summary = build_summary(final_rows, queue, sheets, report_jsonl, report_json)
    write_json(summary_json, summary)
    write_json(progress_json, {**summary, "status": "complete"})
    print("SUMMARY " + json.dumps(summary, indent=2))


def load_hcc_module():
    script_path = Path(__file__).with_name("hcc-sam3-mps-crop.py")
    spec = importlib.util.spec_from_file_location("hcc_sam3_mps_crop", script_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_queue(args):
    mapping_path = Path(args.mapping)
    input_dir = Path(args.input_dir)
    if mapping_path.exists():
        rows = json.loads(mapping_path.read_text())
        return [
            row
            for row in rows
            if row.get("inputPath") and Path(row["inputPath"]).exists()
        ]

    exts = {".tif", ".tiff", ".jpg", ".jpeg", ".png", ".webp"}
    return [
        {"inputName": path.name, "inputPath": str(path)}
        for path in sorted(input_dir.iterdir())
        if path.is_file() and path.suffix.lower() in exts
    ]


def parse_prompts(raw):
    if not raw or raw == "default":
        return None
    return [prompt.strip() for prompt in raw.split(",") if prompt.strip()]


def read_jsonl(path):
    if not Path(path).exists():
        return []
    rows = []
    for line in Path(path).read_text().splitlines():
        if not line.strip():
            continue
        rows.append(json.loads(line))
    return rows


def write_progress(path, queue, rows, processed_this_run, started, report_jsonl):
    elapsed = time.time() - started
    remaining = max(0, len(queue) - len(rows))
    per_item = elapsed / max(1, processed_this_run)
    payload = {
        "status": "running",
        "queue": len(queue),
        "completed": len(rows),
        "remaining": remaining,
        "processedThisRun": processed_this_run,
        "elapsedSeconds": round(elapsed, 1),
        "secondsPerItemThisRun": round(per_item, 3),
        "etaSeconds": round(per_item * remaining, 1),
        "etaHours": round((per_item * remaining) / 3600, 2),
        "reportJsonl": str(report_jsonl),
        "actions": count_by(rows, "action"),
        "reasons": count_by(rows, "reason"),
    }
    write_json(path, payload)


def build_summary(rows, queue, sheets, report_jsonl, report_json):
    return {
        "queue": len(queue),
        "completed": len(rows),
        "ok": sum(1 for row in rows if row.get("ok")),
        "errors": sum(1 for row in rows if not row.get("ok")),
        "actions": count_by(rows, "action"),
        "reasons": count_by(rows, "reason"),
        "reportJsonl": str(report_jsonl),
        "reportJson": str(report_json),
        "contactSheets": sheets,
    }


def count_by(rows, key):
    counts = {}
    for row in rows:
        value = row.get(key) or "none"
        counts[value] = counts.get(value, 0) + 1
    return counts


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, indent=2) + "\n")


if __name__ == "__main__":
    main()
