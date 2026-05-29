#!/usr/bin/env python3
"""Serve a local NGS crop review page with a point-prompt SAM3 endpoint."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import unquote, urlparse

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

DEFAULT_SAM3_REPO = "/Users/erniesg/Downloads/paillette-sam3-apple"
DEFAULT_CHECKPOINT = (
    "/Users/erniesg/.cache/huggingface/hub/models--facebook--sam3/"
    "snapshots/3c879f39826c281e95690f02c7821c4de09afae7/sam3.pt"
)
DEFAULT_BPE = "/Users/erniesg/Downloads/paillette-sam3-apple/assets/bpe_simple_vocab_16e6.txt.gz"


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


def snap_rectangle(review_dir: Path, item_id: str, points: list[dict]) -> dict:
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw, ImageOps

    if not points:
        raise ValueError("Add rough corner or edge points before snapping.")

    source_path = review_dir / "assets" / f"{item_id}-original.jpg"
    if not source_path.exists():
        raise FileNotFoundError(f"Missing original asset for {item_id}")

    started = time.time()
    image = ImageOps.exif_transpose(Image.open(source_path)).convert("RGB")
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

    def segment(self, review_dir: Path, item_id: str, points: list[dict]) -> dict:
        if not points:
            raise ValueError("Add at least one positive/negative point before running SAM.")

        with self.lock:
            self.load()
            return self._segment_loaded(review_dir, item_id, points)

    def _segment_loaded(self, review_dir: Path, item_id: str, points: list[dict]) -> dict:
        import numpy as np
        import torch
        from PIL import Image, ImageDraw, ImageOps

        source_path = review_dir / "assets" / f"{item_id}-original.jpg"
        if not source_path.exists():
            raise FileNotFoundError(f"Missing original asset for {item_id}")

        started = time.time()
        full_image = ImageOps.exif_transpose(Image.open(source_path)).convert("RGB")
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

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path not in {"/api/segment", "/api/snap-rectangle"}:
                self.send_error(404, "Not found")
                return

            try:
                length = int(self.headers.get("content-length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                item_id = str(payload.get("id", "")).strip()
                points = payload.get("points") or []
                if not item_id:
                    raise ValueError("Missing id.")
                if not isinstance(points, list):
                    raise ValueError("points must be an array.")
                if parsed.path == "/api/snap-rectangle":
                    result = snap_rectangle(review_dir, item_id, points)
                else:
                    result = runner.segment(review_dir, item_id, points)
                self._json(200, result)
            except Exception as exc:  # noqa: BLE001 - review endpoint should return diagnostics.
                self._json(500, {"ok": False, "error": str(exc)})

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
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
