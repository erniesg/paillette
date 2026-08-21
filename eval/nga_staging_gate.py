#!/usr/bin/env python3
"""Host-locked, no-login NGA staging release evaluator.

The validators in this module are intentionally pure. Network execution is
kept behind exact-origin validation so a typo can never redirect the gate to
production or to a deceptive host.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import hashlib
import json
import math
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Mapping, Sequence


EXPECTED_API_ORIGIN = "https://paillette-api-stg.berlayar.ai"
EXPECTED_WEB_ORIGIN = "https://paillette-stg.berlayar.ai"
EXPECTED_VERSIONS = {
    "parser": "nga-v5",
    "plan": "nga-plan-v1",
    "contract": "27",
    "apiResultCache": "v6",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
VALID_REPEAT_CACHE_STATES = {"HIT", "KV-FRESH", "COALESCED"}
VALID_FIRST_CACHE_STATES = {"MISS"}
NGA_CLASSIFICATIONS = {
    "Painting",
    "Drawing",
    "Print",
    "Sculpture",
    "Photograph",
    "Decorative Art",
}
NGA_MEDIUM_FAMILIES = {
    "oil",
    "watercolor",
    "ink",
    "graphite",
    "charcoal",
    "etching",
    "engraving",
    "woodcut",
    "bronze",
    "marble",
}
MEDIUM_ALIASES = {
    "oil": ("oil",),
    "watercolor": ("watercolor", "watercolour"),
    "ink": ("ink",),
    "graphite": ("graphite", "pencil"),
    "charcoal": ("charcoal",),
    "etching": ("etching", "etched"),
    "engraving": ("engraving", "engraved"),
    "woodcut": ("woodcut", "woodblock"),
    "bronze": ("bronze",),
    "marble": ("marble",),
}
class GateStopped(RuntimeError):
    """Raised when continuing could evaluate the wrong environment."""


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(canonical_json(value).encode("utf-8"))


def _validate_origin(value: str, expected: str, label: str) -> None:
    parsed = urllib.parse.urlsplit(value)
    expected_parsed = urllib.parse.urlsplit(expected)
    if (
        value != expected
        or parsed.scheme != "https"
        or parsed.hostname != expected_parsed.hostname
        or parsed.port is not None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path != ""
        or parsed.query != ""
        or parsed.fragment != ""
        or parsed.netloc != expected_parsed.netloc
    ):
        raise ValueError(f"{label} must be exactly {expected}")


def validate_staging_origins(api_base_url: str, web_base_url: str) -> None:
    _validate_origin(api_base_url, EXPECTED_API_ORIGIN, "API base URL")
    _validate_origin(web_base_url, EXPECTED_WEB_ORIGIN, "web base URL")


def fold(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    without_marks = "".join(
        character for character in normalized if not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]+", " ", without_marks.lower()).strip()


SEARCH_MIN_YEAR = 1000
SEARCH_MAX_YEAR = 2100
QUALIFIERS = {
    "early": (0, 33),
    "mid": (34, 66),
    "late": (67, 99),
    "first quarter": (0, 24),
    "second quarter": (25, 49),
    "third quarter": (50, 74),
    "fourth quarter": (75, 99),
    "first half": (0, 49),
    "1st half": (0, 49),
    "second half": (50, 99),
    "2nd half": (50, 99),
}


def _bounded_range(start: int, end: int) -> dict[str, int] | None:
    bounded_start = max(SEARCH_MIN_YEAR, start)
    bounded_end = min(SEARCH_MAX_YEAR, end)
    if bounded_start > bounded_end:
        return None
    return {"startYear": bounded_start, "endYear": bounded_end}


def derive_display_date_range(value: Any) -> dict[str, int] | None:
    text = str(value or "")
    text = re.sub(r"[\u2010-\u2015]", "-", text)
    text = re.sub(r"\s+", " ", text).strip().lower()
    if not text or re.search(r"\b(?:undated|date unknown|unknown date)\b", text):
        return None

    ranges: list[dict[str, int]] = []
    if "century" in text:
        qualifier_pattern = "|".join(
            re.escape(item) for item in sorted(QUALIFIERS, key=len, reverse=True)
        )
        pattern = re.compile(
            rf"\b(?:(?P<qual>{qualifier_pattern})(?:\s+of(?:\s+the)?)?\s+)?"
            r"(?P<century>\d{1,2})(?:st|nd|rd|th)"
            r"(?=\s*(?:century\b|[/\-]|\bor\b|\band\b))"
        )
        century_ranges = []
        for match in pattern.finditer(text):
            century = int(match.group("century"))
            if not 1 <= century <= 21:
                continue
            base = (century - 1) * 100
            offsets = QUALIFIERS.get(match.group("qual"), (0, 99))
            century_ranges.append(
                {"startYear": base + offsets[0], "endYear": base + offsets[1]}
            )
        if century_ranges:
            merged = _bounded_range(
                min(item["startYear"] for item in century_ranges),
                max(item["endYear"] for item in century_ranges),
            )
            if merged is None:
                return None
            ranges.append(merged)

    boundary_matches = list(
        re.finditer(r"\b(before|after)\s+(1[0-9]{3}|20[0-9]{2})\b", text)
    )
    if boundary_matches:
        start = SEARCH_MIN_YEAR
        end = SEARCH_MAX_YEAR
        for match in boundary_matches:
            year = int(match.group(2))
            if match.group(1) == "after":
                start = max(start, year + 1)
            else:
                end = min(end, year - 1)
        bounded = _bounded_range(start, end)
        if bounded is None:
            return None
        ranges.append(bounded)

    if ranges:
        return _bounded_range(
            max(item["startYear"] for item in ranges),
            min(item["endYear"] for item in ranges),
        )

    decade = re.search(r"\b((?:1[0-9]|20)[0-9])0s\b", text)
    if decade:
        start = int(f"{decade.group(1)}0")
        return _bounded_range(start, start + 9)

    years = [
        int(match.group(1))
        for match in re.finditer(r"\b(1[0-9]{3}|20[0-9]{2})\b", text)
    ]
    if not years:
        return None
    return _bounded_range(min(years), max(years))


def normalize_constraints(constraints: Mapping[str, Any] | None) -> dict[str, Any]:
    source = constraints or {}
    output: dict[str, Any] = {}
    date_range = source.get("dateRange")
    if isinstance(date_range, Mapping):
        output["dateRange"] = {
            "startYear": int(date_range["startYear"]),
            "endYear": int(date_range["endYear"]),
        }
    for field in ("classifications", "mediumFamilies", "artistIds"):
        values = source.get(field)
        if isinstance(values, list) and values:
            output[field] = sorted({str(value) for value in values})
    return output


def _source_url(row: Mapping[str, Any], metadata: Mapping[str, Any]) -> str | None:
    source = row.get("source")
    source_record = source if isinstance(source, Mapping) else {}
    candidates = (
        metadata.get("sourceUrl"),
        metadata.get("source_url"),
        source_record.get("url"),
        row.get("sourceUrl"),
    )
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _provider(row: Mapping[str, Any], metadata: Mapping[str, Any]) -> str | None:
    source = row.get("source")
    source_record = source if isinstance(source, Mapping) else {}
    for candidate in (metadata.get("provider"), source_record.get("provider")):
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip().lower()
    return None


def _provider_values(row: Mapping[str, Any], metadata: Mapping[str, Any]) -> list[str]:
    source = row.get("source")
    source_record = source if isinstance(source, Mapping) else {}
    return [
        candidate.strip().lower()
        for candidate in (metadata.get("provider"), source_record.get("provider"))
        if isinstance(candidate, str) and candidate.strip()
    ]


def _trusted_nga_source(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = urllib.parse.urlsplit(value)
        hostname = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError:
        return False
    if parsed.scheme != "https" or parsed.username or parsed.password or port:
        return False
    if hostname == "nga.gov" or hostname.endswith(".nga.gov"):
        return True
    # Repository-backed asset proxy contract. It is accepted only for the
    # exact API origins and exact immutable asset-content path shape.
    if hostname in {"paillette-api.berlayar.ai", "paillette-api-stg.berlayar.ai"}:
        return bool(re.fullmatch(r"/api/v1/assets/[a-f0-9]{32}/content", parsed.path))
    return False


def inspect_row(
    row: Mapping[str, Any], constraints: Mapping[str, Any] | None
) -> list[dict[str, Any]]:
    metadata_value = row.get("metadata")
    metadata = metadata_value if isinstance(metadata_value, Mapping) else {}
    normalized = normalize_constraints(constraints)
    violations: list[dict[str, Any]] = []

    artwork_id = str(row.get("id") or "")
    logical_org = artwork_id.split(":", 1)[0] if ":" in artwork_id else None
    raw_org_values = [
        value
        for value in (row.get("orgId"), row.get("galleryId"))
        if isinstance(value, str) and value
    ]
    accepted_physical_orgs = {
        "open-access-art",
        "eabbf000-708e-4d4c-8ac8-966b59d4fcac",
    }
    if logical_org != "open-access-art" or any(
        value not in accepted_physical_orgs for value in raw_org_values
    ):
        violations.append(
            {
                "constraint": "organization",
                "expected": "open-access-art",
                "actual": {
                    "logical": logical_org,
                    "physical": raw_org_values,
                },
            }
        )

    actual_provider = _provider(row, metadata)
    provider_values = _provider_values(row, metadata)
    if actual_provider != "nga" or any(value != "nga" for value in provider_values):
        violations.append(
            {
                "constraint": "provider",
                "expected": "nga",
                "actual": provider_values or [actual_provider],
            }
        )

    source_url = _source_url(row, metadata)
    if not _trusted_nga_source(source_url):
        violations.append(
            {
                "constraint": "source",
                "expected": "trusted NGA source",
                "actual": source_url,
            }
        )

    if "dateRange" in normalized:
        date_text = metadata.get("dateText", metadata.get("date_text"))
        displayed = derive_display_date_range(date_text)
        requested = normalized["dateRange"]
        if (
            displayed is None
            or displayed["startYear"] > requested["endYear"]
            or displayed["endYear"] < requested["startYear"]
        ):
            violations.append(
                {
                    "constraint": "displayed_date",
                    "expected": requested,
                    "dateText": date_text,
                    "displayedRange": displayed,
                    "storedRange": {
                        "startYear": metadata.get("yearStart", row.get("year")),
                        "endYear": metadata.get("yearEnd", row.get("year")),
                    },
                }
            )

    requested_classifications = normalized.get("classifications", [])
    if requested_classifications:
        actual = metadata.get("visualClassification", metadata.get("classification"))
        if actual not in requested_classifications or actual not in NGA_CLASSIFICATIONS:
            violations.append(
                {
                    "constraint": "classification",
                    "expected": requested_classifications,
                    "actual": actual,
                }
            )

    requested_media = normalized.get("mediumFamilies", [])
    if requested_media:
        actual_family = fold(metadata.get("mediumFamily"))
        actual_medium = fold(metadata.get("medium"))
        matches = False
        for requested_medium in requested_media:
            if requested_medium not in NGA_MEDIUM_FAMILIES:
                continue
            aliases = MEDIUM_ALIASES[requested_medium]
            if actual_family == fold(requested_medium) or any(
                re.search(rf"\b{re.escape(fold(alias))}\b", actual_medium)
                for alias in aliases
            ):
                matches = True
                break
        if not matches:
            violations.append(
                {
                    "constraint": "medium",
                    "expected": requested_media,
                    "actual": {
                        "mediumFamily": metadata.get("mediumFamily"),
                        "medium": metadata.get("medium"),
                    },
                }
            )

    requested_artist_ids = normalized.get("artistIds", [])
    if requested_artist_ids:
        actual_artist_id = metadata.get("primaryArtistId")
        if actual_artist_id not in requested_artist_ids:
            violations.append(
                {
                    "constraint": "artist",
                    "expected": requested_artist_ids,
                    "actual": actual_artist_id,
                }
            )
    return violations


def _failure(code: str, **details: Any) -> dict[str, Any]:
    return {"code": code, **details}


def _header(response: Mapping[str, Any], name: str) -> str | None:
    headers = response.get("headers")
    if not isinstance(headers, Mapping):
        return None
    lowered = {str(key).lower(): str(value) for key, value in headers.items()}
    return lowered.get(name.lower())


def _response_json(response: Mapping[str, Any]) -> Mapping[str, Any]:
    value = response.get("json")
    return value if isinstance(value, Mapping) else {}


def _result(failures: list[dict[str, Any]], **details: Any) -> dict[str, Any]:
    return {
        **details,
        "failures": failures,
        "failureCodes": [failure["code"] for failure in failures],
        "passed": not failures,
    }


def evaluate_text_case(
    case: Mapping[str, Any],
    response: Mapping[str, Any],
    observed_versions: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    status = int(response.get("status") or 0)
    payload = _response_json(response)
    if status in {401, 403}:
        failures.append(_failure("unexpected_auth", status=status))
    if not 200 <= status < 300 or payload.get("success") is not True:
        failures.append(_failure("nga_request_failed", status=status))

    data_value = payload.get("data")
    data = data_value if isinstance(data_value, Mapping) else {}
    interpretation_value = data.get("interpretation")
    interpretation = (
        interpretation_value if isinstance(interpretation_value, Mapping) else {}
    )
    parser_version = interpretation.get("parserVersion")
    if parser_version != EXPECTED_VERSIONS["parser"]:
        failures.append(
            _failure(
                "parser_version_mismatch",
                expected=EXPECTED_VERSIONS["parser"],
                actual=parser_version,
            )
        )

    for field, code in (
        ("plan", "plan_version_mismatch"),
        ("contract", "contract_version_mismatch"),
        ("apiResultCache", "cache_version_mismatch"),
    ):
        if observed_versions is not None and observed_versions.get(field) != EXPECTED_VERSIONS[field]:
            failures.append(
                _failure(
                    code,
                    expected=EXPECTED_VERSIONS[field],
                    actual=observed_versions.get(field),
                )
            )

    expected_value = case.get("expected")
    expected = expected_value if isinstance(expected_value, Mapping) else {}
    expected_constraints = normalize_constraints(expected.get("constraints"))
    actual_constraints = normalize_constraints(interpretation.get("constraints"))
    if actual_constraints != expected_constraints:
        failures.append(
            _failure(
                "interpretation_mismatch",
                expected=expected_constraints,
                actual=actual_constraints,
            )
        )

    if "semanticQuery" in expected and interpretation.get("semanticQuery") != expected.get("semanticQuery"):
        failures.append(
            _failure(
                "semantic_query_mismatch",
                expected=expected.get("semanticQuery"),
                actual=interpretation.get("semanticQuery"),
            )
        )

    if "relation" in expected:
        expected_relation = expected.get("relation")
        actual_relation = interpretation.get("relation")
        if actual_relation != expected_relation:
            failures.append(
                _failure(
                    "relation_direction_mismatch",
                    expected=expected_relation,
                    actual=actual_relation,
                )
            )

    if expected.get("unresolved") is True:
        unresolved = interpretation.get("unresolved")
        if not isinstance(unresolved, list) or not unresolved:
            failures.append(_failure("unresolved_ambiguity_missing"))

    rows_value = data.get("results")
    rows = rows_value if isinstance(rows_value, list) else []
    row_records = []
    for rank, row_value in enumerate(rows, 1):
        if not isinstance(row_value, Mapping):
            failures.append(_failure("invalid_result_row", rank=rank))
            continue
        violations = inspect_row(row_value, actual_constraints)
        if violations:
            failures.append(
                _failure(
                    "hard_constraint_violation",
                    rank=rank,
                    artworkId=row_value.get("id"),
                    violations=violations,
                )
            )
        row_records.append(
            {
                "rank": rank,
                "id": row_value.get("id"),
                "title": row_value.get("title"),
                "artist": row_value.get("artist"),
                "similarity": row_value.get("similarity"),
                "metadata": row_value.get("metadata"),
                "violations": violations,
            }
        )

    meta_value = payload.get("meta")
    meta = meta_value if isinstance(meta_value, Mapping) else {}
    search_value = meta.get("search")
    search = search_value if isinstance(search_value, Mapping) else {}
    degraded = search.get("degradedChannels")
    if search.get("cacheable") is False or (isinstance(degraded, list) and degraded):
        failures.append(
            _failure(
                "degraded_cacheable_text",
                cacheable=search.get("cacheable"),
                degradedChannels=degraded,
            )
        )

    if case.get("expectedZeroResults") is True and rows:
        failures.append(_failure("expected_zero_results", actual=len(rows)))

    return _result(
        failures,
        caseId=case.get("id"),
        status=status,
        parserVersion=parser_version,
        interpretation=interpretation,
        constraints=actual_constraints,
        relation=interpretation.get("relation"),
        cache=_header(response, "x-paillette-search-cache"),
        cacheControl=_header(response, "cache-control"),
        etag=_header(response, "etag"),
        cacheable=search.get("cacheable"),
        degradedChannels=degraded,
        rows=row_records,
    )


def evaluate_ngs_probe(response: Mapping[str, Any]) -> dict[str, Any]:
    status = int(response.get("status") or 0)
    payload = _response_json(response)
    failures = []
    error_value = payload.get("error")
    error = error_value if isinstance(error_value, Mapping) else {}
    if (
        status != 403
        or payload.get("success") is not False
        or error.get("code") != "PUBLIC_SEARCH_SCOPE_FORBIDDEN"
    ):
        failures.append(_failure("ngs_public_search_exposed", status=status))
    return _result(failures, status=status, error=error)


def _data_identity(response: Mapping[str, Any]) -> str:
    payload = _response_json(response)
    return sha256_json(payload.get("data"))


def evaluate_text_cache_probe(
    first: Mapping[str, Any],
    repeat: Mapping[str, Any],
    changed: Mapping[str, Any],
    *,
    first_identity: str,
    changed_identity: str,
    snapshot: str,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    first_cache = (_header(first, "x-paillette-search-cache") or "").upper()
    repeat_cache = (_header(repeat, "x-paillette-search-cache") or "").upper()
    if snapshot == "candidate" and first_cache not in VALID_FIRST_CACHE_STATES:
        failures.append(
            _failure("candidate_first_cache_not_miss", actual=first_cache)
        )
    if repeat_cache not in VALID_REPEAT_CACHE_STATES:
        failures.append(_failure("repeat_cache_not_hit", actual=repeat_cache))

    first_data = _data_identity(first)
    repeat_data = _data_identity(repeat)
    if first_data != repeat_data:
        failures.append(_failure("repeat_cache_data_drift"))
    first_etag = _header(first, "etag")
    repeat_etag = _header(repeat, "etag")
    if not first_etag or first_etag != repeat_etag:
        failures.append(
            _failure(
                "repeat_cache_etag_drift", first=first_etag, repeat=repeat_etag
            )
        )

    changed_data = _data_identity(changed)
    changed_etag = _header(changed, "etag")
    if (
        first_identity == changed_identity
        or (first_data == changed_data and first_etag == changed_etag)
    ):
        failures.append(_failure("changed_constraint_cache_collision"))

    for label, response in (("first", first), ("repeat", repeat), ("changed", changed)):
        payload = _response_json(response)
        status = int(response.get("status") or 0)
        if not 200 <= status < 300 or payload.get("success") is not True:
            failures.append(
                _failure("cache_probe_request_failed", probe=label, status=status)
            )
        meta = payload.get("meta") if isinstance(payload.get("meta"), Mapping) else {}
        search = meta.get("search") if isinstance(meta.get("search"), Mapping) else {}
        degraded = search.get("degradedChannels")
        if search.get("cacheable") is False or (isinstance(degraded, list) and degraded):
            failures.append(_failure("degraded_cacheable_text", probe=label))

    return _result(
        failures,
        first={"cache": first_cache, "etag": first_etag, "dataHash": first_data},
        repeat={
            "cache": repeat_cache,
            "etag": repeat_etag,
            "dataHash": repeat_data,
        },
        changed={
            "cache": _header(changed, "x-paillette-search-cache"),
            "etag": changed_etag,
            "dataHash": changed_data,
        },
        identities={"first": first_identity, "changed": changed_identity},
    )


def canonical_image_identity(
    image_bytes: bytes,
    _filename: str,
    constraints: Mapping[str, Any] | None,
    top_k: int,
    min_score: float,
) -> str:
    return sha256_json(
        {
            "version": "public-image-search-v1",
            "contractVersion": EXPECTED_VERSIONS["contract"],
            "mode": "image",
            "orgId": "nga",
            "imageDigest": sha256_bytes(image_bytes),
            "constraints": normalize_constraints(constraints) or None,
            "topK": int(top_k),
            "minScore": float(min_score),
        }
    )


def evaluate_image_identity_probe(
    *,
    stable_first: str,
    stable_repeat: str,
    same_name_first: str,
    same_name_changed: str,
    constraint_first: str,
    constraint_changed: str,
) -> dict[str, Any]:
    failures = []
    if stable_first != stable_repeat:
        failures.append(_failure("stable_image_identity_drift"))
    if same_name_first == same_name_changed:
        failures.append(_failure("same_filename_different_bytes_collision"))
    if constraint_first == constraint_changed:
        failures.append(_failure("image_constraint_identity_collision"))
    return _result(failures)


def evaluate_image_response(
    response: Mapping[str, Any], constraints: Mapping[str, Any] | None
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    status = int(response.get("status") or 0)
    payload = _response_json(response)
    cache_control = (_header(response, "cache-control") or "").lower()
    if "no-store" not in {item.strip() for item in cache_control.split(",")}:
        failures.append(
            _failure("image_response_cacheable", cacheControl=cache_control or None)
        )
    if status in {401, 403}:
        failures.append(_failure("unexpected_auth", status=status))
    if not 200 <= status < 300 or payload.get("success") is not True:
        failures.append(_failure("nga_image_request_failed", status=status))
    data_value = payload.get("data")
    data = data_value if isinstance(data_value, Mapping) else {}
    rows_value = data.get("results")
    rows = rows_value if isinstance(rows_value, list) else []
    row_records = []
    for rank, row_value in enumerate(rows, 1):
        if not isinstance(row_value, Mapping):
            failures.append(_failure("invalid_result_row", rank=rank))
            continue
        violations = inspect_row(row_value, constraints)
        if violations:
            failures.append(
                _failure(
                    "hard_constraint_violation",
                    rank=rank,
                    artworkId=row_value.get("id"),
                    violations=violations,
                )
            )
        row_records.append(
            {
                "rank": rank,
                "id": row_value.get("id"),
                "title": row_value.get("title"),
                "artist": row_value.get("artist"),
                "similarity": row_value.get("similarity"),
                "metadata": row_value.get("metadata"),
                "violations": violations,
            }
        )
    return _result(
        failures,
        status=status,
        cacheControl=cache_control,
        etag=_header(response, "etag"),
        rows=row_records,
    )


def evaluate_negative_image_probes(
    probes: Mapping[str, Mapping[str, Any]]
) -> dict[str, Any]:
    failures = []
    expected_status = {
        "invalid_mime": {400, 413, 415, 422},
        "zero_byte": {400, 413, 415, 422},
        "multiple_files": {400, 413, 415, 422},
        "oversize": {413},
    }
    for name, accepted_statuses in expected_status.items():
        response = probes.get(name) or {}
        status = int(response.get("status") or 0)
        if status not in accepted_statuses:
            failures.append(
                _failure(f"invalid_image_accepted:{name}", status=status)
            )
        cache_control = (_header(response, "cache-control") or "").lower()
        if response.get("headers") is not None and "no-store" not in cache_control:
            failures.append(
                _failure(f"invalid_image_error_cacheable:{name}", status=status)
            )
    return _result(failures)


def _split_inline_map(value: str) -> list[str]:
    fields = []
    start = 0
    quote: str | None = None
    escaped = False
    depth = 0
    for index, character in enumerate(value):
        if escaped:
            escaped = False
            continue
        if character == "\\" and quote:
            escaped = True
            continue
        if character in {'"', "'"}:
            if quote == character:
                quote = None
            elif quote is None:
                quote = character
            continue
        if quote is not None:
            continue
        if character in "[{":
            depth += 1
        elif character in "]}":
            depth -= 1
        elif character == "," and depth == 0:
            fields.append(value[start:index].strip())
            start = index + 1
    fields.append(value[start:].strip())
    return fields


def _parse_inline_value(value: str) -> Any:
    if value.startswith('"') and value.endswith('"'):
        return json.loads(value)
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "null":
        return None
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    return value


def parse_legacy_cases(path: Path) -> list[dict[str, Any]]:
    cases = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        match = re.match(r"^\s*-\s*\{\s*(.*?)\s*\}\s*$", line)
        if not match:
            continue
        fields: dict[str, Any] = {}
        for field in _split_inline_map(match.group(1)):
            separator = field.find(":")
            if separator < 1:
                raise ValueError(f"invalid legacy field at {path}:{line_number}")
            key = field[:separator].strip()
            fields[key] = _parse_inline_value(field[separator + 1 :].strip())
        if not fields.get("id") or not fields.get("text"):
            raise ValueError(f"missing legacy id/text at {path}:{line_number}")
        constraints: dict[str, Any] = {}
        if "startYear" in fields:
            constraints["dateRange"] = {
                "startYear": fields["startYear"],
                "endYear": fields["endYear"],
            }
        if "classification" in fields:
            constraints["classifications"] = [fields["classification"]]
        if "medium" in fields:
            constraints["mediumFamilies"] = [fields["medium"]]
        expected: dict[str, Any] = {"constraints": constraints}
        if "semanticQuery" in fields:
            expected["semanticQuery"] = fields["semanticQuery"]
        if fields.get("relationKind") and fields.get("relationTarget"):
            work = fields.get("classification")
            if not work:
                raise ValueError(f"legacy relation missing work class at {path}:{line_number}")
            if fields["relationKind"] == "derived_from":
                expected["relation"] = {
                    "kind": "derived_from",
                    "workClassification": work,
                    "sourceClassification": fields["relationTarget"],
                }
            else:
                expected["relation"] = {
                    "kind": fields["relationKind"],
                    "workClassification": work,
                    "subjectClassification": fields["relationTarget"],
                }
        cases.append(
            {
                "id": f"legacy:{fields['id']}",
                "legacyId": fields["id"],
                "category": "legacy",
                "query": fields["text"],
                "expected": expected,
            }
        )
    if len(cases) != 92:
        raise ValueError(f"expected exactly 92 legacy cases, found {len(cases)}")
    if len({case["id"] for case in cases}) != len(cases):
        raise ValueError("duplicate legacy case id")
    return cases


def load_case_inventory(new_path: Path, legacy_path: Path) -> dict[str, Any]:
    document = json.loads(new_path.read_text(encoding="utf-8"))
    if document.get("schemaVersion") != "nga-staging-gate-v1":
        raise ValueError("unexpected staging case schema")
    new_text = document.get("textCases")
    image_cases = document.get("imageCases")
    if not isinstance(new_text, list) or not isinstance(image_cases, list):
        raise ValueError("staging case document requires textCases and imageCases")
    if len(new_text) < 24:
        raise ValueError("full gate requires at least 24 new text cases")
    all_ids = [case.get("id") for case in [*new_text, *image_cases]]
    if any(not isinstance(case_id, str) or not case_id for case_id in all_ids):
        raise ValueError("every staging case requires an id")
    if len(set(all_ids)) != len(all_ids):
        raise ValueError("duplicate staging case id")
    expected_versions = document.get("expectedVersions")
    if expected_versions != EXPECTED_VERSIONS:
        raise ValueError("staging case versions do not match evaluator versions")
    return {
        **document,
        "legacyCases": parse_legacy_cases(legacy_path),
    }


def select_cases(inventory: Mapping[str, Any], phase: str) -> dict[str, Any]:
    new_text = list(inventory["textCases"])
    image_cases = list(inventory["imageCases"])
    if phase == "pilot":
        pilot = inventory["pilot"]
        text_by_id = {case["id"]: case for case in new_text}
        image_by_id = {case["id"]: case for case in image_cases}
        selected_text = [text_by_id[case_id] for case_id in pilot["textCaseIds"]]
        selected_images = [
            image_by_id[case_id] for case_id in pilot["imageCaseIds"]
        ]
        if len(selected_text) != 4 or len(selected_images) != 1:
            raise ValueError("pilot must contain exactly four text and one image case")
        return {
            "text": selected_text,
            "image": selected_images,
            "counts": {"legacy": 0, "newText": 4, "image": 1, "total": 5},
        }
    if phase != "full":
        raise ValueError("phase must be pilot or full")
    legacy = list(inventory["legacyCases"])
    return {
        "text": [*legacy, *new_text],
        "image": image_cases,
        "counts": {
            "legacy": len(legacy),
            "newText": len(new_text),
            "image": len(image_cases),
            "total": len(legacy) + len(new_text) + len(image_cases),
        },
    }


def score_manual_relevance(labels: Sequence[int]) -> dict[str, float]:
    if not isinstance(labels, Sequence) or isinstance(labels, (str, bytes)):
        raise ValueError("human relevance labels must be a sequence")
    if any(type(label) is not int or label < 0 or label > 3 for label in labels):
        raise ValueError("human relevance labels must be integers from 0 to 3")
    if not labels:
        raise ValueError("at least one human relevance label is required")
    top_five = list(labels[:5])
    precision_at_five = sum(label > 0 for label in top_five) / 5
    first_relevant = next((index for index, label in enumerate(labels, 1) if label > 0), None)
    mrr = 0.0 if first_relevant is None else 1 / first_relevant
    top_ten = list(labels[:10])
    dcg = sum(
        (2**label - 1) / math.log2(index + 2)
        for index, label in enumerate(top_ten)
    )
    ideal = sorted(top_ten, reverse=True)
    idcg = sum(
        (2**label - 1) / math.log2(index + 2)
        for index, label in enumerate(ideal)
    )
    return {
        "precisionAt5": precision_at_five,
        "mrr": mrr,
        "ndcgAt10": 0.0 if idcg == 0 else dcg / idcg,
    }


def make_manual_grading_template(
    case_id: str, rows: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    return {
        "caseId": case_id,
        "status": "manual_review_required",
        "instructions": "Assign each relevance field an integer 0-3; do not infer it from similarity.",
        "results": [
            {
                "rank": rank,
                "id": row.get("id"),
                "title": row.get("title"),
                "artist": row.get("artist"),
                "relevance": None,
            }
            for rank, row in enumerate(rows, 1)
        ],
    }


class UrllibTransport:
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str] | None = None,
        body: bytes | None = None,
        timeout: int = 90,
    ) -> dict[str, Any]:
        request = urllib.request.Request(
            url,
            data=body,
            headers=dict(headers or {}),
            method=method,
        )
        started = time.monotonic()
        try:
            response = urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        response_body = response.read()
        content_type = response.headers.get_content_type()
        decoded: Any = None
        if content_type == "application/json" or response_body.lstrip().startswith((b"{", b"[")):
            try:
                decoded = json.loads(response_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                decoded = None
        return {
            "status": int(response.status),
            "headers": {key.lower(): value for key, value in response.headers.items()},
            "json": decoded,
            "body": response_body,
            "elapsedMs": round((time.monotonic() - started) * 1000),
        }


class RequestPacer:
    """Conservative rolling-window limiter for anonymous cold-miss traffic."""

    def __init__(
        self,
        requests_per_minute: int = 8,
        *,
        clock: Any = time.monotonic,
        sleep: Any = time.sleep,
    ) -> None:
        if not 1 <= requests_per_minute <= 9:
            raise ValueError("requests per minute must be between 1 and 9")
        self.requests_per_minute = requests_per_minute
        self.clock = clock
        self.sleep = sleep
        self.timestamps: list[float] = []

    def wait(self) -> None:
        now = float(self.clock())
        self.timestamps = [
            timestamp for timestamp in self.timestamps if now - timestamp < 60.0
        ]
        if len(self.timestamps) >= self.requests_per_minute:
            delay = max(0.0, 60.0 - (now - self.timestamps[0]))
            if delay:
                self.sleep(delay)
            now = float(self.clock())
            self.timestamps = [
                timestamp
                for timestamp in self.timestamps
                if now - timestamp < 60.0
            ]
        self.timestamps.append(now)


def verify_staging_health(transport: Any, api_base_url: str) -> dict[str, Any]:
    response = transport.request("GET", f"{api_base_url}/health")
    payload = _response_json(response)
    if (
        response.get("status") != 200
        or payload.get("status") != "healthy"
        or payload.get("environment") != "staging"
    ):
        raise GateStopped(
            "API health did not prove status=healthy and environment=staging"
        )
    return {
        "status": response.get("status"),
        "headers": response.get("headers"),
        "body": payload,
        "elapsedMs": response.get("elapsedMs"),
    }


def observe_local_versions(repo_root: Path) -> dict[str, str]:
    core = (repo_root / "packages/types/src/public-search-core.ts").read_text(
        encoding="utf-8"
    )
    cache = (
        repo_root / "apps/api/src/utils/public-search-result-cache.ts"
    ).read_text(encoding="utf-8")
    parser = (
        repo_root / "apps/api/src/utils/nga-search-intent.ts"
    ).read_text(encoding="utf-8")
    contract_match = re.search(r"PUBLIC_SEARCH_CONTRACT_VERSION\s*=\s*'([^']+)'", core)
    plan_match = re.search(r"version:\s*'(nga-plan-v\d+)'", core)
    cache_match = re.search(r"PUBLIC_SEARCH_RESULT_CACHE_KEY_VERSION\s*=\s*(\d+)", cache)
    parser_match = re.search(
        r"NGA_SEARCH_PARSER_VERSION\s*=\s*'(nga-v\d+)'", parser
    )
    if not all((contract_match, plan_match, cache_match, parser_match)):
        raise ValueError("could not observe local search versions")
    return {
        "parser": parser_match.group(1),
        "plan": plan_match.group(1),
        "contract": contract_match.group(1),
        "apiResultCache": f"v{cache_match.group(1)}",
    }


def canonical_text_identity(case: Mapping[str, Any]) -> str:
    request_value = case.get("request")
    request = request_value if isinstance(request_value, Mapping) else {}
    return sha256_json(
        {
            "contractVersion": EXPECTED_VERSIONS["contract"],
            "query": re.sub(r"\s+", " ", str(case.get("query") or "").strip()),
            "facet": request.get("facet"),
            "constraints": normalize_constraints(request.get("constraints"))
            if "constraints" in request
            else None,
            "topK": int(request.get("topK", 30)),
            "minScore": float(request.get("minScore", 0)),
        }
    )


def _text_request_body(case: Mapping[str, Any]) -> dict[str, Any]:
    request_value = case.get("request")
    request = dict(request_value) if isinstance(request_value, Mapping) else {}
    return {
        "query": case["query"],
        "topK": int(request.pop("topK", 30)),
        "minScore": float(request.pop("minScore", 0)),
        **request,
    }


def _post_json(transport: Any, url: str, body: Mapping[str, Any]) -> dict[str, Any]:
    return transport.request(
        "POST",
        url,
        headers={"content-type": "application/json"},
        body=canonical_json(body).encode("utf-8"),
    )


def _multipart(
    fields: Sequence[tuple[str, str]],
    files: Sequence[tuple[str, str, str, bytes]],
) -> tuple[str, bytes]:
    boundary = f"paillette-nga-gate-{sha256_json([fields, [(a, b, c, len(d)) for a, b, c, d in files]])[:24]}"
    chunks: list[bytes] = []
    for name, value in fields:
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    for name, filename, mime_type, value in files:
        safe_filename = filename.replace('"', "")
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                (
                    f'Content-Disposition: form-data; name="{name}"; '
                    f'filename="{safe_filename}"\r\n'
                ).encode(),
                f"Content-Type: {mime_type}\r\n\r\n".encode(),
                value,
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode())
    return boundary, b"".join(chunks)


def _post_image(
    transport: Any,
    url: str,
    *,
    files: Sequence[tuple[str, str, str, bytes]],
    constraints: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    fields = [("topK", "30"), ("minScore", "0")]
    if constraints is not None:
        fields.append(("constraints", canonical_json(normalize_constraints(constraints))))
    boundary, body = _multipart(fields, files)
    return transport.request(
        "POST",
        url,
        headers={"content-type": f"multipart/form-data; boundary={boundary}"},
        body=body,
        timeout=120,
    )


def _safe_response(response: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "status": response.get("status"),
        "elapsedMs": response.get("elapsedMs"),
        "headers": response.get("headers"),
        "json": response.get("json"),
        "bodyLength": len(response.get("body") or b""),
        "bodySha256": sha256_bytes(response.get("body") or b""),
    }


def _load_fixture_manifest(path: Path) -> dict[str, Mapping[str, Any]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schemaVersion") != "nga-image-fixtures-v1":
        raise ValueError("unexpected image fixture schema")
    fixtures = document.get("fixtures")
    if not isinstance(fixtures, list) or len(fixtures) != 3:
        raise ValueError("image fixture manifest must pin exactly three fixtures")
    result = {}
    for fixture in fixtures:
        if not isinstance(fixture, Mapping):
            raise ValueError("invalid image fixture")
        url = str(fixture.get("url") or "")
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != "api.nga.gov":
            raise ValueError("fixture URL must use exact api.nga.gov host")
        result[str(fixture["artworkId"])] = fixture
    return result


def _download_fixture(transport: Any, fixture: Mapping[str, Any]) -> bytes:
    response = transport.request("GET", str(fixture["url"]), timeout=120)
    body = response.get("body") or b""
    actual_mime = (_header(response, "content-type") or "").split(";", 1)[0].strip()
    if response.get("status") != 200:
        raise GateStopped(f"fixture download failed: {fixture['artworkId']}")
    if actual_mime != fixture["mimeType"]:
        raise GateStopped(
            f"fixture MIME changed: {fixture['artworkId']} {actual_mime!r}"
        )
    if len(body) != fixture["byteLength"]:
        raise GateStopped(
            f"fixture length changed: {fixture['artworkId']} {len(body)}"
        )
    actual_digest = sha256_bytes(body)
    if actual_digest != fixture["sha256"]:
        raise GateStopped(
            f"fixture digest changed: {fixture['artworkId']} {actual_digest}"
        )
    return body


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _git_sha(repo_root: Path) -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def extract_web_contract_versions(response: Mapping[str, Any]) -> list[str]:
    body = response.get("body") or b""
    text = body.decode("utf-8", errors="replace")
    link_header = _header(response, "link") or ""
    versions = sorted(
        set(
            re.findall(
                r"search-spotlights/nga/v(\d+)-[a-f0-9]{64}\.json",
                f"{link_header}\n{text}",
            )
        )
    )
    return versions


def resolve_observed_versions(
    local_versions: Mapping[str, str], live_contract_versions: Sequence[str]
) -> dict[str, str]:
    observed = dict(local_versions)
    if len(live_contract_versions) == 1:
        observed["contract"] = live_contract_versions[0]
    elif not live_contract_versions:
        observed["contract"] = "unobserved"
    else:
        observed["contract"] = "ambiguous:" + ",".join(live_contract_versions)
    return observed


def _observe_web_contract(transport: Any, web_base_url: str) -> dict[str, Any]:
    response = transport.request("GET", f"{web_base_url}/nga/search")
    body = response.get("body") or b""
    return {
        "status": response.get("status"),
        "contractVersions": extract_web_contract_versions(response),
        "bodySha256": sha256_bytes(body),
        "bodyLength": len(body),
    }


@dataclasses.dataclass(frozen=True)
class RunConfig:
    phase: str
    snapshot: str
    api_base_url: str
    web_base_url: str
    out_dir: Path
    fail_on_gates: bool
    repo_root: Path
    requests_per_minute: int = 8


def run_gate(config: RunConfig, transport: Any | None = None) -> dict[str, Any]:
    # This is the first executable line by design. No files or clients are
    # created until both user-provided origins pass exact equality.
    validate_staging_origins(config.api_base_url, config.web_base_url)
    network = transport or UrllibTransport()
    pacer = RequestPacer(config.requests_per_minute)
    health = verify_staging_health(network, config.api_base_url)

    inventory = load_case_inventory(
        config.repo_root / "eval/nga-staging-cases.yaml",
        config.repo_root / "eval/nga-constraint-queries.yaml",
    )
    selected = select_cases(inventory, config.phase)
    local_versions = observe_local_versions(config.repo_root)
    web_contract = _observe_web_contract(network, config.web_base_url)
    live_contract_versions = web_contract["contractVersions"]
    observed_versions = resolve_observed_versions(
        local_versions, live_contract_versions
    )

    started_at = utc_now()
    candidate_sha = _git_sha(config.repo_root)
    config.out_dir.mkdir(parents=True, exist_ok=True)
    identity = {
        "generatedAt": started_at,
        "gitSha": candidate_sha,
        "phase": config.phase,
        "snapshot": config.snapshot,
        "apiBaseUrl": config.api_base_url,
        "webBaseUrl": config.web_base_url,
        "expectedVersions": EXPECTED_VERSIONS,
        "observedVersions": observed_versions,
        "publicSearchRequestsPerMinute": config.requests_per_minute,
        "health": health,
        "webContract": web_contract,
    }
    _write_json(config.out_dir / "identity.json", identity)
    _write_json(
        config.out_dir / "case-inventory.json",
        {
            "counts": selected["counts"],
            "textCaseIds": [case["id"] for case in selected["text"]],
            "imageCaseIds": [case["id"] for case in selected["image"]],
        },
    )

    text_results = []
    manual_templates = []
    text_endpoint = f"{config.web_base_url}/api/public-search/nga/text"
    for case in selected["text"]:
        request_body = _text_request_body(case)
        pacer.wait()
        response = _post_json(network, text_endpoint, request_body)
        evaluated = evaluate_text_case(case, response, observed_versions)
        record = {
            "case": case,
            "request": {
                "url": text_endpoint,
                "method": "POST",
                "body": request_body,
                "identity": canonical_text_identity(case),
            },
            "response": _safe_response(response),
            "evaluation": evaluated,
        }
        text_results.append(record)
        _write_json(config.out_dir / "raw/text" / f"{case['id'].replace(':', '_')}.json", record)
        if case.get("manualGradeTop"):
            rows = [
                {
                    "id": row.get("id"),
                    "title": row.get("title"),
                    "artist": row.get("artist"),
                }
                for row in evaluated["rows"][: int(case["manualGradeTop"])]
            ]
            manual_templates.append(make_manual_grading_template(case["id"], rows))

    # The cache probe is ancillary and is not counted among the five pilot cases.
    cache_token = sha256_json(
        {
            "gitSha": candidate_sha,
            "snapshot": config.snapshot,
            "evidenceDir": config.out_dir.name,
        }
    )[:12]
    cache_case = {
        "id": "cache-probe",
        "query": f"validation {cache_token} oil paintings after 1700 before 1800",
        "expected": {
            "constraints": {
                "dateRange": {"startYear": 1701, "endYear": 1799},
                "classifications": ["Painting"],
                "mediumFamilies": ["oil"],
            }
        },
    }
    changed_cache_case = {
        **cache_case,
        "id": "cache-probe-changed",
        "request": {"constraints": {"classifications": ["Drawing"]}},
        "expected": {"constraints": {"classifications": ["Drawing"]}},
    }
    pacer.wait()
    cache_first = _post_json(network, text_endpoint, _text_request_body(cache_case))
    time.sleep(1.0)
    # The exact repeat should be served by the web cache and does not consume a
    # cold-miss slot. If it is not, the cache probe fails independently.
    cache_repeat = _post_json(network, text_endpoint, _text_request_body(cache_case))
    pacer.wait()
    cache_changed = _post_json(
        network, text_endpoint, _text_request_body(changed_cache_case)
    )
    cache_probe = evaluate_text_cache_probe(
        cache_first,
        cache_repeat,
        cache_changed,
        first_identity=canonical_text_identity(cache_case),
        changed_identity=canonical_text_identity(changed_cache_case),
        snapshot=config.snapshot,
    )
    cache_record = {
        "query": cache_case["query"],
        "changedRequest": _text_request_body(changed_cache_case),
        "first": _safe_response(cache_first),
        "repeat": _safe_response(cache_repeat),
        "changed": _safe_response(cache_changed),
        "evaluation": cache_probe,
    }
    _write_json(config.out_dir / "raw/cache-probe.json", cache_record)

    fixture_manifest = _load_fixture_manifest(
        config.repo_root / "eval/nga-image-fixtures.json"
    )
    needed_fixture_ids = sorted({case["fixtureId"] for case in selected["image"]})
    fixture_bytes = {
        fixture_id: _download_fixture(network, fixture_manifest[fixture_id])
        for fixture_id in needed_fixture_ids
    }
    _write_json(
        config.out_dir / "fixtures-manifest.json",
        {
            "fixtures": [fixture_manifest[fixture_id] for fixture_id in needed_fixture_ids],
            "note": "Full image bytes were verified in memory and were not written to evidence.",
        },
    )

    image_endpoint = f"{config.web_base_url}/api/public-search/nga/image"
    image_results = []
    for case in selected["image"]:
        fixture = fixture_manifest[case["fixtureId"]]
        image_bytes = fixture_bytes[case["fixtureId"]]
        pacer.wait()
        response = _post_image(
            network,
            image_endpoint,
            files=[("image", case["filename"], fixture["mimeType"], image_bytes)],
            constraints=case.get("constraints"),
        )
        evaluated = evaluate_image_response(response, case.get("constraints"))
        if case.get("expectedZeroResults") and evaluated["rows"]:
            evaluated["failures"].append(
                _failure("expected_zero_results", actual=len(evaluated["rows"]))
            )
            evaluated["failureCodes"].append("expected_zero_results")
            evaluated["passed"] = False
        record = {
            "case": case,
            "request": {
                "url": image_endpoint,
                "method": "POST",
                "filename": case["filename"],
                "mimeType": fixture["mimeType"],
                "byteLength": len(image_bytes),
                "sha256": sha256_bytes(image_bytes),
                "constraints": normalize_constraints(case.get("constraints")),
                "identity": canonical_image_identity(
                    image_bytes,
                    case["filename"],
                    case.get("constraints"),
                    30,
                    0,
                ),
            },
            "response": _safe_response(response),
            "evaluation": evaluated,
        }
        image_results.append(record)
        _write_json(config.out_dir / "raw/image" / f"{case['id']}.json", record)

    first_image_case = selected["image"][0]
    first_fixture = fixture_manifest[first_image_case["fixtureId"]]
    first_bytes = fixture_bytes[first_image_case["fixtureId"]]
    pacer.wait()
    repeated_response = _post_image(
        network,
        image_endpoint,
        files=[("image", first_image_case["filename"], first_fixture["mimeType"], first_bytes)],
        constraints=first_image_case.get("constraints"),
    )
    repeated_eval = evaluate_image_response(
        repeated_response, first_image_case.get("constraints")
    )
    stable_first = canonical_image_identity(
        first_bytes,
        first_image_case["filename"],
        first_image_case.get("constraints"),
        30,
        0,
    )
    stable_repeat = canonical_image_identity(
        first_bytes,
        f"renamed-{first_image_case['filename']}",
        first_image_case.get("constraints"),
        30,
        0,
    )
    changed_bytes = first_bytes + b"\x00"
    changed_constraints = {"classifications": ["Drawing"]}
    identity_probe = evaluate_image_identity_probe(
        stable_first=stable_first,
        stable_repeat=stable_repeat,
        same_name_first=stable_first,
        same_name_changed=canonical_image_identity(
            changed_bytes,
            first_image_case["filename"],
            first_image_case.get("constraints"),
            30,
            0,
        ),
        constraint_first=stable_first,
        constraint_changed=canonical_image_identity(
            first_bytes,
            first_image_case["filename"],
            changed_constraints,
            30,
            0,
        ),
    )
    image_probe_record = {
        "stableIdentity": stable_first,
        "repeat": {
            "response": _safe_response(repeated_response),
            "evaluation": repeated_eval,
        },
        "identityEvaluation": identity_probe,
    }
    _write_json(config.out_dir / "raw/image-identity-probe.json", image_probe_record)

    negative_record: dict[str, Any] | None = None
    if config.phase == "full":
        negative_specs = {
            "invalid_mime": [("image", "not-image.txt", "text/plain", b"not an image")],
            "zero_byte": [("image", "empty.jpg", "image/jpeg", b"")],
            "multiple_files": [
                ("image", "one.jpg", "image/jpeg", first_bytes),
                ("image", "two.jpg", "image/jpeg", first_bytes),
            ],
            "oversize": [
                (
                    "image",
                    "oversize.jpg",
                    "image/jpeg",
                    b"\xff\xd8" + bytes(MAX_IMAGE_BYTES - 1),
                )
            ],
        }
        negative_responses = {}
        for name, files in negative_specs.items():
            pacer.wait()
            negative_responses[name] = _post_image(
                network, image_endpoint, files=files
            )
        negative_evaluation = evaluate_negative_image_probes(negative_responses)
        negative_record = {
            "responses": {
                name: _safe_response(response)
                for name, response in negative_responses.items()
            },
            "evaluation": negative_evaluation,
        }
        _write_json(config.out_dir / "raw/image-negative-probes.json", negative_record)

    ngs_response = _post_json(
        network,
        f"{config.web_base_url}/api/public-search/ngs/text",
        {"query": "paintings", "topK": 30, "minScore": 0},
    )
    ngs_probe = evaluate_ngs_probe(ngs_response)
    _write_json(
        config.out_dir / "raw/ngs-probe.json",
        {"response": _safe_response(ngs_response), "evaluation": ngs_probe},
    )
    _write_json(
        config.out_dir / "manual-relevance.json",
        {
            "status": "manual_review_required" if manual_templates else "not_applicable",
            "cases": manual_templates,
        },
    )

    all_failures = []
    for item in text_results:
        all_failures.extend(
            {"scope": "text", "caseId": item["case"]["id"], **failure}
            for failure in item["evaluation"]["failures"]
        )
    for item in image_results:
        all_failures.extend(
            {"scope": "image", "caseId": item["case"]["id"], **failure}
            for failure in item["evaluation"]["failures"]
        )
    all_failures.extend(
        {"scope": "cache", **failure} for failure in cache_probe["failures"]
    )
    all_failures.extend(
        {"scope": "image-identity", **failure}
        for failure in identity_probe["failures"]
    )
    all_failures.extend(
        {"scope": "image-repeat", **failure}
        for failure in repeated_eval["failures"]
    )
    if negative_record:
        all_failures.extend(
            {"scope": "image-negative", **failure}
            for failure in negative_record["evaluation"]["failures"]
        )
    all_failures.extend(
        {"scope": "ngs", **failure} for failure in ngs_probe["failures"]
    )
    if web_contract["status"] != 200:
        all_failures.append(
            {"scope": "web", "code": "nga_search_page_failed", "status": web_contract["status"]}
        )
    if observed_versions != EXPECTED_VERSIONS:
        all_failures.append(
            {
                "scope": "versions",
                "code": "version_mismatch",
                "expected": EXPECTED_VERSIONS,
                "actual": observed_versions,
            }
        )

    summary = {
        "generatedAt": utc_now(),
        "startedAt": started_at,
        "gitSha": candidate_sha,
        "snapshot": config.snapshot,
        "phase": config.phase,
        "publicSearchRequestsPerMinute": config.requests_per_minute,
        "hosts": {
            "api": config.api_base_url,
            "web": config.web_base_url,
        },
        "versions": {
            "expected": EXPECTED_VERSIONS,
            "observed": observed_versions,
        },
        "caseCounts": selected["counts"],
        "text": {
            "selected": len(text_results),
            "passed": sum(item["evaluation"]["passed"] for item in text_results),
        },
        "image": {
            "selected": len(image_results),
            "passed": sum(item["evaluation"]["passed"] for item in image_results),
        },
        "cacheProbe": cache_probe,
        "imageIdentityProbe": identity_probe,
        "ngsProbe": ngs_probe,
        "manualRelevance": {
            "status": "manual_review_required" if manual_templates else "not_applicable",
            "caseCount": len(manual_templates),
            "metrics": None,
        },
        "gatePassed": not all_failures,
        "failureCount": len(all_failures),
        "gateFailures": all_failures,
        "limitations": [
            "Relation relevance requires independent 0-3 human labels; similarity is never used as truth.",
            "NGS non-upstream contact is inferred from the public proxy's scope-forbidden response and is also checked in the browser gate.",
            "The positive image artist case uses a deliberately nonexistent canonical ID because the current public fixture metadata exposes no stable positive artist ID; any returned row still fails the exact-ID backstop.",
            "Plan and API result-cache versions are observed from the exact local candidate and must be bound to the live deployment by Task 7 exact-deployment identity; parser and web contract versions are externally observed.",
            "Semantic text-plus-image fusion is intentionally out of scope.",
        ],
    }
    _write_json(config.out_dir / "summary.json", summary)
    markdown = [
        f"# NGA staging gate — {config.snapshot} {config.phase}",
        "",
        f"- Generated: {summary['generatedAt']}",
        f"- Git SHA: `{candidate_sha}`",
        f"- Hosts: `{config.api_base_url}`, `{config.web_base_url}`",
        f"- Cases: {selected['counts']}",
        f"- Hard gate: {'PASS' if summary['gatePassed'] else 'FAIL'}",
        f"- Failures: {summary['failureCount']}",
        f"- Relation grading: {summary['manualRelevance']['status']}",
        "",
        "## Gate failures",
        "",
    ]
    if all_failures:
        markdown.extend(
            f"- `{failure['scope']}:{failure['code']}`"
            + (f" ({failure.get('caseId')})" if failure.get("caseId") else "")
            for failure in all_failures
        )
    else:
        markdown.append("- None")
    markdown.extend(["", "## Limitations", ""])
    markdown.extend(f"- {item}" for item in summary["limitations"])
    (config.out_dir / "summary.md").write_text("\n".join(markdown) + "\n", encoding="utf-8")

    artifact_hashes = {}
    for path in sorted(config.out_dir.rglob("*")):
        if path.is_file() and path.name != "hashes.json":
            artifact_hashes[str(path.relative_to(config.out_dir))] = {
                "sha256": sha256_bytes(path.read_bytes()),
                "byteLength": path.stat().st_size,
            }
    _write_json(config.out_dir / "hashes.json", artifact_hashes)
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the exact-host NGA staging search release gate."
    )
    parser.add_argument("--phase", choices=("pilot", "full"), required=True)
    parser.add_argument(
        "--snapshot", choices=("baseline", "candidate"), required=True
    )
    parser.add_argument("--api-base-url", required=True)
    parser.add_argument("--web-base-url", required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--fail-on-gates", action="store_true")
    parser.add_argument(
        "--public-search-requests-per-minute",
        type=int,
        default=8,
        help="Anonymous request pace (1-9); default leaves headroom below the API limit.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = Path(__file__).resolve().parents[1]
    try:
        summary = run_gate(
            RunConfig(
                phase=args.phase,
                snapshot=args.snapshot,
                api_base_url=args.api_base_url,
                web_base_url=args.web_base_url,
                out_dir=args.out_dir.resolve(),
                fail_on_gates=args.fail_on_gates,
                repo_root=repo_root,
                requests_per_minute=args.public_search_requests_per_minute,
            )
        )
    except (GateStopped, ValueError, urllib.error.URLError) as error:
        print(f"NGA staging gate stopped: {error}", file=sys.stderr)
        return 2
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.fail_on_gates and not summary["gatePassed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
