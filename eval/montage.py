"""Build per-query montages: configured models side-by-side, top-N thumbnails each.

Reads eval/results/{approach}.json -> writes eval/montages/{qid}.png
These are what Claude reads to sense-check, and what feeds the review artifact.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = True
HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
IMAGES = HERE / "images"
MONT = HERE / "montages"
APPROACH_ORDER = [
    "jina",
    "openclip",
    "caption",
    "v5_omni_small",
    "caption_v5_text_small",
]
LABELS = {
    "jina": "jina-clip-v2",
    "openclip": "OpenCLIP ViT-H",
    "caption": "caption→BGE",
    "v5_omni_small": "Jina v5 omni small",
    "caption_v5_text_small": "caption→Jina v5 text small",
}
TOPN = 8
THUMB = 168
PAD = 6


def font(size, bold=False):
    names = (["Arial Bold.ttf", "Helvetica.ttc"] if bold else ["Arial.ttf", "Helvetica.ttc"])
    for n in names:
        for base in ("/System/Library/Fonts/Supplemental/", "/System/Library/Fonts/"):
            try:
                return ImageFont.truetype(base + n, size)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    MONT.mkdir(exist_ok=True)
    approaches = [a for a in APPROACH_ORDER if (RESULTS / f"{a}.json").exists()]
    if not approaches:
        raise SystemExit("no eval/results/*.json files found for configured approaches")
    data = {a: {q["id"]: q for q in json.loads((RESULTS / f"{a}.json").read_text())["queries"]}
            for a in approaches}
    qmeta = list(data[approaches[0]].values())

    f_hdr, f_lbl, f_rank = font(26, True), font(16, True), font(12, True)
    rowh = THUMB + 30
    W = PAD + TOPN * (THUMB + PAD)
    H = 76 + len(approaches) * rowh

    for q in qmeta:
        qid = q["id"]
        canvas = Image.new("RGB", (W, H), "white")
        d = ImageDraw.Draw(canvas)
        d.text((PAD, 12), f'"{q["text"]}"', fill="black", font=f_hdr)
        d.text((PAD, 48), f'[{q["type"]}]   {qid}', fill="#8a8a8a", font=f_lbl)
        y = 76
        for a in approaches:
            d.text((PAD, y + 6), LABELS.get(a, a), fill="#403a6e", font=f_lbl)
            yy = y + 26
            for rank, hit in enumerate(data[a][qid]["results"][:TOPN]):
                x = PAD + rank * (THUMB + PAD)
                try:
                    im = Image.open(IMAGES / f'{hit["id"]}.webp').convert("RGB")
                    im.thumbnail((THUMB, THUMB))
                    canvas.paste(im, (x, yy))
                except Exception:
                    d.rectangle([x, yy, x + THUMB, yy + THUMB], fill="#ededed")
                d.rectangle([x, yy, x + 20, yy + 16], fill="#000")
                d.text((x + 5, yy + 2), str(rank + 1), fill="white", font=f_rank)
            y += rowh
        canvas.save(MONT / f"{qid}.png")
        print(f"  {qid}  {q['type']}")
    print(f"-> {len(qmeta)} montages in eval/montages/")


if __name__ == "__main__":
    main()
