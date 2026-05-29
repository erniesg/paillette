#!/usr/bin/env python3
"""Serve a local NGS crop review page with a point-prompt SAM3 endpoint."""

from __future__ import annotations

import argparse
import base64
import io
import json
import mimetypes
import os
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import unquote, unquote_to_bytes, urlparse
from urllib.request import Request, urlopen

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

DEFAULT_SAM3_REPO = "/Users/erniesg/Downloads/paillette-sam3-apple"
DEFAULT_CHECKPOINT = (
    "/Users/erniesg/.cache/huggingface/hub/models--facebook--sam3/"
    "snapshots/3c879f39826c281e95690f02c7821c4de09afae7/sam3.pt"
)
DEFAULT_BPE = "/Users/erniesg/Downloads/paillette-sam3-apple/assets/bpe_simple_vocab_16e6.txt.gz"
REMOTE_EXTRACT_PROMPTS = {
    "content": "artwork image content, painting surface, print, drawing, photograph; exclude frame, mat, mount, wall, label",
    "object": "visible artwork object, painting, framed artwork, mounted artwork, scroll, print, photograph",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, help="Review directory to serve.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4189)
    parser.add_argument("--sam3-repo", default=DEFAULT_SAM3_REPO)
    parser.add_argument("--checkpoint", default=DEFAULT_CHECKPOINT)
    parser.add_argument("--bpe", default=DEFAULT_BPE)
    parser.add_argument("--device", default="auto", choices=["auto", "mps", "cuda", "cpu"])
    parser.add_argument("--max-dim", type=int, default=1000)
    return parser.parse_args()


def resolve_device(raw: str) -> str:
    if raw != "auto":
        return raw
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def clamp_box(box: list[int], width: int, height: int) -> list[int]:
    x1, y1, x2, y2 = [int(round(value)) for value in box]
    x1 = max(0, min(width - 1, x1))
    y1 = max(0, min(height - 1, y1))
    x2 = max(x1 + 1, min(width, x2))
    y2 = max(y1 + 1, min(height, y2))
    return [x1, y1, x2, y2]


def box_contains_point(box: list[int], point: dict) -> bool:
    x1, y1, x2, y2 = box
    return x1 <= point["x"] <= x2 and y1 <= point["y"] <= y2


def map_box(box: list[int], from_size: tuple[int, int], to_size: tuple[int, int]) -> list[int]:
    from_w, from_h = from_size
    to_w, to_h = to_size
    x1, y1, x2, y2 = box
    return clamp_box(
        [
            round(x1 * to_w / from_w),
            round(y1 * to_h / from_h),
            round(x2 * to_w / from_w),
            round(y2 * to_h / from_h),
        ],
        to_w,
        to_h,
    )


def point_intent_box(points: list[dict], width: int, height: int) -> list[int]:
    positive = [point for point in points if int(point.get("label", 1)) == 1]
    source = positive if len(positive) >= 2 else points
    if len(source) < 2:
        raise ValueError("Add at least two points to snap a rectangle.")

    xs = [max(0.0, min(float(width), float(point["x"]))) for point in source]
    ys = [max(0.0, min(float(height), float(point["y"]))) for point in source]
    box = [min(xs), min(ys), max(xs), max(ys)]
    if box[2] - box[0] < 8 or box[3] - box[1] < 8:
        raise ValueError("Point rectangle is too small to snap.")
    return clamp_box(box, width, height)


def expanded_span(start: int, end: int, limit: int, fraction: float = 0.18, minimum: int = 18) -> tuple[int, int]:
    size = max(1, end - start)
    pad = max(minimum, int(round(size * fraction)))
    return max(0, start - pad), min(limit, end + pad)


def side_search_radius(size: int, limit: int) -> int:
    return max(24, min(92, int(round(size * 0.34)), int(round(limit * 0.22))))


def choose_axis_line(
    gray,
    gradient,
    estimate: int,
    radius: int,
    span: tuple[int, int],
    limit: int,
    orientation: str,
    side: str,
) -> dict:
    import numpy as np

    lo = max(0, estimate - radius)
    hi = min(limit - 1, estimate + radius)
    span_lo, span_hi = span
    span_lo = max(0, min(span_lo, span_hi - 1))
    span_hi = min(gray.shape[0 if orientation == "vertical" else 1], max(span_hi, span_lo + 1))
    grad_threshold = 24.0
    candidates = []

    for pos in range(lo, hi + 1):
        if orientation == "vertical":
            line = gradient[span_lo:span_hi, max(0, pos - 1) : min(limit, pos + 2)]
            before = gray[span_lo:span_hi, max(0, pos - 5) : max(0, pos - 1)]
            after = gray[span_lo:span_hi, min(limit, pos + 1) : min(limit, pos + 5)]
        else:
            line = gradient[max(0, pos - 1) : min(limit, pos + 2), span_lo:span_hi]
            before = gray[max(0, pos - 5) : max(0, pos - 1), span_lo:span_hi]
            after = gray[min(limit, pos + 1) : min(limit, pos + 5), span_lo:span_hi]

        if line.size == 0:
            continue

        edge = float(line.mean())
        coverage = float((line > grad_threshold).mean())
        contrast = 0.0
        if before.size and after.size:
            contrast = abs(float(before.mean()) - float(after.mean()))

        distance = abs(pos - estimate) / max(1, radius)
        edge_norm = min(edge / 120.0, 2.0)
        contrast_norm = min(contrast / 70.0, 2.0)
        score = edge_norm * 0.42 + coverage * 0.85 + contrast_norm * 0.36 - distance * 0.22
        candidates.append(
            {
                "position": int(pos),
                "score": round(score, 6),
                "edge": round(edge, 6),
                "coverage": round(coverage, 6),
                "contrast": round(contrast, 6),
                "distance": round(distance, 6),
            }
        )

    candidates.sort(key=lambda row: row["score"], reverse=True)
    strong = [
        row
        for row in candidates
        if row["coverage"] >= 0.32 or (row["edge"] >= 70 and row["contrast"] >= 24)
    ]
    if strong:
        selected = strong[0]
        estimate_to_selected = abs(selected["position"] - estimate)
        inward = (
            (side in {"left", "top"} and selected["position"] > estimate)
            or (side in {"right", "bottom"} and selected["position"] < estimate)
        )
        if inward and estimate_to_selected >= 6:
            lo = min(estimate, selected["position"])
            hi = max(estimate, selected["position"])
            if orientation == "vertical":
                strip = gray[span_lo:span_hi, lo:hi]
                strip_gradient = gradient[span_lo:span_hi, lo:hi]
            else:
                strip = gray[lo:hi, span_lo:span_hi]
                strip_gradient = gradient[lo:hi, span_lo:span_hi]

            if strip.size and strip_gradient.size:
                quiet_border = {
                    "mean_luma": round(float(np.mean(strip)), 6),
                    "std_luma": round(float(np.std(strip)), 6),
                    "dark_frac": round(float(np.mean(strip < 80)), 6),
                    "edge": round(float(np.mean(strip_gradient)), 6),
                }
                if (
                    quiet_border["mean_luma"] >= 150
                    and quiet_border["dark_frac"] <= 0.04
                    and quiet_border["std_luma"] <= 32
                    and quiet_border["edge"] <= 90
                ):
                    return {
                        "position": int(round(estimate)),
                        "kind": "point_estimate_quiet_border",
                        "selected": selected,
                        "quietBorder": quiet_border,
                        "candidates": candidates[:8],
                    }
        return {
            "position": selected["position"],
            "kind": "edge",
            "selected": selected,
            "candidates": candidates[:8],
        }

    edge_threshold = max(14, int(round(limit * 0.06)))
    if side in {"left", "top"} and estimate <= edge_threshold:
        return {
            "position": 0,
            "kind": "image_edge",
            "selected": None,
            "candidates": candidates[:8],
        }
    if side in {"right", "bottom"} and limit - estimate <= edge_threshold:
        return {
            "position": limit,
            "kind": "image_edge",
            "selected": None,
            "candidates": candidates[:8],
        }

    return {
        "position": int(round(estimate)),
        "kind": "point_estimate",
        "selected": None,
        "candidates": candidates[:8],
    }


def load_review_source_image(review_dir: Path, item_id: str, source_url: str | None = None):
    from PIL import Image, ImageOps

    if source_url:
        parsed = urlparse(source_url)
        if parsed.scheme in {"http", "https"}:
            local_path = review_dir / unquote(parsed.path).lstrip("/")
        elif parsed.scheme == "file":
            local_path = Path(unquote(parsed.path))
        else:
            local_path = review_dir / unquote((parsed.path or source_url).split("?", 1)[0]).lstrip("/")

        try:
            resolved = local_path.resolve()
            if resolved.exists() and resolved.is_relative_to(review_dir):
                return ImageOps.exif_transpose(Image.open(resolved)).convert("RGB")
        except (OSError, RuntimeError):
            pass

        return load_image_from_url(source_url)

    source_path = review_dir / "assets" / f"{item_id}-original.jpg"
    if not source_path.exists():
        raise FileNotFoundError(f"Missing original asset for {item_id}")
    return ImageOps.exif_transpose(Image.open(source_path)).convert("RGB")


def snap_rectangle(review_dir: Path, item_id: str, points: list[dict], source_url: str | None = None) -> dict:
    import cv2
    import numpy as np
    from PIL import ImageDraw

    if not points:
        raise ValueError("Add rough corner or edge points before snapping.")

    started = time.time()
    image = load_review_source_image(review_dir, item_id, source_url)
    width, height = image.size
    coarse_box = point_intent_box(points, width, height)
    cx1, cy1, cx2, cy2 = coarse_box

    arr = np.asarray(image)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))

    x_span = expanded_span(cx1, cx2, width)
    y_span = expanded_span(cy1, cy2, height)
    x_radius = side_search_radius(cx2 - cx1, width)
    y_radius = side_search_radius(cy2 - cy1, height)

    left = choose_axis_line(gray, gx, cx1, x_radius, y_span, width, "vertical", "left")
    right = choose_axis_line(gray, gx, cx2, x_radius, y_span, width, "vertical", "right")
    top = choose_axis_line(gray, gy, cy1, y_radius, x_span, height, "horizontal", "top")
    bottom = choose_axis_line(gray, gy, cy2, y_radius, x_span, height, "horizontal", "bottom")

    snapped_box = clamp_box(
        [left["position"], top["position"], right["position"], bottom["position"]],
        width,
        height,
    )
    min_w = max(16, int(round((cx2 - cx1) * 0.18)))
    min_h = max(16, int(round((cy2 - cy1) * 0.18)))
    if snapped_box[2] - snapped_box[0] < min_w or snapped_box[3] - snapped_box[1] < min_h:
        snapped_box = coarse_box

    crop = image.crop(tuple(snapped_box))
    stamp = int(time.time() * 1000)
    crop_url_path = f"assets/{item_id}-snap-crop.jpg"
    crop.save(review_dir / crop_url_path, format="JPEG", quality=94)

    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    draw.rectangle(coarse_box, outline=(255, 156, 45), width=3)
    draw.rectangle(snapped_box, outline=(247, 216, 74), width=5)
    for point in points[:32]:
        x = int(round(float(point["x"])))
        y = int(round(float(point["y"])))
        label = int(point.get("label", 1))
        color = (35, 192, 107) if label == 1 else (255, 90, 106)
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=color, outline=(255, 255, 255), width=2)
    overlay_url_path = f"assets/{item_id}-snap-overlay.jpg"
    overlay.save(review_dir / overlay_url_path, format="JPEG", quality=92)

    return {
        "ok": True,
        "id": item_id,
        "method": "snap-rectangle",
        "box": snapped_box,
        "coarseBox": coarse_box,
        "cropUrl": f"{crop_url_path}?v={stamp}",
        "overlayUrl": f"{overlay_url_path}?v={stamp}",
        "diagnostics": {
            "left": left,
            "right": right,
            "top": top,
            "bottom": bottom,
            "xRadius": x_radius,
            "yRadius": y_radius,
        },
        "seconds": round(time.time() - started, 3),
    }


def edge_projection_boundary(edge_density, direction: str) -> int:
    import numpy as np

    length = len(edge_density)
    start = 0 if direction == "forward" else length - 1
    end = length if direction == "forward" else -1
    step = 1 if direction == "forward" else -1

    density = np.asarray(edge_density, dtype=np.float32)
    max_density = float(density.max()) if density.size else 0.0
    median_density = float(np.median(density)) if density.size else 0.0
    avg_density = float(density.sum() / max(1, length))
    if max_density < 5 or avg_density < 1:
        return 0 if direction == "forward" else length - 1

    threshold = max(median_density * 1.5, max_density * 0.3)
    peak_found = False
    peak_position = start
    boundary = start
    index = start
    while index != end:
        current = float(edge_density[index])
        if current > threshold and not peak_found:
            peak_found = True
            peak_position = index

        if peak_found and abs(index - peak_position) > 2 and current < threshold * 0.4:
            boundary = index
            break
        index += step

    if not peak_found:
        boundary = 0 if direction == "forward" else length - 1
    return int(boundary)


def frame_detector_confidence(box: list[int], width: int, height: int, edge_strength: float) -> float:
    x1, y1, x2, y2 = box
    crop_ratio = ((x2 - x1) * (y2 - y1)) / max(1, width * height)
    confidence = 0.25

    if 0.5 <= crop_ratio <= 0.85:
        confidence += 0.40
    elif 0.3 <= crop_ratio < 0.5:
        confidence += 0.30
    elif 0.85 < crop_ratio <= 0.96:
        confidence += 0.28
    elif 0.96 < crop_ratio <= 0.99:
        confidence += 0.18
    elif crop_ratio > 0.99:
        confidence -= 0.4

    center_x = x1 + (x2 - x1) / 2
    center_y = y1 + (y2 - y1) / 2
    center_offset_x = abs(center_x - width / 2) / max(1, width / 2)
    center_offset_y = abs(center_y - height / 2) / max(1, height / 2)
    if center_offset_x < 0.1 and center_offset_y < 0.1:
        confidence += 0.15
    elif center_offset_x < 0.2 and center_offset_y < 0.2:
        confidence += 0.08
    elif center_offset_x > 0.4 or center_offset_y > 0.4:
        confidence -= 0.15

    original_aspect = width / max(1, height)
    cropped_aspect = (x2 - x1) / max(1, y2 - y1)
    aspect_diff = abs(original_aspect - cropped_aspect) / max(0.001, original_aspect)
    if aspect_diff < 0.1:
        confidence += 0.1
    elif aspect_diff < 0.2:
        confidence += 0.05
    elif aspect_diff > 0.3:
        confidence -= 0.2

    if edge_strength < 0.003 and crop_ratio > 0.98:
        confidence -= 0.7
    elif edge_strength < 0.008 and crop_ratio > 0.96:
        confidence -= 0.45
    elif edge_strength < 0.02 and crop_ratio > 0.90:
        confidence -= 0.25
    elif edge_strength < 0.02 and crop_ratio <= 0.90:
        confidence -= 0.10
    elif edge_strength > 0.15:
        confidence += 0.1

    return max(0.0, min(1.0, confidence))


def api_frame_detector(review_dir: Path, item_id: str, source_url: str | None = None) -> dict:
    import cv2
    import numpy as np
    from PIL import ImageDraw

    started = time.time()
    image = load_review_source_image(review_dir, item_id, source_url)
    width, height = image.size
    gray = np.asarray(image.convert("L")).astype(np.float32)
    gray = cv2.GaussianBlur(gray, (0, 0), sigmaX=2.5, sigmaY=2.5)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    edge = (cv2.magnitude(gx, gy) > 50).astype(np.uint8)

    row_edges = edge.sum(axis=1)
    col_edges = edge.sum(axis=0)
    left = edge_projection_boundary(col_edges, "forward")
    right = edge_projection_boundary(col_edges, "backward")
    top = edge_projection_boundary(row_edges, "forward")
    bottom = edge_projection_boundary(row_edges, "backward")

    border_x = int(width * 0.1)
    border_y = int(height * 0.1)
    interior = edge[border_y : height - border_y, border_x : width - border_x]
    edge_strength = float(interior.mean()) if interior.size else 0.0
    valid_geometry = right > left and bottom > top
    box = clamp_box([left, top, right, bottom], width, height) if valid_geometry else [0, 0, width, height]
    confidence = frame_detector_confidence(box, width, height, edge_strength) if valid_geometry else 0.0
    crop_ratio = ((box[2] - box[0]) * (box[3] - box[1])) / max(1, width * height)
    has_frame = valid_geometry and confidence >= 0.5 and 0.3 <= crop_ratio <= 0.99

    stamp = int(time.time() * 1000)
    crop_url_path = f"assets/{item_id}-api-frame-detector-crop.jpg"
    overlay_url_path = f"assets/{item_id}-api-frame-detector-overlay.jpg"
    if has_frame:
        image.crop(tuple(box)).save(review_dir / crop_url_path, format="JPEG", quality=94)
    else:
        image.save(review_dir / crop_url_path, format="JPEG", quality=94)

    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    draw.rectangle(box, outline=(255, 156, 45), width=5)
    overlay.save(review_dir / overlay_url_path, format="JPEG", quality=92)

    return {
        "ok": True,
        "id": item_id,
        "method": "api-frame-detector",
        "box": box,
        "hasFrame": has_frame,
        "confidence": round(confidence, 6),
        "cropRatio": round(crop_ratio, 6),
        "edgeStrength": round(edge_strength, 6),
        "cropUrl": f"{crop_url_path}?v={stamp}",
        "overlayUrl": f"{overlay_url_path}?v={stamp}",
        "diagnostics": {
            "rawBox": [int(left), int(top), int(right), int(bottom)],
            "validGeometry": valid_geometry,
            "rowMax": int(row_edges.max()) if len(row_edges) else 0,
            "colMax": int(col_edges.max()) if len(col_edges) else 0,
            "rowMedian": round(float(np.median(row_edges)), 6) if len(row_edges) else 0,
            "colMedian": round(float(np.median(col_edges)), 6) if len(col_edges) else 0,
        },
        "seconds": round(time.time() - started, 3),
    }


def crop_review_box(
    review_dir: Path,
    item_id: str,
    box: list[int],
    points: list[dict] | None = None,
    source_url: str | None = None,
) -> dict:
    from PIL import ImageDraw

    started = time.time()
    image = load_review_source_image(review_dir, item_id, source_url)
    width, height = image.size
    source_box = clamp_box(box, width, height)

    crop = image.crop(tuple(source_box))
    stamp = int(time.time() * 1000)
    crop_url_path = f"assets/{item_id}-manual-crop.jpg"
    crop.save(review_dir / crop_url_path, format="JPEG", quality=94)

    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    draw.rectangle(source_box, outline=(255, 156, 45), width=5)
    for point in (points or [])[:32]:
        x = int(round(float(point["x"])))
        y = int(round(float(point["y"])))
        label = int(point.get("label", 1))
        color = (35, 192, 107) if label == 1 else (255, 90, 106)
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=color, outline=(255, 255, 255), width=2)
    overlay_url_path = f"assets/{item_id}-manual-overlay.jpg"
    overlay.save(review_dir / overlay_url_path, format="JPEG", quality=92)

    return {
        "ok": True,
        "id": item_id,
        "method": "manual-rectangle",
        "box": source_box,
        "cropUrl": f"{crop_url_path}?v={stamp}",
        "overlayUrl": f"{overlay_url_path}?v={stamp}",
        "seconds": round(time.time() - started, 3),
    }


def ordered_quad_from_points(points: list[dict]) -> list[list[float]]:
    import cv2
    import numpy as np

    positive = [
        [float(point["x"]), float(point["y"])]
        for point in points
        if int(point.get("label", 1)) == 1 and "x" in point and "y" in point
    ]
    if len(positive) < 4:
        raise ValueError("Add four positive corner points to use perspective straightening.")

    pts = np.asarray(positive, dtype=np.float32)
    sums = pts.sum(axis=1)
    diffs = pts[:, 0] - pts[:, 1]
    ordered = np.asarray(
        [
            pts[int(np.argmin(sums))],
            pts[int(np.argmax(diffs))],
            pts[int(np.argmax(sums))],
            pts[int(np.argmin(diffs))],
        ],
        dtype=np.float32,
    )

    if len({(round(float(x), 2), round(float(y), 2)) for x, y in ordered}) < 4:
        rect = cv2.minAreaRect(pts)
        ordered = cv2.boxPoints(rect).astype(np.float32)
        y_sorted = ordered[np.argsort(ordered[:, 1])]
        top = y_sorted[:2][np.argsort(y_sorted[:2, 0])]
        bottom = y_sorted[2:][np.argsort(y_sorted[2:, 0])]
        ordered = np.asarray([top[0], top[1], bottom[1], bottom[0]], dtype=np.float32)

    return [[float(x), float(y)] for x, y in ordered]


def line_coeff(p1, p2):
    import math

    x1, y1 = float(p1[0]), float(p1[1])
    x2, y2 = float(p2[0]), float(p2[1])
    a = y1 - y2
    b = x2 - x1
    c = x1 * y2 - x2 * y1
    norm = math.hypot(a, b)
    if norm <= 1e-6:
        return None
    return [a / norm, b / norm, c / norm]


def line_intersection(l1, l2):
    if not l1 or not l2:
        return None
    a1, b1, c1 = l1
    a2, b2, c2 = l2
    denom = a1 * b2 - a2 * b1
    if abs(denom) <= 1e-6:
        return None
    x = (b1 * c2 - b2 * c1) / denom
    y = (c1 * a2 - c2 * a1) / denom
    return [float(x), float(y)]


def parallel_angle_delta(a: float, b: float) -> float:
    return abs(((a - b + 90.0) % 180.0) - 90.0)


def segment_angle(p1, p2) -> float:
    import math

    return math.degrees(math.atan2(float(p2[1]) - float(p1[1]), float(p2[0]) - float(p1[0])))


def polygon_area(quad: list[list[float]]) -> float:
    area = 0.0
    for index, point in enumerate(quad):
        nxt = quad[(index + 1) % len(quad)]
        area += point[0] * nxt[1] - nxt[0] * point[1]
    return abs(area) / 2.0


def quad_bounds(quad: list[list[float]], width: int, height: int) -> list[int]:
    xs = [point[0] for point in quad]
    ys = [point[1] for point in quad]
    return clamp_box([int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))], width, height)


def refine_quad_with_edges(image, rough_quad: list[list[float]]) -> tuple[list[list[float]], dict]:
    import cv2
    import numpy as np

    width, height = image.size
    rough_box = quad_bounds(rough_quad, width, height)
    pad = max(12, int(round(max(rough_box[2] - rough_box[0], rough_box[3] - rough_box[1]) * 0.08)))
    rx1 = max(0, rough_box[0] - pad)
    ry1 = max(0, rough_box[1] - pad)
    rx2 = min(width, rough_box[2] + pad)
    ry2 = min(height, rough_box[3] + pad)
    if rx2 - rx1 < 24 or ry2 - ry1 < 24:
        return rough_quad, {"used": False, "reason": "roi too small"}

    arr = np.asarray(image)
    roi = arr[ry1:ry2, rx1:rx2]
    gray = cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(gray, 45, 145)
    min_side = max(1, min(rx2 - rx1, ry2 - ry1))
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(24, int(round(min_side * 0.10))),
        minLineLength=max(24, int(round(min_side * 0.30))),
        maxLineGap=max(8, int(round(min_side * 0.05))),
    )
    if lines is None:
        return rough_quad, {"used": False, "reason": "no hough lines"}

    segments = []
    for raw in lines[:256]:
        x1, y1, x2, y2 = [int(v) for v in raw[0]]
        p1 = [x1 + rx1, y1 + ry1]
        p2 = [x2 + rx1, y2 + ry1]
        length = float(np.hypot(p2[0] - p1[0], p2[1] - p1[1]))
        if length < 16:
            continue
        segments.append(
            {
                "p1": p1,
                "p2": p2,
                "line": line_coeff(p1, p2),
                "angle": segment_angle(p1, p2),
                "mid": [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2],
                "length": length,
            }
        )

    side_defs = {
        "top": (rough_quad[0], rough_quad[1]),
        "right": (rough_quad[1], rough_quad[2]),
        "bottom": (rough_quad[3], rough_quad[2]),
        "left": (rough_quad[0], rough_quad[3]),
    }
    selected = {}
    diagnostics = {"used": False, "roi": [rx1, ry1, rx2, ry2], "segments": len(segments), "sides": {}}
    for side, (p1, p2) in side_defs.items():
        rough_line = line_coeff(p1, p2)
        rough_angle = segment_angle(p1, p2)
        rough_mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
        best = None
        for segment in segments:
            if not segment["line"] or not rough_line:
                continue
            angle_delta = parallel_angle_delta(segment["angle"], rough_angle)
            if angle_delta > 18:
                continue
            distance = abs(
                rough_line[0] * segment["mid"][0]
                + rough_line[1] * segment["mid"][1]
                + rough_line[2]
            )
            midpoint_delta = float(np.hypot(segment["mid"][0] - rough_mid[0], segment["mid"][1] - rough_mid[1]))
            score = segment["length"] - distance * 4.2 - angle_delta * 3.0 - midpoint_delta * 0.18
            candidate = {
                "line": segment["line"],
                "score": score,
                "distance": distance,
                "angleDelta": angle_delta,
                "length": segment["length"],
                "points": [segment["p1"], segment["p2"]],
            }
            if best is None or candidate["score"] > best["score"]:
                best = candidate
        if best:
            selected[side] = best["line"]
            diagnostics["sides"][side] = {
                "score": round(float(best["score"]), 6),
                "distance": round(float(best["distance"]), 6),
                "angleDelta": round(float(best["angleDelta"]), 6),
                "length": round(float(best["length"]), 6),
                "points": best["points"],
            }
        else:
            diagnostics["sides"][side] = None

    if not all(side in selected for side in ("top", "right", "bottom", "left")):
        diagnostics["reason"] = "missing side line"
        return rough_quad, diagnostics

    refined = [
        line_intersection(selected["top"], selected["left"]),
        line_intersection(selected["top"], selected["right"]),
        line_intersection(selected["bottom"], selected["right"]),
        line_intersection(selected["bottom"], selected["left"]),
    ]
    if any(point is None for point in refined):
        diagnostics["reason"] = "parallel side lines"
        return rough_quad, diagnostics

    refined = [[max(0.0, min(float(width), p[0])), max(0.0, min(float(height), p[1]))] for p in refined]
    rough_area = max(1.0, polygon_area(rough_quad))
    refined_area = polygon_area(refined)
    if refined_area < rough_area * 0.45 or refined_area > rough_area * 1.85:
        diagnostics["reason"] = "refined area out of range"
        diagnostics["roughArea"] = round(rough_area, 6)
        diagnostics["refinedArea"] = round(refined_area, 6)
        return rough_quad, diagnostics

    diagnostics["used"] = True
    diagnostics["roughArea"] = round(rough_area, 6)
    diagnostics["refinedArea"] = round(refined_area, 6)
    return refined, diagnostics


def warp_quad(image, quad: list[list[float]]):
    import cv2
    import numpy as np
    from PIL import Image

    pts = np.asarray(quad, dtype=np.float32)
    tl, tr, br, bl = pts
    width_a = float(np.linalg.norm(br - bl))
    width_b = float(np.linalg.norm(tr - tl))
    height_a = float(np.linalg.norm(tr - br))
    height_b = float(np.linalg.norm(tl - bl))
    output_w = max(8, int(round(max(width_a, width_b))))
    output_h = max(8, int(round(max(height_a, height_b))))
    dst = np.asarray(
        [[0, 0], [output_w - 1, 0], [output_w - 1, output_h - 1], [0, output_h - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(pts, dst)
    warped = cv2.warpPerspective(
        np.asarray(image),
        matrix,
        (output_w, output_h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return Image.fromarray(warped), {"width": output_w, "height": output_h}


def detect_crop_skew_angle(crop) -> tuple[float, dict]:
    import cv2
    import numpy as np

    gray = cv2.cvtColor(np.asarray(crop), cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(gray, 45, 145)
    height, width = gray.shape
    min_side = max(1, min(width, height))
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(20, int(round(min_side * 0.12))),
        minLineLength=max(24, int(round(min_side * 0.35))),
        maxLineGap=max(8, int(round(min_side * 0.05))),
    )
    if lines is None:
        return 0.0, {"lines": 0, "angles": []}

    angles = []
    for raw in lines[:128]:
        x1, y1, x2, y2 = [float(v) for v in raw[0]]
        length = float(np.hypot(x2 - x1, y2 - y1))
        if length < 16:
            continue
        angle = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        while angle <= -90:
            angle += 180
        while angle > 90:
            angle -= 180
        if abs(angle) <= 16:
            angles.append(angle)
    if not angles:
        return 0.0, {"lines": int(len(lines)), "angles": []}
    median = float(np.median(np.asarray(angles, dtype=np.float32)))
    if abs(median) < 0.2:
        median = 0.0
    return median, {"lines": int(len(lines)), "angles": [round(float(v), 4) for v in angles[:24]]}


def median_border_color(image):
    import numpy as np

    arr = np.asarray(image)
    if arr.size == 0:
        return (245, 245, 245)
    strips = [
        arr[: max(1, arr.shape[0] // 20), :, :],
        arr[-max(1, arr.shape[0] // 20) :, :, :],
        arr[:, : max(1, arr.shape[1] // 20), :],
        arr[:, -max(1, arr.shape[1] // 20) :, :],
    ]
    pixels = np.concatenate([strip.reshape(-1, 3) for strip in strips if strip.size], axis=0)
    color = np.median(pixels, axis=0)
    return tuple(int(round(v)) for v in color)


def straighten_review_source(
    review_dir: Path,
    item_id: str,
    angle_degrees: float,
    source_url: str | None = None,
) -> dict:
    from PIL import Image

    started = time.time()
    source_path = review_dir / "assets" / f"{item_id}-original.jpg"
    if not source_path.exists():
        raise FileNotFoundError(f"Missing original asset for {item_id}")

    image = load_review_source_image(review_dir, item_id, source_url)
    angle = float(angle_degrees)
    fill = median_border_color(image)
    if abs(angle) > 0:
        image = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=fill)

    stamp = int(time.time() * 1000)
    source_url_path = f"assets/{item_id}-source-straighten-{stamp}.jpg"
    image.save(review_dir / source_url_path, format="JPEG", quality=94)
    width, height = image.size
    return {
        "ok": True,
        "id": item_id,
        "method": "source-straighten",
        "mode": "source-rotation",
        "angleDegrees": round(angle, 6),
        "sourceUrl": f"{source_url_path}?v={stamp}",
        "sourceOriginalUrl": source_url or f"assets/{item_id}-original.jpg",
        "width": width,
        "height": height,
        "box": [0, 0, width, height],
        "diagnostics": {"fill": fill},
        "seconds": round(time.time() - started, 3),
    }


def straighten_review_crop(
    review_dir: Path,
    item_id: str,
    box: list[int] | None = None,
    points: list[dict] | None = None,
    angle_degrees: float | None = None,
    source_url: str | None = None,
) -> dict:
    from PIL import Image, ImageDraw

    started = time.time()
    image = load_review_source_image(review_dir, item_id, source_url)
    width, height = image.size
    points = points or []
    source_box = clamp_box(box or [0, 0, width, height], width, height)
    positive_count = sum(1 for point in points if int(point.get("label", 1)) == 1)
    mode = "rotation-box"
    diagnostics = {}
    quad = None

    if angle_degrees is not None:
        crop = image.crop(tuple(source_box))
        angle = float(angle_degrees)
        fill = median_border_color(crop)
        if abs(angle) > 0:
            crop = crop.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=fill)
        quad = [
            [float(source_box[0]), float(source_box[1])],
            [float(source_box[2]), float(source_box[1])],
            [float(source_box[2]), float(source_box[3])],
            [float(source_box[0]), float(source_box[3])],
        ]
        mode = "manual-rotation"
        diagnostics = {"angleDegrees": round(float(angle), 6), "fill": fill}
    elif positive_count >= 4:
        rough_quad = ordered_quad_from_points(points)
        refined_quad, edge_diagnostics = refine_quad_with_edges(image, rough_quad)
        quad = refined_quad
        source_box = quad_bounds(refined_quad, width, height)
        crop, warp_info = warp_quad(image, refined_quad)
        mode = "perspective-points"
        diagnostics = {
            "roughQuad": [[round(v, 3) for v in point] for point in rough_quad],
            "edgeRefine": edge_diagnostics,
            "warp": warp_info,
        }
    else:
        crop = image.crop(tuple(source_box))
        angle, skew_diagnostics = detect_crop_skew_angle(crop)
        fill = median_border_color(crop)
        if abs(angle) > 0:
            crop = crop.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=fill)
        quad = [
            [float(source_box[0]), float(source_box[1])],
            [float(source_box[2]), float(source_box[1])],
            [float(source_box[2]), float(source_box[3])],
            [float(source_box[0]), float(source_box[3])],
        ]
        diagnostics = {"angleDegrees": round(float(angle), 6), "skew": skew_diagnostics, "fill": fill}

    stamp = int(time.time() * 1000)
    crop_url_path = f"assets/{item_id}-straighten-{stamp}-crop.jpg"
    overlay_url_path = f"assets/{item_id}-straighten-{stamp}-overlay.jpg"
    crop.save(review_dir / crop_url_path, format="JPEG", quality=94)

    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    draw.rectangle(source_box, outline=(247, 216, 74), width=3)
    if quad:
        polygon = [(float(x), float(y)) for x, y in quad]
        draw.line(polygon + [polygon[0]], fill=(57, 213, 232), width=5)
    for point in points[:32]:
        x = int(round(float(point["x"])))
        y = int(round(float(point["y"])))
        label = int(point.get("label", 1))
        color = (35, 192, 107) if label == 1 else (255, 90, 106)
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=color, outline=(255, 255, 255), width=2)
    overlay.save(review_dir / overlay_url_path, format="JPEG", quality=92)

    return {
        "ok": True,
        "id": item_id,
        "method": "auto-straighten",
        "mode": mode,
        "box": source_box,
        "quad": [[round(float(x), 3), round(float(y), 3)] for x, y in (quad or [])],
        "positivePoints": positive_count,
        "cropUrl": f"{crop_url_path}?v={stamp}",
        "overlayUrl": f"{overlay_url_path}?v={stamp}",
        "diagnostics": diagnostics,
        "seconds": round(time.time() - started, 3),
    }


def load_image_from_url(image_url: str):
    from PIL import Image, ImageOps

    if not image_url:
        raise ValueError("Missing imageUrl.")

    if image_url.startswith("data:"):
        header, data = image_url.split(",", 1)
        if ";base64" in header:
            raw = base64.b64decode(data)
        else:
            raw = unquote_to_bytes(data)
    else:
        parsed = urlparse(image_url)
        if parsed.scheme in {"http", "https"}:
            request = Request(image_url, headers={"User-Agent": "paillette-local-sam3-review/1.0"})
            with urlopen(request, timeout=90) as response:
                raw = response.read()
        elif parsed.scheme == "file":
            raw = Path(unquote(parsed.path)).read_bytes()
        else:
            raw = Path(image_url).read_bytes()

    return ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")


def submit_review_decisions(review_dir: Path, payload: dict) -> dict:
    submitted_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    output = {
        **payload,
        "submittedAt": payload.get("submittedAt") or submitted_at,
    }
    body = json.dumps(output, ensure_ascii=False, indent=2).encode("utf-8")
    canonical = review_dir / "review-decisions.json"
    timestamped = review_dir / f"review-decisions-{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}.json"
    canonical.write_bytes(body)
    timestamped.write_bytes(body)
    return {
        "ok": True,
        "path": canonical.name,
        "snapshotPath": timestamped.name,
        "bytes": len(body),
        "submittedAt": output["submittedAt"],
        "accepted": sum(1 for value in (payload.get("decisions") or {}).values() if value == "accept"),
        "rejected": sum(1 for value in (payload.get("decisions") or {}).values() if value == "reject"),
    }


def materialize_local_extract_image(review_dir: Path, result: dict, host: str) -> dict:
    image = result.get("image") or {}
    image_url = str(image.get("url") or "")
    if not image_url.startswith("data:"):
        return result

    header, data = image_url.split(",", 1)
    if ";base64" in header:
        raw = base64.b64decode(data)
    else:
        raw = unquote_to_bytes(data)
    stamp = int(time.time() * 1000)
    output_path = f"assets/local-sam3-extract-{stamp}.png"
    (review_dir / output_path).write_bytes(raw)
    result["image"] = {
        **image,
        "url": f"http://{host}/{output_path}",
        "content_type": image.get("content_type") or "image/png",
        "file_name": image.get("file_name") or Path(output_path).name,
        "file_size": len(raw),
    }
    return result


class Sam3PointRunner:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.lock = Lock()
        self.processor = None
        self.model = None
        self.device = None

    def load(self) -> None:
        if self.processor is not None:
            return

        sys.path.insert(0, self.args.sam3_repo)
        from sam3.model.sam3_image_processor import Sam3Processor
        from sam3.model_builder import build_sam3_image_model

        self.device = resolve_device(self.args.device)
        started = time.time()
        print(f"loading local SAM3 for point review on {self.device}", flush=True)
        self.model = build_sam3_image_model(
            device=self.device,
            checkpoint_path=self.args.checkpoint,
            load_from_HF=False,
            bpe_path=self.args.bpe,
            eval_mode=True,
            enable_inst_interactivity=False,
        )
        self.processor = Sam3Processor(self.model, device=self.device, confidence_threshold=0.05)
        print(f"loaded local SAM3 in {time.time() - started:.1f}s", flush=True)

    def segment(
        self,
        review_dir: Path,
        item_id: str,
        points: list[dict],
        source_url: str | None = None,
    ) -> dict:
        if not points:
            raise ValueError("Add at least one positive/negative point before running SAM.")

        with self.lock:
            self.load()
            return self._segment_loaded(review_dir, item_id, points, source_url)

    def api_prompt_extract(
        self,
        review_dir: Path,
        item_id: str,
        target: str,
        source_url: str | None = None,
    ) -> dict:
        target = "content" if target == "content" else "object"
        with self.lock:
            self.load()
            return self._api_prompt_extract_loaded(review_dir, item_id, target, source_url)

    def extract_from_image_url(self, image_url: str, target: str, points: list[dict]) -> dict:
        target = "content" if target == "content" else "object"
        with self.lock:
            self.load()
            image = load_image_from_url(image_url)
            return self._extract_image_loaded(image, target, points)

    def _extract_image_loaded(self, full_image, target: str, points: list[dict]) -> dict:
        import torch
        from PIL import Image

        full_size = full_image.size
        preview = full_image.copy()
        preview.thumbnail((self.args.max_dim, self.args.max_dim), Image.Resampling.LANCZOS)
        preview_size = preview.size
        started = time.time()

        state = self.processor.set_image(preview)
        self.processor.reset_all_prompts(state)

        if points:
            normalized_points = []
            preview_points = []
            for raw in points[:32]:
                label = 1 if int(raw.get("label", 1)) == 1 else 0
                x = float(raw["x"])
                y = float(raw["y"])
                nx = max(0.0, min(1.0, x / max(1, full_size[0])))
                ny = max(0.0, min(1.0, y / max(1, full_size[1])))
                normalized_points.append([nx, ny, label])
                preview_points.append(
                    {
                        "x": int(round(nx * preview_size[0])),
                        "y": int(round(ny * preview_size[1])),
                        "label": label,
                    }
                )
            state["backbone_out"].update(self.model.backbone.forward_text(["visual"], device=self.device))
            state["geometric_prompt"] = self.model._get_dummy_prompt()
            point_tensor = torch.tensor(
                [[[point[0], point[1]]] for point in normalized_points],
                device=self.device,
                dtype=torch.float32,
            )
            label_tensor = torch.tensor(
                [[point[2]] for point in normalized_points],
                device=self.device,
                dtype=torch.long,
            )
            state["geometric_prompt"].append_points(point_tensor, label_tensor)
            output = self.processor._forward_grounding(state)
        else:
            output = self.processor.set_text_prompt(REMOTE_EXTRACT_PROMPTS[target], state)
            preview_points = []

        boxes = output.get("boxes")
        scores = output.get("scores")
        if boxes is None or len(boxes) == 0:
            raise RuntimeError("Local SAM3 returned no boxes.")
        if hasattr(boxes, "detach"):
            boxes = boxes.detach().cpu().numpy()
        if hasattr(scores, "detach"):
            scores = scores.detach().cpu().numpy()

        positive_points = [point for point in preview_points if point["label"] == 1]
        negative_points = [point for point in preview_points if point["label"] == 0]
        candidates = []
        for index, raw_box in enumerate(boxes):
            raw_values = raw_box.tolist() if hasattr(raw_box, "tolist") else list(raw_box)
            box = clamp_box([int(round(value)) for value in raw_values], *preview_size)
            score = float(scores[index]) if scores is not None and index < len(scores) else 0.0
            area = ((box[2] - box[0]) * (box[3] - box[1])) / max(1, preview_size[0] * preview_size[1])
            candidate = {"index": index, "box": box, "score": score, "area": area}
            if points:
                candidate["contains_pos"] = sum(1 for point in positive_points if box_contains_point(box, point))
                candidate["contains_neg"] = sum(1 for point in negative_points if box_contains_point(box, point))
            candidates.append(candidate)

        if points:
            candidates.sort(
                key=lambda row: (
                    row["contains_pos"],
                    -row["contains_neg"],
                    row["score"],
                    -abs(row["area"] - 0.5),
                ),
                reverse=True,
            )

        selected = candidates[0]
        source_box = map_box(selected["box"], preview_size, full_size)
        crop = full_image.crop(tuple(source_box))
        output_buffer = io.BytesIO()
        crop.save(output_buffer, format="PNG")
        output_bytes = output_buffer.getvalue()
        data_url = f"data:image/png;base64,{base64.b64encode(output_bytes).decode('ascii')}"
        return {
            "ok": True,
            "image": {
                "url": data_url,
                "content_type": "image/png",
                "file_name": "local-sam3-output.png",
                "file_size": len(output_bytes),
                "width": source_box[2] - source_box[0],
                "height": source_box[3] - source_box[1],
            },
            "metadata": [{"index": selected["index"], "score": selected["score"], "box": source_box}],
            "scores": [candidate["score"] for candidate in candidates[:5]],
            "boxes": [map_box(candidate["box"], preview_size, full_size) for candidate in candidates[:5]],
            "provider": "local-sam3",
            "target": target,
            "prompt": None if points else REMOTE_EXTRACT_PROMPTS[target],
            "seconds": round(time.time() - started, 3),
        }

    def _api_prompt_extract_loaded(
        self,
        review_dir: Path,
        item_id: str,
        target: str,
        source_url: str | None = None,
    ) -> dict:
        from PIL import Image, ImageDraw

        started = time.time()
        full_image = load_review_source_image(review_dir, item_id, source_url)
        full_size = full_image.size
        preview = full_image.copy()
        preview.thumbnail((self.args.max_dim, self.args.max_dim), Image.Resampling.LANCZOS)
        preview_size = preview.size
        prompt = REMOTE_EXTRACT_PROMPTS[target]

        state = self.processor.set_image(preview)
        self.processor.reset_all_prompts(state)
        output = self.processor.set_text_prompt(prompt, state)
        boxes = output.get("boxes")
        scores = output.get("scores")
        if boxes is None or len(boxes) == 0:
            raise RuntimeError("Local SAM3 returned no boxes for the API extract prompt.")
        if hasattr(boxes, "detach"):
            boxes = boxes.detach().cpu().numpy()
        if hasattr(scores, "detach"):
            scores = scores.detach().cpu().numpy()

        candidates = []
        for index, raw_box in enumerate(boxes):
            raw_values = raw_box.tolist() if hasattr(raw_box, "tolist") else list(raw_box)
            box = clamp_box([int(round(value)) for value in raw_values], *preview_size)
            score = float(scores[index]) if scores is not None and index < len(scores) else 0.0
            candidates.append(
                {
                    "index": index,
                    "box": box,
                    "score": score,
                    "area": ((box[2] - box[0]) * (box[3] - box[1])) / max(1, preview_size[0] * preview_size[1]),
                }
            )

        # The app route selects the first returned mask/output from fal. fal normally
        # returns candidates in score order, so we keep the same "first candidate"
        # semantics here instead of applying the HCC ranking prompt bonuses.
        selected = candidates[0]
        source_box = map_box(selected["box"], preview_size, full_size)

        crop = full_image.crop(tuple(source_box))
        stamp = int(time.time() * 1000)
        crop_url_path = f"assets/{item_id}-api-sam3-{target}-crop.jpg"
        crop.save(review_dir / crop_url_path, format="JPEG", quality=94)

        overlay = full_image.copy()
        draw = ImageDraw.Draw(overlay)
        draw.rectangle(source_box, outline=(126, 232, 135), width=5)
        overlay_url_path = f"assets/{item_id}-api-sam3-{target}-overlay.jpg"
        overlay.save(review_dir / overlay_url_path, format="JPEG", quality=92)

        return {
            "ok": True,
            "id": item_id,
            "method": f"local-api-sam3-{target}",
            "target": target,
            "prompt": prompt,
            "box": source_box,
            "previewBox": selected["box"],
            "score": selected["score"],
            "candidates": candidates[:5],
            "cropUrl": f"{crop_url_path}?v={stamp}",
            "overlayUrl": f"{overlay_url_path}?v={stamp}",
            "seconds": round(time.time() - started, 3),
        }

    def _segment_loaded(
        self,
        review_dir: Path,
        item_id: str,
        points: list[dict],
        source_url: str | None = None,
    ) -> dict:
        import numpy as np
        import torch
        from PIL import Image, ImageDraw

        started = time.time()
        full_image = load_review_source_image(review_dir, item_id, source_url)
        full_size = full_image.size
        preview = full_image.copy()
        preview.thumbnail((self.args.max_dim, self.args.max_dim), Image.Resampling.LANCZOS)
        preview_size = preview.size

        normalized_points = []
        preview_points = []
        for raw in points[:32]:
            label = 1 if int(raw.get("label", 1)) == 1 else 0
            x = float(raw["x"])
            y = float(raw["y"])
            nx = max(0.0, min(1.0, x / max(1, full_size[0])))
            ny = max(0.0, min(1.0, y / max(1, full_size[1])))
            normalized_points.append([nx, ny, label])
            preview_points.append(
                {
                    "x": int(round(nx * preview_size[0])),
                    "y": int(round(ny * preview_size[1])),
                    "label": label,
                }
            )

        state = self.processor.set_image(preview)
        self.processor.reset_all_prompts(state)
        state["backbone_out"].update(self.model.backbone.forward_text(["visual"], device=self.device))
        state["geometric_prompt"] = self.model._get_dummy_prompt()

        point_tensor = torch.tensor(
            [[[point[0], point[1]]] for point in normalized_points],
            device=self.device,
            dtype=torch.float32,
        )
        label_tensor = torch.tensor(
            [[point[2]] for point in normalized_points],
            device=self.device,
            dtype=torch.long,
        )
        state["geometric_prompt"].append_points(point_tensor, label_tensor)
        output = self.processor._forward_grounding(state)
        boxes = output.get("boxes")
        scores = output.get("scores")
        if boxes is None or len(boxes) == 0:
            raise RuntimeError("SAM3 returned no boxes for these points.")
        if hasattr(boxes, "detach"):
            boxes = boxes.detach().cpu().numpy()
        if hasattr(scores, "detach"):
            scores = scores.detach().cpu().numpy()

        positive_points = [point for point in preview_points if point["label"] == 1]
        negative_points = [point for point in preview_points if point["label"] == 0]
        candidates = []
        for index, raw_box in enumerate(boxes):
            box = clamp_box([int(round(value)) for value in raw_box.tolist()], *preview_size)
            score = float(scores[index]) if scores is not None and index < len(scores) else 0.0
            contains_pos = sum(1 for point in positive_points if box_contains_point(box, point))
            contains_neg = sum(1 for point in negative_points if box_contains_point(box, point))
            area = ((box[2] - box[0]) * (box[3] - box[1])) / max(1, preview_size[0] * preview_size[1])
            candidates.append(
                {
                    "index": index,
                    "box": box,
                    "score": score,
                    "contains_pos": contains_pos,
                    "contains_neg": contains_neg,
                    "area": area,
                }
            )

        candidates.sort(
            key=lambda row: (
                row["contains_pos"],
                -row["contains_neg"],
                row["score"],
                -abs(row["area"] - 0.5),
            ),
            reverse=True,
        )
        selected = candidates[0]
        source_box = map_box(selected["box"], preview_size, full_size)

        crop = full_image.crop(tuple(source_box))
        crop_url_path = f"assets/{item_id}-points-crop.jpg"
        crop_path = review_dir / crop_url_path
        crop.save(crop_path, format="JPEG", quality=94)

        overlay = full_image.copy()
        draw = ImageDraw.Draw(overlay)
        draw.rectangle(source_box, outline=(247, 216, 74), width=5)
        for point in points[:32]:
            x = int(round(point["x"]))
            y = int(round(point["y"]))
            label = int(point.get("label", 1))
            color = (35, 192, 107) if label == 1 else (255, 90, 106)
            draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=color, outline=(255, 255, 255), width=2)
        overlay_url_path = f"assets/{item_id}-points-overlay.jpg"
        overlay.save(review_dir / overlay_url_path, format="JPEG", quality=92)

        return {
            "ok": True,
            "id": item_id,
            "box": source_box,
            "previewBox": selected["box"],
            "score": selected["score"],
            "candidates": candidates[:5],
            "cropUrl": f"{crop_url_path}?v={int(time.time() * 1000)}",
            "overlayUrl": f"{overlay_url_path}?v={int(time.time() * 1000)}",
            "seconds": round(time.time() - started, 3),
        }


def make_handler(review_dir: Path, runner: Sam3PointRunner):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(review_dir), **kwargs)

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/api" or parsed.path.startswith("/api/"):
                self._json(
                    200,
                    {
                        "ok": True,
                        "message": "This review helper exposes POST API endpoints; open / for the review UI.",
                        "reviewUrl": "/",
                        "localExtractProvider": {
                            "path": "/api/local-sam3-extract",
                            "method": "POST",
                            "usedBy": "apps/api /api/v1/extract when LOCAL_SAM3_EXTRACT_URL points here",
                            "body": {
                                "imageUrl": "file:///absolute/path/to/image.jpg or https://...",
                                "target": "content",
                                "points": [],
                            },
                        },
                        "reviewSubmit": {
                            "path": "/api/submit-review",
                            "method": "POST",
                            "writes": "review-decisions.json",
                        },
                        "straighten": {
                            "path": "/api/straighten",
                            "method": "POST",
                            "body": {
                                "id": "2010-04377",
                                "box": [46, 25, 426, 316],
                                "points": [
                                    {"x": 46, "y": 25, "label": 1},
                                    {"x": 426, "y": 25, "label": 1},
                                    {"x": 426, "y": 316, "label": 1},
                                    {"x": 46, "y": 316, "label": 1},
                                ],
                                "angleDegrees": "optional manual rotation; omit for auto",
                            },
                        },
                        "sourceStraighten": {
                            "path": "/api/straighten",
                            "method": "POST",
                            "usedBy": "review UI before frame/SAM/manual crop operations",
                            "body": {"id": "2010-04175", "scope": "source", "angleDegrees": -1.4},
                        },
                    },
                )
                return
            super().do_GET()

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path not in {
                "/api/segment",
                "/api/snap-rectangle",
                "/api/crop-box",
                "/api/frame-detector",
                "/api/straighten",
                "/api/straighten-source",
                "/api/local-api-sam3",
                "/api/local-sam3-extract",
                "/api/submit-review",
            }:
                self.send_error(404, "Not found")
                return

            try:
                length = int(self.headers.get("content-length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if parsed.path == "/api/submit-review":
                    self._json(200, submit_review_decisions(review_dir, payload))
                    return
                if parsed.path == "/api/local-sam3-extract":
                    points = payload.get("points") or payload.get("prompts") or []
                    if not isinstance(points, list):
                        raise ValueError("points must be an array.")
                    result = runner.extract_from_image_url(
                        str(payload.get("imageUrl") or payload.get("image_url") or ""),
                        str(payload.get("target") or "content"),
                        points,
                    )
                    self._json(
                        200,
                        materialize_local_extract_image(
                            review_dir,
                            result,
                            self.headers.get("Host", f"{self.server.server_address[0]}:{self.server.server_address[1]}"),
                        ),
                    )
                    return
                item_id = str(payload.get("id", "")).strip()
                points = payload.get("points") or []
                if not item_id:
                    raise ValueError("Missing id.")
                if not isinstance(points, list):
                    raise ValueError("points must be an array.")
                source_url = str(payload.get("sourceUrl") or payload.get("source_url") or "").strip() or None
                if parsed.path == "/api/frame-detector":
                    result = api_frame_detector(review_dir, item_id, source_url)
                elif parsed.path == "/api/straighten-source":
                    raw_angle = payload.get("angleDegrees", None)
                    if raw_angle is None or raw_angle == "":
                        raise ValueError("angleDegrees is required for source straightening.")
                    result = straighten_review_source(review_dir, item_id, float(raw_angle), source_url)
                elif parsed.path == "/api/straighten":
                    if str(payload.get("scope") or payload.get("target") or "").lower() == "source" or payload.get("source") is True:
                        raw_angle = payload.get("angleDegrees", None)
                        if raw_angle is None or raw_angle == "":
                            raise ValueError("angleDegrees is required for source straightening.")
                        result = straighten_review_source(review_dir, item_id, float(raw_angle), source_url)
                        self._json(200, result)
                        return
                    box = payload.get("box") or []
                    if box and (not isinstance(box, list) or len(box) != 4):
                        raise ValueError("box must be a four-number array.")
                    raw_angle = payload.get("angleDegrees", None)
                    angle_degrees = None
                    if raw_angle is not None and raw_angle != "":
                        angle_degrees = float(raw_angle)
                    result = straighten_review_crop(review_dir, item_id, box or None, points, angle_degrees, source_url)
                elif parsed.path == "/api/local-api-sam3":
                    result = runner.api_prompt_extract(
                        review_dir,
                        item_id,
                        str(payload.get("target") or "content"),
                        source_url,
                    )
                elif parsed.path == "/api/crop-box":
                    box = payload.get("box") or []
                    if not isinstance(box, list) or len(box) != 4:
                        raise ValueError("box must be a four-number array.")
                    result = crop_review_box(review_dir, item_id, box, points, source_url)
                elif parsed.path == "/api/snap-rectangle":
                    result = snap_rectangle(review_dir, item_id, points, source_url)
                else:
                    result = runner.segment(review_dir, item_id, points, source_url)
                self._json(200, result)
            except Exception as exc:  # noqa: BLE001 - review endpoint should return diagnostics.
                self._json(500, {"ok": False, "error": str(exc)})

        def do_OPTIONS(self):
            parsed = urlparse(self.path)
            if parsed.path.startswith("/api/"):
                self.send_response(204)
                self.end_headers()
                return
            self.send_error(404, "Not found")

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            super().end_headers()

        def translate_path(self, path):
            parsed_path = unquote(urlparse(path).path)
            if parsed_path == "/":
                parsed_path = "/index.html"
            return str(review_dir / parsed_path.lstrip("/"))

        def _json(self, status: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def guess_type(self, path):
            return mimetypes.guess_type(path)[0] or "application/octet-stream"

    return Handler


def main() -> int:
    args = parse_args()
    review_dir = Path(args.dir).resolve()
    if not review_dir.exists():
        raise SystemExit(f"Review dir does not exist: {review_dir}")

    runner = Sam3PointRunner(args)
    handler = make_handler(review_dir, runner)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"NGS point/SAM review page: http://{args.host}:{args.port}/", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
