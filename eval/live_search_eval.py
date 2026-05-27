"""Wire-to-wire live search regression eval for Paillette.

This hits the deployed/local `/api/v1/orgs/:orgId/search/text` endpoint using
the same query set as the offline embedding bakeoffs. It is deliberately not a
subjective visual relevance judge. The hard gates cover things we can expect to
be deterministic on the live app:

- every request succeeds;
- every top-10 result belongs to the expected org;
- every top-10 result is source-backed and titled;
- exact accession search resolves at rank 1;
- exact metadata and medium probes have at least one exact hit in top 10.

Usage:
  PAILLETTE_API_KEY=... python3 eval/live_search_eval.py --fail-on-gates

For local dev workers that accept the mock user header:
  python3 eval/live_search_eval.py \
    --base-url http://127.0.0.1:8787 \
    --user-id public-search-web
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


HERE = Path(__file__).resolve().parent
DEFAULT_BASE_URL = "https://paillette-api-stg.berlayar.ai"
DEFAULT_ORG_ID = "cf98791d-f3cc-4f9f-b40c-a350efadbd05"
LEGACY_NGS_ORG_ID = "00000000-0000-4000-8000-000000000101"
DEFAULT_TOP_K = 20
HTTP_TIMEOUT_SECONDS = 45

STOPWORDS = {
    "a",
    "an",
    "and",
    "artist",
    "artwork",
    "artworks",
    "by",
    "collection",
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
}


def load_queries(path: Path) -> list[dict[str, Any]]:
    try:
        import yaml
    except ImportError as exc:
        raise SystemExit("Missing dependency: pyyaml. Install eval/requirements.txt.") from exc

    data = yaml.safe_load(path.read_text())
    queries = data.get("queries") if isinstance(data, dict) else None
    if not isinstance(queries, list):
        raise SystemExit(f"Query file has no `queries` list: {path}")
    return queries


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").lower()).strip()


def normalized_words(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", normalize(value))).strip()


def tokens(value: Any) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9]+", normalize(value))
        if len(token) > 1 and token not in STOPWORDS
    ]


def first_year(value: Any) -> int | None:
    match = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", str(value or ""))
    return int(match.group(1)) if match else None


def metadata(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("metadata")
    return value if isinstance(value, dict) else {}


def field(row: dict[str, Any], *names: str) -> Any:
    meta = metadata(row)
    for name in names:
        value = row.get(name)
        if value not in (None, ""):
            return value
        value = meta.get(name)
        if value not in (None, ""):
            return value
    return None


def result_search_text(row: dict[str, Any]) -> str:
    meta = metadata(row)
    values = [
        row.get("title"),
        row.get("artist"),
        row.get("year"),
        meta.get("medium"),
        meta.get("dateText"),
        meta.get("date_text"),
        meta.get("classification"),
        meta.get("culture"),
        meta.get("origin"),
        meta.get("description"),
        meta.get("sourceCollection"),
        meta.get("source_collection"),
        meta.get("accessionNumber"),
        meta.get("accession_number"),
    ]
    return " ".join(str(value) for value in values if value)


def result_org_id(row: dict[str, Any]) -> str:
    return str(row.get("orgId") or row.get("galleryId") or "").strip()


def text_overlap(query_text: str, row: dict[str, Any]) -> float:
    query_tokens = set(tokens(query_text))
    if not query_tokens:
        return 0.0
    haystack = set(tokens(result_search_text(row)))
    return len(query_tokens & haystack) / len(query_tokens)


def exact_metadata_relevant(query_id: str, row: dict[str, Any]) -> bool | None:
    artist = normalize(field(row, "artist"))
    title = normalize(field(row, "title"))
    accession = normalize(field(row, "accessionNumber", "accession_number", "id"))
    classification = normalize(field(row, "classification"))
    year = field(row, "year") or first_year(field(row, "dateText", "date_text"))
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
    medium = normalize(field(row, "medium"))
    classification = normalize(field(row, "classification"))
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


def is_source_backed(
    row: dict[str, Any],
    source_domain: str,
    source_institution: str,
) -> bool:
    source_url = normalize(field(row, "sourceUrl", "source_url"))
    institution = normalize(field(row, "sourceInstitution", "source_institution"))
    source_record_id = normalize(field(row, "sourceRecordId", "source_record_id"))
    accession = normalize(field(row, "accessionNumber", "accession_number"))
    domain_ok = bool(source_domain) and source_domain.lower() in source_url
    institution_ok = bool(source_institution) and source_institution.lower() in institution
    return domain_ok or institution_ok or bool(source_record_id and accession)


def metric_at(
    candidate: dict[str, list[dict[str, Any]]],
    queries: list[dict[str, Any]],
    fn,
    at: int,
) -> float:
    query_ids = [query["id"] for query in queries if fn(query["id"], {}) is not None]
    if not query_ids:
        return 0.0
    hits = 0
    for query_id in query_ids:
        for hit in candidate.get(query_id, [])[:at]:
            if fn(query_id, hit):
                hits += 1
                break
    return hits / len(query_ids)


def precision_at(
    candidate: dict[str, list[dict[str, Any]]],
    queries: list[dict[str, Any]],
    fn,
    at: int,
) -> float:
    query_ids = [query["id"] for query in queries if fn(query["id"], {}) is not None]
    numerator = 0
    denominator = 0
    for query_id in query_ids:
        for hit in candidate.get(query_id, [])[:at]:
            denominator += 1
            if fn(query_id, hit):
                numerator += 1
    return numerator / max(denominator, 1)


def request_headers(args: argparse.Namespace) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "paillette-live-search-eval/1.0",
    }

    api_key = args.api_key or os.getenv(args.api_key_env)
    bearer = os.getenv(args.bearer_env) if args.bearer_env else None
    user_id = args.user_id or os.getenv("PAILLETTE_USER_ID")
    if api_key:
        headers["X-API-Key"] = api_key
    elif bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    elif user_id:
        headers["X-User-Id"] = user_id
        headers["X-User-Email"] = f"{user_id}@eval.local"
        headers["X-User-Name"] = "Live Search Eval"
    return headers


def fetch_search(
    endpoint: str,
    headers: dict[str, str],
    query_text: str,
    top_k: int,
) -> dict[str, Any]:
    body = json.dumps({"query": query_text, "topK": top_k}).encode("utf-8")
    request = Request(endpoint, data=body, headers=headers, method="POST")
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return {
                "ok": 200 <= response.status < 300 and payload.get("success") is True,
                "status": response.status,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                "payload": payload,
            }
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            payload: Any = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw[:1000]}
        return {
            "ok": False,
            "status": error.code,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "payload": payload,
        }
    except URLError as error:
        return {
            "ok": False,
            "status": None,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "payload": {"error": str(error.reason)},
        }


def query_detail(
    query: dict[str, Any],
    response: dict[str, Any],
    results: list[dict[str, Any]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    top10 = results[:10]
    source_hits = sum(
        1 for row in top10 if is_source_backed(row, args.source_domain, args.source_institution)
    )
    org_mismatches = sum(
        1
        for row in top10
        if args.expected_result_org_id and result_org_id(row) != args.expected_result_org_id
    )
    no_title_hits = sum(1 for row in top10 if not normalize(field(row, "title")))
    overlap_values = [text_overlap(query.get("text", ""), row) for row in top10]

    metadata_expected = exact_metadata_relevant(query["id"], {}) is not None
    medium_expected = exact_medium_relevant(query["id"], {}) is not None

    return {
        "id": query["id"],
        "type": query.get("type"),
        "text": query.get("text"),
        "ok": response["ok"],
        "status": response["status"],
        "elapsed_ms": response["elapsed_ms"],
        "count": len(results),
        "top1": result_summary(results[0]) if results else None,
        "source_backed_top10": source_hits,
        "org_mismatch_top10": org_mismatches,
        "no_title_top10": no_title_hits,
        "metadata_expected": metadata_expected,
        "metadata_hit_at_1": any(exact_metadata_relevant(query["id"], row) for row in results[:1])
        if metadata_expected
        else None,
        "metadata_hit_at_5": any(exact_metadata_relevant(query["id"], row) for row in results[:5])
        if metadata_expected
        else None,
        "metadata_hit_at_10": any(exact_metadata_relevant(query["id"], row) for row in top10)
        if metadata_expected
        else None,
        "medium_expected": medium_expected,
        "medium_hit_at_10": any(exact_medium_relevant(query["id"], row) for row in top10)
        if medium_expected
        else None,
        "avg_text_overlap_top10": round(sum(overlap_values) / max(len(overlap_values), 1), 4),
    }


def result_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "title": field(row, "title"),
        "artist": field(row, "artist"),
        "accessionNumber": field(row, "accessionNumber", "accession_number"),
        "medium": field(row, "medium"),
        "similarity": row.get("similarity"),
    }


def extract_error(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or error.get("code") or "")[:240]
    if error:
        return str(error)[:240]
    return None


def summarize(
    queries: list[dict[str, Any]],
    responses: dict[str, dict[str, Any]],
    candidate: dict[str, list[dict[str, Any]]],
    per_query: list[dict[str, Any]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    successful = [row for row in per_query if row["ok"]]
    metadata_query_count = sum(
        1 for query in queries if exact_metadata_relevant(query["id"], {}) is not None
    )
    medium_query_count = sum(
        1 for query in queries if exact_medium_relevant(query["id"], {}) is not None
    )
    accession_query_count = sum(1 for query in queries if query["id"] == "met-04")
    top10_total = sum(min(row["count"], 10) for row in successful)
    source_backed = sum(row["source_backed_top10"] for row in successful)
    org_mismatches = sum(row["org_mismatch_top10"] for row in successful)
    no_title = sum(row["no_title_top10"] for row in successful)
    overlap_values = [
        row["avg_text_overlap_top10"]
        for row in successful
        if row["count"] > 0
    ]

    met04 = candidate.get("met-04", [])
    accession_exact_top1 = 1.0 if met04 and exact_metadata_relevant("met-04", met04[0]) else 0.0

    return {
        "query_count": len(queries),
        "metadata_query_count": metadata_query_count,
        "medium_query_count": medium_query_count,
        "accession_query_count": accession_query_count,
        "success_count": len(successful),
        "response_success_rate": round(len(successful) / max(len(queries), 1), 4),
        "avg_results_per_query": round(
            sum(row["count"] for row in successful) / max(len(successful), 1),
            2,
        ),
        "top10_full_rate": round(
            sum(1 for row in successful if row["count"] >= min(args.top_k, 10))
            / max(len(successful), 1),
            4,
        ),
        "source_backed_top10_rate": round(source_backed / max(top10_total, 1), 4),
        "org_mismatch_top10_rate": round(org_mismatches / max(top10_total, 1), 4),
        "no_title_top10_rate": round(no_title / max(top10_total, 1), 4),
        "accession_exact_top1": accession_exact_top1,
        "metadata_exact_top1": round(metric_at(candidate, queries, exact_metadata_relevant, 1), 4),
        "metadata_exact_top5": round(metric_at(candidate, queries, exact_metadata_relevant, 5), 4),
        "metadata_exact_top10": round(metric_at(candidate, queries, exact_metadata_relevant, 10), 4),
        "metadata_exact_precision_top10": round(
            precision_at(candidate, queries, exact_metadata_relevant, 10),
            4,
        ),
        "medium_exact_top10": round(metric_at(candidate, queries, exact_medium_relevant, 10), 4),
        "medium_exact_precision_top10": round(
            precision_at(candidate, queries, exact_medium_relevant, 10),
            4,
        ),
        "avg_text_overlap_top10": round(sum(overlap_values) / max(len(overlap_values), 1), 4),
        "failed_queries": [
            {
                "id": query["id"],
                "status": responses[query["id"]]["status"],
                "error": extract_error(responses[query["id"]].get("payload")),
            }
            for query in queries
            if not responses[query["id"]]["ok"]
        ],
    }


def evaluate_gates(metrics: dict[str, Any]) -> list[dict[str, Any]]:
    checks = [
        ("responses succeed", "response_success_rate", ">=", 1.0),
        ("top 10 expected org", "org_mismatch_top10_rate", "<=", 0.0),
        ("top 10 source-backed", "source_backed_top10_rate", ">=", 1.0),
        ("top 10 titled", "no_title_top10_rate", "<=", 0.0),
    ]
    if metrics.get("metadata_query_count", 0) > 0:
        if metrics.get("accession_query_count", 0) > 0:
            checks.append(("exact accession rank 1", "accession_exact_top1", ">=", 1.0))
        checks.append(("metadata hit by rank 10", "metadata_exact_top10", ">=", 1.0))
    if metrics.get("medium_query_count", 0) > 0:
        checks.append(("medium hit by rank 10", "medium_exact_top10", ">=", 1.0))
    output = []
    for label, metric, op, expected in checks:
        actual = float(metrics.get(metric, 0))
        passed = actual >= expected if op == ">=" else actual <= expected
        output.append(
            {
                "label": label,
                "metric": metric,
                "actual": actual,
                "operator": op,
                "expected": expected,
                "passed": passed,
            }
        )
    return output


def fmt_pct(value: float | int | None) -> str:
    if value is None:
        return "-"
    return f"{float(value):.2%}"


def render_report(output: dict[str, Any], path: Path) -> None:
    metrics = output["metrics"]
    gates = output["gates"]
    per_query = output["queries"]
    lines = [
        "# Live Search Eval",
        "",
        f"Generated: {output['generated_at']}",
        f"Base URL: `{output['base_url']}`",
        f"Org ID: `{output['org_id']}`",
        f"Top K: `{output['top_k']}`",
        f"Auth: `{output['auth_mode']}`",
        "",
        "## What Can Be 100%",
        "",
        "Hard 100% gates are reserved for deterministic behavior: successful responses, titled/source-backed top-10 results, exact accession rank 1, and exact metadata/medium probes hitting by rank 10.",
        f"Org consistency is also gated: every top-10 result must resolve to `{output['expected_result_org_id']}`.",
        "Subjective visual, mood, occasion, motif, and style queries should not be expected to hit 100% without a judged relevance set; for those, this report uses overlap as a drift signal only.",
        "",
        "## Gates",
        "",
        "| gate | metric | actual | expected | status |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    for gate in gates:
        status = "PASS" if gate["passed"] else "FAIL"
        actual = fmt_pct(gate["actual"])
        expected = f"{gate['operator']} {fmt_pct(gate['expected'])}"
        lines.append(f"| {gate['label']} | `{gate['metric']}` | {actual} | {expected} | {status} |")

    lines.extend(
        [
            "",
            "## Metrics",
            "",
            "| metric | value |",
            "| --- | ---: |",
            f"| response success | {fmt_pct(metrics['response_success_rate'])} |",
            f"| avg results/query | {metrics['avg_results_per_query']:.2f} |",
            f"| source-backed top10 | {fmt_pct(metrics['source_backed_top10_rate'])} |",
            f"| wrong-org top10 | {fmt_pct(metrics['org_mismatch_top10_rate'])} |",
            f"| no-title top10 | {fmt_pct(metrics['no_title_top10_rate'])} |",
            f"| accession exact @1 | {fmt_pct(metrics['accession_exact_top1'])} |",
            f"| metadata exact @1/@5/@10 | {fmt_pct(metrics['metadata_exact_top1'])} / {fmt_pct(metrics['metadata_exact_top5'])} / {fmt_pct(metrics['metadata_exact_top10'])} |",
            f"| metadata precision @10 | {fmt_pct(metrics['metadata_exact_precision_top10'])} |",
            f"| medium exact @10 | {fmt_pct(metrics['medium_exact_top10'])} |",
            f"| medium precision @10 | {fmt_pct(metrics['medium_exact_precision_top10'])} |",
            f"| avg text-overlap top10 | {fmt_pct(metrics['avg_text_overlap_top10'])} |",
        ]
    )

    if metrics["failed_queries"]:
        lines.extend(["", "## Failed Queries", "", "| id | status | error |", "| --- | ---: | --- |"])
        for failed in metrics["failed_queries"]:
            lines.append(f"| {failed['id']} | {failed['status']} | {failed.get('error') or ''} |")

    lines.extend(
        [
            "",
            "## Query Details",
            "",
            "| id | type | status | count | top1 | metadata @10 | medium @10 | source/title | overlap |",
            "| --- | --- | ---: | ---: | --- | ---: | ---: | --- | ---: |",
        ]
    )
    for row in per_query:
        top1 = row.get("top1") or {}
        top1_text = ""
        if top1:
            title = str(top1.get("title") or "").replace("|", "\\|")
            artist = str(top1.get("artist") or "").replace("|", "\\|")
            top1_text = f"{title} / {artist}"
        source_title = f"{row['source_backed_top10']}/10 source, {row['no_title_top10']} no-title"
        if row["org_mismatch_top10"]:
            source_title += f", {row['org_mismatch_top10']} wrong-org"
        lines.append(
            f"| {row['id']} | {row.get('type') or ''} | {row['status']} | {row['count']} | "
            f"{top1_text} | {row['metadata_hit_at_10']} | {row['medium_hit_at_10']} | "
            f"{source_title} | {fmt_pct(row['avg_text_overlap_top10'])} |"
        )

    path.write_text("\n".join(lines) + "\n")


def auth_mode(args: argparse.Namespace) -> str:
    if args.api_key or os.getenv(args.api_key_env):
        return f"api key env `{args.api_key_env}`"
    if args.bearer_env and os.getenv(args.bearer_env):
        return f"bearer env `{args.bearer_env}`"
    if args.user_id or os.getenv("PAILLETTE_USER_ID"):
        return "dev user header"
    return "none"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("PAILLETTE_API_URL", DEFAULT_BASE_URL))
    parser.add_argument("--org-id", default=os.getenv("PAILLETTE_ORG_ID", DEFAULT_ORG_ID))
    parser.add_argument(
        "--expected-result-org-id",
        default=os.getenv("PAILLETTE_EXPECTED_RESULT_ORG_ID", DEFAULT_ORG_ID),
        help="canonical org id expected on every returned top-10 result",
    )
    parser.add_argument("--queries", type=Path, default=HERE / "queries.yaml")
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    parser.add_argument("--query-id", action="append", help="Only run one or more query ids")
    parser.add_argument("--limit", type=int, help="Only run the first N selected queries")
    parser.add_argument("--sleep", type=float, default=0.05, help="Seconds between requests")
    parser.add_argument("--api-key-env", default="PAILLETTE_API_KEY")
    parser.add_argument("--api-key", help="Paillette API key. Prefer --api-key-env to avoid shell history.")
    parser.add_argument("--bearer-env", help="Environment variable containing a Logto bearer token")
    parser.add_argument("--user-id", help="Local/dev X-User-Id fallback; deployed production ignores this")
    parser.add_argument("--source-domain", default="nationalgallery.sg")
    parser.add_argument("--source-institution", default="National Gallery Singapore")
    parser.add_argument("--out-json", type=Path, default=HERE / "live-search-eval-results.json")
    parser.add_argument("--out-report", type=Path, default=HERE / "live-search-eval-report.md")
    parser.add_argument("--fail-on-gates", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.expected_result_org_id == LEGACY_NGS_ORG_ID:
        raise SystemExit(
            f"refusing to accept deprecated NGS org id {LEGACY_NGS_ORG_ID} "
            "as the expected live result org"
        )
    queries = load_queries(args.queries)
    if args.query_id:
        wanted = set(args.query_id)
        queries = [query for query in queries if query.get("id") in wanted]
    if args.limit:
        queries = queries[: args.limit]
    if not queries:
        raise SystemExit("No queries selected.")

    endpoint = (
        f"{args.base_url.rstrip('/')}/api/v1/orgs/{quote(args.org_id, safe='')}/search/text"
    )
    headers = request_headers(args)
    responses: dict[str, dict[str, Any]] = {}
    candidate: dict[str, list[dict[str, Any]]] = {}
    per_query: list[dict[str, Any]] = []

    print(f"Running {len(queries)} live search queries against {args.base_url.rstrip('/')}")
    print(f"Auth mode: {auth_mode(args)}")
    for index, query in enumerate(queries, start=1):
        response = fetch_search(endpoint, headers, query["text"], args.top_k)
        payload = response.get("payload")
        data = payload.get("data") if isinstance(payload, dict) else None
        results = data.get("results", []) if isinstance(data, dict) else []
        responses[query["id"]] = response
        candidate[query["id"]] = results if isinstance(results, list) else []
        per_query.append(query_detail(query, response, candidate[query["id"]], args))
        status = "ok" if response["ok"] else "fail"
        print(f"{index:02d}/{len(queries)} {query['id']} {status} status={response['status']} count={len(candidate[query['id']])}")
        if args.sleep and index < len(queries):
            time.sleep(args.sleep)

    metrics = summarize(queries, responses, candidate, per_query, args)
    gates = evaluate_gates(metrics)
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": args.base_url.rstrip("/"),
        "org_id": args.org_id,
        "expected_result_org_id": args.expected_result_org_id,
        "top_k": args.top_k,
        "query_file": str(args.queries),
        "auth_mode": auth_mode(args),
        "metrics": metrics,
        "gates": gates,
        "queries": per_query,
        "results_by_query": {
            query_id: [result_summary(row) for row in hits]
            for query_id, hits in candidate.items()
        },
    }
    args.out_json.write_text(json.dumps(output, indent=2) + "\n")
    render_report(output, args.out_report)

    failed_gates = [gate for gate in gates if not gate["passed"]]
    print(f"-> {args.out_json}")
    print(f"-> {args.out_report}")
    if failed_gates:
        print("Gate failures:")
        for gate in failed_gates:
            print(
                f"  - {gate['label']}: {gate['actual']:.4f} "
                f"{gate['operator']} {gate['expected']:.4f}"
            )
    else:
        print("All live search gates passed.")

    return 1 if args.fail_on_gates and failed_gates else 0


if __name__ == "__main__":
    sys.exit(main())
