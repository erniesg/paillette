#!/usr/bin/env python3
import argparse
import json
import math
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageOps


DEFAULT_PROMPTS = [
    "artwork only",
    "actual photograph",
    "photograph only",
    "photographic print",
    "printed image",
    "picture inside frame",
    "inner artwork",
    "artwork image",
    "painting only",
    "painted image",
    "drawing",
    "artwork",
    "picture",
    "image only",
    "image inside frame",
    "artwork without frame",
    "unframed artwork",
]


PROMPT_BONUS = {
    "artwork only": 0.45,
    "actual photograph": 0.42,
    "photograph only": 0.40,
    "photographic print": 0.40,
    "printed image": 0.32,
    "picture inside frame": 0.32,
    "inner artwork": 0.28,
    "artwork image": 0.25,
    "picture": 0.18,
    "image only": 0.16,
    "image inside frame": 0.14,
    "painting only": 0.12,
    "painted image": 0.12,
    "drawing": 0.10,
    "artwork": 0.10,
    "artwork without frame": 0.08,
    "unframed artwork": 0.08,
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run local SAM3/MPS HCC crop diagnostics and optional TIFF output."
    )
    parser.add_argument("--input-dir", action="append")
    parser.add_argument("--output-dir")
    parser.add_argument("--report", required=True)
    parser.add_argument("--contact-dir", required=True)
    parser.add_argument("--sam3-repo", default="/Users/erniesg/Downloads/paillette-sam3-apple")
    parser.add_argument(
        "--checkpoint",
        default="/Users/erniesg/.cache/huggingface/hub/models--facebook--sam3/snapshots/3c879f39826c281e95690f02c7821c4de09afae7/sam3.pt",
    )
    parser.add_argument(
        "--bpe",
        default="/Users/erniesg/Downloads/paillette-sam3-apple/assets/bpe_simple_vocab_16e6.txt.gz",
    )
    parser.add_argument("--device", default="mps")
    parser.add_argument("--max-dim", type=int, default=1000)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--include")
    parser.add_argument("--from-report")
    parser.add_argument("--postprocess-loaded", action="store_true")
    parser.add_argument("--border-refine", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--write-unchanged", action="store_true")
    parser.add_argument("--sheet-size", type=int, default=20)
    return parser.parse_args()


def main():
    args = parse_args()
    if args.from_report:
        results = json.loads(Path(args.from_report).read_text())
        if args.postprocess_loaded:
            results = [postprocess_loaded_result(row, args) for row in results]
        if args.apply:
            if not args.output_dir:
                raise SystemExit("--output-dir is required with --apply")
            for row in results:
                if row.get("ok") and (row.get("action") == "crop" or args.write_unchanged):
                    row["output_path"] = write_output(row["file"], row, args)
        write_json(args.report, results)
        Path(args.contact_dir).mkdir(parents=True, exist_ok=True)
        sheets = write_contact_sheets(results, args.contact_dir, args.sheet_size)
        print("SHEETS " + json.dumps(sheets, indent=2))
        return

    if not args.input_dir:
        raise SystemExit("--input-dir is required unless --from-report is used")

    if args.apply and not args.output_dir:
        raise SystemExit("--output-dir is required with --apply")

    sys.path.insert(0, args.sam3_repo)
    from sam3.model.sam3_image_processor import Sam3Processor
    from sam3.model_builder import build_sam3_image_model

    device = resolve_device(args.device)
    print(f"device={device}")
    print("loading_sam3=1")
    started = time.time()
    model = build_sam3_image_model(
        device=device,
        checkpoint_path=args.checkpoint,
        load_from_HF=False,
        bpe_path=args.bpe,
        eval_mode=True,
        enable_inst_interactivity=False,
    )
    processor = Sam3Processor(model, device=device, confidence_threshold=0.05)
    print(f"loaded_sam3_seconds={time.time() - started:.1f}")

    include = parse_include(args.include)
    files = list_images(args.input_dir, include)
    if args.limit:
        files = files[: args.limit]
    Path(args.contact_dir).mkdir(parents=True, exist_ok=True)
    if args.output_dir:
        Path(args.output_dir).mkdir(parents=True, exist_ok=True)

    results = []
    for index, file_path in enumerate(files, start=1):
        item_started = time.time()
        try:
            result = process_image(file_path, args, processor)
            if args.apply and (result["action"] == "crop" or args.write_unchanged):
                result["output_path"] = write_output(file_path, result, args)
        except Exception as exc:
            result = {
                "file": str(file_path),
                "name": file_path.name,
                "ok": False,
                "error": str(exc),
                "action": "error",
            }
        result["seconds"] = round(time.time() - item_started, 3)
        results.append(result)
        chosen = result.get("selected", {})
        box = result.get("final_box") or []
        print(
            f"{index}/{len(files)} {file_path.name} {result.get('action')} "
            f"{result.get('reason')} {chosen.get('prompt')} {box} {result['seconds']:.1f}s",
            flush=True,
        )

    write_json(args.report, results)
    sheets = write_contact_sheets(results, args.contact_dir, args.sheet_size)
    summary = {
        "count": len(results),
        "ok": sum(1 for row in results if row.get("ok")),
        "actions": count_by(results, "action"),
        "reasons": count_by(results, "reason"),
        "sheets": sheets,
        "report": str(Path(args.report).resolve()),
    }
    write_json(str(Path(args.report).with_suffix(".summary.json")), summary)
    print("SUMMARY " + json.dumps(summary, indent=2))


def process_image(file_path, args, processor):
    full_image = ImageOps.exif_transpose(Image.open(file_path)).convert("RGB")
    full_size = full_image.size
    preview = full_image.copy()
    preview.thumbnail((args.max_dim, args.max_dim), Image.Resampling.LANCZOS)
    preview_size = preview.size
    preview_arr = np.asarray(preview)
    edge = border_stats(preview_arr)

    state = processor.set_image(preview)
    candidates = []
    for prompt in DEFAULT_PROMPTS:
        processor.reset_all_prompts(state)
        output = processor.set_text_prompt(prompt, state)
        boxes = output.get("boxes")
        scores = output.get("scores")
        if boxes is None:
            continue
        if hasattr(boxes, "detach"):
            boxes = boxes.detach().cpu().numpy()
        if hasattr(scores, "detach"):
            scores = scores.detach().cpu().numpy()
        for idx, box in enumerate(boxes):
            candidates.append(make_candidate(prompt, idx, box, scores, preview_size))

    candidates.sort(key=lambda row: row["score"], reverse=True)
    selected, reason = select_candidate(candidates, edge, preview_size)
    action = "keep"
    final_box = [0, 0, preview_size[0], preview_size[1]]
    refined = None
    border_refined = None

    if selected:
        final_box = selected["box"]
        action = "crop"
        if selected["area"] >= 0.96 and edge["dark_frac"] < 0.25:
            action = "keep"
            reason = "near_full_sam3"
            final_box = [0, 0, preview_size[0], preview_size[1]]
        else:
            refined = refine_frame_box(preview_arr, final_box, edge)
            if refined:
                final_box = refined["box"]
                reason = f"{reason}+frame_refine"
            border_refined = refine_inner_border_box(preview_arr, final_box, selected, args)
            if border_refined:
                final_box = border_refined["box"]
                reason = f"{reason}+border_refine"
    else:
        selected = {}

    source_box = None
    if action == "crop":
        source_box = map_preview_box_to_source(final_box, preview_size, full_size)

    return {
        "file": str(file_path),
        "name": file_path.name,
        "ok": True,
        "full_size": list(full_size),
        "preview_size": list(preview_size),
        "edge_stats": edge,
        "action": action,
        "reason": reason,
        "selected": selected,
        "final_box": final_box,
        "source_box": source_box,
        "refined": refined,
        "border_refined": border_refined,
        "top": candidates[:30],
    }


def postprocess_loaded_result(row, args):
    if not row.get("ok"):
        return row
    if row.get("reason") in {"keep_clean_studio", "near_full_sam3"}:
        return row

    image = ImageOps.exif_transpose(Image.open(row["file"])).convert("RGB")
    image.thumbnail(tuple(row["preview_size"]), Image.Resampling.LANCZOS)
    image_arr = np.asarray(image)
    full_size = tuple(row["full_size"])
    preview_size = tuple(row["preview_size"])
    current_box = row.get("final_box") or [0, 0, preview_size[0], preview_size[1]]
    refined = refine_inner_border_box(image_arr, current_box, row.get("selected") or {}, args, row)
    if not refined:
        return row

    updated = dict(row)
    updated["action"] = "crop"
    reason = updated.get("reason") or "postprocess"
    if "border_refine" not in reason:
        reason = f"{reason}+border_refine"
    updated["reason"] = reason
    updated["final_box"] = refined["box"]
    updated["source_box"] = map_preview_box_to_source(refined["box"], preview_size, full_size)
    updated["border_refined"] = refined
    return updated


def make_candidate(prompt, idx, raw_box, scores, preview_size):
    width, height = preview_size
    x1, y1, x2, y2 = [float(value) for value in raw_box]
    x1 = clamp(x1, 0, width)
    y1 = clamp(y1, 0, height)
    x2 = clamp(x2, 0, width)
    y2 = clamp(y2, 0, height)
    if x2 < x1:
        x1, x2 = x2, x1
    if y2 < y1:
        y1, y2 = y2, y1
    box_width = max(0.0, x2 - x1)
    box_height = max(0.0, y2 - y1)
    area = (box_width * box_height) / (width * height)
    score = float(scores[idx]) if scores is not None and idx < len(scores) else 0.0
    center = ((x1 + x2) / (2 * width), (y1 + y2) / (2 * height))
    return {
        "prompt": prompt,
        "idx": int(idx),
        "score": round(score, 6),
        "box": [round(x1), round(y1), round(x2), round(y2)],
        "area": round(area, 6),
        "aspect": round(box_width / max(1.0, box_height), 6),
        "center": [round(center[0], 6), round(center[1], 6)],
    }


def select_candidate(candidates, edge, preview_size):
    if is_clean_studio(candidates, edge):
        return None, "keep_clean_studio"

    ranked = []
    for candidate in candidates:
        if candidate["area"] <= 0:
            continue
        if candidate["score"] < 0.35:
            continue
        if candidate["area"] < 0.025:
            continue
        if candidate["score"] < 0.45 and candidate["area"] < 0.30:
            continue
        aspect = candidate["aspect"]
        if (aspect > 6.0 or aspect < 0.16) and candidate["area"] < 0.35:
            continue

        rank = candidate["score"] + PROMPT_BONUS.get(candidate["prompt"], 0.0)
        if 0.06 <= candidate["area"] <= 0.85:
            rank += 0.16
        elif 0.85 < candidate["area"] <= 0.96:
            rank += 0.04
        elif candidate["area"] > 0.96:
            rank -= 0.10
        cx, cy = candidate["center"]
        center_score = 1.0 - min(1.0, math.hypot(cx - 0.5, cy - 0.5) / math.hypot(0.5, 0.5))
        rank += 0.05 * center_score
        if candidate["prompt"] in ("actual photograph", "photograph only", "photographic print"):
            rank += min(0.12, candidate["area"] * 0.12)
        ranked.append((rank, candidate))

    if not ranked:
        return None, "no_usable_sam3_candidate"

    ranked.sort(key=lambda item: item[0], reverse=True)
    selected = dict(ranked[0][1])
    selected["rank"] = round(ranked[0][0], 6)

    near_full = [
        row
        for _, row in ranked[:8]
        if row["area"] >= 0.95 and row["score"] >= 0.48 and edge["dark_frac"] < 0.25
    ]
    if near_full:
        keep = dict(sorted(near_full, key=lambda row: row["score"], reverse=True)[0])
        keep["rank"] = selected["rank"]
        return keep, "near_full_candidate"

    return selected, "ranked_sam3"


def is_clean_studio(candidates, edge):
    if not (edge["dark_frac"] < 0.03 and edge["light_neutral_frac"] >= 0.75):
        return False
    for candidate in candidates[:12]:
        if (
            candidate["prompt"] in ("artwork only", "artwork", "artwork image")
            and candidate["score"] >= 0.75
            and 0.18 <= candidate["area"] <= 0.55
        ):
            return True
    return False


def refine_frame_box(image_arr, box, edge):
    if edge["dark_frac"] < 0.30:
        return None
    x1, y1, x2, y2 = [int(value) for value in box]
    crop = image_arr[y1:y2, x1:x2]
    if crop.shape[0] < 120 or crop.shape[1] < 120:
        return None
    crop_area = (crop.shape[0] * crop.shape[1]) / (image_arr.shape[0] * image_arr.shape[1])
    if crop_area < 0.25 or crop_area > 0.85:
        return None

    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    vertical_profile = smooth(gx.mean(axis=0), 3)
    vertical_coverage = smooth((gx > 45).mean(axis=0), 3)
    horizontal_profile = smooth(gy.mean(axis=1), 3)
    horizontal_coverage = smooth((gy > 45).mean(axis=1), 3)

    left = nearest_line(vertical_profile, vertical_coverage, "leading")
    right = nearest_line(vertical_profile, vertical_coverage, "trailing")
    top = nearest_line(horizontal_profile, horizontal_coverage, "leading")
    bottom = nearest_line(horizontal_profile, horizontal_coverage, "trailing")
    if not all([left, right, top, bottom]):
        return None

    new_box = [x1 + left["index"], y1 + top["index"], x1 + right["index"], y1 + bottom["index"]]
    if new_box[2] <= new_box[0] or new_box[3] <= new_box[1]:
        return None

    old_area = max(1, (x2 - x1) * (y2 - y1))
    new_area = (new_box[2] - new_box[0]) * (new_box[3] - new_box[1])
    area_ratio = new_area / old_area
    insets = {
        "left": (new_box[0] - x1) / max(1, x2 - x1),
        "top": (new_box[1] - y1) / max(1, y2 - y1),
        "right": (x2 - new_box[2]) / max(1, x2 - x1),
        "bottom": (y2 - new_box[3]) / max(1, y2 - y1),
    }
    if area_ratio < 0.72 or area_ratio > 0.98:
        return None
    if min(insets.values()) < 0.006 or max(insets.values()) > 0.16:
        return None

    return {
        "box": new_box,
        "area_ratio": round(area_ratio, 6),
        "insets": {key: round(value, 6) for key, value in insets.items()},
        "lines": {"left": left, "right": right, "top": top, "bottom": bottom},
    }


def refine_inner_border_box(image_arr, box, selected=None, args=None, row=None):
    if not args or not getattr(args, "border_refine", False):
        return None

    selected = selected or {}
    reason = (row or {}).get("reason") or ""
    if "keep_clean_studio" in reason or "near_full" in reason:
        return None

    x1, y1, x2, y2 = [int(value) for value in box]
    crop = image_arr[y1:y2, x1:x2]
    if crop.shape[0] < 100 or crop.shape[1] < 100:
        return None

    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    mag = cv2.magnitude(gx, gy)
    local_mean = cv2.blur(gray, (15, 15))
    local_var = cv2.blur(gray * gray, (15, 15)) - local_mean * local_mean
    local_std = np.sqrt(np.maximum(local_var, 0))
    activity = ((mag > 22) | (local_std > 8)).astype(np.float32)

    vertical_profile = smooth(gx.mean(axis=0), 5)
    vertical_coverage = smooth((gx > 24).mean(axis=0), 5)
    horizontal_profile = smooth(gy.mean(axis=1), 5)
    horizontal_coverage = smooth((gy > 24).mean(axis=1), 5)

    height, width = gray.shape
    wide_crop = width / height >= 2.2
    mode = border_refine_mode(selected, reason, width, height)
    if not mode:
        return None

    cuts = {}
    for side, profile, side_coverage in (
        ("left", vertical_profile, vertical_coverage),
        ("right", vertical_profile, vertical_coverage),
        ("top", horizontal_profile, horizontal_coverage),
        ("bottom", horizontal_profile, horizontal_coverage),
    ):
        side_options = border_side_options(mode, side, wide_crop)
        if not side_options:
            continue
        cuts[side] = quiet_border_cut(
            crop,
            activity,
            profile,
            side_coverage,
            side,
            side_options["max_fraction"],
            side_options.get("dark_only", False),
            side_options.get("light_edge_ok", False),
        )
    accepted = {key: value for key, value in cuts.items() if value}
    accepted = filter_border_cuts(accepted, mode)
    if not accepted:
        return None

    non_dark_sides = [value for value in accepted.values() if value["kind"] != "dark_border"]
    dark_sides = [value for value in accepted.values() if value["kind"] == "dark_border"]
    if len(non_dark_sides) == 1 and not dark_sides:
        only = non_dark_sides[0]
        if only["distance"] > 0.045:
            return None

    left = accepted.get("left", {}).get("index", 0)
    top = accepted.get("top", {}).get("index", 0)
    right = accepted.get("right", {}).get("index", width)
    bottom = accepted.get("bottom", {}).get("index", height)
    if right <= left or bottom <= top:
        return None

    area_ratio = ((right - left) * (bottom - top)) / (width * height)
    min_area_ratio = {
        "dark_only": 0.76,
        "wide_art": 0.66,
        "framed_or_print": 0.70,
        "art_thin": 0.78,
    }[mode]
    if area_ratio < min_area_ratio or area_ratio > 0.995:
        return None

    insets = {
        "left": left / width,
        "top": top / height,
        "right": (width - right) / width,
        "bottom": (height - bottom) / height,
    }
    max_inset = {
        "dark_only": 0.22,
        "wide_art": 0.22,
        "framed_or_print": 0.13,
        "art_thin": 0.08,
    }[mode]
    if max(insets.values()) > max_inset:
        return None

    new_box = [x1 + left, y1 + top, x1 + right, y1 + bottom]
    if new_box == [x1, y1, x2, y2]:
        return None

    return {
        "box": new_box,
        "area_ratio": round(area_ratio, 6),
        "insets": {key: round(value, 6) for key, value in insets.items()},
        "mode": mode,
        "cuts": accepted,
    }


def border_refine_mode(selected, reason, width, height):
    prompt = (selected or {}).get("prompt") or ""
    no_candidate = "no_usable_sam3_candidate" in reason
    if no_candidate:
        return "dark_only"

    prompt_is_photo = any(
        term in prompt for term in ("photograph", "photo", "photographic", "printed image")
    )
    if "frame_refine" in reason or prompt_is_photo:
        return "framed_or_print"

    aspect = width / max(1, height)
    prompt_is_art = any(term in prompt for term in ("artwork", "painting", "drawing", "picture"))
    if prompt_is_art and aspect >= 2.2:
        return "wide_art"
    if prompt_is_art:
        return "art_thin"
    return None


def border_side_options(mode, side, wide_crop):
    if mode == "dark_only":
        return {"max_fraction": 0.22, "dark_only": True}
    if mode == "wide_art":
        if side not in {"top", "bottom"}:
            return None
        return {"max_fraction": 0.22 if wide_crop else 0.16}
    if mode == "framed_or_print":
        return {"max_fraction": 0.13, "light_edge_ok": True}
    if mode == "art_thin":
        return {"max_fraction": 0.08}
    return None


def filter_border_cuts(accepted, mode):
    if mode == "dark_only":
        return {
            side: cut for side, cut in accepted.items() if cut["kind"] == "dark_border"
        }

    if mode == "wide_art":
        vertical = {
            side: cut
            for side, cut in accepted.items()
            if side in {"top", "bottom"} and cut["kind"] != "dark_border"
        }
        if not vertical:
            return {}
        large = [cut for cut in vertical.values() if cut["distance"] > 0.06]
        if large and not all(side in vertical for side in ("top", "bottom")):
            return {}
        return vertical

    if mode == "framed_or_print":
        large_non_dark = [
            cut
            for cut in accepted.values()
            if cut["kind"] != "dark_border" and cut["distance"] > 0.055
        ]
        if len(large_non_dark) == 1 and len(accepted) == 1:
            return {}
        return accepted

    if mode == "art_thin":
        thin = {
            side: cut
            for side, cut in accepted.items()
            if cut["kind"] == "dark_border" or cut["distance"] <= 0.07
        }
        non_dark = [cut for cut in thin.values() if cut["kind"] != "dark_border"]
        if len(non_dark) == 1 and non_dark[0]["distance"] > 0.035:
            return {}
        return thin

    return {}


def quiet_border_cut(
    image,
    activity,
    profile,
    coverage,
    side,
    max_fraction,
    dark_only=False,
    light_edge_ok=False,
):
    axis_length = image.shape[1] if side in {"left", "right"} else image.shape[0]
    min_index = max(3, int(axis_length * 0.008))
    max_index = max(min_index + 1, int(axis_length * max_fraction))
    if side in {"left", "top"}:
        iterator = range(min_index, max_index)
    else:
        iterator = range(axis_length - min_index, axis_length - max_index, -1)

    candidates = []
    for index in iterator:
        low = max(0, index - 7)
        high = min(axis_length, index + 8)
        if profile[index] < np.max(profile[low:high]) - 1e-6:
            continue
        if profile[index] < 8 or coverage[index] < 0.035:
            continue
        candidate = score_quiet_border_cut(
            image,
            activity,
            index,
            side,
            profile[index],
            coverage[index],
            dark_only,
            light_edge_ok,
        )
        if candidate:
            candidates.append(candidate)

    if not candidates:
        return None
    return sorted(candidates, key=lambda item: item["rank"], reverse=True)[0]


def score_quiet_border_cut(
    image,
    activity,
    index,
    side,
    strength,
    line_coverage,
    dark_only=False,
    light_edge_ok=False,
):
    height, width = activity.shape
    axis_length = width if side in {"left", "right"} else height
    distance = index / axis_length if side in {"left", "top"} else (axis_length - index) / axis_length
    if distance <= 0:
        return None

    if side == "left":
        strip = image[:, :index]
        strip_activity = activity[:, :index]
        rest_activity = activity[:, index:]
    elif side == "right":
        strip = image[:, index:]
        strip_activity = activity[:, index:]
        rest_activity = activity[:, :index]
    elif side == "top":
        strip = image[:index, :]
        strip_activity = activity[:index, :]
        rest_activity = activity[index:, :]
    else:
        strip = image[index:, :]
        strip_activity = activity[index:, :]
        rest_activity = activity[:index, :]

    if strip.size == 0 or rest_activity.size == 0:
        return None

    strip_activity_mean = float(strip_activity.mean())
    rest_activity_mean = float(rest_activity.mean())
    quiet_delta = rest_activity_mean - strip_activity_mean
    strip_stats = color_stats(strip)
    is_dark = strip_stats["dark_frac"] >= 0.60 and line_coverage >= 0.035
    is_quiet = (
        strip_activity_mean < 0.46
        and (quiet_delta >= 0.075 or line_coverage >= 0.16 or strength >= 34)
    )
    is_thin_supported = (
        distance <= 0.055
        and strip_activity_mean < 0.60
        and (line_coverage >= 0.15 or strength >= 24)
    )
    is_light_print_edge = (
        light_edge_ok
        and distance <= 0.040
        and strip_stats["light_neutral_frac"] >= 0.74
        and strip_stats["dark_frac"] <= 0.035
        and line_coverage >= 0.15
        and strength >= 12
    )

    if dark_only and not is_dark:
        return None
    if not (is_dark or is_quiet or is_thin_supported or is_light_print_edge):
        return None
    if distance > 0.12 and not (is_dark or (quiet_delta >= 0.18 and strip_activity_mean < 0.44)):
        return None

    kind = "dark_border" if is_dark else "quiet_border"
    rank = (
        max(0.0, quiet_delta) * 2.0
        + float(line_coverage)
        + float(strength) / 100.0
        + (0.35 if is_dark else 0.0)
        + (0.20 if is_light_print_edge else 0.0)
        - distance * 0.45
    )
    return {
        "index": int(index),
        "distance": round(float(distance), 6),
        "strength": round(float(strength), 6),
        "coverage": round(float(line_coverage), 6),
        "strip_activity": round(strip_activity_mean, 6),
        "rest_activity": round(rest_activity_mean, 6),
        "quiet_delta": round(quiet_delta, 6),
        "kind": kind,
        "rank": round(rank, 6),
        "strip_stats": strip_stats,
    }


def color_stats(region):
    pixels = region.reshape(-1, 3).astype(np.float32)
    lum = 0.2126 * pixels[:, 0] + 0.7152 * pixels[:, 1] + 0.0722 * pixels[:, 2]
    maxc = pixels.max(axis=1)
    minc = pixels.min(axis=1)
    sat = np.zeros_like(maxc)
    np.divide(maxc - minc, maxc, out=sat, where=maxc != 0)
    return {
        "mean_lum": round(float(lum.mean()), 6),
        "std_lum": round(float(lum.std()), 6),
        "dark_frac": round(float((lum < 35).mean()), 6),
        "light_neutral_frac": round(float(((lum > 190) & (sat < 0.18)).mean()), 6),
    }


def nearest_line(profile, coverage, side):
    length = len(profile)
    if side == "leading":
        start = max(2, int(length * 0.010))
        end = max(start + 1, int(length * 0.16))
        iterator = range(start, end)
    else:
        start = min(length - 3, int(length * 0.84))
        end = min(length - 3, int(length * 0.990))
        iterator = range(end, start, -1)

    for index in iterator:
        low = max(start, index - 4)
        high = min(end, index + 5)
        if profile[index] < np.max(profile[low:high]):
            continue
        if coverage[index] < 0.20 or profile[index] < 45:
            continue
        return {
            "index": int(index),
            "coverage": round(float(coverage[index]), 6),
            "strength": round(float(profile[index]), 6),
        }
    return None


def border_stats(image_arr):
    height, width = image_arr.shape[:2]
    border = max(2, round(min(width, height) * 0.04))
    mask = np.zeros((height, width), dtype=bool)
    mask[:border, :] = True
    mask[-border:, :] = True
    mask[:, :border] = True
    mask[:, -border:] = True
    samples = image_arr[mask].astype(np.float32)
    lum = 0.2126 * samples[:, 0] + 0.7152 * samples[:, 1] + 0.0722 * samples[:, 2]
    maxc = samples.max(axis=1)
    minc = samples.min(axis=1)
    sat = np.zeros_like(maxc)
    np.divide(maxc - minc, maxc, out=sat, where=maxc != 0)
    all_pixels = image_arr.reshape(-1, 3).astype(np.float32)
    all_lum = 0.2126 * all_pixels[:, 0] + 0.7152 * all_pixels[:, 1] + 0.0722 * all_pixels[:, 2]
    return {
        "dark_frac": round(float((lum < 30).mean()), 6),
        "light_neutral_frac": round(float(((lum > 200) & (sat < 0.16)).mean()), 6),
        "mean_lum": round(float(all_lum.mean()), 6),
        "std_lum": round(float(all_lum.std()), 6),
    }


def smooth(values, radius):
    kernel = np.ones(radius * 2 + 1, dtype=np.float32) / (radius * 2 + 1)
    return np.convolve(values, kernel, mode="same")


def map_preview_box_to_source(box, preview_size, full_size):
    preview_width, preview_height = preview_size
    full_width, full_height = full_size
    scale_x = full_width / preview_width
    scale_y = full_height / preview_height
    x1, y1, x2, y2 = box
    left = max(0, math.floor(x1 * scale_x))
    top = max(0, math.floor(y1 * scale_y))
    right = min(full_width, math.ceil(x2 * scale_x))
    bottom = min(full_height, math.ceil(y2 * scale_y))
    return [left, top, max(1, right - left), max(1, bottom - top)]


def write_output(file_path, result, args):
    rel = relative_to_inputs(Path(file_path), args.input_dir)
    output_path = Path(args.output_dir) / rel
    output_path = output_path.with_suffix(".tif")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    box = result.get("source_box") if result.get("action") == "crop" else None
    if shutil.which("magick"):
        command = ["magick", str(file_path), "-auto-orient"]
        if box:
            left, top, width, height = box
            command += ["-crop", f"{width}x{height}+{left}+{top}", "+repage"]
        command += ["-compress", "LZW", str(output_path)]
        completed = subprocess.run(command, text=True, capture_output=True)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or completed.stdout.strip())
    else:
        image = ImageOps.exif_transpose(Image.open(file_path))
        if box:
            left, top, width, height = box
            image = image.crop((left, top, left + width, top + height))
        image.save(output_path, compression="tiff_lzw")
    return str(output_path)


def write_contact_sheets(results, contact_dir, sheet_size):
    sheets = []
    contact_path = Path(contact_dir)
    cells = []
    for result in results:
        if not result.get("ok"):
            continue
        cells.append(make_contact_cell(result))

    for sheet_index in range(0, len(cells), sheet_size):
        chunk = cells[sheet_index : sheet_index + sheet_size]
        if not chunk:
            continue
        cols = 4
        cell_width, cell_height = chunk[0].size
        rows = math.ceil(len(chunk) / cols)
        sheet = Image.new("RGB", (cols * cell_width, rows * cell_height), "white")
        for index, cell in enumerate(chunk):
            sheet.paste(cell, ((index % cols) * cell_width, (index // cols) * cell_height))
        path = contact_path / f"contact-sheet-{len(sheets) + 1:02d}.jpg"
        sheet.save(path, quality=92)
        sheets.append(str(path))
    return sheets


def make_contact_cell(result):
    image = ImageOps.exif_transpose(Image.open(result["file"])).convert("RGB")
    image.thumbnail(tuple(result["preview_size"]), Image.Resampling.LANCZOS)
    marked = image.copy()
    draw = ImageDraw.Draw(marked)
    if result["action"] == "crop" and result.get("final_box"):
        draw.rectangle(result["final_box"], outline=(255, 0, 200), width=3)
    if result.get("selected", {}).get("box") and result["action"] == "crop":
        draw.rectangle(result["selected"]["box"], outline=(0, 210, 210), width=2)

    crop = image
    if result["action"] == "crop" and result.get("final_box"):
        x1, y1, x2, y2 = result["final_box"]
        crop = image.crop((x1, y1, x2, y2))

    label = (
        f"{result['name']}\n{result['action']} {result.get('reason')} "
        f"{result.get('selected', {}).get('prompt', '')}"
    )
    marked.thumbnail((360, 220), Image.Resampling.LANCZOS)
    crop.thumbnail((360, 220), Image.Resampling.LANCZOS)
    cell = Image.new("RGB", (360, 545), "white")
    label_draw = ImageDraw.Draw(cell)
    label_draw.text((8, 8), label, fill="black")
    label_draw.text((8, 58), "original", fill=(90, 90, 90))
    label_draw.text((8, 295), "selected", fill=(90, 90, 90))
    cell.paste(marked, ((360 - marked.width) // 2, 75))
    cell.paste(crop, ((360 - crop.width) // 2, 315))
    return cell


def list_images(input_dirs, include):
    exts = {".tif", ".tiff", ".jpg", ".jpeg", ".png", ".webp"}
    files = []
    for raw_dir in input_dirs:
        root = Path(raw_dir)
        for path in sorted(root.iterdir()):
            if path.is_file() and path.suffix.lower() in exts:
                if include and path.name not in include:
                    continue
                files.append(path)
    return files


def relative_to_inputs(path, input_dirs):
    if not input_dirs:
        return Path(path.name)
    for raw_dir in input_dirs:
        root = Path(raw_dir)
        try:
            return path.relative_to(root)
        except ValueError:
            pass
    return Path(path.name)


def parse_include(value):
    if not value:
        return None
    return {item.strip() for item in value.split(",") if item.strip()}


def count_by(rows, key):
    counts = {}
    for row in rows:
        value = row.get(key) or "none"
        counts[value] = counts.get(value, 0) + 1
    return counts


def write_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=2) + "\n")


def resolve_device(requested):
    if requested == "mps" and torch.backends.mps.is_available():
        return torch.device("mps")
    if requested == "cuda" and torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def clamp(value, low, high):
    return min(high, max(low, value))


if __name__ == "__main__":
    main()
