#!/usr/bin/env python3

import argparse
import json
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoModel, AutoProcessor


def parse_args():
    parser = argparse.ArgumentParser(
        description="Benchmark local image embedding throughput for cached Open Access assets."
    )
    parser.add_argument(
        "--assets-dir",
        default="tmp/open-access-art-pilot-50-local-first/apply/assets",
        help="Directory containing local image files.",
    )
    parser.add_argument(
        "--asset-manifest",
        help="Optional asset-manifest.json with localPath and role fields.",
    )
    parser.add_argument(
        "--role",
        choices=["all", "web", "thumb"],
        default="all",
        help="Filter asset-manifest rows by role.",
    )
    parser.add_argument(
        "--model",
        default="google/siglip2-so400m-patch14-384",
        help="Hugging Face model id. The script uses local_files_only by default.",
    )
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--device",
        choices=["auto", "cpu", "mps", "cuda"],
        default="auto",
    )
    parser.add_argument(
        "--allow-download",
        action="store_true",
        help="Allow Transformers to download missing model files.",
    )
    parser.add_argument(
        "--trust-remote-code",
        action="store_true",
        help="Allow custom model code required by models such as jinaai/jina-clip-v2.",
    )
    parser.add_argument(
        "--out",
        default="tmp/open-access-art-local-embedding-benchmark/metrics.json",
        help="Metrics JSON output path.",
    )
    return parser.parse_args()


def choose_device(device):
    if device != "auto":
        return device
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def image_paths(args):
    if args.asset_manifest:
        manifest = json.loads(Path(args.asset_manifest).read_text(encoding="utf-8"))
        paths = [
            Path(row["localPath"])
            for row in manifest.get("assets", [])
            if row.get("localPath")
            and (args.role == "all" or row.get("role") == args.role)
        ]
    else:
        paths = sorted(
            path
            for path in Path(args.assets_dir).glob("*")
            if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
        )
    limit = args.limit
    return paths[:limit] if limit > 0 else paths


def open_images(paths):
    images = []
    for path in paths:
        with Image.open(path) as image:
            images.append(image.convert("RGB"))
    return images


def image_features(model, inputs):
    if hasattr(model, "get_image_features"):
        return model.get_image_features(**inputs)
    outputs = model(**inputs)
    if hasattr(outputs, "image_embeds"):
        return outputs.image_embeds
    if hasattr(outputs, "pooler_output"):
        return outputs.pooler_output
    raise RuntimeError("model output does not include image features")


def main():
    args = parse_args()
    paths = image_paths(args)
    if not paths:
        raise SystemExit(f"no image files found in {args.assets_dir}")

    device = choose_device(args.device)
    local_files_only = not args.allow_download

    load_start = time.perf_counter()
    processor = AutoProcessor.from_pretrained(
        args.model,
        local_files_only=local_files_only,
        trust_remote_code=args.trust_remote_code,
    )
    model = AutoModel.from_pretrained(
        args.model,
        local_files_only=local_files_only,
        trust_remote_code=args.trust_remote_code,
    )
    model.eval()
    model.to(device)
    load_seconds = time.perf_counter() - load_start

    # One warmup batch keeps model setup/first-kernel cost out of throughput.
    warmup_paths = paths[: min(args.batch_size, len(paths))]
    with torch.inference_mode():
        inputs = processor(images=open_images(warmup_paths), return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        features = image_features(model, inputs)
        F.normalize(features, dim=-1)
        if device == "mps":
            torch.mps.synchronize()
        elif device == "cuda":
            torch.cuda.synchronize()

    embed_start = time.perf_counter()
    vector_dim = None
    batch_timings = []
    count = 0
    with torch.inference_mode():
        for index in range(0, len(paths), args.batch_size):
            batch_paths = paths[index : index + args.batch_size]
            batch_start = time.perf_counter()
            inputs = processor(images=open_images(batch_paths), return_tensors="pt")
            inputs = {key: value.to(device) for key, value in inputs.items()}
            features = F.normalize(image_features(model, inputs), dim=-1)
            if device == "mps":
                torch.mps.synchronize()
            elif device == "cuda":
                torch.cuda.synchronize()
            batch_seconds = time.perf_counter() - batch_start
            vector_dim = int(features.shape[-1])
            count += len(batch_paths)
            batch_timings.append(
                {
                    "batchIndex": len(batch_timings) + 1,
                    "count": len(batch_paths),
                    "seconds": batch_seconds,
                }
            )

    embed_seconds = time.perf_counter() - embed_start
    metrics = {
        "model": args.model,
        "device": device,
        "assetCount": count,
        "assetManifest": args.asset_manifest,
        "role": args.role,
        "batchSize": args.batch_size,
        "vectorDimensions": vector_dim,
        "loadSeconds": load_seconds,
        "embedSeconds": embed_seconds,
        "imagesPerSecond": count / embed_seconds if embed_seconds else None,
        "secondsPerImage": embed_seconds / count if count else None,
        "batchTimings": batch_timings,
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
