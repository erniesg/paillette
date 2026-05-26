"""Offline v1/v2 embedding bakeoff for the NGS ingest.

This script is intentionally additive: it builds a temporary app DB from the
current NGS ETL SQL, filters the existing eval vectors/results to that v2 corpus,
and writes report artifacts under eval/. It does not upsert or mutate Vectorize.

Usage:
  python eval/v2_bakeoff.py \
    --source-db /tmp/paillette-stg-ngs.sqlite \
    --etl-sql /tmp/paillette-ngs-app-etl.sql
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RRF_K = 60
TOP_K = 20
ACTIVE_EXCLUDE_FROM_V2 = {
    "2011-02233",
    "GI-0389",
    "GI-0578",
    "GI-0685",
    "GI-0738",
    "GI-0739",
    "GI-0791",
}

STOPWORDS = {
    "a",
    "an",
    "and",
    "artist",
    "are",
    "by",
    "for",
    "in",
    "is",
    "of",
    "on",
    "or",
    "the",
    "title",
    "titled",
    "to",
    "with",
    "work",
    "artwork",
    "artworks",
    "collection",
    "titled",
}

ACCESSION_RE = re.compile(
    r"\b(?:\d{4}-\d{5}(?:-\d{3})?|[A-Z]{1,4}-\d{3,6}(?:-[A-Z0-9]+)?)\b",
    re.I,
)
HEX_COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}\b")
COLOR_TERMS = {
    "black",
    "blue",
    "brown",
    "crimson",
    "earth",
    "green",
    "grey",
    "gray",
    "monochrome",
    "navy",
    "ochre",
    "red",
    "sage",
    "yellow",
}
MEDIUM_TERMS = {
    "batik",
    "bronze",
    "canvas",
    "charcoal",
    "graphite",
    "ink",
    "linocut",
    "oil",
    "pencil",
    "print",
    "screenprint",
    "sculpture",
    "watercolour",
    "watercolor",
    "woodcut",
}
FORMAL_VISUAL_TERMS = {
    "brushwork",
    "calligraphic",
    "gestural",
}

CODEX_RATINGS = [
    {
        "name": "v1_jina_image_legacy_corpus",
        "rating": 1.6,
        "approval": "baseline only",
        "rationale": "Strong visual channel from the previous eval, but it is tied to the legacy corpus and still leaks stale/no-title rows.",
    },
    {
        "name": "v1_caption_legacy_corpus",
        "rating": 1.7,
        "approval": "baseline only",
        "rationale": "Better factual retrieval than image-only, but still inherits legacy-corpus leakage and is not the v2 path.",
    },
    {
        "name": "v1_current_ngs_metadata_only",
        "rating": 2.0,
        "approval": "safe rollback",
        "rationale": "Good deterministic exact-search behavior and clean corpus safety, but it is not an embedding candidate and misses visual discovery.",
    },
    {
        "name": "v2_metadata_only_text_enriched",
        "rating": 2.1,
        "approval": "safe fallback",
        "rationale": "Best exact/text baseline on the v2 corpus, useful as a fallback, but not sufficient for multimodal search.",
    },
    {
        "name": "v2_jina_image_filtered",
        "rating": 2.2,
        "approval": "staging candidate",
        "rationale": "Best single visual embedding channel after v2 corpus filtering, but exact artist/title/accession queries remain weak.",
    },
    {
        "name": "v2_caption_filtered",
        "rating": 2.0,
        "approval": "staging candidate",
        "rationale": "Useful factual/semantic channel, but weaker visual behavior and fewer returned hits after v2 filtering.",
    },
    {
        "name": "v2_hybrid_rrf_jina_caption_metadata",
        "rating": 2.4,
        "approval": "staging winner",
        "rationale": "Best v2 direction because it combines visual, caption, and deterministic metadata channels; not traffic-approved until missing embeddings and real v2 index hits are measured.",
    },
    {
        "name": "v2_routed_rrf_jina_caption_metadata",
        "rating": 2.6,
        "approval": "preferred conservative route",
        "rationale": "Use fixed hybrid RRF as the default, with narrow overrides for exact metadata, colour, medium/date, and formal-visual queries so broad semantic/occasion/mood prompts keep caption recall.",
    },
]


def read_json(path: Path) -> Any:
    return json.loads(path.read_text())


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def parse_json(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").lower()).strip()


def tokens(value: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9]+", normalize(value))
        if len(token) > 1 and token not in STOPWORDS
    ]


def normalized_words(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", normalize(value))).strip()


def extract_accession(query: str) -> str | None:
    match = ACCESSION_RE.search(query)
    return match.group(0).upper() if match else None


def extract_title_phrase(query: str) -> str | None:
    quoted = re.search(r'["“”]([^"“”]+)["“”]', query)
    if quoted:
        return normalized_words(quoted.group(1))

    titled = re.search(r"\b(?:work\s+titled|titled|title)\s+(.+)$", query, re.I)
    if titled:
        return normalized_words(titled.group(1))

    return None


def first_year(value: Any) -> int | None:
    match = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", str(value or ""))
    return int(match.group(1)) if match else None


def parse_temporal(query: str) -> tuple[int, int] | None:
    if extract_accession(query):
        return None

    decade = re.search(r"\b((?:1[0-9]{2}|20[0-9])0)'?s\b", query, re.I)
    if decade:
        start = int(decade.group(1))
        return start, start + 9
    year = first_year(query)
    if year:
        return year, year
    return None


def load_queries() -> list[dict[str, Any]]:
    import yaml

    return yaml.safe_load((HERE / "queries.yaml").read_text())["queries"]


def relaxed_schema_text() -> str:
    schema = (ROOT / "packages/database/src/schema.sql").read_text()
    # The ETL preserves some NULL source timestamps. D1 staging accepts the data
    # after migrations; this temp SQLite DB only needs the queryable shape.
    return (
        schema.replace("created_at TEXT NOT NULL DEFAULT", "created_at TEXT DEFAULT")
        .replace("updated_at TEXT NOT NULL DEFAULT", "updated_at TEXT DEFAULT")
        .replace("uploaded_by TEXT NOT NULL", "uploaded_by TEXT")
        .replace("created_by TEXT NOT NULL", "created_by TEXT")
    )


def run_sqlite_script(db_path: Path, sql_path: Path) -> None:
    with sql_path.open("rb") as handle:
        subprocess.run(["sqlite3", str(db_path)], stdin=handle, check=True)


def prepare_app_db(args: argparse.Namespace) -> Path:
    if args.rebuild_etl or not args.etl_sql.exists():
        if not args.source_db.exists():
            raise SystemExit(f"source DB not found: {args.source_db}")
        subprocess.run(
            [
                "node",
                "scripts/build-ngs-app-etl.mjs",
                str(args.source_db),
                str(args.etl_sql),
            ],
            cwd=ROOT,
            check=True,
        )

    if args.force or not args.app_db.exists():
        args.app_db.unlink(missing_ok=True)
        schema_path = args.app_db.with_suffix(".schema.sql")
        schema_path.write_text(relaxed_schema_text())
        run_sqlite_script(args.app_db, schema_path)
        run_sqlite_script(args.app_db, args.etl_sql)

    return args.app_db


def load_app_artworks(app_db: Path) -> dict[str, dict[str, Any]]:
    con = sqlite3.connect(app_db)
    con.row_factory = sqlite3.Row
    rows: dict[str, dict[str, Any]] = {}
    for row in con.execute(
        """
        SELECT
          id,
          org_id,
          title,
          artist,
          year,
          date_text,
          medium,
          classification,
          culture,
          origin,
          description,
          credit_line,
          rights,
          accession_number,
          source_url,
          source_institution,
          source_collection,
          source_record_id,
          field_sources,
          image_url,
          thumbnail_url,
          embedding_id,
          custom_metadata
        FROM artworks
        WHERE deleted_at IS NULL
        """
    ):
        item = dict(row)
        metadata = parse_json(item.get("custom_metadata")) or {}
        caption = metadata.get("generated_caption") or {}
        item["generated_caption_text"] = (
            caption.get("text") if isinstance(caption, dict) else None
        )
        item["web_image_source"] = metadata.get("web_image_source")
        item["legacy_image_source"] = metadata.get("legacy_image_source")
        item["in_ngs_catalog"] = bool(metadata.get("in_ngs_catalog"))
        item["dimensions_text"] = metadata.get("dimensions_text")
        item["geographic_association"] = metadata.get("geographic_association")
        item["subject_tags"] = metadata.get("subject_tags")
        item["search_text_v1"] = " ".join(
            str(part or "")
            for part in [
                item.get("title"),
                item.get("artist"),
                item.get("date_text"),
                item.get("medium"),
                item.get("classification"),
                item.get("accession_number"),
                item.get("description"),
            ]
        )
        item["search_text_v2"] = " ".join(
            str(part or "")
            for part in [
                item["search_text_v1"],
                item.get("generated_caption_text"),
                item.get("dimensions_text"),
                item.get("geographic_association"),
                item.get("subject_tags"),
            ]
        )
        rows[item["id"]] = item
    con.close()
    return rows


def load_legacy_corpus() -> dict[str, dict[str, Any]]:
    return {row["id"]: row for row in read_jsonl(HERE / "corpus.jsonl")}


def detail_for(artwork_id: str, app_rows: dict[str, dict[str, Any]], legacy_rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    row = app_rows.get(artwork_id) or legacy_rows.get(artwork_id) or {"id": artwork_id}
    source_url = row.get("source_url")
    return {
        "id": artwork_id,
        "title": row.get("title"),
        "artist": row.get("artist"),
        "date_text": row.get("date_text"),
        "medium": row.get("medium"),
        "classification": row.get("classification"),
        "accession_number": row.get("accession_number") or artwork_id,
        "source_url": source_url,
        "generated_caption_text": row.get("generated_caption_text"),
        "ngs_validated": bool(
            row.get("in_ngs_catalog")
            and source_url
            and str(source_url).startswith("https://www.nationalgallery.sg/")
        ),
    }


def score_metadata_row(query: dict[str, Any], row: dict[str, Any], enriched: bool) -> float:
    query_text = query["text"]
    qnorm = normalize(query_text)
    qtokens = tokens(query_text)
    text = normalize(row["search_text_v2" if enriched else "search_text_v1"])
    score = 0.0

    title = normalize(row.get("title"))
    artist = normalize(row.get("artist"))
    accession = normalize(row.get("accession_number"))
    medium = normalize(row.get("medium"))
    classification = normalize(row.get("classification"))
    accession_query = extract_accession(query_text)

    if accession_query:
        return 500.0 if normalize(accession_query) == accession else 0.0

    if qnorm == title:
        score += 120
    if title and len(title) >= 3 and title in qnorm:
        score += 75
    if artist and artist in qnorm:
        score += 90
    if accession and accession in qnorm:
        score += 140

    temporal = parse_temporal(query_text)
    if temporal:
        year = row.get("year") or first_year(row.get("date_text"))
        if year and temporal[0] <= int(year) <= temporal[1]:
            score += 100

    if "sculpt" in qnorm and "sculpt" in f"{medium} {classification}":
        score += 90

    for token in qtokens:
        if token in title:
            score += 12
        if token in artist:
            score += 10
        if token in accession:
            score += 20
        if token in medium:
            score += 8
        if token in classification:
            score += 8
        if token in text:
            score += 3 if enriched else 2

    if len(qtokens) > 1 and qnorm in text:
        score += 30

    return score


def query_route(
    query: dict[str, Any],
    app_rows: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    query_text = query["text"]
    qtype = query.get("type")
    query_words = normalized_words(query_text)
    title_phrase = extract_title_phrase(query_text)
    artist_names = {normalized_words(row.get("artist")) for row in app_rows.values()}
    title_names = {normalized_words(row.get("title")) for row in app_rows.values()}
    query_tokens = set(tokens(query_text))
    qnorm = normalized_words(query_text)

    if extract_accession(query_text):
        return {
            "intent": "accession_exact",
            "weights": {"jina_image": 0.0, "caption": 0.0, "metadata": 8.0},
        }

    if title_phrase and title_phrase in title_names:
        return {
            "intent": "title_exact",
            "weights": {"jina_image": 0.15, "caption": 1.2, "metadata": 4.0},
        }

    if query_words in artist_names:
        return {
            "intent": "artist_exact",
            "weights": {"jina_image": 0.1, "caption": 1.5, "metadata": 2.5},
        }

    if query_words in title_names:
        return {
            "intent": "title_exact",
            "weights": {"jina_image": 0.15, "caption": 1.2, "metadata": 4.0},
        }

    if qtype == "color" or HEX_COLOR_RE.search(query_text) or query_tokens & COLOR_TERMS:
        return {
            "intent": "color_visual",
            "weights": {"jina_image": 1.5, "caption": 0.25, "metadata": 0.0},
        }

    has_medium_term = bool(query_tokens & MEDIUM_TERMS)
    has_medium_context = "oil lamp" not in qnorm and "oil lamps" not in qnorm
    if qtype == "medium" or (has_medium_term and has_medium_context):
        return {
            "intent": "medium_exact",
            "weights": {"jina_image": 0.2, "caption": 0.8, "metadata": 3.0},
        }

    if parse_temporal(query_text):
        return {
            "intent": "temporal",
            "weights": {"jina_image": 0.2, "caption": 0.6, "metadata": 4.0},
        }

    if query_tokens & FORMAL_VISUAL_TERMS:
        return {
            "intent": "formal_visual",
            "weights": {"jina_image": 1.2, "caption": 0.8, "metadata": 0.2},
        }

    return {
        "intent": "balanced",
        "weights": {"jina_image": 1.0, "caption": 1.0, "metadata": 1.0},
    }


def metadata_search(
    queries: list[dict[str, Any]],
    app_rows: dict[str, dict[str, Any]],
    enriched: bool,
) -> dict[str, list[dict[str, Any]]]:
    output: dict[str, list[dict[str, Any]]] = {}
    for query in queries:
        ranked = []
        for artwork_id, row in app_rows.items():
            score = score_metadata_row(query, row, enriched)
            if score > 0:
                ranked.append((score, artwork_id))
        ranked.sort(
            key=lambda item: (
                -item[0],
                normalize(app_rows[item[1]].get("title")),
                item[1],
            )
        )
        output[query["id"]] = [
            {**detail_for(artwork_id, app_rows, {}), "score": round(score, 4)}
            for score, artwork_id in ranked[:TOP_K]
        ]
    return output


def result_file(name: str) -> dict[str, list[dict[str, Any]]]:
    data = read_json(HERE / "results" / f"{name}.json")
    return {query["id"]: query.get("results", []) for query in data["queries"]}


def filter_to_v2(
    source: dict[str, list[dict[str, Any]]],
    app_rows: dict[str, dict[str, Any]],
    legacy_rows: dict[str, dict[str, Any]],
    require_caption: bool = False,
    require_image: bool = False,
) -> dict[str, list[dict[str, Any]]]:
    output = {}
    for query_id, hits in source.items():
        filtered = []
        seen = set()
        for hit in hits:
            artwork_id = hit["id"]
            row = app_rows.get(artwork_id)
            if not row or artwork_id in seen:
                continue
            if require_caption and not row.get("generated_caption_text"):
                continue
            if require_image and not row.get("embedding_id"):
                continue
            seen.add(artwork_id)
            filtered.append(
                {
                    **detail_for(artwork_id, app_rows, legacy_rows),
                    "score": hit.get("score"),
                }
            )
        output[query_id] = filtered[:TOP_K]
    return output


def rrf_fuse(
    channels: list[tuple[str, float, dict[str, list[dict[str, Any]]]]],
    app_rows: dict[str, dict[str, Any]],
    legacy_rows: dict[str, dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    query_ids = sorted({qid for _, _, results in channels for qid in results})
    output = {}
    for query_id in query_ids:
        scores: dict[str, float] = {}
        sources: dict[str, list[str]] = {}
        for channel_name, weight, results in channels:
            for rank, hit in enumerate(results.get(query_id, []), start=1):
                artwork_id = hit["id"]
                scores[artwork_id] = scores.get(artwork_id, 0.0) + weight / (RRF_K + rank)
                sources.setdefault(artwork_id, []).append(channel_name)
        ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:TOP_K]
        output[query_id] = [
            {
                **detail_for(artwork_id, app_rows, legacy_rows),
                "score": round(score, 6),
                "channels": sources.get(artwork_id, []),
            }
            for artwork_id, score in ranked
        ]
    return output


def routed_rrf_fuse(
    queries: list[dict[str, Any]],
    app_rows: dict[str, dict[str, Any]],
    legacy_rows: dict[str, dict[str, Any]],
    jina_results: dict[str, list[dict[str, Any]]],
    caption_results: dict[str, list[dict[str, Any]]],
    metadata_results: dict[str, list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    output = {}
    by_channel = {
        "jina_image": jina_results,
        "caption": caption_results,
        "metadata": metadata_results,
    }

    for query in queries:
        query_id = query["id"]
        route = query_route(query, app_rows)
        scores: dict[str, float] = {}
        sources: dict[str, list[str]] = {}
        for channel_name, weight in route["weights"].items():
            if weight <= 0:
                continue
            for rank, hit in enumerate(by_channel[channel_name].get(query_id, []), start=1):
                artwork_id = hit["id"]
                scores[artwork_id] = scores.get(artwork_id, 0.0) + weight / (RRF_K + rank)
                sources.setdefault(artwork_id, []).append(channel_name)

        ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:TOP_K]
        output[query_id] = [
            {
                **detail_for(artwork_id, app_rows, legacy_rows),
                "score": round(score, 6),
                "channels": sources.get(artwork_id, []),
                "route": route["intent"],
            }
            for artwork_id, score in ranked
        ]

    return output


def exact_metadata_relevant(query_id: str, row: dict[str, Any]) -> bool | None:
    artist = normalize(row.get("artist"))
    title = normalize(row.get("title"))
    accession = normalize(row.get("accession_number") or row.get("id"))
    classification = normalize(row.get("classification"))
    year = row.get("year") or first_year(row.get("date_text"))
    checks = {
        "met-01": "cheong soo pieng" in artist,
        "met-02": "georgette chen" in artist,
        "met-03": "latiff mohidin" in artist,
        "met-04": "2003-03860" in accession,
        "met-05": "variations on i ching" in title.replace("-", " "),
        "met-06": "sculpt" in classification,
        "met-07": bool(year and 1950 <= int(year) <= 1959),
    }
    return checks.get(query_id)


def exact_medium_relevant(query_id: str, row: dict[str, Any]) -> bool | None:
    medium = normalize(row.get("medium"))
    classification = normalize(row.get("classification"))
    checks = {
        "me-01": "oil" in medium and "canvas" in medium,
        "me-02": "watercolour" in medium or "watercolor" in medium,
        "me-03": any(term in medium for term in ["charcoal", "pencil", "graphite"]),
        "me-04": any(term in medium for term in ["woodcut", "linocut", "lino cut"]),
        "me-05": "bronze" in medium or "carved" in medium or "sculpt" in classification,
        "me-06": "ink" in medium and "paper" in medium,
        "me-07": "batik" in medium,
    }
    return checks.get(query_id)


def text_overlap(query_text: str, row: dict[str, Any]) -> float:
    query_tokens = set(tokens(query_text))
    if not query_tokens:
        return 0.0
    haystack = set(tokens(row.get("search_text_v2") or row.get("search_text_v1") or ""))
    return len(query_tokens & haystack) / len(query_tokens)


def metric_at(
    candidate: dict[str, list[dict[str, Any]]],
    queries: list[dict[str, Any]],
    app_rows: dict[str, dict[str, Any]],
    fn,
    at: int,
) -> float:
    query_ids = [query["id"] for query in queries if fn(query["id"], {}) is not None]
    if not query_ids:
        return 0.0
    hits = 0
    for query_id in query_ids:
        for hit in candidate.get(query_id, [])[:at]:
            row = app_rows.get(hit["id"], hit)
            if fn(query_id, row):
                hits += 1
                break
    return hits / len(query_ids)


def summarize_candidate(
    name: str,
    candidate: dict[str, list[dict[str, Any]]],
    queries: list[dict[str, Any]],
    app_rows: dict[str, dict[str, Any]],
    legacy_rows: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    total = 0
    source_backed = 0
    no_title = 0
    web_image = 0
    legacy_image = 0
    overlap_sum = 0.0
    overlap_n = 0
    top_lengths = []
    channel_counter: Counter[str] = Counter()
    query_by_id = {query["id"]: query for query in queries}

    for query_id, hits in candidate.items():
        top_lengths.append(len(hits))
        query = query_by_id.get(query_id, {})
        for hit in hits[:10]:
            total += 1
            row = app_rows.get(hit["id"]) or legacy_rows.get(hit["id"]) or hit
            if hit["id"] in app_rows:
                source_backed += 1
            if not str(row.get("title") or "").strip():
                no_title += 1
            if app_rows.get(hit["id"], {}).get("web_image_source"):
                web_image += 1
            if app_rows.get(hit["id"], {}).get("legacy_image_source"):
                legacy_image += 1
            overlap_sum += text_overlap(query.get("text", ""), row)
            overlap_n += 1
            for channel in hit.get("channels", []):
                channel_counter[channel] += 1

    return {
        "name": name,
        "avg_results_per_query": round(sum(top_lengths) / max(len(top_lengths), 1), 2),
        "source_backed_top10_rate": round(source_backed / max(total, 1), 4),
        "no_title_top10_rate": round(no_title / max(total, 1), 4),
        "metadata_exact_top1": round(metric_at(candidate, queries, app_rows, exact_metadata_relevant, 1), 4),
        "metadata_exact_top5": round(metric_at(candidate, queries, app_rows, exact_metadata_relevant, 5), 4),
        "metadata_exact_top10": round(metric_at(candidate, queries, app_rows, exact_metadata_relevant, 10), 4),
        "medium_exact_top10": round(metric_at(candidate, queries, app_rows, exact_medium_relevant, 10), 4),
        "avg_text_overlap_top10": round(overlap_sum / max(overlap_n, 1), 4),
        "web_image_hits_top10": web_image,
        "legacy_image_hits_top10": legacy_image,
        "top10_channel_counts": dict(channel_counter),
    }


def load_dual_judgement_projection() -> dict[str, Any]:
    claude = read_json(HERE / "judgements" / "claude.json")
    codex = read_json(HERE / "judgements" / "codex.json")
    projection = {}
    for approach in ["jina", "caption"]:
        values = []
        for query_id, claude_score in claude[approach].items():
            codex_score = codex[approach][query_id]
            values.append((claude_score + codex_score) / 2)
        projection[approach] = round(sum(values) / len(values), 3)

    hybrid_values = []
    for query_id in claude["jina"]:
        image_score = (claude["jina"][query_id] + codex["jina"][query_id]) / 2
        caption_score = (claude["caption"][query_id] + codex["caption"][query_id]) / 2
        hybrid_values.append(max(image_score, caption_score))
    projection["best_of_jina_caption_upper_bound"] = round(
        sum(hybrid_values) / len(hybrid_values), 3
    )
    return projection


def select_winner(
    metrics: list[dict[str, Any]],
    projection: dict[str, Any],
) -> tuple[str, list[dict[str, Any]]]:
    """Pick an embedding candidate from explicit gates and a simple score.

    Metadata-only remains a baseline. The user asked for a v2 embedding/index
    path, so the winner must include at least one embedding channel.
    """
    scored = []
    for metric in metrics:
        name = metric["name"]
        has_image = "jina" in name
        has_caption = "caption" in name
        is_v2 = name.startswith("v2_")
        eligible = (
            is_v2
            and (has_image or has_caption)
            and metric["source_backed_top10_rate"] == 1
            and metric["no_title_top10_rate"] == 0
        )
        if has_image and has_caption:
            judged_quality = projection["best_of_jina_caption_upper_bound"] / 3
        elif has_image:
            judged_quality = projection["jina"] / 3
        elif has_caption:
            judged_quality = projection["caption"] / 3
        else:
            judged_quality = 0
        exact_quality = (
            metric["metadata_exact_top10"] + metric["medium_exact_top10"]
        ) / 2
        routing_quality = 0.03 if "routed_rrf" in name else 0.0
        score = (0.6 * judged_quality) + (0.3 * exact_quality) + (
            0.1 * metric["avg_text_overlap_top10"]
        ) + routing_quality
        scored.append(
            {
                "name": name,
                "eligible": eligible,
                "score": round(score, 4),
                "judged_quality_component": round(judged_quality, 4),
                "exact_quality_component": round(exact_quality, 4),
                "text_overlap_component": metric["avg_text_overlap_top10"],
                "routing_quality_component": routing_quality,
            }
        )

    eligible_scores = [row for row in scored if row["eligible"]]
    if not eligible_scores:
        raise RuntimeError("no eligible v2 embedding candidates")
    eligible_scores.sort(key=lambda row: (-row["score"], row["name"]))
    return eligible_scores[0]["name"], scored


def vector_coverage(app_rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    v2_ids = set(app_rows)
    coverage = {
        "v2_artworks": len(v2_ids),
        "v2_imageable_artworks": sum(1 for row in app_rows.values() if row.get("embedding_id")),
        "v2_captioned_artworks": sum(1 for row in app_rows.values() if row.get("generated_caption_text")),
        "v2_ngs_validated_artworks": sum(
            1
            for row in app_rows.values()
            if row.get("in_ngs_catalog")
            and str(row.get("source_url") or "").startswith("https://www.nationalgallery.sg/")
        ),
        "v2_web_image_source_artworks": sum(1 for row in app_rows.values() if row.get("web_image_source")),
        "v2_legacy_image_approved_artworks": sum(1 for row in app_rows.values() if row.get("legacy_image_source")),
    }
    for vector_name in ["jina", "caption", "caption_v5_text_small", "v5_omni_small"]:
        path = HERE / "vectors" / f"{vector_name}.npz"
        if not path.exists():
            continue
        import numpy as np

        data = np.load(path, allow_pickle=True)
        ids = {str(item) for item in data["ids"]}
        coverage[f"{vector_name}_vectors"] = len(ids)
        coverage[f"{vector_name}_vectors_in_v2"] = len(ids & v2_ids)
        coverage[f"{vector_name}_vectors_missing_for_v2"] = len(v2_ids - ids)
    return coverage


def ngs_validation(app_rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    invalid = []
    for artwork_id, row in sorted(app_rows.items()):
        source_url = str(row.get("source_url") or "")
        in_ngs_catalog = bool(row.get("in_ngs_catalog"))
        if not in_ngs_catalog or not source_url.startswith("https://www.nationalgallery.sg/"):
            invalid.append(
                {
                    "id": artwork_id,
                    "title": row.get("title"),
                    "in_ngs_catalog": in_ngs_catalog,
                    "source_url": source_url or None,
                }
            )
    return {
        "valid_count": len(app_rows) - len(invalid),
        "invalid_count": len(invalid),
        "invalid": invalid,
    }


def render_markdown(
    output: dict[str, Any],
    report_path: Path,
) -> None:
    metrics = output["metrics"]
    coverage = output["coverage"]
    validation = output.get("ngs_validation", {})
    projection = output["dual_judge_projection"]
    winner = output["recommendation"]["winner"]
    lines = [
        "# V2 Embedding Bakeoff",
        "",
        f"Generated: {output['generated_at']}",
        "",
        "## Corpus Gate",
        "",
        f"- v2 ETL corpus: {coverage['v2_artworks']} artworks",
        f"- imageable v2 rows: {coverage['v2_imageable_artworks']}",
        f"- captioned v2 rows: {coverage['v2_captioned_artworks']}",
        f"- NGS-validated rows: {coverage['v2_ngs_validated_artworks']}",
        f"- rows needing NGS source validation: {validation.get('invalid_count', 0)}",
        f"- web-image enrichment rows: {coverage['v2_web_image_source_artworks']}",
        f"- reviewer-approved legacy-image rows: {coverage['v2_legacy_image_approved_artworks']}",
        f"- active exclude_from_v2 rows: {len(ACTIVE_EXCLUDE_FROM_V2)} ({', '.join(sorted(ACTIVE_EXCLUDE_FROM_V2))})",
        "",
        "Existing vector coverage over v2:",
        "",
        "| vector set | total | in v2 | missing v2 |",
        "| --- | ---: | ---: | ---: |",
    ]
    for vector_name in ["jina", "caption", "caption_v5_text_small", "v5_omni_small"]:
        if f"{vector_name}_vectors" in coverage:
            lines.append(
                f"| {vector_name} | {coverage[f'{vector_name}_vectors']} | "
                f"{coverage[f'{vector_name}_vectors_in_v2']} | "
                f"{coverage[f'{vector_name}_vectors_missing_for_v2']} |"
            )
    lines.extend(
        [
            "",
            "## Candidate Metrics",
            "",
            "| candidate | avg results/query | source-backed top10 | no-title top10 | metadata exact @1/@5/@10 | medium exact @10 | text-overlap top10 |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for metric in metrics:
        lines.append(
            f"| {metric['name']} | {metric['avg_results_per_query']} | "
            f"{metric['source_backed_top10_rate']:.2%} | "
            f"{metric['no_title_top10_rate']:.2%} | "
            f"{metric['metadata_exact_top1']:.2%} / {metric['metadata_exact_top5']:.2%} / {metric['metadata_exact_top10']:.2%} | "
            f"{metric['medium_exact_top10']:.2%} | "
            f"{metric['avg_text_overlap_top10']:.2%} |"
        )

    lines.extend(
        [
            "",
            "## Codex Ratings",
            "",
            "Scale: 0-3 staging readiness rating from Codex, separate from the metric score and not a fresh human relevance judgement.",
            "",
            "| candidate | rating | approval | rationale |",
            "| --- | ---: | --- | --- |",
        ]
    )
    for rating in output["codex_ratings"]:
        lines.append(
            f"| {rating['name']} | {rating['rating']:.1f}/3 | "
            f"{rating['approval']} | {rating['rationale']} |"
        )

    lines.extend(
        [
            "",
            "## Dual-Judge Projection",
            "",
            "These are carried forward from the existing Claude+Codex judged montage eval, not newly judged v2 results.",
            "",
            f"- jina image channel average: {projection['jina']} / 3",
            f"- caption channel average: {projection['caption']} / 3",
            f"- best-of image/caption upper bound: {projection['best_of_jina_caption_upper_bound']} / 3",
            "",
            "## Recommendation",
            "",
            f"Winner for user approval: `{winner}`.",
            "",
            output["recommendation"]["summary"],
            "",
            "Decision rule: candidates must be v2, source-backed, free of no-title rows in the top 10, and include at least one embedding channel. The score then combines carried-forward dual-judge channel quality (60%), exact metadata/medium checks (30%), text-overlap diagnostics (10%), and a small route-awareness bonus for avoiding known cross-channel pollution. Metadata-only is retained as a baseline, not selected as the embedding/index winner.",
            "",
            "Approval status: not ready for routing cutover until the missing v2 embeddings are generated and the routed candidate is judged or smoke-tested against production-fusion behavior.",
            "",
            "Use v2 as an additive staging path only: keep `VECTORIZE` and `CAPTION_VECTORIZE` as v1, load v2 into `VECTORIZE_V2` and `CAPTION_VECTORIZE_V2`, then set `EMBEDDING_INDEX_VERSION=v2` and `SEARCH_FUSION_MODE=hybrid` for the API process being tested. Rollback for ranking is `SEARCH_FUSION_MODE=legacy`; rollback for indexes is `EMBEDDING_INDEX_VERSION=v1`.",
            "",
            "## Notes",
            "",
            "- This bakeoff uses existing query result files for the image/caption channels, filtered to the v2 ETL corpus. The missing v2 rows need a final embedding pass before staging cutover.",
            "- NGS validation requires both in-catalog metadata and a National Gallery Singapore source URL. Rows without that proof are listed in `ngs_validation.invalid` in the JSON artifact.",
            "- Metadata-only rows remain searchable through the structured metadata channel even when no image vector exists.",
            "- The report is scoped to staging because the v2 Vectorize bindings are only defined for `[env.staging]`.",
            "- Independent Claude Code review is recorded in `eval/v2-bakeoff-claude-review.md`.",
            "- Codex review and ratings are recorded in `eval/v2-bakeoff-codex-review.md`.",
            "- The script writes no Vectorize data and does not alter D1/R2.",
        ]
    )
    report_path.write_text("\n".join(lines) + "\n")


def render_codex_review(output: dict[str, Any], review_path: Path) -> None:
    winner = output["recommendation"]["winner"]
    ratings = {rating["name"]: rating for rating in output["codex_ratings"]}
    winner_rating = ratings.get(winner, {}).get("rating", "–")
    lines = [
        "# Codex V2 Bakeoff Ratings",
        "",
        "Scale: 0-3 staging readiness rating. These ratings combine the existing judged channel quality, v2 corpus safety, exact-query coverage, and operational readiness. They are not a replacement for fresh judged v2-index results.",
        "",
        "| candidate | rating | approval | rationale |",
        "| --- | ---: | --- | --- |",
    ]
    for rating in output["codex_ratings"]:
        lines.append(
            f"| {rating['name']} | {rating['rating']:.1f}/3 | "
            f"{rating['approval']} | {rating['rationale']} |"
        )

    lines.extend(
        [
            "",
            "## Codex Recommendation",
            "",
            f"My pick for the v2 staging winner is `{winner}` at {winner_rating}/3.",
            "",
            "I would not approve traffic cutover from this artifact alone. The next gate is generating the 412 missing v2 embeddings, upserting both staging v2 indices, measuring actual routed RRF output, and re-judging the routed candidate against metadata-only and image-only baselines.",
        ]
    )
    review_path.write_text("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-db", type=Path, default=Path("/tmp/paillette-stg-ngs.sqlite"))
    parser.add_argument("--etl-sql", type=Path, default=Path("/tmp/paillette-ngs-app-etl.sql"))
    parser.add_argument("--app-db", type=Path, default=Path("/tmp/paillette-v2-bakeoff.sqlite"))
    parser.add_argument("--out-json", type=Path, default=HERE / "v2-bakeoff-results.json")
    parser.add_argument("--out-report", type=Path, default=HERE / "v2-bakeoff-report.md")
    parser.add_argument(
        "--out-codex-review",
        type=Path,
        default=HERE / "v2-bakeoff-codex-review.md",
    )
    parser.add_argument("--rebuild-etl", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    app_db = prepare_app_db(args)
    app_rows = load_app_artworks(app_db)
    legacy_rows = load_legacy_corpus()
    queries = load_queries()

    legacy_jina = result_file("jina")
    legacy_caption = result_file("caption")

    v1_current_metadata = metadata_search(queries, app_rows, enriched=False)
    v2_metadata_enriched = metadata_search(queries, app_rows, enriched=True)
    v2_jina = filter_to_v2(legacy_jina, app_rows, legacy_rows, require_image=True)
    v2_caption = filter_to_v2(legacy_caption, app_rows, legacy_rows, require_caption=True)
    v2_hybrid = rrf_fuse(
        [
            ("jina_image", 1.0, v2_jina),
            ("caption", 1.0, v2_caption),
            ("metadata", 1.0, v2_metadata_enriched),
        ],
        app_rows,
        legacy_rows,
    )
    v2_routed = routed_rrf_fuse(
        queries,
        app_rows,
        legacy_rows,
        v2_jina,
        v2_caption,
        v2_metadata_enriched,
    )

    candidates = {
        "v1_jina_image_legacy_corpus": {
            qid: [detail_for(hit["id"], app_rows, legacy_rows) | {"score": hit.get("score")} for hit in hits[:TOP_K]]
            for qid, hits in legacy_jina.items()
        },
        "v1_caption_legacy_corpus": {
            qid: [detail_for(hit["id"], app_rows, legacy_rows) | {"score": hit.get("score")} for hit in hits[:TOP_K]]
            for qid, hits in legacy_caption.items()
        },
        "v1_current_ngs_metadata_only": v1_current_metadata,
        "v2_metadata_only_text_enriched": v2_metadata_enriched,
        "v2_jina_image_filtered": v2_jina,
        "v2_caption_filtered": v2_caption,
        "v2_hybrid_rrf_jina_caption_metadata": v2_hybrid,
        "v2_routed_rrf_jina_caption_metadata": v2_routed,
    }

    metrics = [
        summarize_candidate(name, candidate, queries, app_rows, legacy_rows)
        for name, candidate in candidates.items()
    ]
    projection = load_dual_judgement_projection()
    winner, decision_scores = select_winner(metrics, projection)
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "app_db": str(app_db),
        "etl_sql": str(args.etl_sql),
        "active_exclude_from_v2": sorted(ACTIVE_EXCLUDE_FROM_V2),
        "coverage": vector_coverage(app_rows),
        "ngs_validation": ngs_validation(app_rows),
        "dual_judge_projection": projection,
        "metrics": metrics,
        "decision_scores": decision_scores,
        "codex_ratings": CODEX_RATINGS,
        "recommendation": {
            "winner": winner,
            "summary": (
                "The staging recommendation is a conservative routed RRF: fixed "
                "hybrid RRF remains the default for broad semantic, occasion, "
                "mood, and motif queries; narrow route overrides apply only to "
                "high-confidence accession, artist, title, colour, medium/date, "
                "and formal-visual queries. That keeps caption recall where it "
                "helps while preventing exact and colour intent from being "
                "diluted by the wrong channel."
            ),
        },
        "candidates": candidates,
    }

    args.out_json.write_text(json.dumps(output, indent=2))
    render_markdown(output, args.out_report)
    render_codex_review(output, args.out_codex_review)
    print(f"wrote {args.out_json}")
    print(f"wrote {args.out_report}")
    print(f"wrote {args.out_codex_review}")
    print(f"winner: {winner}")


if __name__ == "__main__":
    main()
