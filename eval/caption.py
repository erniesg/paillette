"""Caption the NGS corpus with a local VLM (Qwen3-VL via MLX), grounded on the
real NGS catalogue metadata. -> eval/captions.jsonl

Resumable (appends, skips done). Each caption carries provenance: the model,
prompt version, timestamp, and the NGS/roots source URLs.
Run in the .venv-cap venv.

Usage: python caption.py [limit]
  limit = caption a fixed random sample of N (seeded 42, reproducible).
"""
import sys
import json
import time
import random
import datetime
from pathlib import Path

from mlx_vlm import load, generate
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

HERE = Path(__file__).resolve().parent
MODEL = "mlx-community/Qwen3-VL-30B-A3B-Instruct-4bit"
PROMPT_VERSION = "cap-v1"
OUT = HERE / "captions.jsonl"

QUESTION = """You are writing a factual description of an artwork for a search index.

VERIFIED FACTS (from the National Gallery Singapore catalogue — treat as true):
{facts}

Look at the image. Write ONE factual paragraph (about 110 words) for a search index.
Weave in: the artist, title, date and medium/classification from the facts; the
subject and what is literally depicted; visual style and technique; dominant
colours; mood or atmosphere; period or cultural context if evident.

Rules: describe only what you can see in the image or what the verified facts
state. Do not invent names, places, dates or events. No flowery language — be
concrete and specific."""


def load_grounding():
    g = {}
    for line in (HERE / "corpus_grounding.jsonl").read_text().splitlines():
        if line.strip():
            r = json.loads(line)
            g[r["id"]] = r
    return g


def facts_block(art, g):
    parts = []
    for label, key in [("Title", "title"), ("Artist", "artist"),
                        ("Date", "date_text"), ("Classification", "classification")]:
        if art.get(key):
            parts.append(f"- {label}: {art[key]}")
    try:
        rn = g.get("raw_ngs")
        rn = json.loads(rn) if isinstance(rn, str) else (rn or {})
        if rn.get("objCreditLineTxt"):
            parts.append(f"- Credit line: {rn['objCreditLineTxt']}")
    except Exception:
        pass
    if art.get("description"):
        parts.append(f"- Catalogue description: {art['description'][:800]}")
    return "\n".join(parts) if parts else "- (no catalogue metadata available)"


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else None
    rows = [json.loads(l) for l in (HERE / "corpus.jsonl").read_text().splitlines() if l.strip()]
    rows = [r for r in rows if (HERE / "images" / f'{r["id"]}.webp').exists()]
    if limit:
        random.seed(42)  # fixed, reproducible sample
        rows = random.sample(rows, min(limit, len(rows)))
        rows.sort(key=lambda r: r["id"])
    grounding = load_grounding()

    done = set()
    if OUT.exists():
        for l in OUT.read_text().splitlines():
            if l.strip():
                done.add(json.loads(l)["id"])
    todo = [r for r in rows if r["id"] not in done]
    print(f"captioning {len(todo)} artworks ({len(done)} already done) with {MODEL}")

    model, processor = load(MODEL)
    config = load_config(MODEL)

    t0 = time.time()
    with open(OUT, "a") as f:
        for i, art in enumerate(todo):
            img = str(HERE / "images" / f'{art["id"]}.webp')
            q = QUESTION.format(facts=facts_block(art, grounding.get(art["id"], {})))
            prompt = apply_chat_template(processor, config, q, num_images=1)
            try:
                res = generate(model, processor, prompt, image=img,
                               max_tokens=220, temperature=0.2, verbose=False)
                text = (res.text if hasattr(res, "text") else str(res)).strip()
            except Exception as e:
                text = ""
                print(f"  FAIL {art['id']}: {e}")
            g = grounding.get(art["id"], {})
            sources = [u for u in (g.get("ngs_detail_url"), g.get("roots_listing_url")) if u]
            f.write(json.dumps({
                "id": art["id"],
                "caption": text,
                "model": MODEL,
                "prompt_version": PROMPT_VERSION,
                "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "sources": sources,
            }, ensure_ascii=False) + "\n")
            f.flush()
            if i < 3 or (i + 1) % 25 == 0:
                el = time.time() - t0
                print(f"  {i+1}/{len(todo)}  {el/(i+1):.1f}s/img  | {art['id']}: {text[:100]}")
    print(f"DONE -> captions.jsonl  ({time.time()-t0:.0f}s total)")


if __name__ == "__main__":
    main()
