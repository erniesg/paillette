"""OpenAI vision judge — rates retrieval results 0-3 against each query's intent.

Uses the SAME rubric Claude uses, so the two judges are comparable.
Reads eval/results/{approach}.json -> writes eval/judgements/openai.json
"""
import json
import base64
import os
import time
from pathlib import Path
from openai import OpenAI

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
IMAGES = HERE / "images"
JUDGE = HERE / "judgements"
APPROACHES = ["jina", "siglip", "openclip"]
TOPN = 8
MODEL = "gpt-4o"

# load key from eval/.env
for line in (HERE / ".env").read_text().splitlines():
    if line.startswith("OPENAI_API_KEY="):
        os.environ["OPENAI_API_KEY"] = line.split("=", 1)[1].strip()

RUBRIC = {
    "keyword":  "how well the image literally depicts the named subject",
    "occasion": "how well a curator could feature this image for that occasion/festival (symbols, palette, cultural cues)",
    "motif":    "how strongly the image shows that visual pattern/structure, regardless of subject",
    "mood":     "how strongly the image evokes that feeling/mood",
}
SCALE = "0=irrelevant, 1=loosely related, 2=relevant, 3=excellent match"

client = OpenAI()


def b64(path):
    return base64.b64encode(path.read_bytes()).decode()


def judge(query):
    imgs = [(r["id"], IMAGES / f'{r["id"]}.webp')
            for r in query["results"][:TOPN]
            if (IMAGES / f'{r["id"]}.webp').exists()]
    content = [{"type": "text", "text":
        f'Query: "{query["text"]}"\n'
        f'Intent ({query["type"]}): rate {RUBRIC[query["type"]]}.\n'
        f'Scale: {SCALE}.\n'
        f'Rate EACH of the {len(imgs)} images below, in order. '
        f'Reply ONLY JSON: {{"scores":[int,...]}} with exactly {len(imgs)} integers.'}]
    for _id, p in imgs:
        content.append({"type": "image_url",
                        "image_url": {"url": f"data:image/webp;base64,{b64(p)}"}})
    for attempt in range(2):
        try:
            resp = client.chat.completions.create(
                model=MODEL, messages=[{"role": "user", "content": content}],
                response_format={"type": "json_object"}, temperature=0)
            scores = json.loads(resp.choices[0].message.content).get("scores", [])
            return {_id: (scores[i] if i < len(scores) else None)
                    for i, (_id, _p) in enumerate(imgs)}
        except Exception as e:
            if attempt == 0:
                time.sleep(3)
            else:
                print(f"    FAILED: {e}")
                return {_id: None for _id, _p in imgs}


def main():
    JUDGE.mkdir(exist_ok=True)
    out = {}
    for a in APPROACHES:
        out[a] = {}
        for q in json.loads((RESULTS / f"{a}.json").read_text())["queries"]:
            out[a][q["id"]] = judge(q)
            print(f"  openai {a}/{q['id']}")
    (JUDGE / "openai.json").write_text(json.dumps(out, indent=2))
    print("-> eval/judgements/openai.json")


if __name__ == "__main__":
    main()
