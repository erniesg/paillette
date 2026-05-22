"""caption->embed: embed the VLM captions with a local text model.
captions.jsonl -> vectors/caption.npz  (the corpus side of the caption approach)
"""
import json
from pathlib import Path

from lib import save_vectors
from embed import CaptionEmbed

HERE = Path(__file__).resolve().parent

rows = [json.loads(l) for l in (HERE / "captions.jsonl").read_text().splitlines() if l.strip()]
rows = [r for r in rows if r.get("caption", "").strip()]
ids = [r["id"] for r in rows]
print(f"embedding {len(ids)} captions with bge-large...")

emb = CaptionEmbed()
vecs = emb.embed_texts([r["caption"] for r in rows])
save_vectors("caption", ids, vecs)
print(f"-> eval/vectors/caption.npz  {vecs.shape}")
