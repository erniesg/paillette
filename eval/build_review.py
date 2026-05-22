"""Assemble eval/review.html — the embedding comparison artifact.

Reads every configured approach that has eval/results/{approach}.json. Two
judges — Claude + Codex — each judgements/{judge}.json shaped
{approach: {qid: 0-3}}. Per query: models side-by-side, both judges' scores,
winner highlighted, disagreements flagged. Click a thumbnail for full details.
Renders fine before judging is done.
"""
import json
import html
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
JUDGE = HERE / "judgements"
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
INTENTS = ["keyword", "occasion", "motif", "mood", "style", "medium", "metadata", "color"]
TOPN = 8
SCORE_COLOR = {3: "#3f7d52", 2: "#7a8a3a", 1: "#9a7320", 0: "#a8492f"}

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f6f4ef;color:#211f1c;font:14px/1.5 -apple-system,Segoe UI,sans-serif}
header{padding:18px 28px;border-bottom:1px solid #e4dfd5;background:#fffefb}
header h1{font-size:19px}header p{color:#6f6a62;font-size:13px;margin-top:3px}
main{max-width:1300px;margin:0 auto;padding:22px 28px 90px}
.matrix{border-collapse:collapse;margin-bottom:10px}
.matrix th,.matrix td{border:1px solid #e4dfd5;padding:7px 16px;text-align:center;font-variant-numeric:tabular-nums}
.matrix th{background:#efebe2}.matrix .rowh{text-align:left;font-weight:700;background:#fbfaf7}
.matrix td.win{background:#eef4ee;font-weight:700;color:#3f7d52}
.legend{font-size:12px;color:#6f6a62;margin:8px 0 18px;max-width:940px}
.legend b{color:#211f1c}
.bar{position:sticky;top:0;background:#f6f4ef;padding:10px 0;z-index:5;border-bottom:1px solid #e4dfd5;margin-bottom:14px}
.bar button{font:13px inherit;padding:6px 12px;border:1px solid #cfcabe;border-radius:7px;background:#fff;cursor:pointer}
.card{background:#fffefb;border:1px solid #e4dfd5;border-radius:12px;padding:16px 18px;margin-bottom:16px}
body.disonly .card[data-dis="false"]{display:none}
.qhead{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.q{font:600 19px/1.3 Georgia,serif}
.chip-i{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:#efebe2;color:#6f6a62;padding:3px 9px;border-radius:99px}
.flag{font-size:12px;font-weight:700;color:#a8492f;background:#f6e9e4;padding:3px 9px;border-radius:99px}
.mrow{display:flex;gap:12px;align-items:flex-start;margin:6px 0;padding:6px;border-radius:8px}
.mrow.win{background:#f1f5f1}
.mlabel{width:152px;flex:none;font-size:12px;font-weight:700;color:#403a6e;display:flex;flex-direction:column;gap:3px}
.mlabel span{font-size:11px;font-weight:600;color:#6f6a62}
.strip{display:flex;gap:5px;flex-wrap:wrap}
.cell{position:relative;width:116px;cursor:zoom-in}
.cell img{width:116px;height:116px;object-fit:cover;border:1px solid #d8d3c8;border-radius:5px;background:#efebe2;display:block}
.cell:hover img{border-color:#403a6e}
.rank{position:absolute;top:2px;left:2px;background:rgba(0,0,0,.78);color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px}
.modal{display:none;position:fixed;inset:0;background:rgba(22,20,17,.86);z-index:50;align-items:center;justify-content:center;padding:30px}
.modal.open{display:flex}
.modal-inner{background:#fffefb;border-radius:12px;max-width:1140px;max-height:90vh;display:flex;overflow:hidden}
.modal-img{flex:1;display:flex;align-items:center;justify-content:center;background:#211f1c;padding:14px}
.modal-img img{max-width:60vw;max-height:84vh;object-fit:contain}
.modal-meta{width:330px;flex:none;padding:22px;overflow:auto}
.modal-meta h2{font:600 21px/1.3 Georgia,serif;margin-bottom:4px}
.modal-meta .artist{color:#403a6e;font-weight:600;margin-bottom:14px}
.modal-meta dl{display:grid;grid-template-columns:78px 1fr;gap:5px 10px;font-size:13px;margin-bottom:14px}
.modal-meta dt{color:#8a8a8a;font-weight:600}
.modal-meta .desc{font-size:13px;line-height:1.55;color:#3f3b35;border-top:1px solid #e4dfd5;padding-top:12px}
.modal-meta .ctx{font-size:12px;color:#6f6a62;background:#f1f0ec;border-radius:7px;padding:9px 11px;margin-bottom:14px}
.modal-x{position:absolute;top:18px;right:22px;color:#fff;font-size:30px;cursor:pointer;line-height:1}
"""

JS = """
function openModal(el){
  var id=el.dataset.id, a=ART[id]||{};
  document.getElementById('m-img').src='images/'+id+'.webp';
  document.getElementById('m-title').textContent=a.title||'(untitled)';
  document.getElementById('m-artist').textContent=a.artist||'artist unknown';
  document.getElementById('m-acc').textContent=id;
  document.getElementById('m-date').textContent=a.date||'\\u2013';
  document.getElementById('m-cls').textContent=a.cls||'\\u2013';
  document.getElementById('m-desc').textContent=a.desc||'No curatorial description.';
  document.getElementById('m-ctx').textContent=
    'rank '+el.dataset.rank+' for \\u201c'+el.dataset.q+'\\u201d \\u00b7 '+el.dataset.model;
  document.getElementById('modal').classList.add('open');
}
function closeModal(){document.getElementById('modal').classList.remove('open');}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();});
"""


def load(p, default):
    return json.loads(p.read_text()) if p.exists() else default


def main():
    approaches = [a for a in APPROACH_ORDER if (RESULTS / f"{a}.json").exists()]
    if not approaches:
        raise SystemExit("no eval/results/*.json files found for configured approaches")
    results = {a: {q["id"]: q for q in load(RESULTS / f"{a}.json", {"queries": []})["queries"]}
               for a in approaches}
    base = next((a for a in approaches if results[a]), approaches[0])
    queries = list(results[base].values())
    claude = load(JUDGE / "claude.json", {})
    codex = load(JUDGE / "codex.json", {})
    corpus = {}
    cp = HERE / "corpus.jsonl"
    if cp.exists():
        for line in cp.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                corpus[r["id"]] = r

    def jscore(j, a, qid):
        v = j.get(a, {}).get(qid)
        return v if isinstance(v, (int, float)) else None

    def combined(a, qid):
        vals = [s for s in (jscore(claude, a, qid), jscore(codex, a, qid)) if s is not None]
        return sum(vals) / len(vals) if vals else None

    def best_by(scorer, qid):
        sc = {a: scorer(a, qid) for a in approaches}
        sc = {a: v for a, v in sc.items() if v is not None}
        return max(sc, key=sc.get) if sc else None

    def disagree(qid):
        bc = best_by(lambda a, q: jscore(claude, a, q), qid)
        bx = best_by(lambda a, q: jscore(codex, a, q), qid)
        return bc is not None and bx is not None and bc != bx

    def fmt(v):
        return f"{v:.2f}" if isinstance(v, float) else ("–" if v is None else str(v))

    rows = ""
    for intent in INTENTS:
        qids = [q["id"] for q in queries if q["type"] == intent]
        means = {}
        for a in approaches:
            vals = [combined(a, qid) for qid in qids]
            vals = [v for v in vals if v is not None]
            means[a] = sum(vals) / len(vals) if vals else None
        best = max((a for a in approaches if means[a] is not None),
                   key=lambda a: means[a], default=None)
        cells = "".join(f'<td class="{"win" if a == best else ""}">{fmt(means[a])}</td>'
                        for a in approaches)
        rows += f'<tr><td class="rowh">{intent}</td>{cells}</tr>'
    matrix = ('<table class="matrix"><tr><th>intent</th>'
              + "".join(f"<th>{LABELS.get(a, a)}</th>" for a in approaches)
              + "</tr>" + rows + "</table>")

    used = set()
    cards = ""
    for q in queries:
        qid = q["id"]
        qtext = html.escape(q["text"], quote=True)
        dis = disagree(qid)
        win = best_by(combined, qid)
        modrows = ""
        for a in approaches:
            cc, cx = jscore(claude, a, qid), jscore(codex, a, qid)
            cells = ""
            for rank, r in enumerate(results.get(a, {}).get(qid, {}).get("results", [])[:TOPN], 1):
                rid = r["id"]
                used.add(rid)
                cells += (f'<figure class="cell" onclick="openModal(this)" data-id="{rid}" '
                          f'data-q="{qtext}" data-model="{LABELS.get(a, a)}" data-rank="{rank}">'
                          f'<img loading="lazy" src="images/{rid}.webp">'
                          f'<span class="rank">{rank}</span></figure>')

            def sc(v):
                return (f'<b style="color:{SCORE_COLOR.get(int(v), "#888")}">{v}</b>'
                        if v is not None else "–")
            modrows += (f'<div class="mrow{" win" if a == win else ""}">'
                        f'<div class="mlabel">{LABELS.get(a, a)}'
                        f'<span>Claude {sc(cc)} · Codex {sc(cx)}</span></div>'
                        f'<div class="strip">{cells}</div></div>')
        flag = '<span class="flag">judges disagree on the winner</span>' if dis else ''
        cards += (f'<section class="card" data-dis="{str(dis).lower()}">'
                  f'<div class="qhead"><span class="q">"{q["text"]}"</span>'
                  f'<span class="chip-i">{q["type"]}</span>{flag}</div>{modrows}</section>')

    art = {rid: {"title": corpus.get(rid, {}).get("title"),
                 "artist": corpus.get(rid, {}).get("artist"),
                 "date": corpus.get(rid, {}).get("date_text"),
                 "cls": corpus.get(rid, {}).get("classification"),
                 "desc": corpus.get(rid, {}).get("description")} for rid in used}
    judged = " + ".join([n for n, d in (("Claude", claude), ("Codex", codex)) if d]) or "none yet"
    modal = ('<div class="modal" id="modal" onclick="if(event.target===this)closeModal()">'
             '<span class="modal-x" onclick="closeModal()">&times;</span>'
             '<div class="modal-inner"><div class="modal-img"><img id="m-img"></div>'
             '<div class="modal-meta"><h2 id="m-title"></h2>'
             '<div class="artist" id="m-artist"></div><div class="ctx" id="m-ctx"></div>'
             '<dl><dt>accession</dt><dd id="m-acc"></dd><dt>date</dt><dd id="m-date"></dd>'
             '<dt>classification</dt><dd id="m-cls"></dd></dl>'
             '<div class="desc" id="m-desc"></div></div></div></div>')
    out = (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<title>Paillette · Embedding Eval R2</title><style>' + CSS + '</style></head><body>'
        '<header><h1>Paillette · Embedding Eval</h1>'
        f'<p>8k corpus · {len(queries)} queries · {len(approaches)} approaches · judges: {judged} · '
        'click a thumbnail for full details</p></header><main>' + matrix +
        '<p class="legend">Matrix = mean relevance 0–3 (Claude + Codex averaged); '
        '<b>green</b> = best approach for that intent. Each model row shows both judges\' '
        'holistic scores; <b>green row</b> = winner. <b style="color:#a8492f">judges disagree</b> '
        '= Claude and Codex pick different winners — your call.</p>'
        '<div class="bar"><button onclick="document.body.classList.toggle(\'disonly\')">'
        'toggle: disagreements only</button></div>' + cards + '</main>' + modal +
        '<script>const ART=' + json.dumps(art) + ';' + JS + '</script></body></html>')
    (HERE / "review.html").write_text(out)
    print(f"-> eval/review.html  ({len(queries)} queries, {len(approaches)} approaches, {len(art)} artworks, judged: {judged})")


if __name__ == "__main__":
    main()
