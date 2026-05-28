"""Build a visual review page for the v2 omni comparison."""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from v2_bakeoff import (
    HERE,
    filter_to_v2,
    load_app_artworks,
    load_legacy_corpus,
    load_queries,
    metadata_search,
    prepare_app_db,
    result_file,
    routed_rrf_fuse,
)
from v2_omni_comparison import rename_channel


TOP_N = 8
OUT = HERE / "evals.html"

CANDIDATES = [
    ("decided_jina_text_routed", "Decided: Jina CLIP v2 image + Jina text caption + metadata"),
    ("omni_family_routed", "Omni family: v5 omni image + Jina text caption + metadata"),
    ("omni_image_metadata", "Omni image + metadata"),
    ("omni_image_only", "Omni image only"),
]

CSS = """
*{box-sizing:border-box}body{margin:0;background:#f6f4ef;color:#25221d;font:14px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:10;background:#fffdf8;border-bottom:1px solid #ddd7ca;padding:14px 22px}
h1{font-size:19px;margin:0 0 4px}.sub{color:#69635a;font-size:12px}.controls{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
select,input,button{font:inherit;border:1px solid #cfc8ba;background:#fff;border-radius:7px;padding:6px 9px}button{cursor:pointer}
main{max-width:1500px;margin:0 auto;padding:18px 22px 80px}
.metric{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:14px}
.m{background:#fffdf8;border:1px solid #ddd7ca;border-radius:9px;padding:9px}.m b{display:block;font-size:16px}.m span{display:block;color:#69635a;font-size:11px}
.card{background:#fffdf8;border:1px solid #ddd7ca;border-radius:10px;margin:0 0 14px;overflow:hidden}
.q{padding:12px 14px;border-bottom:1px solid #e7e1d5;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.q b{font:600 19px/1.25 Georgia,serif}.pill{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5c564d;background:#eee8dc;border-radius:999px;padding:3px 8px}
.row{display:grid;grid-template-columns:210px 1fr;gap:10px;padding:10px 14px;border-top:1px solid #eee8dc}
.row:first-of-type{border-top:0}.label{font-weight:750;color:#36305f}.label small{display:block;color:#69635a;font-weight:600;margin-top:4px}
.strip{display:flex;gap:7px;flex-wrap:wrap}.hit{width:152px;background:#fff;border:1px solid #ddd7ca;border-radius:7px;padding:5px;position:relative}
.hit img,.noimg{width:140px;height:98px;object-fit:cover;border-radius:5px;border:1px solid #d5cec0;background:#eee8dc;display:block}
.noimg{display:flex;align-items:center;justify-content:center;color:#888;font-size:11px}.rank{position:absolute;top:7px;left:7px;background:rgba(0,0,0,.75);color:#fff;font-size:10px;font-weight:800;border-radius:4px;padding:1px 5px}
.t{font-size:11px;font-weight:750;line-height:1.15;margin-top:5px;height:26px;overflow:hidden}.a,.id,.meta{font-size:10px;color:#69635a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.id{color:#36305f;font-weight:750}.channels{font-size:10px;color:#765d1d;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.caption{font-size:10px;color:#403b34;line-height:1.2;margin-top:3px;height:36px;overflow:hidden}.decided{background:#f7fbf7}.omni{background:#f8f7ff}
.hidden{display:none}.note{font-size:12px;color:#69635a;margin:8px 0 16px;max-width:980px}
"""

JS = """
function applyFilters(){
  const intent=document.getElementById('intent').value;
  const q=document.getElementById('search').value.trim().toLowerCase();
  for(const card of document.querySelectorAll('.card')){
    const okIntent=intent==='all'||card.dataset.intent===intent;
    const okQuery=!q||card.dataset.text.includes(q);
    card.classList.toggle('hidden',!(okIntent&&okQuery));
  }
}
"""


def esc(value: Any) -> str:
    return html.escape(str(value or ""), quote=True)


def short(value: Any, length: int = 170) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= length else text[: length - 1] + "..."


def load_metrics() -> dict[str, dict[str, Any]]:
    path = HERE / "v2-omni-comparison.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {row["name"]: row for row in data.get("metrics", [])}


def hit_cell(hit: dict[str, Any], rank: int) -> str:
    rid = hit["id"]
    image_path = HERE / "images" / f"{rid}.webp"
    image = (
        f'<img loading="lazy" src="images/{esc(rid)}.webp">'
        if image_path.exists()
        else '<div class="noimg">no image</div>'
    )
    details = []
    if hit.get("channels"):
        details.append("/".join(str(channel) for channel in hit["channels"]))
    if hit.get("route"):
        details.append(f"route {hit['route']}")
    if hit.get("score") is not None:
        details.append(f"score {float(hit['score']):.4g}")
    caption = short(hit.get("generated_caption_text"), 190)
    return (
        '<figure class="hit">'
        f'{image}<span class="rank">{rank}</span>'
        f'<figcaption><div class="t">{esc(hit.get("title") or "(untitled)")}</div>'
        f'<div class="a">{esc(hit.get("artist") or "artist unknown")}</div>'
        f'<div class="id">{esc(hit.get("accession_number") or rid)}</div>'
        f'<div class="meta">{esc(hit.get("date_text") or "")} {esc(hit.get("medium") or "")}</div>'
        f'<div class="channels">{esc(" | ".join(details))}</div>'
        f'<div class="caption">{esc(caption)}</div></figcaption></figure>'
    )


def build_candidates() -> tuple[list[dict[str, Any]], dict[str, dict[str, list[dict[str, Any]]]]]:
    class Args:
        source_db = Path("/tmp/paillette-stg-ngs.sqlite")
        etl_sql = Path("/tmp/paillette-ngs-app-etl.sql")
        app_db = Path("/tmp/paillette-v2-bakeoff.sqlite")
        rebuild_etl = False
        force = False

    app_db = prepare_app_db(Args)
    app_rows = load_app_artworks(app_db)
    legacy_rows = load_legacy_corpus()
    queries = load_queries()

    jina_image = filter_to_v2(result_file("jina"), app_rows, legacy_rows, require_image=True)
    jina_caption = filter_to_v2(
        result_file("caption_v5_text_small"),
        app_rows,
        legacy_rows,
        require_caption=True,
    )
    omni_image = filter_to_v2(result_file("v5_omni_small"), app_rows, legacy_rows, require_image=True)
    metadata = metadata_search(queries, app_rows, enriched=True)

    candidates = {
        "decided_jina_text_routed": routed_rrf_fuse(
            queries, app_rows, legacy_rows, jina_image, jina_caption, metadata
        ),
        "omni_family_routed": rename_channel(
            routed_rrf_fuse(queries, app_rows, legacy_rows, omni_image, jina_caption, metadata),
            "jina_image",
            "omni_image",
        ),
        "omni_image_metadata": {},
        "omni_image_only": omni_image,
    }

    # Keep this simple and explicit: equal-weight RRF for omni image + metadata.
    from v2_bakeoff import rrf_fuse

    candidates["omni_image_metadata"] = rrf_fuse(
        [("omni_image", 1.0, omni_image), ("metadata", 1.0, metadata)],
        app_rows,
        legacy_rows,
    )
    return queries, candidates


def main() -> None:
    metrics = load_metrics()
    queries, candidates = build_candidates()
    intents = sorted({query["type"] for query in queries})

    metric_html = ""
    for name, label in CANDIDATES:
        metric = metrics.get(name, {})
        metric_html += (
            '<div class="m">'
            f'<b>{esc(name)}</b><span>{esc(label)}</span>'
            f'<span>metadata @10 {float(metric.get("metadata_exact_top10", 0)):.0%} | '
            f'medium @10 {float(metric.get("medium_exact_top10", 0)):.0%} | '
            f'text overlap {float(metric.get("avg_text_overlap_top10", 0)):.1%}</span></div>'
        )

    cards = ""
    for query in queries:
        qid = query["id"]
        qtext = query["text"]
        rows = ""
        for name, label in CANDIDATES:
            row_class = "decided" if name.startswith("decided") else "omni"
            hits = candidates.get(name, {}).get(qid, [])[:TOP_N]
            cells = "".join(hit_cell(hit, rank) for rank, hit in enumerate(hits, 1))
            rows += (
                f'<div class="row {row_class}"><div class="label">{esc(label)}'
                f'<small>{esc(name)}</small></div><div class="strip">{cells}</div></div>'
            )
        cards += (
            f'<section class="card" data-intent="{esc(query["type"])}" '
            f'data-text="{esc((qid + " " + qtext).lower())}">'
            f'<div class="q"><b>"{esc(qtext)}"</b><span class="pill">{esc(query["type"])}</span>'
            f'<span class="pill">{esc(qid)}</span></div>{rows}</section>'
        )

    options = '<option value="all">All intents</option>' + "".join(
        f'<option value="{esc(intent)}">{esc(intent)}</option>' for intent in intents
    )
    html_out = (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        "<title>Paillette v2 omni review</title><style>"
        + CSS
        + "</style></head><body><header><h1>Paillette v2 omni visual review</h1>"
        '<div class="sub">Offline v2 corpus-filtered results. Top 8 shown per query. Review whether omni image improves visual relevance enough to replace Jina CLIP v2 image.</div>'
        '<div class="controls"><select id="intent" onchange="applyFilters()">'
        + options
        + '</select><input id="search" oninput="applyFilters()" placeholder="Search query id/text">'
        '<button onclick="window.scrollTo({top:0,behavior:\'smooth\'})">Top</button></div></header>'
        '<main><div class="metric">'
        + metric_html
        + '</div><p class="note">Read rows horizontally. The decided row uses Jina CLIP v2 for images; omni rows use jina-embeddings-v5-omni-small for images. Captions use Jina v5 text-small where present.</p>'
        + cards
        + "</main><script>"
        + JS
        + "</script></body></html>"
    )
    OUT.write_text(html_out)
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
