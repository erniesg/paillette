"""Embed the NGS corpus image set with a chosen approach.

Usage: python embed.py <approach> [limit]
  approaches: jina | siglip | openclip
  limit: optional int — embed a fixed random sample of N images (seeded, so all
         three models embed the SAME sample). For a fast first pass.

Every embedder exposes embed_images() and embed_texts() landing in the SAME
vector space — that is the multimodal point, and what the current Paillette
code gets wrong (image=Jina 1024d, text=BGE 768d).
"""
import sys
import time
import random
import numpy as np
from PIL import Image, ImageFile
import torch

from lib import load_corpus, save_vectors

ImageFile.LOAD_TRUNCATED_IMAGES = True  # tolerate slightly-truncated thumbnails
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
BATCH = 32


def load_images(records):
    """Open images robustly; skip unreadable ones. Returns (ids, [PIL.Image])."""
    ids, imgs, bad = [], [], []
    for r in records:
        try:
            imgs.append(Image.open(r["_image"]).convert("RGB"))
            ids.append(r["id"])
        except Exception:
            bad.append(r["id"])
    if bad:
        print(f"  skipped {len(bad)} unreadable images (e.g. {bad[:5]})")
    return ids, imgs


class JinaCLIPv2:
    name = "jina"
    def __init__(self):
        from transformers import AutoModel
        self.m = AutoModel.from_pretrained("jinaai/jina-clip-v2", trust_remote_code=True)
        self.m.to(DEVICE).eval()

    @torch.no_grad()
    def embed_images(self, images):
        out = []
        for i in range(0, len(images), BATCH):
            out.append(np.asarray(self.m.encode_image(images[i:i + BATCH])))
            print(f"  jina {min(i + BATCH, len(images))}/{len(images)}")
        return np.concatenate(out)

    @torch.no_grad()
    def embed_texts(self, texts):
        texts = list(texts)
        out = []
        for i in range(0, len(texts), BATCH):
            out.append(np.asarray(self.m.encode_text(texts[i:i + BATCH])))
        return np.concatenate(out)


class SigLIP2:
    name = "siglip"
    def __init__(self):
        from transformers import AutoModel, AutoProcessor
        mid = "google/siglip2-so400m-patch14-384"
        self.model = AutoModel.from_pretrained(mid).to(DEVICE).eval()
        self.proc = AutoProcessor.from_pretrained(mid)

    @torch.no_grad()
    def embed_images(self, images):
        out = []
        for i in range(0, len(images), BATCH):
            inp = self.proc(images=images[i:i + BATCH], return_tensors="pt").to(DEVICE)
            out.append(self.model.get_image_features(**inp).cpu().float().numpy())
            print(f"  siglip {min(i + BATCH, len(images))}/{len(images)}")
        return np.concatenate(out)

    @torch.no_grad()
    def embed_texts(self, texts):
        texts = list(texts)
        out = []
        for i in range(0, len(texts), BATCH):
            inp = self.proc(text=texts[i:i + BATCH], return_tensors="pt",
                            padding="max_length", max_length=64, truncation=True).to(DEVICE)
            out.append(self.model.get_text_features(**inp).cpu().float().numpy())
        return np.concatenate(out)


class OpenCLIPH14:
    name = "openclip"
    def __init__(self):
        import open_clip
        self.model, _, self.pre = open_clip.create_model_and_transforms(
            "ViT-H-14", pretrained="laion2b_s32b_b79k", device=DEVICE)
        self.model.eval()
        self.tok = open_clip.get_tokenizer("ViT-H-14")

    @torch.no_grad()
    def embed_images(self, images):
        out = []
        for i in range(0, len(images), BATCH):
            t = torch.stack([self.pre(im) for im in images[i:i + BATCH]]).to(DEVICE)
            out.append(self.model.encode_image(t).cpu().float().numpy())
            print(f"  openclip {min(i + BATCH, len(images))}/{len(images)}")
        return np.concatenate(out)

    @torch.no_grad()
    def embed_texts(self, texts):
        texts = list(texts)
        out = []
        for i in range(0, len(texts), BATCH):
            t = self.tok(texts[i:i + BATCH]).to(DEVICE)
            out.append(self.model.encode_text(t).cpu().float().numpy())
        return np.concatenate(out)


class CaptionEmbed:
    """caption->embed: a local text embedder (bge-large). The corpus side is the
    VLM captions; the query side is the query text — same encoder, one space."""
    name = "caption"
    def __init__(self):
        from sentence_transformers import SentenceTransformer
        self.m = SentenceTransformer("BAAI/bge-large-en-v1.5", device=DEVICE)

    def embed_texts(self, texts):
        return np.asarray(self.m.encode(list(texts), batch_size=64,
                                        normalize_embeddings=True,
                                        show_progress_bar=False))

    def embed_images(self, images):
        raise NotImplementedError("caption->embed has no image side")


EMBEDDERS = {"jina": JinaCLIPv2, "siglip": SigLIP2, "openclip": OpenCLIPH14,
             "caption": CaptionEmbed}


def get_embedder(name):
    if name not in EMBEDDERS:
        raise SystemExit(f"unknown approach '{name}' — pick from {list(EMBEDDERS)}")
    return EMBEDDERS[name]()


def main():
    approach = sys.argv[1] if len(sys.argv) > 1 else "jina"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else None
    corpus = load_corpus()
    if limit:
        random.seed(42)  # same sample across all 3 models
        corpus = random.sample(corpus, min(limit, len(corpus)))
        corpus.sort(key=lambda r: r["id"])
    print(f"[{approach}] loading {len(corpus)} images...")
    ids, images = load_images(corpus)
    print(f"[{approach}] embedding {len(images)} images on {DEVICE}")
    emb = get_embedder(approach)
    t0 = time.time()
    vecs = emb.embed_images(images)
    save_vectors(approach, ids, vecs)
    print(f"[{approach}] done: {np.asarray(vecs).shape} in {time.time() - t0:.0f}s "
          f"-> eval/vectors/{approach}.npz")


if __name__ == "__main__":
    main()
