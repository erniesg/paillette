#!/usr/bin/env python3
"""Host-locked, no-login NGA staging release evaluator.

The validators in this module are intentionally pure. Network execution is
kept behind exact-origin validation so a typo can never redirect the gate to
production or to a deceptive host.
"""

from __future__ import annotations

import argparse
import base64
import dataclasses
import datetime as dt
import hashlib
import json
import math
import re
import secrets
import struct
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from pathlib import Path
from typing import Any, Mapping, Sequence


EXPECTED_API_ORIGIN = "https://paillette-api-stg.berlayar.ai"
EXPECTED_WEB_ORIGIN = "https://paillette-stg.berlayar.ai"
EVALUATOR_USER_AGENT = "Paillette-NGA-Staging-Gate/1.0"
EXPECTED_VERSIONS = {
    "parser": "nga-v7",
    "plan": "nga-plan-v2",
    "contract": "29",
    "apiResultCache": "v8",
}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
PLAYWRIGHT_COOLDOWN_SECONDS = 60
REQUEST_COOLDOWN_SECONDS = 60
MANUAL_RELEVANCE_MINIMUMS = {
    "precisionAt5": 0.2,
    "mrr": 0.2,
    "ndcgAt10": 0.7,
}
PLAYWRIGHT_TEST_COUNT = 9
PLAYWRIGHT_PUBLIC_SEARCH_REQUEST_BUDGET = 8
PILOT_TEXT_CASE_IDS = (
    "relation-active-depicts",
    "relation-passive-depicts",
    "classification-list",
    "combined-oil-ships-date",
)
PILOT_IMAGE_CASE_IDS = (
    "image-artist",
    "image-artist-wrong-primary",
    "image-artist-secondary-control",
)
PILOT_RELATION_CASE_IDS = (
    "relation-active-depicts",
    "relation-passive-depicts",
)
PLAYWRIGHT_SCREENSHOTS = (
    "01-image-pre-upload.png",
    "02-text-owned-image-editor.png",
    "03-image-owner-local-palette.png",
    "04-live-same-name.png",
    "05-controlled-replacement-ownership.png",
    "06-invalid-upload-preserves-results.png",
    "08-direct-artist-attribution.png",
    "09-derived-verified-empty.png",
    "07-ngs-locked.png",
)
PLAYWRIGHT_SPEC_TITLES = (
    "pre-upload Image is compact, accessible, truthful, and passive",
    "Text remains the truthful result owner while Image is only being edited",
    "constrained Image becomes owner and Palette order stays local",
    "separate live same-filename image requests execute distinctly",
    "controlled out-of-order image responses keep replacement result ownership",
    "invalid uploads preserve prior results and expose an alert",
    "direct artist attribution returns the pinned primary-artist fixture",
    "derived relation empty state reports unverified catalogue evidence",
    "NGS stays visibly locked and sends no public-search request",
)
PLAYWRIGHT_SPEC_IDS = (
    "d1c3b58c6b8000469ec5-199dd5869c1d0ade8048",
    "d1c3b58c6b8000469ec5-49ba2302c2b118fbe2f3",
    "d1c3b58c6b8000469ec5-4350d3d8f1f78314881d",
    "d1c3b58c6b8000469ec5-5aeb23a432ab4df1c50c",
    "d1c3b58c6b8000469ec5-1788ccaa5c6cbf7ba7ef",
    "d1c3b58c6b8000469ec5-b87deb1a9d50a0245a51",
    "d1c3b58c6b8000469ec5-0f940651da0b878f8942",
    "d1c3b58c6b8000469ec5-9d59bbae641205ec3b17",
    "d1c3b58c6b8000469ec5-00841a90e29eb411d3b7",
)
PLAYWRIGHT_ARTIFACT_DIRECTORIES = (
    "nga-staging-gate-anonymous-9984a-ssible-truthful-and-passive-nga-staging-chrome",
    "nga-staging-gate-anonymous-356fc--Image-is-only-being-edited-nga-staging-chrome",
    "nga-staging-gate-anonymous-5db73-d-Palette-order-stays-local-nga-staging-chrome",
    "nga-staging-gate-anonymous-60fa1-requests-execute-distinctly-nga-staging-chrome",
    "nga-staging-gate-anonymous-9934e-eplacement-result-ownership-nga-staging-chrome",
    "nga-staging-gate-anonymous-f48c0-results-and-expose-an-alert-nga-staging-chrome",
    "nga-staging-gate-anonymous-9855a-nned-primary-artist-fixture-nga-staging-chrome",
    "nga-staging-gate-anonymous-6806a-verified-catalogue-evidence-nga-staging-chrome",
    "nga-staging-gate-anonymous-9b265-ds-no-public-search-request-nga-staging-chrome",
)
PLAYWRIGHT_PROJECT_NAME = "nga-staging-chrome"
RUN_ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")
RETAINED_RELEVANCE_SCHEMA = "nga-retained-relevance-labels-v1"
NGA_SOURCE_COMMIT = "79d114c2186ca38af27a9478717f1e509d799495"
NGA_FULL_STAGED_COUNT = 63_253
NGA_PILOT_OBJECT_IDS = ("131994", "110821", "11236", "38", "579")
NGA_PILOT_PRIMARY_ARTISTS = {
    "131994": "1364",
    "110821": "23812",
    "11236": "1974",
    "38": "119",
    "579": "1507",
}
NGA_SOURCE_SHA256 = {
    "objects.csv": "0435ee2468c5043046daef4a0c39badb586d52d4ed24712287423a4897961d67",
    "published_images.csv": "8fb22d56ba09490937fb54ff07560c18ca4eb3468c24aa91167eeb4e9cc3a16d",
    "objects_constituents.csv": "a460accc402ad8b0130e3b108f9bc9d03ac9621721db9ef713f944205eba6c1d",
    "constituents.csv": "090ed9c7d71a3fb83660bbf0e52d6b6a133eab60bf87b4115a4b36bb9042d3b9",
    "constituents_altnames.csv": "129547888f858aa15d951dff27c6761abd308357a1c0787438ded8091964a44f",
}
NGA_SOURCE_HEADERS = {
    "objects.csv": "objectid,uuid,accessioned,accessionnum,locationid,title,displaydate,beginyear,endyear,visualbrowsertimespan,medium,dimensions,inscription,markings,attributioninverted,attribution,provenancetext,creditline,classification,subclassification,visualbrowserclassification,parentid,isvirtual,departmentabbr,portfolio,series,volume,watermarks,lastdetectedmodification,wikidataid,customprinturl",
    "published_images.csv": "uuid,iiifurl,iiifthumburl,viewtype,sequence,width,height,maxpixels,openaccess,created,modified,depictstmsobjectid,assistivetext",
    "objects_constituents.csv": "objectid,constituentid,displayorder,roletype,role,prefix,suffix,displaydate,beginyear,endyear,country,zipcode",
    "constituents.csv": "constituentid,uuid,ulanid,preferreddisplayname,forwarddisplayname,lastname,displaydate,artistofngaobject,beginyear,endyear,visualbrowsertimespan,nationality,visualbrowsernationality,constituenttype,wikidataid",
    "constituents_altnames.csv": "altnameid,constituentid,lastname,displayname,forwarddisplayname,nametype",
}
NGA_STAGING_ORG_ID = "eabbf000-708e-4d4c-8ac8-966b59d4fcac"
NGA_STAGING_D1_DATABASE = "paillette-db-stg"
NGA_STAGING_IMAGE_VECTOR_INDEX = "paillette-embeddings-v2-stg"
PRODUCTION_IDENTITY_PATHS = {
    phase: {
        "trustedPreflight": "preflight/production-identity.json",
        "before": f"candidate/production-identity/{phase}/before.json",
        "after": f"candidate/production-identity/{phase}/after.json",
    }
    for phase in ("pilot", "full")
}
ARTIST_STATE_PATHS = {
    "pilot": {
        "preflightManifests": ["preflight/pilot/preflight-manifest.json"],
        "postApplyVerification": "candidate/post-apply/pilot/verification.json",
    },
    "full": {
        "preflightManifests": [
            "preflight/pilot/preflight-manifest.json",
            "preflight/full-remaining/preflight-manifest.json",
        ],
        "postApplyVerification": "candidate/post-apply/full/verification.json",
    },
}
PRODUCTION_IDENTITY_ROLES = {
    "trustedPreflight": "trusted_preflight",
    "before": "before",
    "after": "after",
}
DEPLOYMENT_IDENTITY_API_FIELDS = {
    "origin",
    "deploymentId",
    "versionId",
    "gitSha",
    "apiVersion",
    "parserVersion",
    "planVersion",
    "resultCacheVersion",
}
DEPLOYMENT_IDENTITY_WEB_FIELDS = {
    "origin",
    "deploymentId",
    "versionId",
    "gitSha",
    "contractVersion",
}
ARTIST_DATA_BINDING_FIELDS = {
    "schemaVersion",
    "artifactManifest",
    "preflightManifests",
    "postApplyVerification",
    "productionIdentity",
}
PRODUCTION_IDENTITY_FIELDS = set(PRODUCTION_IDENTITY_ROLES)
BOUND_ARTIFACT_DESCRIPTOR_FIELDS = {"path", "sha256"}
LOCAL_VERSION_SOURCE_PATHS = (
    "packages/types/src/public-search-core.ts",
    "apps/api/src/utils/public-search-result-cache.ts",
    "apps/api/src/utils/nga-search-intent.ts",
)
IDENTITY_EVIDENCE_PATHS = {
    "deploymentIdentity": "raw/identity/deployment-identity.json",
    "localVersions": "raw/identity/local-versions.json",
    "requestPolicy": "raw/identity/request-policy.json",
    "health": "raw/identity/health.json",
    "webContract": "raw/identity/web-contract.json",
}
EXPECTED_PRODUCTION_RESOURCES = {
    "api": {
        "environment": "production",
        "service": "paillette-api",
        "origin": "https://paillette-api.berlayar.ai",
    },
    "web": {
        "environment": "production",
        "service": "paillette",
        "origin": "https://paillette.berlayar.ai",
    },
}
MAX_EVIDENCE_JSON_BYTES = 2 * 1024 * 1024
MAX_EVIDENCE_HEADERS_BYTES = 64 * 1024
VALID_REPEAT_CACHE_STATES = {"HIT", "KV-FRESH", "COALESCED"}
VALID_FIRST_CACHE_STATES = {"MISS"}
VALID_TEXT_CACHE_STATES = {
    "MISS",
    "HIT",
    "KV-FRESH",
    "KV-STALE",
    "COALESCED",
}
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


def start_evidence_run(out_dir: Path) -> str:
    """Atomically reserve a fresh evidence root and return its random nonce."""
    if out_dir.exists():
        raise GateStopped(f"evidence output directory already exists: {out_dir}")
    try:
        out_dir.mkdir(parents=True, exist_ok=False)
    except FileExistsError as error:
        raise GateStopped(
            f"evidence output directory already exists: {out_dir}"
        ) from error
    return secrets.token_hex(16)


def run_binding(
    *,
    run_id: str,
    snapshot: str,
    evaluator_git_sha: str,
    deployment_identity_hash: str,
) -> dict[str, str]:
    return {
        "runId": run_id,
        "snapshot": snapshot,
        "evaluatorGitSha": evaluator_git_sha,
        "deploymentIdentityHash": deployment_identity_hash,
    }


def build_playwright_handoff(
    *,
    run_id: str,
    phase: str,
    snapshot: str,
    evaluator_git_sha: str,
    deployment_identity_hash: str,
    completed_at: dt.datetime | None = None,
) -> dict[str, Any]:
    completed = completed_at or dt.datetime.now(dt.timezone.utc)
    if completed.tzinfo is None:
        raise ValueError("Playwright handoff completion time must be timezone-aware")
    completed = completed.astimezone(dt.timezone.utc)
    not_before = completed + dt.timedelta(seconds=PLAYWRIGHT_COOLDOWN_SECONDS)
    return {
        **run_binding(
            run_id=run_id,
            snapshot=snapshot,
            evaluator_git_sha=evaluator_git_sha,
            deployment_identity_hash=deployment_identity_hash,
        ),
        "schemaVersion": "nga-playwright-handoff-v1",
        "phase": phase,
        "pythonCompletedAt": completed.isoformat().replace("+00:00", "Z"),
        "playwrightNotBefore": not_before.isoformat().replace("+00:00", "Z"),
        "cooldownSeconds": PLAYWRIGHT_COOLDOWN_SECONDS,
        "browserPublicSearchRequestBudget": PLAYWRIGHT_PUBLIC_SEARCH_REQUEST_BUDGET,
        "expectedTestCount": PLAYWRIGHT_TEST_COUNT,
    }


def build_request_cooldown_handoff(
    *,
    binding: Mapping[str, str],
    phase: str,
    request_timing_sha256: str,
    last_public_request_at: str,
) -> dict[str, Any]:
    last = _parse_utc_timestamp(last_public_request_at)
    if last is None:
        raise ValueError("last public request time must be timezone-aware")
    return {
        **binding,
        "schemaVersion": "nga-request-cooldown-handoff-v1",
        "phase": phase,
        "requestTimingPath": "raw/request-timing.json",
        "requestTimingSha256": request_timing_sha256,
        "lastPublicRequestAt": last_public_request_at,
        "nextRunNotBefore": (
            last + dt.timedelta(seconds=REQUEST_COOLDOWN_SECONDS)
        ).isoformat().replace("+00:00", "Z"),
        "cooldownSeconds": REQUEST_COOLDOWN_SECONDS,
    }


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _semantic_d1_snapshot(row_value: Any) -> dict[str, Any] | None:
    if not isinstance(row_value, Mapping):
        return None
    row = dict(row_value)
    for field in ("custom_metadata", "field_sources"):
        value = row.get(field)
        if value is None or value == "":
            parsed: Any = {}
        elif isinstance(value, Mapping):
            parsed = dict(value)
        elif isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return None
        else:
            return None
        if not isinstance(parsed, Mapping):
            return None
        row[field] = dict(parsed)
    return row


def _semantic_d1_snapshots_equal(left: Any, right: Any) -> bool:
    normalized_left = _semantic_d1_snapshot(left)
    normalized_right = _semantic_d1_snapshot(right)
    return (
        normalized_left is not None
        and normalized_right is not None
        and canonical_json(normalized_left) == canonical_json(normalized_right)
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(canonical_json(value).encode("utf-8"))


def evaluate_pilot_full_identity_continuity(
    pilot_identity: Mapping[str, Any],
    full_identity: Mapping[str, Any],
    *,
    evidence_root: Path | None = None,
) -> dict[str, Any]:
    """Allow only the documented pilot-to-full evidence rebinding."""
    failures: list[dict[str, Any]] = []
    for phase, identity in (("pilot", pilot_identity), ("full", full_identity)):
        api_value = identity.get("api")
        api = api_value if isinstance(api_value, Mapping) else {}
        evaluator_git_sha = api.get("gitSha")
        schema_evaluation = evaluate_deployment_binding(
            identity,
            snapshot="candidate",
            evaluator_git_sha=(
                evaluator_git_sha if isinstance(evaluator_git_sha, str) else ""
            ),
        )
        artist_value = identity.get("artistDataBinding")
        artist = artist_value if isinstance(artist_value, Mapping) else {}
        if (
            schema_evaluation.get("passed") is not True
            or _artist_binding_phase(artist) != phase
        ):
            failures.append(
                _failure(
                    "pilot_full_identity_schema_invalid",
                    phase=phase,
                    reasons=schema_evaluation.get("failureCodes"),
                )
            )
    pilot_hash = sha256_json(pilot_identity)
    if full_identity.get("pilotDeploymentIdentityHash") != pilot_hash:
        failures.append(
            _failure(
                "pilot_deployment_identity_hash_mismatch",
                expected=pilot_hash,
                actual=full_identity.get("pilotDeploymentIdentityHash"),
            )
        )

    pilot_artist_value = pilot_identity.get("artistDataBinding")
    full_artist_value = full_identity.get("artistDataBinding")
    pilot_artist = (
        pilot_artist_value if isinstance(pilot_artist_value, Mapping) else {}
    )
    full_artist = full_artist_value if isinstance(full_artist_value, Mapping) else {}
    pilot_production_value = pilot_artist.get("productionIdentity")
    full_production_value = full_artist.get("productionIdentity")
    pilot_production = (
        pilot_production_value
        if isinstance(pilot_production_value, Mapping)
        else {}
    )
    full_production = (
        full_production_value if isinstance(full_production_value, Mapping) else {}
    )
    pilot_immutable = {
        "schemaVersion": pilot_identity.get("schemaVersion"),
        "snapshot": pilot_identity.get("snapshot"),
        "api": pilot_identity.get("api"),
        "web": pilot_identity.get("web"),
        "artistDataBinding": {
            "schemaVersion": pilot_artist.get("schemaVersion"),
            "trustedPreflight": pilot_production.get("trustedPreflight"),
        },
    }
    full_immutable = {
        "schemaVersion": full_identity.get("schemaVersion"),
        "snapshot": full_identity.get("snapshot"),
        "api": full_identity.get("api"),
        "web": full_identity.get("web"),
        "artistDataBinding": {
            "schemaVersion": full_artist.get("schemaVersion"),
            "trustedPreflight": full_production.get("trustedPreflight"),
        },
    }
    if canonical_json(full_immutable) != canonical_json(pilot_immutable):
        failures.append(_failure("pilot_full_identity_drift", field="immutable"))
    pilot_preflight_value = pilot_artist.get("preflightManifests")
    full_preflight_value = full_artist.get("preflightManifests")
    pilot_preflight = (
        pilot_preflight_value if isinstance(pilot_preflight_value, list) else []
    )
    full_preflight = (
        full_preflight_value if isinstance(full_preflight_value, list) else []
    )
    if (
        len(pilot_preflight) != 1
        or len(full_preflight) != 2
        or canonical_json(full_preflight[0])
        != canonical_json(pilot_preflight[0])
    ):
        failures.append(_failure("pilot_preflight_capture_drift"))
    pilot_captured_at = _parse_utc_timestamp(pilot_identity.get("capturedAt"))
    full_captured_at = _parse_utc_timestamp(full_identity.get("capturedAt"))
    if (
        pilot_captured_at is None
        or full_captured_at is None
        or full_captured_at <= pilot_captured_at
    ):
        failures.append(
            _failure("pilot_full_identity_drift", field="capturedAt")
        )

    capture_descriptors: dict[str, Mapping[str, Any]] = {}
    for phase, production in (
        ("pilot", pilot_production),
        ("full", full_production),
    ):
        for role in ("before", "after"):
            descriptor_value = production.get(role)
            descriptor = (
                descriptor_value
                if isinstance(descriptor_value, Mapping)
                else {}
            )
            capture_descriptors[f"{phase}.{role}"] = descriptor
    capture_names_by_digest: dict[str, list[str]] = {}
    for name, descriptor in capture_descriptors.items():
        digest = descriptor.get("sha256")
        if isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{64}", digest):
            capture_names_by_digest.setdefault(digest, []).append(name)
    for names in capture_names_by_digest.values():
        if len(names) > 1:
            failures.append(
                _failure(
                    "production_identity_capture_digest_reused",
                    captures=sorted(names),
                )
            )

    pilot_after = capture_descriptors["pilot.after"]
    full_after = capture_descriptors["full.after"]
    if (
        not isinstance(full_after.get("sha256"), str)
        or re.fullmatch(r"[a-f0-9]{64}", str(full_after.get("sha256"))) is None
        or full_after.get("sha256") == pilot_after.get("sha256")
    ):
        failures.append(_failure("full_production_after_not_fresh"))

    full_manifest_value = full_artist.get("artifactManifest")
    full_manifest = (
        full_manifest_value if isinstance(full_manifest_value, Mapping) else {}
    )
    if (
        full_manifest.get("path") != "backfill/full/artifact-manifest.json"
        or not isinstance(full_manifest.get("sha256"), str)
        or re.fullmatch(r"[a-f0-9]{64}", str(full_manifest.get("sha256"))) is None
    ):
        failures.append(_failure("full_artist_manifest_binding_invalid"))

    if evidence_root is None:
        failures.append(
            _failure(
                "production_identity_capture_continuity_invalid",
                capture="evidenceRoot",
            )
        )
    else:
        root = evidence_root.resolve()
        raw_capture_specs = (
            (
                "trustedPreflight",
                pilot_production.get("trustedPreflight"),
                "pilot",
                "trustedPreflight",
            ),
            ("pilot.before", pilot_production.get("before"), "pilot", "before"),
            ("pilot.after", pilot_production.get("after"), "pilot", "after"),
            ("full.before", full_production.get("before"), "full", "before"),
            ("full.after", full_production.get("after"), "full", "after"),
        )
        raw_captures: dict[str, Mapping[str, Any]] = {}
        for name, descriptor_value, phase, role in raw_capture_specs:
            descriptor = (
                descriptor_value
                if isinstance(descriptor_value, Mapping)
                else {}
            )
            expected_path = PRODUCTION_IDENTITY_PATHS[phase][
                "trustedPreflight" if name == "trustedPreflight" else role
            ]
            resolved = _resolve_bound_file(
                root,
                descriptor,
                expected_path=expected_path,
            )
            if resolved is None or not resolved[1]:
                failures.append(
                    _failure(
                        "production_identity_capture_continuity_invalid",
                        capture=name,
                    )
                )
                continue
            value = _load_bound_json(resolved[1])
            capture = _valid_production_capture(
                value,
                expected_role=PRODUCTION_IDENTITY_ROLES[
                    "trustedPreflight" if name == "trustedPreflight" else role
                ],
            )
            if capture is None:
                failures.append(
                    _failure(
                        "production_identity_capture_continuity_invalid",
                        capture=name,
                    )
                )
                continue
            raw_captures[name] = capture
        if set(raw_captures) == {
            "trustedPreflight",
            "pilot.before",
            "pilot.after",
            "full.before",
            "full.after",
        }:
            trusted_resources = raw_captures["trustedPreflight"].get("resources")
            if any(
                raw_captures[name].get("resources") != trusted_resources
                for name in (
                    "pilot.before",
                    "pilot.after",
                    "full.before",
                    "full.after",
                )
            ):
                failures.append(_failure("production_artist_data_identity_changed"))
            capture_times = {
                name: _parse_utc_timestamp(capture.get("capturedAt"))
                for name, capture in raw_captures.items()
            }
            trusted_time = capture_times["trustedPreflight"]
            pilot_before_time = capture_times["pilot.before"]
            pilot_after_time = capture_times["pilot.after"]
            full_before_time = capture_times["full.before"]
            full_after_time = capture_times["full.after"]
            if (
                any(value is None for value in capture_times.values())
                or not (
                    trusted_time <= pilot_before_time
                    < pilot_after_time
                    < full_before_time
                    < full_after_time
                )
            ):
                failures.append(
                    _failure("production_identity_capture_order_invalid")
                )

    return _result(
        failures,
        pilotDeploymentIdentityHash=pilot_hash,
        fullDeploymentIdentityHash=sha256_json(full_identity),
    )


def evaluate_request_timing_evidence(
    document: Mapping[str, Any],
    *,
    expected_binding: Mapping[str, Any],
    expected_labels: Sequence[str],
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    _validate_run_binding(
        document, expected_binding, "raw/request-timing.json", failures
    )
    expected_fields = {
        *expected_binding,
        "schemaVersion",
        "configuredRequestsPerMinute",
        "requests",
        "lastPublicRequestAt",
    }
    if (
        document.get("schemaVersion") != "nga-request-timing-evidence-v1"
        or set(document) != expected_fields
    ):
        failures.append(_failure("request_timing_document_invalid"))
    rate = document.get("configuredRequestsPerMinute")
    if type(rate) is not int or not 1 <= rate <= 9:
        failures.append(_failure("request_timing_rate_invalid", actual=rate))
        rate = 9
    requests_value = document.get("requests")
    requests = requests_value if isinstance(requests_value, list) else []
    actual_labels: list[Any] = []
    parsed_times: list[dt.datetime] = []
    for index, event_value in enumerate(requests):
        event = event_value if isinstance(event_value, Mapping) else {}
        actual_labels.append(event.get("label"))
        parsed = _parse_utc_timestamp(event.get("startedAt"))
        if (
            set(event) != {"sequence", "label", "startedAt"}
            or event.get("sequence") != index + 1
            or not isinstance(event.get("label"), str)
            or parsed is None
        ):
            failures.append(
                _failure("request_timing_event_invalid", sequence=index + 1)
            )
        elif parsed_times and parsed < parsed_times[-1]:
            failures.append(
                _failure("request_timing_not_monotonic", sequence=index + 1)
            )
        if parsed is not None:
            parsed_times.append(parsed)
    if actual_labels != list(expected_labels):
        failures.append(
            _failure(
                "request_timing_inventory_mismatch",
                expected=list(expected_labels),
                actual=actual_labels,
            )
        )
    rolling_start = 0
    for end, timestamp in enumerate(parsed_times):
        while (
            rolling_start <= end
            and (timestamp - parsed_times[rolling_start]).total_seconds() >= 60
        ):
            rolling_start += 1
        count = end - rolling_start + 1
        if count > rate or count > 9:
            failures.append(
                _failure(
                    "request_timing_rolling_budget_exceeded",
                    sequence=end + 1,
                    actual=count,
                    configured=rate,
                )
            )
            break
    expected_last = (
        requests[-1].get("startedAt")
        if requests and isinstance(requests[-1], Mapping)
        else None
    )
    if document.get("lastPublicRequestAt") != expected_last:
        failures.append(_failure("request_timing_last_request_mismatch"))
    return _result(
        failures,
        requestCount=len(requests),
        configuredRequestsPerMinute=rate,
        lastPublicRequestAt=expected_last,
    )


def evaluate_request_cooldown_handoff(
    handoff: Mapping[str, Any],
    *,
    expected_binding: Mapping[str, Any],
    phase: str,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    _validate_run_binding(
        handoff,
        expected_binding,
        "request-cooldown-handoff.json",
        failures,
    )
    expected_fields = {
        *expected_binding,
        "schemaVersion",
        "phase",
        "requestTimingPath",
        "requestTimingSha256",
        "lastPublicRequestAt",
        "nextRunNotBefore",
        "cooldownSeconds",
    }
    if (
        handoff.get("schemaVersion") != "nga-request-cooldown-handoff-v1"
        or set(handoff) != expected_fields
        or handoff.get("phase") != phase
        or handoff.get("requestTimingPath") != "raw/request-timing.json"
        or not isinstance(handoff.get("requestTimingSha256"), str)
        or re.fullmatch(
            r"[a-f0-9]{64}", str(handoff.get("requestTimingSha256"))
        )
        is None
        or handoff.get("cooldownSeconds") != REQUEST_COOLDOWN_SECONDS
    ):
        failures.append(_failure("request_cooldown_handoff_invalid"))
    last = _parse_utc_timestamp(handoff.get("lastPublicRequestAt"))
    not_before = _parse_utc_timestamp(handoff.get("nextRunNotBefore"))
    if (
        last is None
        or not_before is None
        or (not_before - last).total_seconds() != REQUEST_COOLDOWN_SECONDS
    ):
        failures.append(_failure("request_cooldown_handoff_invalid"))
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        raise ValueError("request cooldown comparison time must be timezone-aware")
    if not_before is not None and current.astimezone(dt.timezone.utc) < not_before:
        failures.append(
            _failure(
                "request_cooldown_not_elapsed",
                nextRunNotBefore=handoff.get("nextRunNotBefore"),
            )
        )
    return _result(failures, handoff=dict(handoff))


def validate_request_cooldown_file(
    handoff_path: Path,
    *,
    current_binding: Mapping[str, Any],
    phase: str,
    expected_labels: Sequence[str],
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    if (
        handoff_path.name != "request-cooldown-handoff.json"
        or handoff_path.is_symlink()
    ):
        return _result([_failure("request_cooldown_path_invalid")])
    try:
        handoff_bytes = handoff_path.read_bytes()
        handoff_value = json.loads(handoff_bytes)
    except (OSError, json.JSONDecodeError) as error:
        return _result(
            [_failure("request_cooldown_handoff_invalid", error=str(error))]
        )
    handoff = handoff_value if isinstance(handoff_value, Mapping) else {}
    previous_binding = {
        "runId": handoff.get("runId"),
        "snapshot": current_binding.get("snapshot"),
        "evaluatorGitSha": current_binding.get("evaluatorGitSha"),
        "deploymentIdentityHash": current_binding.get("deploymentIdentityHash"),
    }
    cooldown = evaluate_request_cooldown_handoff(
        handoff,
        expected_binding=previous_binding,
        phase=phase,
        now=now,
    )
    failures.extend(cooldown["failures"])
    if (
        not isinstance(previous_binding["runId"], str)
        or RUN_ID_PATTERN.fullmatch(str(previous_binding["runId"])) is None
    ):
        failures.append(_failure("request_cooldown_handoff_invalid", field="runId"))

    timing_path = handoff_path.parent / "raw/request-timing.json"
    if timing_path.is_symlink():
        failures.append(_failure("request_cooldown_path_invalid"))
    try:
        timing_bytes = timing_path.read_bytes()
        timing_value = json.loads(timing_bytes)
    except (OSError, json.JSONDecodeError) as error:
        failures.append(
            _failure("request_timing_document_invalid", error=str(error))
        )
        timing_bytes = b""
        timing_value = {}
    timing = timing_value if isinstance(timing_value, Mapping) else {}
    timing_evaluation = evaluate_request_timing_evidence(
        timing,
        expected_binding=previous_binding,
        expected_labels=expected_labels,
    )
    failures.extend(timing_evaluation["failures"])
    if sha256_bytes(timing_bytes) != handoff.get("requestTimingSha256"):
        failures.append(_failure("request_cooldown_timing_hash_mismatch"))
    if handoff.get("lastPublicRequestAt") != timing.get("lastPublicRequestAt"):
        failures.append(_failure("request_cooldown_timing_mismatch"))
    return _result(
        failures,
        handoffContent=capture_bound_json_bytes(handoff_bytes),
        requestTimingContent=capture_bound_json_bytes(timing_bytes),
        evaluation=cooldown,
    )


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


def _artist_binding_phase(value: Mapping[str, Any]) -> str | None:
    manifest_value = value.get("artifactManifest")
    manifest = manifest_value if isinstance(manifest_value, Mapping) else {}
    for phase in PRODUCTION_IDENTITY_PATHS:
        if manifest.get("path") == f"backfill/{phase}/artifact-manifest.json":
            return phase
    return None


def _evaluate_artist_data_binding(
    identity: Mapping[str, Any], *, expected_phase: str | None = None
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    value = identity.get("artistDataBinding")
    if not isinstance(value, Mapping):
        return _result([_failure("artist_data_identity_incomplete")])

    manifest_value = value.get("artifactManifest")
    manifest = manifest_value if isinstance(manifest_value, Mapping) else {}
    preflight_value = value.get("preflightManifests")
    preflight = preflight_value if isinstance(preflight_value, list) else []
    post_apply_value = value.get("postApplyVerification")
    post_apply = post_apply_value if isinstance(post_apply_value, Mapping) else {}
    production_value = value.get("productionIdentity")
    production = (
        production_value if isinstance(production_value, Mapping) else {}
    )
    phase = _artist_binding_phase(value)
    expected_paths = PRODUCTION_IDENTITY_PATHS.get(phase or "", {})
    expected_state_paths = ARTIST_STATE_PATHS.get(phase or "", {})
    descriptors = {
        "artifactManifest": manifest,
        "postApplyVerification": post_apply,
        **{
            name: (
                production.get(name)
                if isinstance(production.get(name), Mapping)
                else {}
            )
            for name in PRODUCTION_IDENTITY_FIELDS
        },
    }
    valid = (
        set(value) == ARTIST_DATA_BINDING_FIELDS
        and value.get("schemaVersion") == "nga-artist-data-binding-v3"
        and set(production) == PRODUCTION_IDENTITY_FIELDS
        and phase is not None
        and (expected_phase is None or phase == expected_phase)
        and all(
            set(descriptor) == BOUND_ARTIFACT_DESCRIPTOR_FIELDS
            and isinstance(descriptor.get("path"), str)
            and bool(descriptor.get("path"))
            and isinstance(descriptor.get("sha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", descriptor["sha256"])
            is not None
            for descriptor in descriptors.values()
        )
        and all(
            descriptors[name].get("path") == expected_path
            for name, expected_path in expected_paths.items()
        )
        and len(preflight)
        == len(expected_state_paths.get("preflightManifests", []))
        and all(
            isinstance(descriptor, Mapping)
            and set(descriptor) == BOUND_ARTIFACT_DESCRIPTOR_FIELDS
            and descriptor.get("path") == expected_path
            and isinstance(descriptor.get("sha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", descriptor["sha256"]) is not None
            for descriptor, expected_path in zip(
                preflight,
                expected_state_paths.get("preflightManifests", []),
                strict=True,
            )
        )
        and post_apply.get("path")
        == expected_state_paths.get("postApplyVerification")
    )
    if not valid:
        failures.append(_failure("artist_data_identity_invalid"))
    return _result(failures, binding=value)


def _resolve_bound_file(
    evidence_root: Path,
    descriptor: Mapping[str, Any],
    *,
    expected_path: str | None = None,
) -> tuple[Path, bytes] | None:
    relative_value = descriptor.get("path")
    digest = descriptor.get("sha256")
    if (
        not isinstance(relative_value, str)
        or not relative_value
        or Path(relative_value).is_absolute()
        or relative_value.startswith(("/", "\\"))
        or ".." in re.split(r"[\\/]", relative_value)
        or re.match(r"^[A-Za-z]:[\\/]", relative_value) is not None
        or (expected_path is not None and relative_value != expected_path)
        or not isinstance(digest, str)
        or re.fullmatch(r"[a-f0-9]{64}", digest) is None
    ):
        return None
    root = evidence_root.resolve(strict=True)
    unresolved = root / relative_value
    try:
        resolved = unresolved.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError):
        return None
    current = root
    for part in Path(relative_value).parts:
        current /= part
        if current.is_symlink():
            return None
    if not resolved.is_file():
        return None
    payload = resolved.read_bytes()
    if sha256_bytes(payload) != digest:
        return resolved, b""
    return resolved, payload


def _load_bound_json(payload: bytes) -> Mapping[str, Any] | list[Any] | None:
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, (Mapping, list)) else None


def _load_ndjson(payload: bytes) -> list[Mapping[str, Any]] | None:
    rows: list[Mapping[str, Any]] = []
    try:
        for line in payload.decode("utf-8").splitlines():
            if not line:
                continue
            value = json.loads(line)
            if not isinstance(value, Mapping):
                return None
            rows.append(value)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return rows


def _parse_wrangler_json_output(value: Any) -> Any | None:
    if not isinstance(value, str):
        return None
    match = re.search(r"^[\t ]*[\[{]", value, flags=re.MULTILINE)
    if match is None:
        return None
    try:
        payload = json.loads(value[match.start() :])
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, (Mapping, list)) else None


def _d1_facts_from_apply_stdout(value: Any) -> Mapping[str, Any] | None:
    payload = _parse_wrangler_json_output(value)
    results = payload if isinstance(payload, list) else [payload]
    if (
        not results
        or any(
            not isinstance(result, Mapping) or result.get("success") is not True
            for result in results
        )
    ):
        return None
    query_counts: list[int] = []

    def collect_query_counts(item: Any) -> bool:
        if isinstance(item, list):
            return all(collect_query_counts(child) for child in item)
        if not isinstance(item, Mapping):
            return True
        for key, child in item.items():
            if key == "Total queries executed":
                if type(child) is not int or child < 0:
                    return False
                query_counts.append(child)
            elif not collect_query_counts(child):
                return False
        return True

    if not collect_query_counts(results) or not query_counts:
        return None
    telemetry: dict[str, list[Any]] = {
        "changes": [],
        "rowsRead": [],
        "rowsWritten": [],
        "changedDb": [],
        "finalBookmarks": [],
    }
    telemetry_fields = (
        ("changes", "changes", lambda item: type(item) is int and item >= 0),
        ("rows_read", "rowsRead", lambda item: type(item) is int and item >= 0),
        (
            "rows_written",
            "rowsWritten",
            lambda item: type(item) is int and item >= 0,
        ),
        ("changed_db", "changedDb", lambda item: type(item) is bool),
    )
    for result in results:
        meta_value = result.get("meta")
        if meta_value is not None and not isinstance(meta_value, Mapping):
            return None
        meta = meta_value if isinstance(meta_value, Mapping) else {}
        for source, target, valid in telemetry_fields:
            if source not in meta:
                continue
            if not valid(meta[source]):
                return None
            telemetry[target].append(meta[source])
        if "finalBookmark" in result:
            bookmark = result.get("finalBookmark")
            if not isinstance(bookmark, str) or not bookmark.strip():
                return None
            telemetry["finalBookmarks"].append(bookmark)
    return {
        "queryCount": sum(query_counts),
        "telemetry": telemetry,
    }


def _valid_production_capture(
    value: Any, *, expected_role: str
) -> Mapping[str, Any] | None:
    if not isinstance(value, Mapping) or set(value) != {
        "schemaVersion",
        "captureRole",
        "capturedAt",
        "resources",
    }:
        return None
    if (
        value.get("schemaVersion") != "nga-production-identity-v1"
        or value.get("captureRole") != expected_role
        or _parse_utc_timestamp(value.get("capturedAt")) is None
    ):
        return None
    resources_value = value.get("resources")
    resources = resources_value if isinstance(resources_value, Mapping) else {}
    if set(resources) != set(EXPECTED_PRODUCTION_RESOURCES):
        return None
    for name, expected in EXPECTED_PRODUCTION_RESOURCES.items():
        resource_value = resources.get(name)
        resource = resource_value if isinstance(resource_value, Mapping) else {}
        if set(resource) != {
            "environment",
            "service",
            "origin",
            "deploymentId",
            "versionId",
        } or any(
            resource.get(field) != expected_value
            for field, expected_value in expected.items()
        ):
            return None
        if not _nonblank_string(resource.get("deploymentId")) or not _nonblank_string(
            resource.get("versionId")
        ):
            return None
    return value


def evaluate_artist_data_evidence(
    evidence_root: Path,
    binding: Mapping[str, Any],
    *,
    phase: str,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    binding_schema = _evaluate_artist_data_binding(
        {"artistDataBinding": binding}, expected_phase=phase
    )
    failures.extend(binding_schema["failures"])
    if not evidence_root.is_dir():
        return _result(
            [
                _failure("artist_evidence_root_invalid"),
                _failure("artist_artifact_manifest_missing"),
                _failure("production_identity_preflight_untrusted"),
            ]
        )
    marker = evidence_root / "preflight/evidence-root.txt"
    try:
        marker_value = marker.read_text(encoding="utf-8").strip()
    except OSError:
        marker_value = ""
    if marker.is_symlink() or marker_value != str(evidence_root.resolve()):
        failures.append(_failure("artist_evidence_root_invalid"))

    manifest_descriptor_value = binding.get("artifactManifest")
    manifest_descriptor = (
        manifest_descriptor_value
        if isinstance(manifest_descriptor_value, Mapping)
        else {}
    )
    resolved_manifest = _resolve_bound_file(evidence_root, manifest_descriptor)
    if resolved_manifest is None:
        failures.append(_failure("artist_evidence_path_invalid"))
        failures.append(_failure("artist_artifact_manifest_missing"))
        manifest_path = None
        manifest_bytes = b""
        manifest: Mapping[str, Any] = {}
    else:
        manifest_path, manifest_bytes = resolved_manifest
        if not manifest_bytes:
            failures.append(_failure("artist_artifact_manifest_hash_mismatch"))
            manifest = {}
        else:
            manifest_value = _load_bound_json(manifest_bytes)
            manifest = manifest_value if isinstance(manifest_value, Mapping) else {}
            if not manifest:
                failures.append(_failure("artist_artifact_manifest_invalid"))

    expected_count = 5 if phase == "pilot" else NGA_FULL_STAGED_COUNT
    if manifest and manifest_descriptor.get("path") != (
        f"backfill/{manifest.get('phase')}/artifact-manifest.json"
    ):
        failures.append(_failure("artist_evidence_path_invalid"))
    if manifest and manifest.get("phase") != phase:
        failures.append(_failure("artist_artifact_phase_mismatch"))
    expected_identity = {
        "schemaVersion": 1,
        "environment": "staging",
        "expectedOrgId": NGA_STAGING_ORG_ID,
        "resources": {
            "d1Database": NGA_STAGING_D1_DATABASE,
            "imageVectorIndex": NGA_STAGING_IMAGE_VECTOR_INDEX,
        },
    }
    if manifest and any(
        manifest.get(field) != expected for field, expected in expected_identity.items()
    ):
        failures.append(_failure("artist_artifact_identity_mismatch"))
    source_value = manifest.get("source") if manifest else None
    source = source_value if isinstance(source_value, Mapping) else {}
    if manifest and source.get("commit") != NGA_SOURCE_COMMIT:
        failures.append(_failure("artist_artifact_source_commit_mismatch"))

    artifact_root = manifest_path.parent if manifest_path is not None else evidence_root
    files_value = manifest.get("files") if manifest else None
    files = files_value if isinstance(files_value, list) else []
    declared_files: dict[str, tuple[Mapping[str, Any], Path, bytes]] = {}
    for record_value in files:
        record = record_value if isinstance(record_value, Mapping) else {}
        relative = record.get("path")
        resolved = _resolve_bound_file(artifact_root, record)
        if (
            not isinstance(relative, str)
            or relative in declared_files
            or resolved is None
        ):
            failures.append(_failure("artist_artifact_file_invalid", path=relative))
            continue
        path, payload = resolved
        if not payload:
            failures.append(
                _failure("artist_artifact_file_hash_mismatch", path=relative)
            )
            continue
        if record.get("bytes") != len(payload):
            failures.append(
                _failure("artist_artifact_file_size_mismatch", path=relative)
            )
        declared_files[relative] = (record, path, payload)

    required_json = {
        "source-manifest.json",
        "mapping.json",
        "rollback/d1-records.json",
        "vector-value-hashes.json",
    }
    if not required_json.issubset(declared_files):
        failures.append(_failure("artist_artifact_manifest_incomplete"))
    source_manifest_record = declared_files.get("source-manifest.json")
    if source_manifest_record and source.get(
        "manifestSha256"
    ) != source_manifest_record[0].get("sha256"):
        failures.append(_failure("artist_source_manifest_hash_mismatch"))
    if source_manifest_record:
        source_manifest_value = _load_bound_json(source_manifest_record[2])
        source_manifest = (
            source_manifest_value
            if isinstance(source_manifest_value, Mapping)
            else {}
        )
        if source_manifest.get("sourceCommit") != NGA_SOURCE_COMMIT:
            failures.append(_failure("artist_artifact_source_commit_mismatch"))
        source_files_value = source_manifest.get("files")
        source_files = (
            source_files_value if isinstance(source_files_value, Mapping) else {}
        )
        trusted_source_inventory = (
            source_manifest.get("schemaVersion") == 1
            and source_manifest.get("candidateCount") == NGA_FULL_STAGED_COUNT
            and set(source_files) == set(NGA_SOURCE_SHA256)
        )
        if trusted_source_inventory:
            for filename, expected_digest in NGA_SOURCE_SHA256.items():
                file_value = source_files.get(filename)
                file_record = file_value if isinstance(file_value, Mapping) else {}
                if (
                    set(file_record) != {"sha256", "rowCount", "header"}
                    or file_record.get("sha256") != expected_digest
                    or file_record.get("header") != NGA_SOURCE_HEADERS[filename]
                    or type(file_record.get("rowCount")) is not int
                    or int(file_record["rowCount"]) <= 0
                ):
                    trusted_source_inventory = False
                    break
        if not trusted_source_inventory:
            failures.append(_failure("artist_source_inventory_mismatch"))

    mapping_record = declared_files.get("mapping.json")
    mapping_value = _load_bound_json(mapping_record[2]) if mapping_record else None
    mapping = mapping_value if isinstance(mapping_value, list) else []
    mapping_by_id: dict[str, Mapping[str, Any]] = {}
    for row_value in mapping:
        row = row_value if isinstance(row_value, Mapping) else {}
        artwork_id = row.get("id")
        primary_id = row.get("primaryArtistId")
        if (
            not isinstance(artwork_id, str)
            or re.fullmatch(r"open-access-art:nga:\d+", artwork_id) is None
            or artwork_id in mapping_by_id
            or not isinstance(primary_id, str)
            or re.fullmatch(r"\d+", primary_id) is None
        ):
            failures.append(_failure("artist_mapping_invalid"))
            continue
        mapping_by_id[artwork_id] = row
        custom_value = row.get("customMetadata")
        custom = custom_value if isinstance(custom_value, Mapping) else {}
        artists_value = custom.get("ngaArtists")
        artists = artists_value if isinstance(artists_value, Mapping) else {}
        relationships_value = artists.get("relationships")
        relationships = (
            relationships_value if isinstance(relationships_value, list) else []
        )
        field_sources_value = row.get("fieldSources")
        field_sources = (
            field_sources_value
            if isinstance(field_sources_value, Mapping)
            else {}
        )
        parsed_relationships = [
            _parse_artist_relationship(relationship)
            for relationship in relationships
        ]
        if (
            set(row) != {
                "id",
                "primaryArtistId",
                "customMetadata",
                "fieldSources",
            }
            or set(custom) != {"ngaArtists"}
            or set(artists) != {"sourceCommit", "relationships"}
            or artists.get("sourceCommit") != NGA_SOURCE_COMMIT
            or field_sources
            != {"primary_artist_id": "nga.objects_constituents"}
            or not relationships
            or any(relationship is None for relationship in parsed_relationships)
        ):
            failures.append(
                _failure("artist_mapping_relationship_invalid", artworkId=artwork_id)
            )
            continue
        valid_relationships = [
            relationship
            for relationship in parsed_relationships
            if relationship is not None
        ]
        relationship_keys = [
            canonical_json(relationship)
            for relationship in valid_relationships
        ]
        minimum_order = min(
            float(relationship["displayOrder"])
            for relationship in valid_relationships
        )
        minimum_relationships = [
            relationship
            for relationship in valid_relationships
            if float(relationship["displayOrder"]) == minimum_order
        ]
        if (
            len(set(relationship_keys)) != len(relationship_keys)
            or len(minimum_relationships) != 1
            or minimum_relationships[0].get("constituentId") != primary_id
        ):
            failures.append(
                _failure("artist_mapping_primary_mismatch", artworkId=artwork_id)
            )
    if len(mapping) != expected_count or len(mapping_by_id) != expected_count:
        failures.append(_failure("artist_artifact_count_mismatch"))
    if mapping_record and mapping_record[0].get("recordCount") != len(mapping):
        failures.append(_failure("artist_artifact_count_mismatch"))
    if phase == "pilot" and set(mapping_by_id) != {
        f"open-access-art:nga:{object_id}" for object_id in NGA_PILOT_OBJECT_IDS
    }:
        failures.append(_failure("artist_pilot_id_scope_mismatch"))
    if phase == "pilot" and {
        artwork_id.removeprefix("open-access-art:nga:"): row.get("primaryArtistId")
        for artwork_id, row in mapping_by_id.items()
    } != NGA_PILOT_PRIMARY_ARTISTS:
        failures.append(_failure("artist_pilot_mapping_mismatch"))

    enriched_rows: list[Mapping[str, Any]] = []
    rollback_rows: list[Mapping[str, Any]] = []
    for relative, (record, _path, payload) in declared_files.items():
        target = None
        if relative.startswith("vectors/") and relative.endswith(".ndjson"):
            target = enriched_rows
        elif relative.startswith("rollback/") and relative.endswith(".ndjson"):
            target = rollback_rows
        if target is None:
            continue
        rows = _load_ndjson(payload)
        if rows is None:
            failures.append(_failure("artist_vector_artifact_invalid", path=relative))
            continue
        if record.get("recordCount") != len(rows):
            failures.append(_failure("artist_artifact_count_mismatch", path=relative))
        target.extend(rows)
    enriched_by_id = {str(row.get("id") or ""): row for row in enriched_rows}
    rollback_by_id = {str(row.get("id") or ""): row for row in rollback_rows}
    if (
        len(enriched_rows) != expected_count
        or len(rollback_rows) != expected_count
        or set(enriched_by_id) != set(mapping_by_id)
        or set(rollback_by_id) != set(mapping_by_id)
    ):
        failures.append(_failure("artist_artifact_count_mismatch"))
    for artwork_id, row in enriched_by_id.items():
        metadata_value = row.get("metadata")
        metadata = metadata_value if isinstance(metadata_value, Mapping) else {}
        if (
            metadata.get("artworkId") != artwork_id
            or metadata.get("primaryArtistId")
            != mapping_by_id.get(artwork_id, {}).get("primaryArtistId")
        ):
            failures.append(
                _failure("artist_vector_identity_mismatch", artworkId=artwork_id)
            )

    rollback_d1_record = declared_files.get("rollback/d1-records.json")
    rollback_d1_value = (
        _load_bound_json(rollback_d1_record[2]) if rollback_d1_record else None
    )
    rollback_d1 = rollback_d1_value if isinstance(rollback_d1_value, list) else []
    rollback_d1_by_id = {
        str(row.get("id") or ""): row
        for row in rollback_d1
        if isinstance(row, Mapping)
    }
    rollback_d1_complete = True
    for row_value in rollback_d1:
        row = row_value if isinstance(row_value, Mapping) else {}
        try:
            custom_metadata = (
                json.loads(row.get("custom_metadata") or "{}")
                if isinstance(row.get("custom_metadata"), str)
                else row.get("custom_metadata") or {}
            )
        except json.JSONDecodeError:
            custom_metadata = None
        if (
            row.get("org_id") != NGA_STAGING_ORG_ID
            or not isinstance(custom_metadata, Mapping)
            or custom_metadata.get("provider") != "nga"
            or not {"primary_artist_id", "custom_metadata", "field_sources"}.issubset(
                row
            )
        ):
            rollback_d1_complete = False
    if (
        len(rollback_d1) != expected_count
        or len(rollback_d1_by_id) != expected_count
        or set(rollback_d1_by_id) != set(mapping_by_id)
        or not rollback_d1_complete
        or any(
            not isinstance(row, Mapping) or set(row) != set(rollback_d1[0])
            for row in rollback_d1
        )
    ):
        failures.append(_failure("artist_rollback_d1_invalid"))
    if rollback_d1_record and rollback_d1_record[0].get("recordCount") != len(
        rollback_d1
    ):
        failures.append(_failure("artist_artifact_count_mismatch"))
    for artwork_id, row in rollback_by_id.items():
        metadata_value = row.get("metadata")
        metadata = metadata_value if isinstance(metadata_value, Mapping) else {}
        if metadata.get("artworkId") != artwork_id:
            failures.append(
                _failure("artist_vector_identity_mismatch", artworkId=artwork_id)
            )

    hashes_record = declared_files.get("vector-value-hashes.json")
    hashes_value = _load_bound_json(hashes_record[2]) if hashes_record else None
    value_hashes = hashes_value if isinstance(hashes_value, list) else []
    hashes_by_id = {
        str(row.get("id") or ""): row
        for row in value_hashes
        if isinstance(row, Mapping)
    }
    if len(value_hashes) != expected_count or set(hashes_by_id) != set(
        mapping_by_id
    ):
        failures.append(_failure("artist_artifact_count_mismatch"))
    if hashes_record and hashes_record[0].get("recordCount") != len(value_hashes):
        failures.append(_failure("artist_artifact_count_mismatch"))
    for artwork_id, mapping_row in mapping_by_id.items():
        original = rollback_by_id.get(artwork_id)
        enriched = enriched_by_id.get(artwork_id)
        declared = hashes_by_id.get(artwork_id)
        if not all(
            isinstance(value, Mapping)
            for value in (original, enriched, declared)
        ):
            continue
        original_digest = sha256_json(original.get("values"))
        enriched_digest = sha256_json(enriched.get("values"))
        expected_enriched = json.loads(json.dumps(original))
        metadata_value = expected_enriched.get("metadata")
        metadata = metadata_value if isinstance(metadata_value, dict) else {}
        metadata["primaryArtistId"] = mapping_row.get("primaryArtistId")
        expected_enriched["metadata"] = metadata
        if (
            declared.get("originalSha256") != original_digest
            or declared.get("enrichedSha256") != enriched_digest
            or original_digest != enriched_digest
            or sha256_json(enriched) != sha256_json(expected_enriched)
        ):
            failures.append(
                _failure("artist_vector_values_changed", artworkId=artwork_id)
            )

    invariants_value = manifest.get("invariants") if manifest else None
    invariants = invariants_value if isinstance(invariants_value, Mapping) else {}
    expected_invariants = {
        "stagedRecordCount": expected_count,
        "mappingCount": expected_count,
        "expectedD1Changes": expected_count if phase == "pilot" else expected_count - 5,
        "imageVectorCount": expected_count,
        "rollbackD1RecordCount": expected_count,
        "rollbackVectorCount": expected_count,
        "vectorValuesUnchanged": True,
        "captionVectorsChanged": 0,
    }
    if manifest and any(
        invariants.get(field) != expected for field, expected in expected_invariants.items()
    ):
        failures.append(_failure("artist_artifact_count_mismatch"))

    preflight_value = manifest.get("preflightInputs") if manifest else None
    preflight = preflight_value if isinstance(preflight_value, list) else []
    preflight_phases = sorted(
        str(item.get("phase")) for item in preflight if isinstance(item, Mapping)
    )
    preflight_counts = [
        item.get("counts", {}).get("stagedRecords")
        for item in preflight
        if isinstance(item, Mapping) and isinstance(item.get("counts"), Mapping)
    ]
    preflight_count = (
        sum(preflight_counts)
        if all(type(count) is int and count >= 0 for count in preflight_counts)
        else -1
    )
    expected_phases = ["pilot"] if phase == "pilot" else ["full", "pilot"]
    if preflight_phases != expected_phases or preflight_count != expected_count:
        failures.append(_failure("artist_preflight_scope_mismatch"))
    for item_value in preflight:
        item = item_value if isinstance(item_value, Mapping) else {}
        counts_value = item.get("counts")
        counts = counts_value if isinstance(counts_value, Mapping) else {}
        image_vectors_value = item.get("imageVectors")
        image_vectors = (
            image_vectors_value if isinstance(image_vectors_value, list) else []
        )
        resources_value = item.get("resources")
        resources = resources_value if isinstance(resources_value, Mapping) else {}
        ids_value = item.get("ids")
        ids = ids_value if isinstance(ids_value, Mapping) else {}
        staged_value = item.get("stagedRecords")
        staged = staged_value if isinstance(staged_value, Mapping) else {}
        digest_values = [
            item.get("manifestSha256"),
            ids.get("sha256"),
            staged.get("sha256"),
            *[
                vector.get("sha256") if isinstance(vector, Mapping) else None
                for vector in image_vectors
            ],
        ]
        vector_counts = [
            vector.get("count")
            for vector in image_vectors
            if isinstance(vector, Mapping)
        ]
        image_count = (
            sum(vector_counts)
            if len(vector_counts) == len(image_vectors)
            and all(type(count) is int and count >= 0 for count in vector_counts)
            else -1
        )
        expected_binding_count = (
            5
            if item.get("phase") == "pilot"
            else NGA_FULL_STAGED_COUNT - 5
            if phase == "full" and item.get("phase") == "full"
            else -1
        )
        if (
            item.get("expectedOrgId") != NGA_STAGING_ORG_ID
            or resources
            != {
                "d1Database": NGA_STAGING_D1_DATABASE,
                "imageVectorIndex": NGA_STAGING_IMAGE_VECTOR_INDEX,
            }
            or counts.get("ids") != ids.get("count")
            or counts.get("stagedRecords") != staged.get("count")
            or counts.get("imageVectors") != image_count
            or counts.get("ids") != counts.get("stagedRecords")
            or counts.get("ids") != counts.get("imageVectors")
            or counts.get("stagedRecords") != expected_binding_count
            or any(
                not isinstance(digest, str)
                or re.fullmatch(r"[a-f0-9]{64}", digest) is None
                for digest in digest_values
            )
        ):
            failures.append(_failure("artist_preflight_scope_mismatch"))

    bound_paths = [str(marker.resolve())] if marker.is_file() else []
    if manifest_path is not None:
        bound_paths.append(str(manifest_path.resolve()))
    bound_paths.extend(str(value[1].resolve()) for value in declared_files.values())

    def load_state_input(
        root: Path,
        descriptor_value: Any,
        *,
        failure_code: str,
        ndjson: bool = False,
    ) -> tuple[Path | None, list[Any]]:
        descriptor = (
            descriptor_value if isinstance(descriptor_value, Mapping) else {}
        )
        resolved = _resolve_bound_file(root, descriptor)
        if resolved is None:
            failures.append(_failure(failure_code))
            return None, []
        path, payload = resolved
        if not payload:
            failures.append(_failure(failure_code))
            return path, []
        value = _load_ndjson(payload) if ndjson else _load_bound_json(payload)
        if not isinstance(value, list):
            failures.append(_failure(failure_code))
            return path, []
        bound_paths.append(str(path.resolve()))
        return path, value

    def contains_recovery_value(value: Any, key: str, expected: Any) -> bool:
        if isinstance(value, Mapping):
            return value.get(key) == expected or any(
                contains_recovery_value(child, key, expected)
                for child in value.values()
            )
        if isinstance(value, list):
            return any(
                contains_recovery_value(child, key, expected) for child in value
            )
        return False

    preflight_descriptors_value = binding.get("preflightManifests")
    preflight_descriptors = (
        preflight_descriptors_value
        if isinstance(preflight_descriptors_value, list)
        else []
    )
    expected_preflight_paths = ARTIST_STATE_PATHS.get(phase, {}).get(
        "preflightManifests", []
    )
    preflight_scope_ids: set[str] = set()
    for descriptor_value, expected_path in zip(
        preflight_descriptors, expected_preflight_paths
    ):
        descriptor = (
            descriptor_value if isinstance(descriptor_value, Mapping) else {}
        )
        resolved = _resolve_bound_file(
            evidence_root, descriptor, expected_path=expected_path
        )
        if resolved is None:
            failures.append(_failure("artist_preflight_manifest_missing"))
            continue
        preflight_path, preflight_payload = resolved
        if not preflight_payload:
            failures.append(_failure("artist_preflight_manifest_hash_mismatch"))
            continue
        preflight_manifest_value = _load_bound_json(preflight_payload)
        preflight_manifest = (
            preflight_manifest_value
            if isinstance(preflight_manifest_value, Mapping)
            else {}
        )
        if not preflight_manifest:
            failures.append(_failure("artist_preflight_manifest_invalid"))
            continue
        bound_paths.append(str(preflight_path.resolve()))
        capture_phase = preflight_manifest.get("phase")
        expected_capture_count = (
            5
            if capture_phase == "pilot"
            else NGA_FULL_STAGED_COUNT - 5
            if phase == "full" and capture_phase == "full"
            else -1
        )
        capture_counts_value = preflight_manifest.get("counts")
        capture_counts = (
            capture_counts_value
            if isinstance(capture_counts_value, Mapping)
            else {}
        )
        capture_inputs_value = preflight_manifest.get("inputs")
        capture_inputs = (
            capture_inputs_value
            if isinstance(capture_inputs_value, Mapping)
            else {}
        )
        rollback_value = preflight_manifest.get("rollback")
        capture_rollback = (
            rollback_value if isinstance(rollback_value, Mapping) else {}
        )
        if (
            preflight_manifest.get("schemaVersion") != 2
            or preflight_manifest.get("captureKind") != "preflight"
            or _parse_utc_timestamp(preflight_manifest.get("capturedAt")) is None
            or preflight_manifest.get("environment") != "staging"
            or preflight_manifest.get("expectedOrgId") != NGA_STAGING_ORG_ID
            or preflight_manifest.get("resources")
            != {
                "d1Database": NGA_STAGING_D1_DATABASE,
                "imageVectorIndex": NGA_STAGING_IMAGE_VECTOR_INDEX,
            }
            or capture_counts
            != {
                "ids": expected_capture_count,
                "stagedRecords": expected_capture_count,
                "imageVectors": expected_capture_count,
            }
            or set(capture_inputs) != {"ids", "stagedRecords", "imageVectors"}
            or preflight_manifest.get("hashes")
            != {
                "ids": (
                    capture_inputs.get("ids", {}).get("sha256")
                    if isinstance(capture_inputs.get("ids"), Mapping)
                    else None
                ),
                "stagedRecords": (
                    capture_inputs.get("stagedRecords", {}).get("sha256")
                    if isinstance(capture_inputs.get("stagedRecords"), Mapping)
                    else None
                ),
            }
            or canonical_json(preflight_manifest.get("vectorFiles"))
            != canonical_json(capture_inputs.get("imageVectors"))
            or set(capture_rollback) != {"d1TimeTravel", "recoveryPoint"}
        ):
            failures.append(_failure("artist_preflight_manifest_invalid"))

        matching_binding = next(
            (
                item
                for item in preflight
                if isinstance(item, Mapping) and item.get("phase") == capture_phase
            ),
            None,
        )
        captured_binding = {
            "manifestSha256": sha256_bytes(preflight_payload),
            "phase": capture_phase,
            "expectedOrgId": preflight_manifest.get("expectedOrgId"),
            "resources": preflight_manifest.get("resources"),
            "counts": capture_counts_value,
            "ids": capture_inputs.get("ids"),
            "stagedRecords": capture_inputs.get("stagedRecords"),
            "imageVectors": capture_inputs.get("imageVectors"),
            "rollback": rollback_value,
        }
        if (
            not isinstance(matching_binding, Mapping)
            or canonical_json(captured_binding) != canonical_json(matching_binding)
        ):
            failures.append(_failure("artist_preflight_scope_mismatch"))

        _, captured_ids = load_state_input(
            preflight_path.parent,
            capture_inputs.get("ids"),
            failure_code="artist_preflight_artifact_hash_mismatch",
        )
        _, captured_d1 = load_state_input(
            preflight_path.parent,
            capture_inputs.get("stagedRecords"),
            failure_code="artist_preflight_artifact_hash_mismatch",
        )
        captured_vectors: list[Any] = []
        vector_descriptors = capture_inputs.get("imageVectors")
        if not isinstance(vector_descriptors, list):
            failures.append(_failure("artist_preflight_artifact_hash_mismatch"))
            vector_descriptors = []
        for vector_descriptor in vector_descriptors:
            _, rows = load_state_input(
                preflight_path.parent,
                vector_descriptor,
                failure_code="artist_preflight_artifact_hash_mismatch",
                ndjson=True,
            )
            captured_vectors.extend(rows)
        captured_d1_by_id = {
            str(row.get("id") or ""): row
            for row in captured_d1
            if isinstance(row, Mapping)
        }
        captured_vector_by_id = {}
        for row in captured_vectors:
            if not isinstance(row, Mapping):
                continue
            metadata_value = row.get("metadata")
            metadata = metadata_value if isinstance(metadata_value, Mapping) else {}
            captured_vector_by_id[str(row.get("id") or metadata.get("artworkId") or "")] = row
        captured_id_set = {
            str(value) for value in captured_ids if isinstance(value, str)
        }
        if (
            len(captured_ids) != expected_capture_count
            or len(captured_id_set) != expected_capture_count
            or len(captured_d1) != expected_capture_count
            or len(captured_d1_by_id) != expected_capture_count
            or len(captured_vectors) != expected_capture_count
            or len(captured_vector_by_id) != expected_capture_count
            or set(captured_d1_by_id) != captured_id_set
            or set(captured_vector_by_id) != captured_id_set
            or not captured_id_set.issubset(mapping_by_id)
            or any(
                not _semantic_d1_snapshots_equal(
                    captured_d1_by_id.get(artwork_id),
                    rollback_d1_by_id.get(artwork_id),
                )
                or canonical_json(captured_vector_by_id.get(artwork_id))
                != canonical_json(rollback_by_id.get(artwork_id))
                for artwork_id in captured_id_set
            )
        ):
            failures.append(_failure("artist_preflight_state_mismatch"))
        preflight_scope_ids.update(captured_id_set)

        recovery_descriptor = capture_rollback.get("d1TimeTravel")
        recovery_resolved = _resolve_bound_file(
            preflight_path.parent,
            recovery_descriptor
            if isinstance(recovery_descriptor, Mapping)
            else {},
        )
        if recovery_resolved is None or not recovery_resolved[1]:
            failures.append(_failure("artist_preflight_rollback_hash_mismatch"))
        else:
            recovery_path, recovery_payload = recovery_resolved
            recovery_document = _load_bound_json(recovery_payload)
            recovery_point_value = capture_rollback.get("recoveryPoint")
            recovery_point = (
                recovery_point_value
                if isinstance(recovery_point_value, Mapping)
                else {}
            )
            recovery_fields = [
                field
                for field in ("bookmark", "timestamp")
                if _nonblank_string(recovery_point.get(field))
            ]
            usable_recovery = (
                set(recovery_point) == {"bookmark", "timestamp"}
                and bool(recovery_fields)
                and all(
                    contains_recovery_value(
                        recovery_document, field, recovery_point.get(field)
                    )
                    for field in recovery_fields
                )
            )
            if not usable_recovery:
                failures.append(_failure("artist_preflight_recovery_point_invalid"))
            bound_paths.append(str(recovery_path.resolve()))
    if preflight_scope_ids != set(mapping_by_id):
        failures.append(_failure("artist_preflight_scope_mismatch"))

    post_descriptor_value = binding.get("postApplyVerification")
    post_descriptor = (
        post_descriptor_value
        if isinstance(post_descriptor_value, Mapping)
        else {}
    )
    expected_post_path = ARTIST_STATE_PATHS.get(phase, {}).get(
        "postApplyVerification"
    )
    post_resolved = _resolve_bound_file(
        evidence_root, post_descriptor, expected_path=expected_post_path
    )
    if post_resolved is None:
        failures.append(_failure("artist_post_apply_verification_missing"))
    elif not post_resolved[1]:
        failures.append(_failure("artist_post_apply_verification_hash_mismatch"))
    else:
        post_path, post_payload = post_resolved
        post_value = _load_bound_json(post_payload)
        post = post_value if isinstance(post_value, Mapping) else {}
        bound_paths.append(str(post_path.resolve()))
        state_descriptor_value = post.get("stateManifest")
        state_descriptor = (
            state_descriptor_value
            if isinstance(state_descriptor_value, Mapping)
            else {}
        )
        if (
            set(post)
            != {
                "schemaVersion",
                "verifiedAt",
                "environment",
                "phase",
                "artifactManifestSha256",
                "stateManifest",
                "preflightInputs",
                "resumeLineage",
                "applyResponses",
                "applySummary",
                "summary",
            }
            or post.get("schemaVersion") != "nga-post-apply-verification-v3"
            or _parse_utc_timestamp(post.get("verifiedAt")) is None
            or post.get("environment") != "staging"
            or post.get("phase") != phase
            or post.get("artifactManifestSha256") != sha256_bytes(manifest_bytes)
            or canonical_json(post.get("preflightInputs")) != canonical_json(preflight)
            or state_descriptor.get("path") != "state-manifest.json"
        ):
            failures.append(_failure("artist_post_apply_verification_invalid"))

        apply_responses_value = post.get("applyResponses")
        apply_responses = (
            apply_responses_value
            if isinstance(apply_responses_value, list)
            else []
        )
        apply_summary_value = post.get("applySummary")
        apply_summary = (
            apply_summary_value
            if isinstance(apply_summary_value, Mapping)
            else {}
        )
        ordered_apply_value = manifest.get("orderedArtifacts") if manifest else None
        ordered_apply = (
            ordered_apply_value if isinstance(ordered_apply_value, list) else []
        )
        apply_inventory_valid = len(apply_responses) == len(ordered_apply)
        apply_counts_valid = True
        expected_d1_queries = 0
        actual_d1_queries = 0
        d1_chunk_count = 0
        resumed_response_count = 0
        executed_response_count = 0
        saw_executed_response = False
        resumed_sources: list[Mapping[str, Any]] = []
        seen_response_paths: set[str] = set()
        for index, artifact_value in enumerate(ordered_apply):
            artifact = artifact_value if isinstance(artifact_value, Mapping) else {}
            descriptor_value = (
                apply_responses[index] if index < len(apply_responses) else {}
            )
            descriptor = (
                descriptor_value
                if isinstance(descriptor_value, Mapping)
                else {}
            )
            sequence = index + 1
            kind = artifact.get("kind")
            artifact_path = str(artifact.get("path") or "")
            response_path = f"apply-responses/{sequence:04d}.json"
            execution = descriptor.get("execution")
            expected_descriptor_keys = {
                "sequence",
                "kind",
                "path",
                "artifactPath",
                "sha256",
                "execution",
                *(
                    ("expectedQueryCount", "actualQueryCount", "telemetry")
                    if kind == "d1-sql"
                    else ()
                ),
                *(("source",) if execution == "resumed" else ()),
            }
            if (
                set(descriptor) != expected_descriptor_keys
                or descriptor.get("sequence") != sequence
                or descriptor.get("kind") != kind
                or descriptor.get("artifactPath") != artifact_path
                or descriptor.get("path") != response_path
                or response_path in seen_response_paths
                or execution not in {"resumed", "executed"}
                or (execution == "resumed" and saw_executed_response)
            ):
                apply_inventory_valid = False
            if execution == "resumed":
                resumed_response_count += 1
                source_value = descriptor.get("source")
                if isinstance(source_value, Mapping):
                    resumed_sources.append(source_value)
            elif execution == "executed":
                executed_response_count += 1
                saw_executed_response = True
            seen_response_paths.add(response_path)
            response_resolved = _resolve_bound_file(post_path.parent, descriptor)
            if response_resolved is None or not response_resolved[1]:
                failures.append(
                    _failure("artist_apply_response_artifact_hash_mismatch")
                )
                continue
            response_file, response_payload = response_resolved
            bound_paths.append(str(response_file.resolve()))
            if execution == "resumed":
                source_value = descriptor.get("source")
                source = source_value if isinstance(source_value, Mapping) else {}
                source_resolved = (
                    _resolve_bound_file(manifest_path.parent, source)
                    if manifest_path is not None
                    else None
                )
                if (
                    source_resolved is None
                    or not source_resolved[1]
                    or source.get("sha256") != descriptor.get("sha256")
                    or source_resolved[1] != response_payload
                ):
                    failures.append(
                        _failure("artist_apply_resume_source_hash_mismatch")
                    )
                else:
                    bound_paths.append(str(source_resolved[0].resolve()))
            response_value = _load_bound_json(response_payload)
            response = (
                response_value if isinstance(response_value, Mapping) else {}
            )
            if (
                set(response)
                != {"sequence", "kind", "path", "status", "stdout", "stderr"}
                or response.get("sequence") != sequence
                or response.get("kind") != kind
                or response.get("path") != artifact_path
                or response.get("status") != 0
                or not isinstance(response.get("stdout"), str)
                or not isinstance(response.get("stderr"), str)
            ):
                apply_inventory_valid = False
                continue
            if kind != "d1-sql":
                continue
            d1_chunk_count += 1
            sql_record = declared_files.get(artifact_path)
            sql_payload = sql_record[2] if sql_record is not None else b""
            try:
                sql_text = sql_payload.decode("utf-8")
            except UnicodeDecodeError:
                sql_text = ""
            sql_ids = re.findall(
                r"^\s*AND id = '([^']+)'\s*;?\s*$", sql_text, flags=re.MULTILINE
            )
            expected_chunk_queries = len(sql_ids)
            if (
                len(sql_ids) != artifact.get("recordCount")
                or len(set(sql_ids)) != len(sql_ids)
                or any(artwork_id not in mapping_by_id for artwork_id in sql_ids)
            ):
                apply_inventory_valid = False
            facts = _d1_facts_from_apply_stdout(response.get("stdout"))
            actual_chunk_queries = (
                facts.get("queryCount") if isinstance(facts, Mapping) else None
            )
            actual_telemetry = (
                facts.get("telemetry") if isinstance(facts, Mapping) else None
            )
            if (
                descriptor.get("expectedQueryCount") != expected_chunk_queries
                or descriptor.get("actualQueryCount") != actual_chunk_queries
                or actual_chunk_queries != expected_chunk_queries
                or canonical_json(descriptor.get("telemetry"))
                != canonical_json(actual_telemetry)
            ):
                apply_counts_valid = False
            expected_d1_queries += expected_chunk_queries
            actual_d1_queries += (
                actual_chunk_queries if isinstance(actual_chunk_queries, int) else 0
            )
        if not apply_inventory_valid:
            failures.append(_failure("artist_apply_response_inventory_invalid"))
        resume_lineage_value = post.get("resumeLineage")
        if resumed_response_count:
            resume_lineage = (
                resume_lineage_value
                if isinstance(resume_lineage_value, Mapping)
                else {}
            )
            lineage_resolved = (
                _resolve_bound_file(manifest_path.parent, resume_lineage)
                if manifest_path is not None
                else None
            )
            if lineage_resolved is None or not lineage_resolved[1]:
                failures.append(
                    _failure("artist_apply_resume_lineage_hash_mismatch")
                )
            else:
                lineage_path, lineage_payload = lineage_resolved
                lineage_value = _load_bound_json(lineage_payload)
                lineage = (
                    lineage_value if isinstance(lineage_value, Mapping) else {}
                )
                bound_paths.append(str(lineage_path.resolve()))
                source_git_sha = str(lineage.get("sourceGitSha") or "")
                source_root = str(lineage.get("sourceEvidenceRoot") or "")
                lineage_manifest_value = lineage.get("artifactManifest")
                lineage_manifest = (
                    lineage_manifest_value
                    if isinstance(lineage_manifest_value, Mapping)
                    else {}
                )
                lineage_preflight_value = lineage.get("preflightManifests")
                lineage_preflight = (
                    lineage_preflight_value
                    if isinstance(lineage_preflight_value, list)
                    else []
                )
                lineage_responses_value = lineage.get("responses")
                lineage_responses = (
                    lineage_responses_value
                    if isinstance(lineage_responses_value, list)
                    else []
                )
                expected_preflight_hashes = {
                    str(item.get("phase") or ""): item.get("manifestSha256")
                    for item in preflight
                    if isinstance(item, Mapping)
                }
                lineage_valid = (
                    set(lineage)
                    == {
                        "schemaVersion",
                        "sourceGitSha",
                        "sourceEvidenceRoot",
                        "artifactManifest",
                        "preflightManifests",
                        "responses",
                    }
                    and lineage.get("schemaVersion")
                    == "nga-apply-resume-lineage-v1"
                    and re.fullmatch(r"[a-f0-9]{40}", source_git_sha)
                    is not None
                    and re.fullmatch(
                        rf"\.agent/evidence/nga-staging/{source_git_sha}/\d{{8}}T\d{{6}}Z",
                        source_root,
                    )
                    is not None
                    and set(lineage_manifest) == {"sourcePath", "sha256"}
                    and lineage_manifest.get("sourcePath")
                    == f"backfill/{phase}/artifact-manifest.json"
                    and lineage_manifest.get("sha256")
                    == sha256_bytes(manifest_bytes)
                    and len(lineage_preflight) == len(expected_preflight_hashes)
                    and all(
                        isinstance(item, Mapping)
                        and item.get("sourcePath")
                        == (
                            "preflight/pilot/preflight-manifest.json"
                            if item.get("phase") == "pilot"
                            else "preflight/full-remaining/preflight-manifest.json"
                            if item.get("phase") == "full"
                            else None
                        )
                        for item in lineage_preflight
                    )
                    and {
                        str(item.get("phase") or ""): item.get("sha256")
                        for item in lineage_preflight
                        if isinstance(item, Mapping)
                        and set(item) == {"phase", "sourcePath", "sha256"}
                    }
                    == expected_preflight_hashes
                    and len(lineage_responses) == resumed_response_count
                    and all(
                        isinstance(item, Mapping)
                        and set(item)
                        == {"sequence", "sourcePath", "copiedPath", "sha256"}
                        and item.get("sequence") == index + 1
                        and item.get("copiedPath") == source.get("path")
                        and item.get("sha256") == source.get("sha256")
                        and re.fullmatch(
                            rf"backfill/{phase}/apply-responses/"
                            rf"(?!\.{{1,2}}/)[^/]+/{index + 1:04d}\.json",
                            str(item.get("sourcePath") or ""),
                        )
                        is not None
                        for index, (item, source) in enumerate(
                            zip(lineage_responses, resumed_sources)
                        )
                    )
                )
                if not lineage_valid:
                    failures.append(_failure("artist_apply_resume_lineage_invalid"))
        elif resume_lineage_value is not None:
            failures.append(_failure("artist_apply_resume_lineage_invalid"))
        expected_apply_summary = {
            "responseCount": len(ordered_apply),
            "resumedResponseCount": resumed_response_count,
            "executedResponseCount": executed_response_count,
            "d1ChunkCount": d1_chunk_count,
            "expectedD1QueryCount": expected_d1_queries,
            "actualD1QueryCount": actual_d1_queries,
            "expectedApplicationRecordChanges": (
                expected_count if phase == "pilot" else expected_count - 5
            ),
            "verifiedApplicationRecordChanges": (
                expected_count if phase == "pilot" else expected_count - 5
            ),
        }
        if (
            not apply_counts_valid
            or expected_d1_queries != expected_count
            or actual_d1_queries != expected_count
            or canonical_json(apply_summary)
            != canonical_json(expected_apply_summary)
        ):
            failures.append(
                _failure("artist_apply_response_query_count_mismatch")
            )
        state_resolved = _resolve_bound_file(post_path.parent, state_descriptor)
        if state_resolved is None or not state_resolved[1]:
            failures.append(_failure("artist_post_apply_artifact_hash_mismatch"))
        else:
            state_path, state_payload = state_resolved
            state_value = _load_bound_json(state_payload)
            state = state_value if isinstance(state_value, Mapping) else {}
            bound_paths.append(str(state_path.resolve()))
            state_counts_value = state.get("counts")
            state_counts = (
                state_counts_value
                if isinstance(state_counts_value, Mapping)
                else {}
            )
            state_inputs_value = state.get("inputs")
            state_inputs = (
                state_inputs_value
                if isinstance(state_inputs_value, Mapping)
                else {}
            )
            if (
                state.get("schemaVersion") != 2
                or state.get("captureKind") != "post-apply"
                or _parse_utc_timestamp(state.get("capturedAt")) is None
                or state.get("environment") != "staging"
                or state.get("phase") != phase
                or state.get("expectedOrgId") != NGA_STAGING_ORG_ID
                or state.get("resources")
                != {
                    "d1Database": NGA_STAGING_D1_DATABASE,
                    "imageVectorIndex": NGA_STAGING_IMAGE_VECTOR_INDEX,
                }
                or state_counts
                != {
                    "ids": expected_count,
                    "stagedRecords": expected_count,
                    "imageVectors": expected_count,
                }
                or set(state_inputs) != {"ids", "stagedRecords", "imageVectors"}
                or state.get("hashes")
                != {
                    "ids": (
                        state_inputs.get("ids", {}).get("sha256")
                        if isinstance(state_inputs.get("ids"), Mapping)
                        else None
                    ),
                    "stagedRecords": (
                        state_inputs.get("stagedRecords", {}).get("sha256")
                        if isinstance(state_inputs.get("stagedRecords"), Mapping)
                        else None
                    ),
                }
                or canonical_json(state.get("vectorFiles"))
                != canonical_json(state_inputs.get("imageVectors"))
                or "rollback" in state
            ):
                failures.append(_failure("artist_post_apply_state_manifest_invalid"))
            _, post_ids = load_state_input(
                state_path.parent,
                state_inputs.get("ids"),
                failure_code="artist_post_apply_artifact_hash_mismatch",
            )
            _, post_d1 = load_state_input(
                state_path.parent,
                state_inputs.get("stagedRecords"),
                failure_code="artist_post_apply_artifact_hash_mismatch",
            )
            post_vectors: list[Any] = []
            post_vector_descriptors = state_inputs.get("imageVectors")
            if not isinstance(post_vector_descriptors, list):
                failures.append(_failure("artist_post_apply_artifact_hash_mismatch"))
                post_vector_descriptors = []
            for vector_descriptor in post_vector_descriptors:
                _, rows = load_state_input(
                    state_path.parent,
                    vector_descriptor,
                    failure_code="artist_post_apply_artifact_hash_mismatch",
                    ndjson=True,
                )
                post_vectors.extend(rows)
            post_d1_by_id = {
                str(row.get("id") or ""): row
                for row in post_d1
                if isinstance(row, Mapping)
            }
            post_vectors_by_id = {}
            for row in post_vectors:
                if not isinstance(row, Mapping):
                    continue
                metadata_value = row.get("metadata")
                metadata = (
                    metadata_value if isinstance(metadata_value, Mapping) else {}
                )
                post_vectors_by_id[
                    str(row.get("id") or metadata.get("artworkId") or "")
                ] = row
            post_id_set = {str(value) for value in post_ids if isinstance(value, str)}
            state_valid = (
                len(post_ids) == expected_count
                and len(post_id_set) == expected_count
                and len(post_d1) == expected_count
                and len(post_d1_by_id) == expected_count
                and len(post_vectors) == expected_count
                and len(post_vectors_by_id) == expected_count
                and post_id_set == set(mapping_by_id)
                and set(post_d1_by_id) == post_id_set
                and set(post_vectors_by_id) == post_id_set
            )
            ordered_ids = sorted(
                mapping_by_id,
                key=lambda artwork_id: int(artwork_id.rsplit(":", 1)[1]),
            )
            application_record_changes = 0
            for artwork_id in ordered_ids:
                desired = mapping_by_id.get(artwork_id, {})
                original_value = rollback_d1_by_id.get(artwork_id)
                actual_value = post_d1_by_id.get(artwork_id)
                original_vector = rollback_by_id.get(artwork_id)
                actual_vector = post_vectors_by_id.get(artwork_id)
                if not all(
                    isinstance(value, Mapping)
                    for value in (
                        desired,
                        original_value,
                        actual_value,
                        original_vector,
                        actual_vector,
                    )
                ):
                    state_valid = False
                    continue
                original = json.loads(json.dumps(original_value))
                actual = json.loads(json.dumps(actual_value))
                try:
                    original_custom = (
                        json.loads(original.get("custom_metadata") or "{}")
                        if isinstance(original.get("custom_metadata"), str)
                        else original.get("custom_metadata") or {}
                    )
                    actual_custom = (
                        json.loads(actual.get("custom_metadata") or "{}")
                        if isinstance(actual.get("custom_metadata"), str)
                        else actual.get("custom_metadata") or {}
                    )
                    original_sources = (
                        json.loads(original.get("field_sources") or "{}")
                        if isinstance(original.get("field_sources"), str)
                        else original.get("field_sources") or {}
                    )
                    actual_sources = (
                        json.loads(actual.get("field_sources") or "{}")
                        if isinstance(actual.get("field_sources"), str)
                        else actual.get("field_sources") or {}
                    )
                except json.JSONDecodeError:
                    state_valid = False
                    continue
                if not all(
                    isinstance(value, Mapping)
                    for value in (
                        original_custom,
                        actual_custom,
                        original_sources,
                        actual_sources,
                    )
                ):
                    state_valid = False
                    continue
                expected_custom = {
                    **original_custom,
                    "ngaArtists": desired.get("customMetadata", {}).get("ngaArtists"),
                }
                expected_sources = {
                    **original_sources,
                    "primary_artist_id": "nga.objects_constituents",
                }
                original_semantic = {
                    **original,
                    "custom_metadata": original_custom,
                    "field_sources": original_sources,
                }
                actual_semantic = {
                    **actual,
                    "custom_metadata": actual_custom,
                    "field_sources": actual_sources,
                }
                if (
                    phase == "pilot"
                    or artwork_id.removeprefix("open-access-art:nga:")
                    not in NGA_PILOT_OBJECT_IDS
                ) and canonical_json(actual_semantic) != canonical_json(
                    original_semantic
                ):
                    application_record_changes += 1
                original["primary_artist_id"] = desired.get("primaryArtistId")
                original["custom_metadata"] = expected_custom
                original["field_sources"] = expected_sources
                original["updated_at"] = actual.get("updated_at")
                actual["custom_metadata"] = actual_custom
                actual["field_sources"] = actual_sources
                expected_vector = json.loads(json.dumps(original_vector))
                expected_vector["metadata"] = {
                    **(
                        expected_vector.get("metadata")
                        if isinstance(expected_vector.get("metadata"), Mapping)
                        else {}
                    ),
                    "primaryArtistId": desired.get("primaryArtistId"),
                }
                if (
                    actual_value.get("primary_artist_id")
                    != desired.get("primaryArtistId")
                    or canonical_json(actual_custom) != canonical_json(expected_custom)
                    or canonical_json(actual_sources) != canonical_json(expected_sources)
                    or canonical_json(actual) != canonical_json(original)
                    or canonical_json(actual_vector) != canonical_json(expected_vector)
                ):
                    state_valid = False
            if not state_valid:
                failures.append(_failure("artist_post_apply_state_mismatch"))
            expected_application_record_changes = (
                expected_count if phase == "pilot" else expected_count - 5
            )
            if application_record_changes != expected_application_record_changes:
                failures.append(
                    _failure(
                        "artist_post_apply_application_change_count_mismatch",
                        expected=expected_application_record_changes,
                        actual=application_record_changes,
                    )
                )
            expected_summary = {
                "phase": phase,
                "recordCount": expected_count,
                "vectorCount": expected_count,
                "applicationRecordChanges": application_record_changes,
                "unrelatedFieldsUnchanged": True,
                "vectorValuesUnchanged": True,
                "idempotentD1State": True,
                "postRecordsSha256": sha256_json(
                    [post_d1_by_id.get(artwork_id) for artwork_id in ordered_ids]
                ),
                "postVectorsSha256": sha256_json(
                    [post_vectors_by_id.get(artwork_id) for artwork_id in ordered_ids]
                ),
            }
            if canonical_json(post.get("summary")) != canonical_json(expected_summary):
                failures.append(_failure("artist_post_apply_summary_mismatch"))

    ordered_value = manifest.get("orderedArtifacts") if manifest else None
    ordered = ordered_value if isinstance(ordered_value, list) else []
    ordered_counts = {"d1-sql": 0, "image-vectors": 0}
    for item_value in ordered:
        item = item_value if isinstance(item_value, Mapping) else {}
        declared = declared_files.get(str(item.get("path") or ""))
        if (
            item.get("kind") not in {"d1-sql", "image-vectors"}
            or declared is None
            or item.get("sha256") != declared[0].get("sha256")
            or item.get("recordCount") != declared[0].get("recordCount")
        ):
            failures.append(_failure("artist_ordered_artifact_invalid"))
        elif type(item.get("recordCount")) is int:
            ordered_counts[str(item.get("kind"))] += int(item["recordCount"])
    if ordered_counts != {"d1-sql": expected_count, "image-vectors": expected_count}:
        failures.append(_failure("artist_artifact_count_mismatch"))

    production_value = binding.get("productionIdentity")
    production = production_value if isinstance(production_value, Mapping) else {}
    captures: dict[str, Mapping[str, Any]] = {}
    expected_production_paths = PRODUCTION_IDENTITY_PATHS.get(phase, {})
    for name, expected_path in expected_production_paths.items():
        descriptor_value = production.get(name)
        descriptor = descriptor_value if isinstance(descriptor_value, Mapping) else {}
        resolved = _resolve_bound_file(
            evidence_root, descriptor, expected_path=expected_path
        )
        if resolved is None:
            if name == "trustedPreflight":
                failures.append(_failure("production_identity_preflight_untrusted"))
            else:
                failures.append(
                    _failure("production_identity_capture_invalid", capture=name)
                )
            continue
        path, payload = resolved
        if not payload:
            failures.append(
                _failure("production_identity_hash_mismatch", capture=name)
            )
            continue
        value = _load_bound_json(payload)
        capture = _valid_production_capture(
            value, expected_role=PRODUCTION_IDENTITY_ROLES[name]
        )
        if capture is None:
            failures.append(
                _failure("production_identity_capture_invalid", capture=name)
            )
            continue
        captures[name] = capture
        bound_paths.append(str(path.resolve()))
    if "trustedPreflight" not in captures:
        failures.append(_failure("production_identity_preflight_untrusted"))
    elif any(
        captures.get(name, {}).get("resources")
        != captures["trustedPreflight"].get("resources")
        for name in ("before", "after")
    ):
        failures.append(_failure("production_artist_data_identity_changed"))
    if set(captures) == set(expected_production_paths):
        trusted_time = _parse_utc_timestamp(
            captures["trustedPreflight"].get("capturedAt")
        )
        before_time = _parse_utc_timestamp(captures["before"].get("capturedAt"))
        after_time = _parse_utc_timestamp(captures["after"].get("capturedAt"))
        if (
            any(value is None for value in (trusted_time, before_time, after_time))
            or not trusted_time <= before_time < after_time
        ):
            failures.append(_failure("production_identity_capture_order_invalid"))

    artifact_hashes = {
        str(path.relative_to(evidence_root.resolve())): sha256_bytes(
            path.read_bytes()
        )
        for path in sorted({Path(value) for value in bound_paths})
    }
    return _result(
        failures,
        binding=binding,
        mappingCount=len(mapping),
        vectorRecordCount=len(enriched_rows),
        vectorValueHashCount=len(value_hashes),
        artifactHashes=artifact_hashes,
        evidenceSha256=sha256_json(artifact_hashes),
        boundPaths=bound_paths,
    )


def evaluate_deployment_binding(
    identity: Mapping[str, Any], *, snapshot: str, evaluator_git_sha: str
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    api_value = identity.get("api")
    web_value = identity.get("web")
    api = api_value if isinstance(api_value, Mapping) else {}
    web = web_value if isinstance(web_value, Mapping) else {}
    expected_top_fields = {
        "schemaVersion",
        "snapshot",
        "capturedAt",
        "api",
        "web",
    }
    artist_phase: str | None = None
    if snapshot == "candidate":
        expected_top_fields.add("artistDataBinding")
        artist_value = identity.get("artistDataBinding")
        if isinstance(artist_value, Mapping):
            artist_phase = _artist_binding_phase(artist_value)
        if artist_phase == "full":
            expected_top_fields.add("pilotDeploymentIdentityHash")
    if set(identity) != expected_top_fields:
        failures.append(
            _failure(
                "deployment_identity_incomplete",
                field="topLevelFields",
                expected=sorted(expected_top_fields),
                actual=sorted(identity),
            )
        )
    if set(api) != DEPLOYMENT_IDENTITY_API_FIELDS:
        failures.append(
            _failure(
                "deployment_identity_incomplete",
                field="api.fields",
                expected=sorted(DEPLOYMENT_IDENTITY_API_FIELDS),
                actual=sorted(api),
            )
        )
    if set(web) != DEPLOYMENT_IDENTITY_WEB_FIELDS:
        failures.append(
            _failure(
                "deployment_identity_incomplete",
                field="web.fields",
                expected=sorted(DEPLOYMENT_IDENTITY_WEB_FIELDS),
                actual=sorted(web),
            )
        )
    required_top = {
        "schemaVersion": "nga-deployment-identity-v1",
        "snapshot": snapshot,
    }
    for field, expected in required_top.items():
        if identity.get(field) != expected:
            failures.append(
                _failure(
                    "deployment_identity_incomplete",
                    field=field,
                    expected=expected,
                    actual=identity.get(field),
                )
            )
    if _parse_utc_timestamp(identity.get("capturedAt")) is None:
        failures.append(
            _failure("deployment_identity_incomplete", field="capturedAt")
        )

    required_components = {
        "api": (
            api,
            {
                "origin": EXPECTED_API_ORIGIN,
                "deploymentId": None,
                "versionId": None,
                "gitSha": None,
                "apiVersion": None,
                "parserVersion": None,
                "planVersion": None,
                "resultCacheVersion": None,
            },
        ),
        "web": (
            web,
            {
                "origin": EXPECTED_WEB_ORIGIN,
                "deploymentId": None,
                "versionId": None,
                "gitSha": None,
                "contractVersion": None,
            },
        ),
    }
    for component, (record, fields) in required_components.items():
        for field, expected in fields.items():
            value = record.get(field)
            valid = value == expected if expected is not None else (
                isinstance(value, str) and bool(value.strip())
            )
            if not valid:
                failures.append(
                    _failure(
                        "deployment_identity_incomplete",
                        field=f"{component}.{field}",
                        expected=expected,
                        actual=value,
                    )
                )
        git_sha = record.get("gitSha")
        if isinstance(git_sha, str) and not re.fullmatch(r"[a-f0-9]{40}", git_sha):
            failures.append(
                _failure(
                    "deployment_identity_incomplete",
                    field=f"{component}.gitSha",
                    actual=git_sha,
                )
            )

    deployed_versions = {
        "parser": api.get("parserVersion"),
        "plan": api.get("planVersion"),
        "contract": web.get("contractVersion"),
        "apiResultCache": api.get("resultCacheVersion"),
    }
    if snapshot == "candidate":
        if artist_phase == "full" and (
            not isinstance(identity.get("pilotDeploymentIdentityHash"), str)
            or re.fullmatch(
                r"[a-f0-9]{64}", str(identity.get("pilotDeploymentIdentityHash"))
            )
            is None
        ):
            failures.append(
                _failure(
                    "deployment_identity_incomplete",
                    field="pilotDeploymentIdentityHash",
                )
            )
        for component, record in (("api", api), ("web", web)):
            if record.get("gitSha") != evaluator_git_sha:
                failures.append(
                    _failure(
                        "deployment_git_sha_mismatch",
                        component=component,
                        expected=evaluator_git_sha,
                        actual=record.get("gitSha"),
                    )
                )
        if deployed_versions != EXPECTED_VERSIONS:
            failures.append(
                _failure(
                    "deployed_version_mismatch",
                    expected=EXPECTED_VERSIONS,
                    actual=deployed_versions,
                )
            )
        artist_data = _evaluate_artist_data_binding(identity)
        failures.extend(artist_data["failures"])
    else:
        artist_data = _result([], binding=identity.get("artistDataBinding"))
    return _result(
        failures,
        snapshot=snapshot,
        evaluatorGitSha=evaluator_git_sha,
        deploymentIdentityHash=sha256_json(identity),
        deployedVersions=deployed_versions,
        artistDataBinding=artist_data,
        identity=identity,
    )


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
    raw_org_fields = {
        field: row.get(field) for field in ("orgId", "galleryId")
    }
    raw_org_values = list(raw_org_fields.values())
    accepted_physical_orgs = {
        "open-access-art",
        "eabbf000-708e-4d4c-8ac8-966b59d4fcac",
    }
    if logical_org != "open-access-art" or any(
        not isinstance(value, str) or value not in accepted_physical_orgs
        for value in raw_org_values
    ):
        violations.append(
            {
                "constraint": "organization",
                "expected": "open-access-art",
                "actual": {
                    "logical": logical_org,
                    "physical": raw_org_fields,
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


ATTRIBUTION_ROLE_MARKERS = {
    "after": ("after",),
    "attributed_to": ("attributed to", "attributed"),
    "workshop_of": ("workshop of",),
    "studio_of": ("studio of",),
    "circle_of": ("circle of",),
    "school_of": ("school of",),
    "follower_of": ("follower of",),
}


def _nonblank_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _parse_artist_relationship(value: Any) -> Mapping[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    constituent_id = value.get("constituentId")
    display_order = value.get("displayOrder")
    prefix = value.get("prefix")
    suffix = value.get("suffix")
    alternatives = value.get("alternativeNames")
    if (
        not isinstance(constituent_id, str)
        or re.fullmatch(r"\d+", constituent_id) is None
        or isinstance(display_order, bool)
        or not isinstance(display_order, (int, float))
        or not math.isfinite(display_order)
        or not float(display_order).is_integer()
        or abs(display_order) > 2**53 - 1
        or value.get("roleType") != "artist"
        or not _nonblank_string(value.get("role"))
        or not (prefix is None or _nonblank_string(prefix))
        or not (suffix is None or _nonblank_string(suffix))
        or not _nonblank_string(value.get("preferredDisplayName"))
        or not _nonblank_string(value.get("forwardDisplayName"))
        or not isinstance(alternatives, list)
        or any(not _nonblank_string(name) for name in alternatives)
    ):
        return None
    return value


def _row_proves_attribution(
    row: Mapping[str, Any], attribution: Mapping[str, Any]
) -> bool:
    metadata_value = row.get("metadata")
    metadata = metadata_value if isinstance(metadata_value, Mapping) else {}
    artists_value = metadata.get("ngaArtists")
    artists = artists_value if isinstance(artists_value, Mapping) else {}
    relationships_value = artists.get("relationships")
    relationships = relationships_value if isinstance(relationships_value, list) else []
    relationship_kind = attribution.get("relationship")
    target_tokens = set(fold(attribution.get("targetText")).split())
    if not target_tokens or relationship_kind not in {
        "direct",
        *ATTRIBUTION_ROLE_MARKERS,
    }:
        return False

    for value in relationships:
        parsed = _parse_artist_relationship(value)
        if parsed is None:
            continue
        relationship = parsed
        constituent_id = relationship.get("constituentId")
        names = [
            relationship.get("preferredDisplayName"),
            relationship.get("forwardDisplayName"),
        ]
        alternatives = relationship.get("alternativeNames")
        if isinstance(alternatives, list):
            names.extend(alternatives)
        names_match = any(
            isinstance(name, str)
            and target_tokens.issubset(set(fold(name).split()))
            for name in names
        )
        if (
            not names_match
        ):
            continue
        role_text = fold(
            " ".join(
                str(relationship.get(field) or "")
                for field in ("prefix", "role", "suffix")
            )
        )
        if relationship_kind == "direct":
            if metadata.get("primaryArtistId") == constituent_id:
                return True
            continue
        if any(
            f" {marker} " in f" {role_text} "
            for marker in ATTRIBUTION_ROLE_MARKERS[str(relationship_kind)]
        ):
            return True
    return False


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


def _evaluate_minimum_results(
    case: Mapping[str, Any], actual: int
) -> list[dict[str, Any]]:
    if "minimumResults" not in case:
        return []
    minimum_results = case.get("minimumResults")
    if type(minimum_results) is not int or minimum_results < 1:
        return [
            _failure(
                "invalid_minimum_results",
                declared=minimum_results,
                requirement="integer greater than or equal to 1",
            )
        ]
    if actual < minimum_results:
        return [
            _failure(
                str(case.get("capabilityFailure") or "minimum_results_not_met"),
                expectedMinimum=minimum_results,
                actual=actual,
            )
        ]
    return []


def _strict_success_rows(
    payload: Mapping[str, Any], schema_code: str
) -> tuple[Mapping[str, Any], list[Any], list[dict[str, Any]]]:
    failures: list[dict[str, Any]] = []
    data_value = payload.get("data")
    if not isinstance(data_value, Mapping):
        failures.append(_failure(schema_code, field="data", actual=type(data_value).__name__))
        return {}, [], failures
    results_value = data_value.get("results")
    if not isinstance(results_value, list):
        failures.append(
            _failure(schema_code, field="data.results", actual=type(results_value).__name__)
        )
        rows: list[Any] = []
    else:
        rows = results_value
    count = data_value.get("count")
    if type(count) is not int or count != len(rows):
        failures.append(
            _failure(schema_code, field="data.count", actual=count, expected=len(rows))
        )
    if any(not isinstance(row, Mapping) for row in rows):
        failures.append(_failure(schema_code, field="data.results[]"))
    return data_value, rows, failures


def evaluate_declared_interpretation(
    case: Mapping[str, Any],
    interpretation: Mapping[str, Any],
    expected_parser_version: str,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    parser_version = interpretation.get("parserVersion")
    if parser_version != expected_parser_version:
        failures.append(
            _failure(
                "parser_version_mismatch",
                expected=expected_parser_version,
                actual=parser_version,
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

    if "semanticQuery" in expected and interpretation.get(
        "semanticQuery"
    ) != expected.get("semanticQuery"):
        failures.append(
            _failure(
                "semantic_query_mismatch",
                expected=expected.get("semanticQuery"),
                actual=interpretation.get("semanticQuery"),
            )
        )

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

    expected_attribution = expected.get("attribution")
    actual_attribution = interpretation.get("attribution")
    if "attribution" in expected and actual_attribution != expected_attribution:
        failures.append(
            _failure(
                "attribution_interpretation_mismatch",
                expected=expected_attribution,
                actual=actual_attribution,
            )
        )

    unresolved = interpretation.get("unresolved")
    expects_unresolved = expected.get("unresolved") is True
    if expects_unresolved:
        if not isinstance(unresolved, list) or not unresolved:
            failures.append(_failure("unresolved_ambiguity_missing"))
    elif isinstance(unresolved, list) and unresolved:
        failures.append(
            _failure("unexpected_unresolved", actual=unresolved)
        )
    elif not isinstance(unresolved, list):
        failures.append(
            _failure(
                "invalid_text_success_schema",
                field="data.interpretation.unresolved",
            )
        )

    return _result(
        failures,
        parserVersion=parser_version,
        constraints=actual_constraints,
        relation=actual_relation,
        attribution=actual_attribution,
        unresolved=unresolved,
    )


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

    data, rows, schema_failures = _strict_success_rows(
        payload, "invalid_text_success_schema"
    )
    failures.extend(schema_failures)
    interpretation_value = data.get("interpretation")
    interpretation = (
        interpretation_value if isinstance(interpretation_value, Mapping) else {}
    )
    expected_parser_version = (
        observed_versions.get("parser")
        if observed_versions is not None
        else EXPECTED_VERSIONS["parser"]
    )
    interpretation_evaluation = evaluate_declared_interpretation(
        case, interpretation, expected_parser_version
    )
    failures.extend(interpretation_evaluation["failures"])
    parser_version = interpretation_evaluation["parserVersion"]
    actual_constraints = interpretation_evaluation["constraints"]
    expected_value = case.get("expected")
    expected = expected_value if isinstance(expected_value, Mapping) else {}
    expected_relation = expected.get("relation")
    expected_attribution = expected.get("attribution")

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
        metadata_value = row_value.get("metadata")
        metadata = metadata_value if isinstance(metadata_value, Mapping) else {}
        row_evidence_value = metadata.get("relationEvidence")
        row_evidence = (
            row_evidence_value
            if isinstance(row_evidence_value, Mapping)
            else {}
        )
        if isinstance(expected_relation, Mapping):
            expected_sources = (
                {"institution_metadata"}
                if expected_relation.get("kind") == "derived_from"
                else {"institution_metadata", "image_caption_agreement"}
            )
            if (
                row_evidence.get("verified") is not True
                or row_evidence.get("source") not in expected_sources
            ):
                failures.append(
                    _failure(
                        "unverified_relation_row",
                        rank=rank,
                        artworkId=row_value.get("id"),
                    )
                )
        if isinstance(expected_attribution, Mapping) and (
            row_evidence.get("verified") is not True
            or row_evidence.get("source") != "catalogue_artist"
        ):
            failures.append(
                _failure(
                    "unverified_attribution_row",
                    rank=rank,
                    artworkId=row_value.get("id"),
                )
            )
        if isinstance(expected_attribution, Mapping) and not _row_proves_attribution(
            row_value, expected_attribution
        ):
            failures.append(
                _failure(
                    "attribution_hard_filter_violation",
                    rank=rank,
                    artworkId=row_value.get("id"),
                    expected=expected_attribution,
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
    if (
        not isinstance(meta_value, Mapping)
        or not isinstance(search_value, Mapping)
        or search.get("cacheable") is not True
        or not isinstance(degraded, list)
    ):
        failures.append(_failure("invalid_text_success_schema", field="meta.search"))
    if search.get("cacheable") is not True or degraded != []:
        failures.append(
            _failure(
                "degraded_cacheable_text",
                cacheable=search.get("cacheable"),
                degradedChannels=degraded,
            )
        )

    cache_control = _header(response, "cache-control")
    etag = _header(response, "etag")
    cache_state = (_header(response, "x-paillette-search-cache") or "").upper()
    cache_control_tokens = {
        token.strip().lower() for token in (cache_control or "").split(",")
    }
    required_headers = {
        "cache-control": bool(
            "public" in cache_control_tokens
            and any(token.startswith("s-maxage=") for token in cache_control_tokens)
        ),
        "etag": bool(etag),
        "x-paillette-search-cache": cache_state in VALID_TEXT_CACHE_STATES,
    }
    for header, valid in required_headers.items():
        if not valid:
            failures.append(_failure("missing_text_cache_header", header=header))

    if case.get("expectedZeroResults") is True and rows:
        failures.append(_failure("expected_zero_results", actual=len(rows)))
    relation_evidence_value = interpretation.get("relationEvidence")
    relation_evidence = (
        relation_evidence_value
        if isinstance(relation_evidence_value, Mapping)
        else {}
    )
    if isinstance(expected_relation, Mapping):
        expected_policy = (
            "catalogue_derivation"
            if expected_relation.get("kind") == "derived_from"
            else "visible_subject"
        )
        expected_status = "verified" if rows else "unverified"
        if (
            relation_evidence.get("policy") != expected_policy
            or relation_evidence.get("status") != expected_status
        ):
            failures.append(
                _failure(
                    "relation_evidence_status_mismatch",
                    expected={
                        "policy": expected_policy,
                        "status": expected_status,
                    },
                    actual=relation_evidence_value,
                )
            )
    if case.get("expectedVerifiedEmpty") is True:
        if rows:
            failures.append(
                _failure("unsupported_derived_relation_row", actual=len(rows))
            )
        if (
            not isinstance(expected_relation, Mapping)
            or expected_relation.get("kind") != "derived_from"
            or relation_evidence
            != {
                "policy": "catalogue_derivation",
                "status": "unverified",
            }
        ):
            failures.append(_failure("derived_verified_empty_evidence_mismatch"))
    failures.extend(_evaluate_minimum_results(case, len(row_records)))

    return _result(
        failures,
        caseId=case.get("id"),
        status=status,
        parserVersion=parser_version,
        interpretation=interpretation,
        constraints=actual_constraints,
        relation=interpretation_evaluation["relation"],
        attribution=interpretation_evaluation["attribution"],
        relationEvidence=relation_evidence_value,
        cache=cache_state or None,
        cacheControl=cache_control,
        etag=etag,
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
        _data, _rows, schema_failures = _strict_success_rows(
            payload, "invalid_text_success_schema"
        )
        failures.extend({**failure, "probe": label} for failure in schema_failures)
        meta_value = payload.get("meta")
        meta = meta_value if isinstance(meta_value, Mapping) else {}
        search_value = meta.get("search")
        search = search_value if isinstance(search_value, Mapping) else {}
        degraded = search.get("degradedChannels")
        if (
            not isinstance(meta_value, Mapping)
            or not isinstance(search_value, Mapping)
            or search.get("cacheable") is not True
            or not isinstance(degraded, list)
        ):
            failures.append(
                _failure(
                    "invalid_text_success_schema", field="meta.search", probe=label
                )
            )
        if search.get("cacheable") is not True or degraded != []:
            failures.append(
                _failure(
                    "degraded_cacheable_text",
                    probe=label,
                    cacheable=search.get("cacheable"),
                    degradedChannels=degraded,
                )
            )
        cache_control = _header(response, "cache-control")
        cache_control_tokens = {
            token.strip().lower() for token in (cache_control or "").split(",")
        }
        required_headers = {
            "cache-control": bool(
                "public" in cache_control_tokens
                and any(
                    token.startswith("s-maxage=")
                    for token in cache_control_tokens
                )
            ),
            "etag": bool(_header(response, "etag")),
            "x-paillette-search-cache": (
                (_header(response, "x-paillette-search-cache") or "").upper()
                in VALID_TEXT_CACHE_STATES
            ),
        }
        failures.extend(
            _failure("missing_text_cache_header", header=header, probe=label)
            for header, valid in required_headers.items()
            if not valid
        )

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
    return canonical_image_identity_from_digest(
        sha256_bytes(image_bytes), constraints, top_k, min_score
    )


def canonical_image_identity_from_digest(
    image_digest: str,
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
            "imageDigest": image_digest,
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
    _data, rows, schema_failures = _strict_success_rows(
        payload, "invalid_image_success_schema"
    )
    failures.extend(schema_failures)
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


def evaluate_image_case(
    case: Mapping[str, Any], response: Mapping[str, Any]
) -> dict[str, Any]:
    evaluated = evaluate_image_response(response, case.get("constraints"))
    failures = list(evaluated["failures"])
    failures.extend(_evaluate_minimum_results(case, len(evaluated["rows"])))
    target_expectation = case.get("targetExpectation")
    if target_expectation is not None:
        fixture_id = case.get("fixtureId")
        if not isinstance(target_expectation, Mapping) or not isinstance(
            fixture_id, str
        ):
            failures.append(_failure("invalid_image_target_expectation"))
        else:
            policy = target_expectation.get("policy")
            target_rank = next(
                (
                    row["rank"]
                    for row in evaluated["rows"]
                    if row.get("id") == fixture_id
                ),
                None,
            )
            if policy == "required":
                max_rank = target_expectation.get("maxRank")
                if type(max_rank) is not int or max_rank < 1:
                    failures.append(_failure("invalid_image_target_expectation"))
                elif target_rank is None:
                    failures.append(
                        _failure(
                            "required_image_target_missing",
                            artworkId=fixture_id,
                            expectedMaxRank=max_rank,
                        )
                    )
                elif target_rank > max_rank:
                    failures.append(
                        _failure(
                            "required_image_target_rank_not_met",
                            artworkId=fixture_id,
                            expectedMaxRank=max_rank,
                            actualRank=target_rank,
                        )
                    )
            elif policy == "excluded":
                if target_rank is not None:
                    failures.append(
                        _failure(
                            "excluded_image_target_returned",
                            artworkId=fixture_id,
                            actualRank=target_rank,
                        )
                    )
            else:
                failures.append(_failure("invalid_image_target_expectation"))
    return {
        **evaluated,
        "failures": failures,
        "failureCodes": [failure["code"] for failure in failures],
        "passed": not failures,
    }


def evaluate_negative_image_probes(
    probes: Mapping[str, Mapping[str, Any]]
) -> dict[str, Any]:
    failures = []
    expected_status = {
        "invalid_mime": {400, 413, 415, 422},
        "zero_byte": {400, 413, 415, 422},
        "multiple_files": {400, 413, 415, 422},
        "oversize": {400, 413},
    }
    expected_messages = {
        "invalid_mime": "Image must be a JPEG, PNG, or WebP file.",
        "zero_byte": "Image must not be empty.",
        "multiple_files": "Exactly one image file is required.",
        "oversize": "Image must be 10 MB or smaller.",
    }
    for name, accepted_statuses in expected_status.items():
        response = probes.get(name) or {}
        status = int(response.get("status") or 0)
        if status not in accepted_statuses:
            failures.append(
                _failure(f"invalid_image_accepted:{name}", status=status)
            )
        payload = _response_json(response)
        error_value = payload.get("error")
        error = error_value if isinstance(error_value, Mapping) else {}
        if (
            payload.get("success") is not False
            or error.get("code") != "INVALID_INPUT"
            or error.get("message") != expected_messages[name]
        ):
            failures.append(
                _failure(
                    f"invalid_image_error_contract:{name}",
                    status=status,
                    error=error,
                )
            )
        cache_control = (_header(response, "cache-control") or "").lower()
        if "no-store" not in cache_control:
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
        if fields.get("unresolved") is True:
            expected["unresolved"] = True
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
                "legacyAmbiguous": fields.get("ambiguous") is True,
                **(
                    {"minimumResults": 1}
                    if fields.get("ambiguous") is not True
                    and expected.get("unresolved") is not True
                    else {}
                ),
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
    normalized_new_text = []
    request_contracts: dict[str, tuple[str, Mapping[str, Any]]] = {}
    for raw_case in new_text:
        case = dict(raw_case)
        expected_value = case.get("expected")
        expected = expected_value if isinstance(expected_value, Mapping) else {}
        relation_value = expected.get("relation")
        relation = relation_value if isinstance(relation_value, Mapping) else {}
        manual = bool(case.get("manualGradeTop"))
        verified_empty = case.get("expectedVerifiedEmpty") is True
        expected_zero = case.get("expectedZeroResults") is True
        if (manual or "minimumResults" in case) and (
            verified_empty or expected_zero
        ):
            raise ValueError("contradictory request gates")
        if (
            "minimumResults" not in case
            and not verified_empty
            and not expected_zero
            and expected.get("unresolved") is not True
        ):
            case["minimumResults"] = 1
        if relation.get("kind") == "derived_from" and (
            not verified_empty or manual
        ):
            raise ValueError(
                "historical derived requests require verified-empty evidence"
            )
        request_key = sha256_json(_text_request_body(case))
        contract = {
            "expected": expected,
            "manualGradeTop": case.get("manualGradeTop"),
            "minimumResults": case.get("minimumResults"),
            "expectedZeroResults": expected_zero,
            "expectedVerifiedEmpty": verified_empty,
        }
        previous = request_contracts.get(request_key)
        if previous is not None and previous[1] != contract:
            raise ValueError(
                "contradictory request gates: "
                f"{previous[0]} and {case.get('id')}"
            )
        request_contracts[request_key] = (str(case.get("id")), contract)
        normalized_new_text.append(case)
    expected_versions = document.get("expectedVersions")
    if expected_versions != EXPECTED_VERSIONS:
        raise ValueError("staging case versions do not match evaluator versions")
    return {
        **document,
        "textCases": normalized_new_text,
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
        if (
            tuple(pilot.get("textCaseIds", [])) != PILOT_TEXT_CASE_IDS
            or tuple(pilot.get("imageCaseIds", [])) != PILOT_IMAGE_CASE_IDS
            or any(
                str(case.get("fixtureId", "")).removeprefix(
                    "open-access-art:nga:"
                )
                not in NGA_PILOT_OBJECT_IDS
                for case in selected_images
            )
        ):
            raise ValueError("pilot case inventory differs from the approved scope")
        return {
            "text": selected_text,
            "image": selected_images,
            "counts": {"legacy": 0, "newText": 4, "image": 3, "total": 7},
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


def compute_relevance_metrics(
    labels: Sequence[int], *, strong_threshold: int = 2
) -> dict[str, float | int]:
    if not isinstance(labels, Sequence) or isinstance(labels, (str, bytes)):
        raise ValueError("human relevance labels must be a sequence")
    if any(type(label) is not int or label < 0 or label > 3 for label in labels):
        raise ValueError("human relevance labels must be integers from 0 to 3")
    if not labels:
        raise ValueError("at least one human relevance label is required")
    if type(strong_threshold) is not int or not 1 <= strong_threshold <= 3:
        raise ValueError("strong relevance threshold must be an integer from 1 to 3")
    top_five = list(labels[:5])
    precision_at_five = sum(label > 0 for label in top_five) / 5
    strong_results_at_five = sum(label >= strong_threshold for label in top_five)
    first_relevant = next((index for index, label in enumerate(labels, 1) if label > 0), None)
    first_strong = next(
        (
            index
            for index, label in enumerate(labels, 1)
            if label >= strong_threshold
        ),
        None,
    )
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
        "strongPrecisionAt5": strong_results_at_five / 5,
        "strongResultsAt5": strong_results_at_five,
        "strongResultCount": sum(
            label >= strong_threshold for label in labels
        ),
        "mrr": mrr,
        "strongMrr": 0.0 if first_strong is None else 1 / first_strong,
        "ndcgAt10": 0.0 if idcg == 0 else dcg / idcg,
    }


def score_manual_relevance(labels: Sequence[int]) -> dict[str, float | int]:
    return compute_relevance_metrics(labels, strong_threshold=2)


def evaluate_strong_relevance(
    metrics: Mapping[str, Any], *, minimum_strong_results: int = 1
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    if type(minimum_strong_results) is not int or minimum_strong_results < 1:
        return _result([_failure("invalid_strong_relevance_minimum")])
    actual = metrics.get("strongResultsAt5")
    precision = metrics.get("strongPrecisionAt5")
    if type(actual) is not int or type(precision) not in {int, float}:
        failures.append(_failure("strong_relevance_metrics_incomplete"))
    elif actual < minimum_strong_results:
        failures.append(
            _failure(
                "strong_relevance_threshold_not_met",
                expectedMinimum=minimum_strong_results,
                actual=actual,
            )
        )
    return _result(
        failures,
        minimumStrongResults=minimum_strong_results,
        metrics=metrics,
    )


def make_manual_grading_template(
    case_id: str, rows: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    return {
        "caseId": case_id,
        "status": "manual_review_required",
        "minimumReturnedRelevance": 1,
        "instructions": (
            "Assign each relevance field an integer 0-3; do not infer it from "
            "similarity. Grades 2-3 are strong; grade 1 is weak and cannot "
            "satisfy the strong-result gate; grade 0 in any evaluated returned "
            "row stops the release."
        ),
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


def summarize_manual_relevance(
    templates: Sequence[Mapping[str, Any]], labels_document: Mapping[str, Any]
) -> dict[str, Any]:
    if not templates:
        raise ValueError("no grading templates exist for relevance labels")
    if labels_document.get("schemaVersion") != "nga-relevance-labels-v1":
        raise ValueError("unexpected relevance label schema")
    for field in ("gradedAt", "reviewer"):
        if not isinstance(labels_document.get(field), str) or not labels_document.get(
            field
        ):
            raise ValueError(f"relevance labels require {field}")
    label_cases_value = labels_document.get("cases")
    if not isinstance(label_cases_value, list):
        raise ValueError("relevance labels require cases")
    label_cases = {
        case.get("caseId"): case
        for case in label_cases_value
        if isinstance(case, Mapping) and isinstance(case.get("caseId"), str)
    }
    template_ids = [str(template.get("caseId")) for template in templates]
    if set(label_cases) != set(template_ids) or len(label_cases) != len(template_ids):
        raise ValueError("relevance labels must cover every grading template exactly")

    by_case: dict[str, Any] = {}
    for template in templates:
        case_id = str(template["caseId"])
        expected_results = template.get("results")
        supplied_results = label_cases[case_id].get("results")
        if not isinstance(expected_results, list) or not isinstance(
            supplied_results, list
        ):
            raise ValueError(f"invalid relevance rows for {case_id}")
        expected_ids = [row.get("id") for row in expected_results]
        supplied_ids = [
            row.get("id") if isinstance(row, Mapping) else None
            for row in supplied_results
        ]
        if supplied_ids != expected_ids:
            raise ValueError(f"relevance row identity drift for {case_id}")
        labels = [
            row.get("relevance") if isinstance(row, Mapping) else None
            for row in supplied_results
        ]
        minimum_returned = template.get("minimumReturnedRelevance")
        if minimum_returned != 1:
            raise ValueError(
                f"invalid minimum returned relevance for {case_id}"
            )
        by_case[case_id] = {
            **score_manual_relevance(labels),
            "minimumReturnedRelevance": minimum_returned,
            "irrelevantResultCount": sum(
                label < minimum_returned for label in labels
            ),
        }

    metric_names = (
        "precisionAt5",
        "strongPrecisionAt5",
        "strongResultsAt5",
        "strongResultCount",
        "mrr",
        "strongMrr",
        "ndcgAt10",
        "minimumReturnedRelevance",
        "irrelevantResultCount",
    )
    macro = {
        metric: sum(metrics[metric] for metrics in by_case.values()) / len(by_case)
        for metric in metric_names
    }
    return {
        "status": "graded",
        "caseCount": len(by_case),
        "gradedAt": labels_document["gradedAt"],
        "reviewer": labels_document["reviewer"],
        "labelsSha256": sha256_json(labels_document),
        "metrics": {"byCase": by_case, "macro": macro},
    }


def retain_relevance_labels(
    *,
    binding: Mapping[str, str],
    templates: Sequence[Mapping[str, Any]],
    labels_document: Mapping[str, Any],
) -> dict[str, Any]:
    """Build the canonical same-run record needed to replay human grading."""
    summarize_manual_relevance(templates, labels_document)
    return {
        **binding,
        "schemaVersion": RETAINED_RELEVANCE_SCHEMA,
        "gradingTemplateSha256": sha256_json(templates),
        "labels": labels_document,
    }


def evaluate_manual_relevance_completion(
    summary: Mapping[str, Any], snapshot: str
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    case_count = int(summary.get("caseCount") or 0)
    if snapshot != "candidate" or case_count <= 0:
        return _result(failures, summary=summary)
    if summary.get("status") != "graded":
        failures.append(
            _failure(
                "manual_relevance_incomplete", actual=summary.get("status")
            )
        )
        return _result(failures, summary=summary)

    metrics_value = summary.get("metrics")
    metrics = metrics_value if isinstance(metrics_value, Mapping) else {}
    by_case_value = metrics.get("byCase")
    by_case = by_case_value if isinstance(by_case_value, Mapping) else {}
    if len(by_case) != case_count:
        failures.append(
            _failure(
                "manual_relevance_metrics_incomplete",
                expectedCaseCount=case_count,
                actualCaseCount=len(by_case),
            )
        )
        return _result(failures, summary=summary)

    for case_id, case_metrics_value in by_case.items():
        case_metrics = (
            case_metrics_value
            if isinstance(case_metrics_value, Mapping)
            else {}
        )
        for metric, minimum in MANUAL_RELEVANCE_MINIMUMS.items():
            actual = case_metrics.get(metric)
            if type(actual) not in {int, float}:
                failures.append(
                    _failure(
                        "manual_relevance_metrics_incomplete",
                        caseId=case_id,
                        metric=metric,
                    )
                )
            elif actual < minimum:
                failures.append(
                    _failure(
                        "manual_relevance_threshold_not_met",
                        caseId=case_id,
                        metric=metric,
                        expectedMinimum=minimum,
                        actual=actual,
                    )
                )
        strong_gate = evaluate_strong_relevance(
            case_metrics,
            minimum_strong_results=1,
        )
        failures.extend(
            {**failure, "caseId": case_id}
            for failure in strong_gate["failures"]
        )
        minimum_returned = case_metrics.get("minimumReturnedRelevance")
        irrelevant_count = case_metrics.get("irrelevantResultCount")
        if minimum_returned != 1 or type(irrelevant_count) is not int:
            failures.append(
                _failure(
                    "manual_relevance_metrics_incomplete",
                    caseId=case_id,
                    metric="irrelevantResultCount",
                )
            )
        elif irrelevant_count > 0:
            failures.append(
                _failure(
                    "irrelevant_manual_result_returned",
                    caseId=case_id,
                    minimumReturnedRelevance=minimum_returned,
                    actual=irrelevant_count,
                )
            )
    return _result(failures, summary=summary)


def evaluate_pilot_inspection(
    inspection_path: Path,
    *,
    deployment_identity: Mapping[str, Any],
    evaluator_git_sha: str,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    try:
        inspection_value = json.loads(inspection_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return _result(
            [_failure("pilot_inspection_invalid", error=str(error))]
        )
    inspection = inspection_value if isinstance(inspection_value, Mapping) else {}
    if inspection.get("schemaVersion") != "nga-pilot-inspection-v1":
        failures.append(_failure("pilot_inspection_invalid", field="schemaVersion"))
    if inspection.get("decision") != "proceed":
        failures.append(
            _failure(
                "pilot_inspection_not_approved",
                actual=inspection.get("decision"),
            )
        )
    for field in (
        "reviewedAt",
        "reviewer",
        "pilotSummaryPath",
        "pilotSummarySha256",
        "pilotArtifactManifestPath",
        "pilotArtifactManifestSha256",
        "pilotDeploymentIdentityHash",
    ):
        if not isinstance(inspection.get(field), str) or not inspection.get(field):
            failures.append(_failure("pilot_inspection_invalid", field=field))
    manifest_path_value = inspection.get("pilotArtifactManifestPath")
    if not isinstance(manifest_path_value, str) or not manifest_path_value:
        failures.append(_failure("pilot_artifact_manifest_missing"))

    summary_path_value = inspection.get("pilotSummaryPath")
    if not isinstance(summary_path_value, str) or not summary_path_value:
        return _result(failures)
    summary_path = Path(summary_path_value)
    if not summary_path.is_absolute():
        summary_path = inspection_path.parent / summary_path
    try:
        summary_bytes = summary_path.read_bytes()
        summary_value = json.loads(summary_bytes)
    except (OSError, json.JSONDecodeError) as error:
        failures.append(_failure("pilot_summary_invalid", error=str(error)))
        return _result(failures, pilotSummaryPath=str(summary_path))
    summary = summary_value if isinstance(summary_value, Mapping) else {}
    actual_summary_hash = sha256_bytes(summary_bytes)
    if actual_summary_hash != inspection.get("pilotSummarySha256"):
        failures.append(
            _failure(
                "pilot_summary_hash_mismatch",
                expected=inspection.get("pilotSummarySha256"),
                actual=actual_summary_hash,
            )
        )
    pilot_deployment_hash = inspection.get("pilotDeploymentIdentityHash")
    if (
        not isinstance(pilot_deployment_hash, str)
        or re.fullmatch(r"[a-f0-9]{64}", pilot_deployment_hash) is None
        or deployment_identity.get("pilotDeploymentIdentityHash")
        != pilot_deployment_hash
    ):
        failures.append(_failure("pilot_deployment_identity_hash_mismatch"))
    expected_summary = {
        "phase": "pilot",
        "snapshot": "candidate",
        "gatePassed": True,
        "evaluatorGitSha": evaluator_git_sha,
        "deploymentIdentityHash": pilot_deployment_hash,
    }
    for field, expected in expected_summary.items():
        if summary.get(field) != expected:
            failures.append(
                _failure(
                    "pilot_summary_binding_mismatch",
                    field=field,
                    expected=expected,
                    actual=summary.get(field),
                )
            )
    manual_value = summary.get("manualRelevance")
    manual = manual_value if isinstance(manual_value, Mapping) else {}
    if manual.get("status") != "graded":
        failures.append(
            _failure(
                "pilot_manual_review_incomplete",
                actual=manual.get("status"),
            )
        )

    expected_counts = {"legacy": 0, "newText": 4, "image": 3, "total": 7}
    if summary.get("caseCounts") != expected_counts:
        failures.append(
            _failure(
                "pilot_case_counts_mismatch",
                expected=expected_counts,
                actual=summary.get("caseCounts"),
            )
        )
    expected_hard_results = {
        "text": {"selected": 4, "passed": 4},
        "image": {"selected": 3, "passed": 3},
    }
    for modality, expected in expected_hard_results.items():
        if summary.get(modality) != expected:
            failures.append(
                _failure(
                    "pilot_hard_gate_incomplete",
                    modality=modality,
                    expected=expected,
                    actual=summary.get(modality),
                )
            )
    if summary.get("failureCount") != 0 or summary.get("gateFailures") != []:
        failures.append(_failure("pilot_hard_gate_incomplete", modality="all"))

    metrics_value = manual.get("metrics")
    metrics = metrics_value if isinstance(metrics_value, Mapping) else {}
    by_case_value = metrics.get("byCase")
    by_case = by_case_value if isinstance(by_case_value, Mapping) else {}
    macro_value = metrics.get("macro")
    macro = macro_value if isinstance(macro_value, Mapping) else {}
    if manual.get("caseCount") != len(PILOT_RELATION_CASE_IDS) or set(
        by_case
    ) != set(PILOT_RELATION_CASE_IDS):
        failures.append(
            _failure(
                "pilot_manual_review_cases_mismatch",
                expected=list(PILOT_RELATION_CASE_IDS),
                actual=sorted(by_case),
            )
        )
    metric_names = (
        "precisionAt5",
        "strongPrecisionAt5",
        "strongResultsAt5",
        "strongResultCount",
        "mrr",
        "strongMrr",
        "ndcgAt10",
        "minimumReturnedRelevance",
        "irrelevantResultCount",
    )
    metric_sets = [macro, *[value for value in by_case.values() if isinstance(value, Mapping)]]
    if (
        len(metric_sets) != len(PILOT_RELATION_CASE_IDS) + 1
        or any(
            type(metric_set.get(metric)) not in {int, float}
            for metric_set in metric_sets
            for metric in metric_names
        )
    ):
        failures.append(_failure("pilot_manual_review_metrics_missing"))
    labels_hash = manual.get("labelsSha256")
    if not isinstance(labels_hash, str) or not re.fullmatch(
        r"[a-f0-9]{64}", labels_hash
    ):
        failures.append(_failure("pilot_manual_review_labels_unbound"))

    manifest_path: Path | None = None
    manifest_hash: str | None = None
    bundle_evaluation: dict[str, Any] | None = None
    if isinstance(manifest_path_value, str) and manifest_path_value:
        manifest_path = Path(manifest_path_value)
        if not manifest_path.is_absolute():
            manifest_path = inspection_path.parent / manifest_path
        try:
            manifest_bytes = manifest_path.read_bytes()
            manifest_value = json.loads(manifest_bytes)
        except (OSError, json.JSONDecodeError) as error:
            failures.append(
                _failure("pilot_artifact_manifest_invalid", error=str(error))
            )
        else:
            manifest = manifest_value if isinstance(manifest_value, Mapping) else {}
            manifest_hash = sha256_bytes(manifest_bytes)
            if manifest_hash != inspection.get("pilotArtifactManifestSha256"):
                failures.append(
                    _failure(
                        "pilot_artifact_manifest_hash_mismatch",
                        expected=inspection.get("pilotArtifactManifestSha256"),
                        actual=manifest_hash,
                    )
                )
            evidence_root = manifest_path.parent
            if manifest_path.resolve() != (
                evidence_root / "artifact-manifest.json"
            ).resolve():
                failures.append(_failure("pilot_artifact_manifest_invalid"))
            if summary_path.resolve() != (evidence_root / "summary.json").resolve():
                failures.append(_failure("pilot_summary_manifest_path_mismatch"))
            bundle_evaluation = evaluate_evidence_bundle(
                evidence_root, manifest, require_hard_pass=True
            )
            failures.extend(
                _failure(
                    "pilot_artifact_manifest_invalid",
                    reason=failure["code"],
                    details=failure,
                )
                for failure in bundle_evaluation["failures"]
            )

    if bundle_evaluation is not None:
        expected_inventory = {
            "counts": expected_counts,
            "textCaseIds": list(PILOT_TEXT_CASE_IDS),
            "imageCaseIds": list(PILOT_IMAGE_CASE_IDS),
        }
        case_inventory = bundle_evaluation.get("caseInventory")
        if case_inventory != expected_inventory:
            failures.append(
                _failure(
                    "pilot_case_inventory_mismatch",
                    expected=expected_inventory,
                    actual=case_inventory,
                )
            )
        pilot_identity_value = (bundle_evaluation.get("identity") or {}).get(
            "deploymentIdentity"
        )
        pilot_identity = (
            pilot_identity_value
            if isinstance(pilot_identity_value, Mapping)
            else {}
        )
        artist_evidence_root = _find_artist_evidence_root(evidence_root)
        continuity = evaluate_pilot_full_identity_continuity(
            pilot_identity,
            deployment_identity,
            evidence_root=artist_evidence_root,
        )
        failures.extend(continuity["failures"])
        if sha256_json(pilot_identity) != pilot_deployment_hash:
            failures.append(_failure("pilot_deployment_identity_hash_mismatch"))
    return _result(
        failures,
        pilotSummaryPath=str(summary_path),
        pilotSummarySha256=actual_summary_hash,
        pilotArtifactManifestPath=(
            str(manifest_path) if manifest_path is not None else None
        ),
        pilotArtifactManifestSha256=manifest_hash,
        pilotDeploymentIdentityHash=pilot_deployment_hash,
        inspection=inspection,
    )


def evaluate_recorded_pilot_inspection(
    record: Mapping[str, Any],
    *,
    deployment_identity: Mapping[str, Any],
    evaluator_git_sha: str,
) -> dict[str, Any]:
    """Rehash the reviewed pilot bundle from the full bundle's bound record."""
    failures: list[dict[str, Any]] = []
    if (
        record.get("passed") is not True
        or record.get("failureCodes") != []
        or record.get("failures") != []
    ):
        failures.append(_failure("recorded_pilot_inspection_failed"))
    summary_path_value = record.get("pilotSummaryPath")
    manifest_path_value = record.get("pilotArtifactManifestPath")
    if not isinstance(summary_path_value, str) or not isinstance(
        manifest_path_value, str
    ):
        return _result(
            [*failures, _failure("recorded_pilot_inspection_invalid")]
        )
    summary_path = Path(summary_path_value)
    manifest_path = Path(manifest_path_value)
    if not summary_path.is_absolute() or not manifest_path.is_absolute():
        return _result(
            [*failures, _failure("recorded_pilot_inspection_invalid")]
        )
    try:
        summary_bytes = summary_path.read_bytes()
        manifest_bytes = manifest_path.read_bytes()
        manifest_value = json.loads(manifest_bytes)
    except (OSError, json.JSONDecodeError) as error:
        return _result(
            [
                *failures,
                _failure("recorded_pilot_inspection_invalid", error=str(error)),
            ]
        )
    if (
        summary_path.parent != manifest_path.parent
        or summary_path.name != "summary.json"
        or manifest_path.name != "artifact-manifest.json"
        or record.get("pilotSummarySha256") != sha256_bytes(summary_bytes)
        or record.get("pilotArtifactManifestSha256")
        != sha256_bytes(manifest_bytes)
    ):
        failures.append(_failure("recorded_pilot_inspection_hash_mismatch"))
    manifest = manifest_value if isinstance(manifest_value, Mapping) else {}
    bundle = evaluate_evidence_bundle(
        manifest_path.parent, manifest, require_hard_pass=True
    )
    failures.extend(
        _failure("recorded_pilot_bundle_invalid", reason=failure.get("code"))
        for failure in bundle["failures"]
    )
    pilot_identity_value = (bundle.get("identity") or {}).get(
        "deploymentIdentity"
    )
    pilot_identity = (
        pilot_identity_value if isinstance(pilot_identity_value, Mapping) else {}
    )
    artist_evidence_root = _find_artist_evidence_root(manifest_path.parent)
    continuity = evaluate_pilot_full_identity_continuity(
        pilot_identity,
        deployment_identity,
        evidence_root=artist_evidence_root,
    )
    failures.extend(continuity["failures"])
    if (
        bundle.get("phase") != "pilot"
        or bundle.get("snapshot") != "candidate"
        or bundle.get("evaluatorGitSha") != evaluator_git_sha
        or record.get("pilotDeploymentIdentityHash")
        != continuity.get("pilotDeploymentIdentityHash")
    ):
        failures.append(_failure("recorded_pilot_inspection_binding_mismatch"))
    return _result(
        failures,
        pilotDeploymentIdentityHash=continuity.get(
            "pilotDeploymentIdentityHash"
        ),
    )


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


class UrllibTransport:
    def __init__(self) -> None:
        self.opener = urllib.request.build_opener(_RejectRedirects())

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str] | None = None,
        body: bytes | None = None,
        timeout: int = 90,
    ) -> dict[str, Any]:
        request_headers = {
            "User-Agent": EVALUATOR_USER_AGENT,
            "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
            **dict(headers or {}),
        }
        request = urllib.request.Request(
            url,
            data=body,
            headers=request_headers,
            method=method,
        )
        started = time.monotonic()
        try:
            response = self.opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            response = error
        response_body = response.read()
        status = int(response.status)
        final_url = response.geturl()
        if final_url != url or 300 <= status < 400:
            raise GateStopped(
                f"request endpoint relocated: expected {url}, "
                f"received {status} at {final_url}"
            )
        content_type = response.headers.get_content_type()
        decoded: Any = None
        if content_type == "application/json" or response_body.lstrip().startswith((b"{", b"[")):
            try:
                decoded = json.loads(response_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                decoded = None
        return {
            "requestUrl": url,
            "finalUrl": final_url,
            "status": status,
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
        wall_clock: Any | None = None,
    ) -> None:
        if not 1 <= requests_per_minute <= 9:
            raise ValueError("requests per minute must be between 1 and 9")
        self.requests_per_minute = requests_per_minute
        self.clock = clock
        self.sleep = sleep
        self.wall_clock = wall_clock or (lambda: dt.datetime.now(dt.timezone.utc))
        self.timestamps: list[float] = []
        self.evidence: list[dict[str, Any]] = []

    def wait(self, label: str = "unlabeled") -> str:
        if not isinstance(label, str) or not label.strip():
            raise ValueError("request timing label must be nonblank")
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
        wall_time = self.wall_clock()
        if not isinstance(wall_time, dt.datetime) or wall_time.tzinfo is None:
            raise ValueError("request timing wall clock must be timezone-aware")
        started_at = wall_time.astimezone(dt.timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )
        self.evidence.append(
            {
                "sequence": len(self.evidence) + 1,
                "label": label,
                "startedAt": started_at,
            }
        )
        return started_at


def expected_public_request_labels(
    selected: Mapping[str, Any], phase: str
) -> list[str]:
    labels = [f"text:{case['id']}" for case in selected.get("text", [])]
    labels.extend(("cache:first", "cache:repeat", "cache:changed"))
    labels.extend(f"image:{case['id']}" for case in selected.get("image", []))
    labels.append("image:repeat")
    if phase == "full":
        labels.extend(
            f"image-negative:{name}"
            for name in ("invalid_mime", "zero_byte", "multiple_files", "oversize")
        )
    labels.append("ngs:text")
    return labels


def evaluate_staging_health_response(
    response: Mapping[str, Any], api_base_url: str
) -> dict[str, Any]:
    payload = _response_json(response)
    expected_url = f"{api_base_url}/health"
    failures = []
    if (
        response.get("requestUrl") != expected_url
        or response.get("finalUrl") != expected_url
        or response.get("status") != 200
        or payload.get("status") != "healthy"
        or payload.get("environment") != "staging"
    ):
        failures.append(
            _failure("staging_health_invalid", expectedUrl=expected_url)
        )
    observation = {
        "requestUrl": response.get("requestUrl"),
        "finalUrl": response.get("finalUrl"),
        "status": response.get("status"),
        "headers": response.get("headers"),
        "body": payload,
        "elapsedMs": response.get("elapsedMs"),
    }
    return _result(failures, observation=observation)


def verify_staging_health(transport: Any, api_base_url: str) -> dict[str, Any]:
    response = transport.request("GET", f"{api_base_url}/health")
    evaluation = evaluate_staging_health_response(response, api_base_url)
    if not evaluation["passed"]:
        raise GateStopped(
            "API health did not prove status=healthy and environment=staging"
        )
    return evaluation["observation"]


def _parse_local_version_sources(sources: Mapping[str, str]) -> dict[str, str]:
    if set(sources) != set(LOCAL_VERSION_SOURCE_PATHS):
        raise ValueError("local version source inventory mismatch")
    core = sources[LOCAL_VERSION_SOURCE_PATHS[0]]
    cache = sources[LOCAL_VERSION_SOURCE_PATHS[1]]
    parser = sources[LOCAL_VERSION_SOURCE_PATHS[2]]
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


def capture_local_version_sources(repo_root: Path) -> list[dict[str, Any]]:
    records = []
    for relative in LOCAL_VERSION_SOURCE_PATHS:
        payload = (repo_root / relative).read_bytes()
        records.append(
            {
                "path": relative,
                "sha256": sha256_bytes(payload),
                "byteLength": len(payload),
                "contentBase64": base64.b64encode(payload).decode("ascii"),
            }
        )
    return records


def capture_bound_json_bytes(payload: bytes) -> dict[str, Any]:
    return {
        "sha256": sha256_bytes(payload),
        "byteLength": len(payload),
        "contentBase64": base64.b64encode(payload).decode("ascii"),
    }


def parse_bound_json_bytes(value: Any) -> Mapping[str, Any]:
    record = value if isinstance(value, Mapping) else {}
    if set(record) != {"sha256", "byteLength", "contentBase64"}:
        raise ValueError("bound JSON byte record invalid")
    try:
        payload = base64.b64decode(record.get("contentBase64"), validate=True)
        document = json.loads(payload)
    except (TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("bound JSON bytes invalid") from None
    if (
        record.get("byteLength") != len(payload)
        or record.get("sha256") != sha256_bytes(payload)
        or not isinstance(document, Mapping)
    ):
        raise ValueError("bound JSON digest or shape invalid")
    return document


def parse_captured_local_versions(records_value: Any) -> dict[str, str]:
    records = records_value if isinstance(records_value, list) else []
    if len(records) != len(LOCAL_VERSION_SOURCE_PATHS):
        raise ValueError("local version source inventory mismatch")
    sources: dict[str, str] = {}
    for index, expected_path in enumerate(LOCAL_VERSION_SOURCE_PATHS):
        record_value = records[index]
        record = record_value if isinstance(record_value, Mapping) else {}
        if record.get("path") != expected_path or set(record) != {
            "path",
            "sha256",
            "byteLength",
            "contentBase64",
        }:
            raise ValueError("local version source inventory mismatch")
        try:
            payload = base64.b64decode(record.get("contentBase64"), validate=True)
            text = payload.decode("utf-8")
        except (TypeError, ValueError, UnicodeDecodeError):
            raise ValueError("local version source encoding invalid") from None
        if (
            record.get("byteLength") != len(payload)
            or record.get("sha256") != sha256_bytes(payload)
        ):
            raise ValueError("local version source digest mismatch")
        sources[expected_path] = text
    return _parse_local_version_sources(sources)


def observe_local_versions(repo_root: Path) -> dict[str, str]:
    return parse_captured_local_versions(capture_local_version_sources(repo_root))


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
    json_value = response.get("json")
    json_bytes = canonical_json(json_value).encode("utf-8")
    return {
        "requestUrl": response.get("requestUrl"),
        "finalUrl": response.get("finalUrl"),
        "status": response.get("status"),
        "elapsedMs": response.get("elapsedMs"),
        "headers": response.get("headers"),
        "json": json_value,
        "jsonByteLength": len(json_bytes),
        "jsonSha256": sha256_bytes(json_bytes),
        "bodyLength": len(response.get("body") or b""),
        "bodySha256": sha256_bytes(response.get("body") or b""),
    }


def serialize_identity_response(response: Mapping[str, Any]) -> dict[str, Any]:
    body_value = response.get("body")
    if isinstance(body_value, bytes):
        body = body_value
    elif isinstance(response.get("json"), (Mapping, list)):
        body = canonical_json(response.get("json")).encode("utf-8")
    else:
        body = b""
    headers_value = response.get("headers")
    headers = (
        {str(key).lower(): str(value) for key, value in headers_value.items()}
        if isinstance(headers_value, Mapping)
        else {}
    )
    return {
        "requestUrl": response.get("requestUrl"),
        "finalUrl": response.get("finalUrl"),
        "status": response.get("status"),
        "elapsedMs": response.get("elapsedMs"),
        "headers": headers,
        "bodyBase64": base64.b64encode(body).decode("ascii"),
        "bodyLength": len(body),
        "bodySha256": sha256_bytes(body),
    }


def parse_identity_response(value: Any, *, expected_url: str) -> dict[str, Any]:
    record = value if isinstance(value, Mapping) else {}
    if set(record) != {
        "requestUrl",
        "finalUrl",
        "status",
        "elapsedMs",
        "headers",
        "bodyBase64",
        "bodyLength",
        "bodySha256",
    }:
        raise ValueError("identity response shape invalid")
    headers_value = record.get("headers")
    if (
        record.get("requestUrl") != expected_url
        or record.get("finalUrl") != expected_url
        or type(record.get("status")) is not int
        or isinstance(record.get("elapsedMs"), bool)
        or not isinstance(record.get("elapsedMs"), (int, float))
        or float(record["elapsedMs"]) < 0
        or not isinstance(headers_value, Mapping)
        or any(
            not isinstance(key, str) or not isinstance(item, str)
            for key, item in headers_value.items()
        )
    ):
        raise ValueError("identity response metadata invalid")
    try:
        body = base64.b64decode(record.get("bodyBase64"), validate=True)
    except (TypeError, ValueError):
        raise ValueError("identity response body encoding invalid") from None
    if (
        record.get("bodyLength") != len(body)
        or record.get("bodySha256") != sha256_bytes(body)
        or len(body) > MAX_EVIDENCE_JSON_BYTES
    ):
        raise ValueError("identity response body digest mismatch")
    try:
        json_value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        json_value = None
    return {
        "requestUrl": record["requestUrl"],
        "finalUrl": record["finalUrl"],
        "status": record["status"],
        "elapsedMs": record["elapsedMs"],
        "headers": dict(headers_value),
        "body": body,
        "json": json_value,
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


def load_json_object(path: Path, label: str) -> Mapping[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid {label} file: {path}") from error
    if not isinstance(document, Mapping):
        raise ValueError(f"{label} must be a JSON object")
    return document


def load_deployment_identity(path: Path) -> Mapping[str, Any]:
    return load_json_object(path, "deployment identity")


def _read_evidence_json(
    root: Path,
    relative: str,
    failures: list[dict[str, Any]],
) -> Mapping[str, Any]:
    path = root / relative
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        failures.append(
            _failure("evidence_json_invalid", path=relative, error=str(error))
        )
        return {}
    if not isinstance(value, Mapping):
        failures.append(_failure("evidence_json_invalid", path=relative))
        return {}
    return value


def _parse_utc_timestamp(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(dt.timezone.utc)


def _expected_run_cases(phase: str) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[1]
    inventory = load_case_inventory(
        repo_root / "eval/nga-staging-cases.yaml",
        repo_root / "eval/nga-constraint-queries.yaml",
    )
    return select_cases(inventory, phase)


def _validate_run_binding(
    record: Mapping[str, Any],
    expected: Mapping[str, str],
    path: str,
    failures: list[dict[str, Any]],
) -> None:
    for field, value in expected.items():
        if record.get(field) != value:
            failures.append(
                _failure(
                    "evidence_run_binding_mismatch",
                    path=path,
                    field=field,
                    expected=value,
                    actual=record.get(field),
                )
            )


def _validate_stored_response(
    value: Any,
    *,
    expected_url: str,
    path: str,
    failures: list[dict[str, Any]],
) -> Mapping[str, Any]:
    response = value if isinstance(value, Mapping) else {}
    payload = response.get("json")
    headers = response.get("headers")
    status = response.get("status")
    body_length = response.get("bodyLength")
    body_sha = response.get("bodySha256")
    try:
        payload_size = len(canonical_json(payload).encode("utf-8"))
        header_size = len(canonical_json(headers).encode("utf-8"))
    except (TypeError, ValueError):
        payload_size = MAX_EVIDENCE_JSON_BYTES + 1
        header_size = MAX_EVIDENCE_HEADERS_BYTES + 1
    valid = (
        isinstance(value, Mapping)
        and response.get("requestUrl") == expected_url
        and response.get("finalUrl") == expected_url
        and type(status) is int
        and isinstance(headers, Mapping)
        and bool(headers)
        and isinstance(payload, Mapping)
        and bool(payload)
        and 0 < payload_size <= MAX_EVIDENCE_JSON_BYTES
        and response.get("jsonByteLength") == payload_size
        and response.get("jsonSha256")
        == sha256_bytes(canonical_json(payload).encode("utf-8"))
        and 0 < header_size <= MAX_EVIDENCE_HEADERS_BYTES
        and type(body_length) is int
        and 0 < body_length <= MAX_EVIDENCE_JSON_BYTES
        and isinstance(body_sha, str)
        and re.fullmatch(r"[a-f0-9]{64}", body_sha) is not None
    )
    if not valid:
        failures.append(
            _failure("stored_response_evidence_invalid", path=path)
        )
    return response


def _evaluation_drift(
    stored: Any,
    recomputed: Mapping[str, Any],
    *,
    path: str,
    failures: list[dict[str, Any]],
) -> None:
    if stored != recomputed:
        failures.append(_failure("stored_evaluation_drift", path=path))


def _expected_image_request(
    case: Mapping[str, Any], fixture: Mapping[str, Any], endpoint: str
) -> dict[str, Any]:
    constraints = normalize_constraints(case.get("constraints"))
    return {
        "url": endpoint,
        "method": "POST",
        "filename": case["filename"],
        "mimeType": fixture["mimeType"],
        "byteLength": fixture["byteLength"],
        "sha256": fixture["sha256"],
        "constraints": constraints,
        "topK": 30,
        "minScore": 0,
        "identity": canonical_image_identity_from_digest(
            str(fixture["sha256"]), constraints, 30, 0
        ),
    }


def _collect_playwright_specs(suites: Any) -> list[Mapping[str, Any]]:
    if not isinstance(suites, list):
        return []
    specs: list[Mapping[str, Any]] = []
    for suite_value in suites:
        suite = suite_value if isinstance(suite_value, Mapping) else {}
        for spec in suite.get("specs", []):
            if isinstance(spec, Mapping):
                specs.append(spec)
        specs.extend(_collect_playwright_specs(suite.get("suites")))
    return specs


def _valid_png(path: Path) -> bool:
    try:
        data = path.read_bytes()
    except OSError:
        return False
    if len(data) < 1024 or len(data) > 20 * 1024 * 1024:
        return False
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    offset = 8
    width = height = 0
    saw_idat = saw_iend = False
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        end = offset + 12 + length
        if end > len(data):
            return False
        payload = data[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack(">I", data[offset + 8 + length : end])[0]
        if zlib.crc32(kind + payload) & 0xFFFFFFFF != expected_crc:
            return False
        if kind == b"IHDR":
            if length != 13:
                return False
            width, height = struct.unpack(">II", payload[:8])
        elif kind == b"IDAT":
            saw_idat = saw_idat or bool(payload)
        elif kind == b"IEND":
            saw_iend = True
            break
        offset = end
    return width >= 320 and height >= 200 and saw_idat and saw_iend


def _valid_trace_zip(path: Path) -> bool:
    try:
        if path.stat().st_size < 32 or path.stat().st_size > 100 * 1024 * 1024:
            return False
        with path.open("rb") as stream:
            signature = stream.read(4)
        if signature not in {b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"}:
            return False
        with zipfile.ZipFile(path) as archive:
            entries = [item for item in archive.infolist() if not item.is_dir()]
            entry_by_name = {item.filename: item for item in entries}
            test_trace = entry_by_name.get("test.trace")
            if (
                len(entry_by_name) != len(entries)
                or test_trace is None
                or not 0 < test_trace.file_size <= 64 * 1024 * 1024
                or archive.testzip() is not None
            ):
                return False
            trace_lines = archive.read(test_trace).splitlines()
            if not trace_lines:
                return False
            events = [json.loads(line) for line in trace_lines if line.strip()]
            return bool(events) and any(
                isinstance(event, Mapping)
                and event.get("type") == "context-options"
                and event.get("origin") == "testRunner"
                and type(event.get("version")) is int
                and event["version"] >= 1
                for event in events
            )
    except (OSError, UnicodeDecodeError, ValueError, zipfile.BadZipFile):
        return False


def _playwright_attachment_path(
    path_value: Any,
    *,
    artifact_root: Path,
) -> tuple[Path, str] | None:
    if not isinstance(path_value, str) or not path_value:
        return None
    path = Path(path_value)
    if not path.is_absolute():
        return None
    try:
        resolved = path.resolve(strict=True)
        relative = resolved.relative_to(artifact_root.resolve(strict=True))
    except (OSError, ValueError):
        return None
    if len(relative.parts) not in {2, 3} or not resolved.is_file():
        return None
    return resolved, relative.as_posix()


def _find_artist_evidence_root(start: Path) -> Path | None:
    resolved = start.resolve()
    for candidate in (resolved, *resolved.parents):
        marker = candidate / "preflight/evidence-root.txt"
        try:
            if marker.read_text(encoding="utf-8").strip() == str(candidate):
                return candidate
        except OSError:
            continue
    return None


def _artist_evidence_record(evaluation: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "passed": evaluation.get("passed") is True,
        "failureCodes": evaluation.get("failureCodes"),
        "mappingCount": evaluation.get("mappingCount"),
        "vectorRecordCount": evaluation.get("vectorRecordCount"),
        "vectorValueHashCount": evaluation.get("vectorValueHashCount"),
        "artifactHashes": evaluation.get("artifactHashes"),
        "evidenceSha256": evaluation.get("evidenceSha256"),
    }


def evaluate_evidence_bundle(
    out_dir: Path,
    manifest: Mapping[str, Any] | None = None,
    *,
    require_hard_pass: bool = False,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    if not out_dir.is_dir():
        return _result([_failure("evidence_directory_missing", path=str(out_dir))])
    existing_files = [path for path in out_dir.rglob("*") if path.is_file()]
    if not existing_files:
        return _result([_failure("evidence_directory_empty", path=str(out_dir))])

    summary = _read_evidence_json(out_dir, "summary.json", failures)
    identity = _read_evidence_json(out_dir, "identity.json", failures)
    case_inventory = _read_evidence_json(
        out_dir, "case-inventory.json", failures
    )
    manual_document = _read_evidence_json(
        out_dir, "manual-relevance.json", failures
    )
    fixtures_document = _read_evidence_json(
        out_dir, "fixtures-manifest.json", failures
    )
    handoff = _read_evidence_json(out_dir, "playwright-handoff.json", failures)
    request_timing = _read_evidence_json(
        out_dir, "raw/request-timing.json", failures
    )
    request_cooldown_handoff = _read_evidence_json(
        out_dir, "request-cooldown-handoff.json", failures
    )
    identity_documents = {
        name: _read_evidence_json(out_dir, relative, failures)
        for name, relative in IDENTITY_EVIDENCE_PATHS.items()
    }
    report = _read_evidence_json(
        out_dir, "playwright/playwright-report.json", failures
    )

    phase = summary.get("phase")
    snapshot = summary.get("snapshot")
    run_id = summary.get("runId")
    evaluator_git_sha = summary.get("evaluatorGitSha")
    deployment_hash = summary.get("deploymentIdentityHash")
    if phase not in {"pilot", "full"}:
        failures.append(_failure("evidence_phase_invalid", actual=phase))
        selected: dict[str, Any] = {
            "text": [],
            "image": [],
            "counts": {},
        }
    else:
        selected = _expected_run_cases(str(phase))
    if phase not in {"pilot", "full"}:
        return _result(failures, phase=phase, snapshot=snapshot)
    if snapshot not in {"baseline", "candidate"}:
        failures.append(_failure("evidence_snapshot_invalid", actual=snapshot))
    require_hard_pass = require_hard_pass or snapshot == "candidate"
    if not isinstance(run_id, str) or RUN_ID_PATTERN.fullmatch(run_id) is None:
        failures.append(_failure("evidence_run_id_invalid", actual=run_id))
    if not isinstance(evaluator_git_sha, str) or not re.fullmatch(
        r"[a-f0-9]{40}", evaluator_git_sha
    ):
        failures.append(
            _failure("evidence_evaluator_identity_invalid", actual=evaluator_git_sha)
        )
    if not isinstance(deployment_hash, str) or not re.fullmatch(
        r"[a-f0-9]{64}", deployment_hash
    ):
        failures.append(
            _failure("evidence_deployment_identity_invalid", actual=deployment_hash)
        )

    expected_binding = {
        "runId": run_id,
        "snapshot": snapshot,
        "evaluatorGitSha": evaluator_git_sha,
        "deploymentIdentityHash": deployment_hash,
    }
    request_labels = expected_public_request_labels(selected, str(phase))
    request_timing_evaluation = evaluate_request_timing_evidence(
        request_timing,
        expected_binding=expected_binding,
        expected_labels=request_labels,
    )
    failures.extend(request_timing_evaluation["failures"])
    cooldown_not_before = _parse_utc_timestamp(
        request_cooldown_handoff.get("nextRunNotBefore")
    )
    request_cooldown_evaluation = evaluate_request_cooldown_handoff(
        request_cooldown_handoff,
        expected_binding=expected_binding,
        phase=str(phase),
        now=cooldown_not_before or dt.datetime.now(dt.timezone.utc),
    )
    failures.extend(request_cooldown_evaluation["failures"])
    request_timing_path = out_dir / "raw/request-timing.json"
    if (
        not request_timing_path.is_file()
        or request_cooldown_handoff.get("requestTimingSha256")
        != sha256_bytes(request_timing_path.read_bytes())
        or request_cooldown_handoff.get("lastPublicRequestAt")
        != request_timing.get("lastPublicRequestAt")
    ):
        failures.append(_failure("request_cooldown_timing_hash_mismatch"))
    _validate_run_binding(identity, expected_binding, "identity.json", failures)
    raw_deployment_document = identity_documents.get("deploymentIdentity") or {}
    try:
        deployment_identity = parse_bound_json_bytes(
            raw_deployment_document.get("content")
        )
    except ValueError:
        deployment_identity = {}
        failures.append(_failure("deployment_identity_raw_artifact_invalid"))
    if identity.get("deploymentIdentity") != deployment_identity:
        failures.append(_failure("evidence_deployment_identity_raw_mismatch"))
    recomputed_deployment_binding = evaluate_deployment_binding(
        deployment_identity,
        snapshot=str(snapshot),
        evaluator_git_sha=str(evaluator_git_sha),
    )
    deployment_binding_value = identity.get("deploymentBinding")
    deployment_binding = (
        deployment_binding_value
        if isinstance(deployment_binding_value, Mapping)
        else {}
    )
    identity_expectations = {
        "phase": phase,
        "snapshot": snapshot,
        "evaluatorGitSha": evaluator_git_sha,
        "apiBaseUrl": EXPECTED_API_ORIGIN,
        "webBaseUrl": EXPECTED_WEB_ORIGIN,
    }
    for field, expected in identity_expectations.items():
        if identity.get(field) != expected:
            failures.append(
                _failure(
                    "evidence_identity_mismatch",
                    field=field,
                    expected=expected,
                    actual=identity.get(field),
                )
            )
    if (
        recomputed_deployment_binding.get("passed") is not True
        or recomputed_deployment_binding.get("deploymentIdentityHash")
        != deployment_hash
        or deployment_binding != recomputed_deployment_binding
    ):
        failures.append(_failure("evidence_deployment_binding_mismatch"))
    deployed_contract = str(
        recomputed_deployment_binding.get("deployedVersions", {}).get("contract")
        or ""
    )
    identity_evaluation = evaluate_identity_evidence(
        identity_documents,
        expected_binding=expected_binding,
        deployed_contract_version=deployed_contract,
    )
    identity_decision = identity_evaluation["decision"]
    if snapshot == "candidate" and identity_evaluation["passed"] is not True:
        failures.extend(identity_evaluation["failures"])
        failures.append(_failure("candidate_identity_evidence_failed"))
    identity_decision_fields = {
        "localVersions": "localVersions",
        "publicSearchRequestsPerMinute": "publicSearchRequestsPerMinute",
        "health": "health",
        "webContract": "webContract",
        "liveContractBinding": "liveContractBinding",
    }
    for decision_field, identity_field in identity_decision_fields.items():
        if identity.get(identity_field) != identity_decision.get(decision_field):
            failures.append(
                _failure(
                    "evidence_identity_observation_mismatch",
                    field=identity_field,
                )
            )
    if identity.get("identityReleaseDecision") != identity_decision:
        failures.append(_failure("evidence_identity_decision_mismatch"))
    if identity.get("requestTiming") != request_timing_evaluation:
        failures.append(_failure("evidence_request_timing_mismatch"))
    if identity.get("requestCooldownHandoff") != request_cooldown_handoff:
        failures.append(_failure("evidence_request_cooldown_mismatch"))
    summary_versions_value = summary.get("versions")
    summary_versions = (
        summary_versions_value
        if isinstance(summary_versions_value, Mapping)
        else {}
    )
    summary_identity_expectations = {
        "publicSearchRequestsPerMinute": identity_decision.get(
            "publicSearchRequestsPerMinute"
        ),
        "hosts": {"api": EXPECTED_API_ORIGIN, "web": EXPECTED_WEB_ORIGIN},
        "identityReleaseDecision": identity_decision,
    }
    for field, expected in summary_identity_expectations.items():
        if summary.get(field) != expected:
            failures.append(
                _failure("evidence_summary_identity_mismatch", field=field)
            )
    if summary.get("requestTiming") != request_timing_evaluation:
        failures.append(_failure("evidence_summary_request_timing_mismatch"))
    if summary.get("requestCooldownHandoff") != request_cooldown_handoff:
        failures.append(_failure("evidence_summary_request_cooldown_mismatch"))
    previous_relative = "raw/previous-request-cooldown.json"
    previous_path = out_dir / previous_relative
    previous_document: Mapping[str, Any] | None = None
    if snapshot == "candidate" and not previous_path.is_file():
        failures.append(_failure("candidate_previous_request_cooldown_missing"))
    if previous_path.is_file():
        previous_document = _read_evidence_json(out_dir, previous_relative, failures)
        _validate_run_binding(
            previous_document, expected_binding, previous_relative, failures
        )
        if (
            previous_document.get("schemaVersion")
            != "nga-previous-request-cooldown-evidence-v1"
            or previous_document.get("phase") != phase
            or set(previous_document)
            != {
                *expected_binding,
                "schemaVersion",
                "phase",
                "handoffContent",
                "requestTimingContent",
            }
        ):
            failures.append(_failure("previous_request_cooldown_evidence_invalid"))
        try:
            previous_handoff = parse_bound_json_bytes(
                previous_document.get("handoffContent")
            )
            previous_timing = parse_bound_json_bytes(
                previous_document.get("requestTimingContent")
            )
        except ValueError:
            previous_handoff = {}
            previous_timing = {}
            failures.append(_failure("previous_request_cooldown_evidence_invalid"))
        previous_binding = {
            "runId": previous_handoff.get("runId"),
            "snapshot": snapshot,
            "evaluatorGitSha": evaluator_git_sha,
            "deploymentIdentityHash": deployment_hash,
        }
        previous_timing_evaluation = evaluate_request_timing_evidence(
            previous_timing,
            expected_binding=previous_binding,
            expected_labels=request_labels,
        )
        failures.extend(previous_timing_evaluation["failures"])
        previous_not_before = _parse_utc_timestamp(
            previous_handoff.get("nextRunNotBefore")
        )
        previous_cooldown_evaluation = evaluate_request_cooldown_handoff(
            previous_handoff,
            expected_binding=previous_binding,
            phase=str(phase),
            now=previous_not_before or dt.datetime.now(dt.timezone.utc),
        )
        failures.extend(previous_cooldown_evaluation["failures"])
        previous_timing_content = previous_document.get("requestTimingContent")
        if (
            not isinstance(previous_timing_content, Mapping)
            or previous_handoff.get("requestTimingSha256")
            != previous_timing_content.get("sha256")
            or previous_handoff.get("lastPublicRequestAt")
            != previous_timing.get("lastPublicRequestAt")
        ):
            failures.append(_failure("previous_request_cooldown_timing_mismatch"))
    if identity.get("previousRequestCooldown") != previous_document:
        failures.append(_failure("evidence_previous_request_cooldown_mismatch"))
    if summary.get("previousRequestCooldown") != previous_document:
        failures.append(_failure("evidence_summary_previous_request_cooldown_mismatch"))
    if (
        summary_versions.get("localEvaluator")
        != identity_decision.get("localVersions")
        or summary_versions.get("liveContractBinding")
        != identity_decision.get("liveContractBinding")
        or summary_versions.get("deployed")
        != recomputed_deployment_binding.get("deployedVersions")
        or summary_versions.get("deploymentBinding")
        != recomputed_deployment_binding
    ):
        failures.append(_failure("evidence_summary_versions_mismatch"))
    artist_data_evidence: dict[str, Any] | None = None
    artist_bound_paths: set[Path] = set()
    if snapshot == "candidate":
        artist_root = _find_artist_evidence_root(out_dir)
        binding_value = deployment_identity.get("artistDataBinding")
        binding = binding_value if isinstance(binding_value, Mapping) else {}
        if artist_root is None:
            artist_data_evaluation = _result(
                [_failure("artist_evidence_root_invalid")]
            )
        else:
            artist_data_evaluation = evaluate_artist_data_evidence(
                artist_root, binding, phase=str(phase)
            )
        artist_data_evidence = _artist_evidence_record(artist_data_evaluation)
        if artist_data_evaluation.get("passed") is not True:
            failures.extend(artist_data_evaluation.get("failures") or [])
            failures.append(_failure("evidence_artist_data_binding_failed"))
        if identity.get("artistDataEvidence") != artist_data_evidence:
            failures.append(_failure("evidence_artist_data_binding_drift"))
        artist_bound_paths = {
            Path(path).resolve()
            for path in artist_data_evaluation.get("boundPaths") or []
            if isinstance(path, str)
        }
    elif identity.get("artistDataEvidence") is not None:
        failures.append(_failure("unexpected_artist_data_evidence"))

    recorded_pilot_value = identity.get("pilotInspection")
    recorded_pilot = (
        recorded_pilot_value
        if isinstance(recorded_pilot_value, Mapping)
        else None
    )
    if summary.get("pilotInspection") != recorded_pilot:
        failures.append(_failure("evidence_pilot_inspection_mismatch"))
    if phase == "full" and snapshot == "candidate":
        if recorded_pilot is None:
            failures.append(_failure("candidate_pilot_inspection_missing"))
        else:
            recomputed_pilot = evaluate_recorded_pilot_inspection(
                recorded_pilot,
                deployment_identity=deployment_identity,
                evaluator_git_sha=str(evaluator_git_sha),
            )
            failures.extend(recomputed_pilot["failures"])
    elif recorded_pilot is not None:
        failures.append(_failure("unexpected_pilot_inspection"))

    expected_text_ids = [case["id"] for case in selected["text"]]
    expected_image_ids = [case["id"] for case in selected["image"]]
    expected_counts = selected["counts"]
    expected_inventory = {
        "counts": expected_counts,
        "textCaseIds": expected_text_ids,
        "imageCaseIds": expected_image_ids,
    }
    for field, expected in expected_inventory.items():
        if case_inventory.get(field) != expected:
            failures.append(
                _failure(
                    "evidence_case_inventory_mismatch",
                    field=field,
                    expected=expected,
                    actual=case_inventory.get(field),
                )
            )
    if summary.get("caseCounts") != expected_counts:
        failures.append(_failure("evidence_summary_case_counts_mismatch"))
    expected_selected = {
        "text": len(expected_text_ids),
        "image": len(expected_image_ids),
    }
    for modality, expected_count in expected_selected.items():
        modality_value = summary.get(modality)
        modality_summary = (
            modality_value if isinstance(modality_value, Mapping) else {}
        )
        if modality_summary.get("selected") != expected_count:
            failures.append(
                _failure(
                    "evidence_summary_selected_mismatch",
                    modality=modality,
                    expected=expected_count,
                    actual=modality_summary.get("selected"),
                )
            )

    summary_manual_value = summary.get("manualRelevance")
    summary_manual = (
        summary_manual_value if isinstance(summary_manual_value, Mapping) else {}
    )
    _validate_run_binding(
        manual_document, expected_binding, "manual-relevance.json", failures
    )
    if manual_document.get("summary") != summary_manual:
        failures.append(_failure("evidence_manual_summary_mismatch"))

    handoff_expectations = {
        "schemaVersion": "nga-playwright-handoff-v1",
        "runId": run_id,
        "phase": phase,
        "snapshot": snapshot,
        "evaluatorGitSha": evaluator_git_sha,
        "deploymentIdentityHash": deployment_hash,
        "cooldownSeconds": PLAYWRIGHT_COOLDOWN_SECONDS,
        "browserPublicSearchRequestBudget": PLAYWRIGHT_PUBLIC_SEARCH_REQUEST_BUDGET,
        "expectedTestCount": PLAYWRIGHT_TEST_COUNT,
    }
    for field, expected in handoff_expectations.items():
        if handoff.get(field) != expected:
            failures.append(
                _failure(
                    "playwright_handoff_mismatch",
                    field=field,
                    expected=expected,
                    actual=handoff.get(field),
                )
            )
    if summary.get("playwrightHandoff") != handoff:
        failures.append(_failure("playwright_summary_handoff_mismatch"))
    completed_at = _parse_utc_timestamp(handoff.get("pythonCompletedAt"))
    not_before = _parse_utc_timestamp(handoff.get("playwrightNotBefore"))
    last_public_request_at = _parse_utc_timestamp(
        request_timing.get("lastPublicRequestAt")
    )
    if (
        completed_at is None
        or not_before is None
        or last_public_request_at is None
        or completed_at < last_public_request_at
        or (not_before - completed_at).total_seconds()
        < PLAYWRIGHT_COOLDOWN_SECONDS
    ):
        failures.append(_failure("playwright_cooldown_invalid"))

    report_config_value = report.get("config")
    report_config = (
        report_config_value if isinstance(report_config_value, Mapping) else {}
    )
    metadata_value = report_config.get("metadata")
    metadata = metadata_value if isinstance(metadata_value, Mapping) else {}
    handoff_path = out_dir / "playwright-handoff.json"
    handoff_hash = (
        sha256_bytes(handoff_path.read_bytes()) if handoff_path.is_file() else None
    )
    if metadata.get("ngaStagingRun") != handoff:
        failures.append(_failure("playwright_report_binding_mismatch"))
    if metadata.get("bindingSha256") != handoff_hash:
        failures.append(_failure("playwright_report_binding_hash_mismatch"))
    stats_value = report.get("stats")
    stats = stats_value if isinstance(stats_value, Mapping) else {}
    expected_stats = {
        "expected": PLAYWRIGHT_TEST_COUNT,
        "skipped": 0,
        "unexpected": 0,
        "flaky": 0,
    }
    for field, expected in expected_stats.items():
        if stats.get(field) != expected:
            failures.append(
                _failure(
                    "playwright_report_incomplete",
                    field=field,
                    expected=expected,
                    actual=stats.get(field),
                )
            )

    projects_value = report_config.get("projects")
    projects = projects_value if isinstance(projects_value, list) else []
    project_names = [
        project.get("name")
        for project in projects
        if isinstance(project, Mapping)
    ]
    if project_names != [PLAYWRIGHT_PROJECT_NAME]:
        failures.append(
            _failure(
                "playwright_project_mismatch",
                expected=PLAYWRIGHT_PROJECT_NAME,
                actual=project_names,
            )
        )
    specs = _collect_playwright_specs(report.get("suites"))
    if report.get("errors") not in (None, []):
        failures.append(_failure("playwright_report_contains_errors"))
    titles = [spec.get("title") for spec in specs]
    if titles != list(PLAYWRIGHT_SPEC_TITLES):
        failures.append(
            _failure(
                "playwright_spec_inventory_mismatch",
                expected=list(PLAYWRIGHT_SPEC_TITLES),
                actual=titles,
            )
        )
    artifact_root = out_dir / "playwright/playwright-artifacts"
    attachment_paths: set[str] = set()
    screenshot_paths: set[str] = set()
    trace_paths: set[str] = set()
    attachment_directories: set[str] = set()
    for index, spec in enumerate(specs):
        tests_value = spec.get("tests")
        tests = tests_value if isinstance(tests_value, list) else []
        valid_test = len(tests) == 1 and isinstance(tests[0], Mapping)
        test_record = tests[0] if valid_test else {}
        results_value = test_record.get("results")
        results = results_value if isinstance(results_value, list) else []
        result = results[0] if len(results) == 1 and isinstance(results[0], Mapping) else {}
        if (
            spec.get("ok") is not True
            or not valid_test
            or index >= len(PLAYWRIGHT_SPEC_IDS)
            or spec.get("id") != PLAYWRIGHT_SPEC_IDS[index]
            or test_record.get("expectedStatus") != "passed"
            or test_record.get("status") != "expected"
            or test_record.get("projectName") != PLAYWRIGHT_PROJECT_NAME
            or len(results) != 1
            or not isinstance(results[0], Mapping)
            or result.get("status") != "passed"
        ):
            failures.append(
                _failure(
                    "playwright_spec_not_passed", title=spec.get("title")
                )
            )
        attachments_value = result.get("attachments")
        attachments = attachments_value if isinstance(attachments_value, list) else []
        expected_screenshot = (
            PLAYWRIGHT_SCREENSHOTS[index]
            if index < len(PLAYWRIGHT_SCREENSHOTS)
            else "invalid.png"
        )
        attachment_by_name = {
            attachment.get("name"): attachment
            for attachment in attachments
            if isinstance(attachment, Mapping)
            and isinstance(attachment.get("name"), str)
        }
        if (
            len(attachments) != 2
            or len(attachment_by_name) != 2
            or set(attachment_by_name) != {expected_screenshot, "trace"}
        ):
            failures.append(
                _failure(
                    "playwright_attachment_inventory_mismatch",
                    title=spec.get("title"),
                )
            )
            continue
        screenshot_attachment = attachment_by_name[expected_screenshot]
        trace_attachment = attachment_by_name["trace"]
        if (
            screenshot_attachment.get("contentType") != "image/png"
            or trace_attachment.get("contentType") != "application/zip"
            or screenshot_attachment.get("body") is not None
            or trace_attachment.get("body") is not None
        ):
            failures.append(
                _failure(
                    "playwright_attachment_metadata_invalid",
                    title=spec.get("title"),
                )
            )
            continue
        screenshot_path = _playwright_attachment_path(
            screenshot_attachment.get("path"), artifact_root=artifact_root
        )
        trace_path = _playwright_attachment_path(
            trace_attachment.get("path"), artifact_root=artifact_root
        )
        if (
            screenshot_path is None
            or trace_path is None
            or len(screenshot_path[0].relative_to(artifact_root.resolve(strict=True)).parts)
            != 3
            or screenshot_path[0].parent.name != "attachments"
            or screenshot_path[0].suffix.lower() != ".png"
            or len(trace_path[0].relative_to(artifact_root.resolve(strict=True)).parts)
            != 2
            or trace_path[0].name != "trace.zip"
            or screenshot_path[0].parent.parent != trace_path[0].parent
        ):
            failures.append(
                _failure(
                    "playwright_attachment_path_invalid",
                    title=spec.get("title"),
                )
            )
            continue
        relative_directory = trace_path[0].parent.relative_to(
            artifact_root.resolve(strict=True)
        ).as_posix()
        out_screenshot = f"playwright/playwright-artifacts/{screenshot_path[1]}"
        out_trace = f"playwright/playwright-artifacts/{trace_path[1]}"
        if (
            out_screenshot in attachment_paths
            or out_trace in attachment_paths
            or relative_directory in attachment_directories
            or index >= len(PLAYWRIGHT_ARTIFACT_DIRECTORIES)
            or relative_directory != PLAYWRIGHT_ARTIFACT_DIRECTORIES[index]
        ):
            failures.append(
                _failure(
                    "playwright_attachment_not_unique",
                    title=spec.get("title"),
                )
            )
            continue
        attachment_directories.add(relative_directory)
        attachment_paths.update({out_screenshot, out_trace})
        screenshot_paths.add(out_screenshot)
        trace_paths.add(out_trace)

    required_python_paths = {
        "identity.json",
        "summary.json",
        "summary.md",
        "case-inventory.json",
        "fixtures-manifest.json",
        "manual-relevance.json",
        "playwright-handoff.json",
        "request-cooldown-handoff.json",
        *IDENTITY_EVIDENCE_PATHS.values(),
        "raw/request-timing.json",
        "raw/cache-probe.json",
        "raw/image-identity-probe.json",
        "raw/ngs-probe.json",
        *{
            f"raw/text/{case_id.replace(':', '_')}.json"
            for case_id in expected_text_ids
        },
        *{f"raw/image/{case_id}.json" for case_id in expected_image_ids},
    }
    if summary_manual.get("status") == "graded":
        required_python_paths.add("relevance-labels.json")
    if previous_path.is_file():
        required_python_paths.add(previous_relative)
    if phase == "full":
        required_python_paths.add("raw/image-negative-probes.json")
    required_playwright_paths = {
        "playwright/playwright-report.json",
        "playwright/playwright-artifacts/.last-run.json",
        *attachment_paths,
    }
    if (
        len(attachment_paths) != PLAYWRIGHT_TEST_COUNT * 2
        or len(screenshot_paths) != PLAYWRIGHT_TEST_COUNT
        or len(trace_paths) != PLAYWRIGHT_TEST_COUNT
    ):
        failures.append(
            _failure(
                "playwright_attachment_count_mismatch",
                expected=PLAYWRIGHT_TEST_COUNT * 2,
                actual=len(attachment_paths),
            )
        )
    for screenshot_path in sorted(screenshot_paths):
        if not _valid_png(out_dir / screenshot_path):
            failures.append(
                _failure(
                    "playwright_screenshot_invalid",
                    path=screenshot_path,
                )
            )
    for trace_path in sorted(trace_paths):
        if not _valid_trace_zip(out_dir / trace_path):
            failures.append(
                _failure("playwright_trace_invalid", path=trace_path)
            )
    required_paths = required_python_paths | required_playwright_paths | trace_paths
    actual_paths = {
        path.relative_to(out_dir).as_posix()
        for path in existing_files
        if path.resolve() != (out_dir / "artifact-manifest.json").resolve()
        and path.resolve() not in artist_bound_paths
    }
    missing_paths = sorted(required_paths - actual_paths)
    unexpected_paths = sorted(actual_paths - required_paths)
    if missing_paths:
        failures.append(_failure("evidence_artifacts_missing", paths=missing_paths))
    if unexpected_paths:
        failures.append(
            _failure("unexpected_evidence_artifacts", paths=unexpected_paths)
        )
    last_run = _read_evidence_json(
        out_dir, "playwright/playwright-artifacts/.last-run.json", failures
    )
    if last_run.get("status") != "passed" or last_run.get("failedTests") != []:
        failures.append(_failure("playwright_last_run_incomplete"))

    deployed_versions_value = recomputed_deployment_binding.get("deployedVersions")
    deployed_versions = (
        deployed_versions_value
        if isinstance(deployed_versions_value, Mapping)
        else {}
    )
    text_endpoint = f"{EXPECTED_WEB_ORIGIN}/api/public-search/nga/text"
    text_by_id = {case["id"]: case for case in selected["text"]}
    recomputed_text_by_id: dict[str, Mapping[str, Any]] = {}
    for case_id in expected_text_ids:
        relative = f"raw/text/{case_id.replace(':', '_')}.json"
        record = _read_evidence_json(out_dir, relative, failures)
        _validate_run_binding(record, expected_binding, relative, failures)
        expected_case = text_by_id[case_id]
        if record.get("case") != expected_case:
            failures.append(
                _failure("raw_case_inventory_drift", path=relative, caseId=case_id)
            )
        expected_request = {
            "url": text_endpoint,
            "method": "POST",
            "body": _text_request_body(expected_case),
            "identity": canonical_text_identity(expected_case),
        }
        if record.get("request") != expected_request:
            failures.append(_failure("raw_request_drift", path=relative))
        response = _validate_stored_response(
            record.get("response"),
            expected_url=text_endpoint,
            path=relative,
            failures=failures,
        )
        recomputed = evaluate_text_case(expected_case, response, deployed_versions)
        recomputed_text_by_id[case_id] = recomputed
        _evaluation_drift(
            record.get("evaluation"), recomputed, path=relative, failures=failures
        )
        if require_hard_pass and recomputed.get("passed") is not True:
            failures.append(
                _failure("raw_case_evidence_failed", path=relative, caseId=case_id)
            )

    expected_manual_cases = [
        make_manual_grading_template(
            case["id"],
            recomputed_text_by_id[case["id"]]["rows"][
                : int(case["manualGradeTop"])
            ],
        )
        for case in selected["text"]
        if case.get("manualGradeTop")
    ]
    if manual_document.get("cases") != expected_manual_cases:
        failures.append(_failure("manual_relevance_case_inventory_drift"))
    manual_case_ids = [case["caseId"] for case in expected_manual_cases]
    if summary_manual.get("caseCount") != len(manual_case_ids):
        failures.append(_failure("manual_relevance_case_inventory_drift"))

    recomputed_manual = summary_manual
    if summary_manual.get("status") == "graded":
        labels_relative = "relevance-labels.json"
        retained_labels = _read_evidence_json(out_dir, labels_relative, failures)
        _validate_run_binding(
            retained_labels, expected_binding, labels_relative, failures
        )
        labels_document_value = retained_labels.get("labels")
        labels_document = (
            labels_document_value
            if isinstance(labels_document_value, Mapping)
            else {}
        )
        if (
            retained_labels.get("schemaVersion") != RETAINED_RELEVANCE_SCHEMA
            or retained_labels.get("gradingTemplateSha256")
            != sha256_json(expected_manual_cases)
        ):
            failures.append(_failure("retained_relevance_binding_mismatch"))
        try:
            recomputed_manual = summarize_manual_relevance(
                expected_manual_cases, labels_document
            )
        except (TypeError, ValueError) as error:
            failures.append(
                _failure("retained_relevance_labels_invalid", error=str(error))
            )
            recomputed_manual = {}
        if summary_manual != recomputed_manual:
            failures.append(_failure("manual_relevance_summary_drift"))
    elif (out_dir / "relevance-labels.json").exists():
        failures.append(_failure("unexpected_relevance_labels"))

    recomputed_manual_gate = evaluate_manual_relevance_completion(
        recomputed_manual, str(snapshot)
    )
    if manual_document.get("evaluation") != recomputed_manual_gate:
        failures.append(_failure("manual_relevance_evaluation_drift"))
    if require_hard_pass and recomputed_manual_gate.get("passed") is not True:
        failures.append(_failure("manual_relevance_evidence_failed"))

    repo_root = Path(__file__).resolve().parents[1]
    committed_fixture_document = load_json_object(
        repo_root / "eval/nga-image-fixtures.json", "image fixture manifest"
    )
    fixture_values = committed_fixture_document.get("fixtures")
    fixture_list = fixture_values if isinstance(fixture_values, list) else []
    fixtures_by_id = {
        fixture.get("artworkId"): fixture
        for fixture in fixture_list
        if isinstance(fixture, Mapping)
    }
    expected_fixture_ids = sorted(
        {case["fixtureId"] for case in selected["image"]}
    )
    expected_fixture_evidence = {
        "fixtures": [fixtures_by_id[fixture_id] for fixture_id in expected_fixture_ids],
        "note": "Full image bytes were verified in memory and were not written to evidence.",
    }
    if fixtures_document != expected_fixture_evidence:
        failures.append(_failure("fixture_evidence_inventory_drift"))

    image_endpoint = f"{EXPECTED_WEB_ORIGIN}/api/public-search/nga/image"
    image_by_id = {case["id"]: case for case in selected["image"]}
    for case_id in expected_image_ids:
        relative = f"raw/image/{case_id}.json"
        record = _read_evidence_json(out_dir, relative, failures)
        _validate_run_binding(record, expected_binding, relative, failures)
        expected_case = image_by_id[case_id]
        fixture = fixtures_by_id[expected_case["fixtureId"]]
        if record.get("case") != expected_case:
            failures.append(
                _failure("raw_case_inventory_drift", path=relative, caseId=case_id)
            )
        expected_request = _expected_image_request(
            expected_case, fixture, image_endpoint
        )
        if record.get("request") != expected_request:
            failures.append(_failure("raw_request_drift", path=relative))
        response = _validate_stored_response(
            record.get("response"),
            expected_url=image_endpoint,
            path=relative,
            failures=failures,
        )
        recomputed = evaluate_image_case(expected_case, response)
        _evaluation_drift(
            record.get("evaluation"), recomputed, path=relative, failures=failures
        )
        if require_hard_pass and recomputed.get("passed") is not True:
            failures.append(
                _failure("raw_case_evidence_failed", path=relative, caseId=case_id)
            )

    if require_hard_pass and (
        summary.get("text")
        != {"selected": len(expected_text_ids), "passed": len(expected_text_ids)}
        or summary.get("image")
        != {"selected": len(expected_image_ids), "passed": len(expected_image_ids)}
        or summary.get("gatePassed") is not True
        or summary.get("failureCount") != 0
        or summary.get("gateFailures") != []
    ):
        failures.append(_failure("candidate_summary_aggregate_failed"))

    cache_relative = "raw/cache-probe.json"
    cache_record = _read_evidence_json(out_dir, cache_relative, failures)
    _validate_run_binding(cache_record, expected_binding, cache_relative, failures)
    cache_query = cache_record.get("query")
    if not isinstance(cache_query, str) or re.fullmatch(
        r"validation [a-f0-9]{12} oil paintings after 1700 before 1800",
        cache_query,
    ) is None:
        failures.append(_failure("cache_probe_query_invalid"))
        cache_query = "invalid"
    cache_case = {
        "id": "cache-probe",
        "query": cache_query,
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
    first_identity = canonical_text_identity(cache_case)
    changed_identity = canonical_text_identity(changed_cache_case)
    expected_cache_requests = {
        "firstRequest": _text_request_body(cache_case),
        "repeatRequest": _text_request_body(cache_case),
        "changedRequest": _text_request_body(changed_cache_case),
        "firstIdentity": first_identity,
        "changedIdentity": changed_identity,
    }
    if any(
        cache_record.get(field) != value
        for field, value in expected_cache_requests.items()
    ):
        failures.append(_failure("cache_probe_request_drift"))
    cache_responses = {
        field: _validate_stored_response(
            cache_record.get(field),
            expected_url=text_endpoint,
            path=f"{cache_relative}:{field}",
            failures=failures,
        )
        for field in ("first", "repeat", "changed")
    }
    recomputed_cache = evaluate_text_cache_probe(
        cache_responses["first"],
        cache_responses["repeat"],
        cache_responses["changed"],
        first_identity=first_identity,
        changed_identity=changed_identity,
        snapshot=str(snapshot),
    )
    _evaluation_drift(
        cache_record.get("evaluation"),
        recomputed_cache,
        path=cache_relative,
        failures=failures,
    )
    if require_hard_pass and recomputed_cache.get("passed") is not True:
        failures.append(_failure("raw_probe_evidence_failed", path=cache_relative))

    identity_relative = "raw/image-identity-probe.json"
    identity_record = _read_evidence_json(out_dir, identity_relative, failures)
    _validate_run_binding(identity_record, expected_binding, identity_relative, failures)
    first_image_case = selected["image"][0]
    first_fixture = fixtures_by_id[first_image_case["fixtureId"]]
    expected_first_request = _expected_image_request(
        first_image_case, first_fixture, image_endpoint
    )
    if identity_record.get("request") != expected_first_request:
        failures.append(_failure("image_identity_request_drift"))
    changed_digest = identity_record.get("sameNameChangedSha256")
    changed_constraints = {"classifications": ["Drawing"]}
    expected_identity_inputs = {
        "stable_first": expected_first_request["identity"],
        "stable_repeat": expected_first_request["identity"],
        "same_name_first": expected_first_request["identity"],
        "same_name_changed": canonical_image_identity_from_digest(
            str(changed_digest), first_image_case.get("constraints"), 30, 0
        ),
        "constraint_first": expected_first_request["identity"],
        "constraint_changed": canonical_image_identity_from_digest(
            str(first_fixture["sha256"]), changed_constraints, 30, 0
        ),
    }
    if (
        not isinstance(changed_digest, str)
        or re.fullmatch(r"[a-f0-9]{64}", changed_digest) is None
        or identity_record.get("changedConstraints") != changed_constraints
        or identity_record.get("identityInputs") != expected_identity_inputs
        or identity_record.get("stableIdentity")
        != expected_first_request["identity"]
    ):
        failures.append(_failure("image_identity_inputs_drift"))
    repeat_value = identity_record.get("repeat")
    repeat = repeat_value if isinstance(repeat_value, Mapping) else {}
    repeat_response = _validate_stored_response(
        repeat.get("response"),
        expected_url=image_endpoint,
        path=f"{identity_relative}:repeat",
        failures=failures,
    )
    recomputed_repeat = evaluate_image_response(
        repeat_response, first_image_case.get("constraints")
    )
    recomputed_identity = evaluate_image_identity_probe(**expected_identity_inputs)
    _evaluation_drift(
        repeat.get("evaluation"),
        recomputed_repeat,
        path=f"{identity_relative}:repeat",
        failures=failures,
    )
    _evaluation_drift(
        identity_record.get("identityEvaluation"),
        recomputed_identity,
        path=identity_relative,
        failures=failures,
    )
    if require_hard_pass and (
        recomputed_identity.get("passed") is not True
        or recomputed_repeat.get("passed") is not True
    ):
        failures.append(_failure("raw_probe_evidence_failed", path=identity_relative))

    if phase == "full":
        negative_relative = "raw/image-negative-probes.json"
        negative_record = _read_evidence_json(out_dir, negative_relative, failures)
        _validate_run_binding(
            negative_record, expected_binding, negative_relative, failures
        )
        responses_value = negative_record.get("responses")
        responses = responses_value if isinstance(responses_value, Mapping) else {}
        validated_negative = {
            name: _validate_stored_response(
                responses.get(name),
                expected_url=image_endpoint,
                path=f"{negative_relative}:{name}",
                failures=failures,
            )
            for name in ("invalid_mime", "zero_byte", "multiple_files", "oversize")
        }
        recomputed_negative = evaluate_negative_image_probes(validated_negative)
        _evaluation_drift(
            negative_record.get("evaluation"),
            recomputed_negative,
            path=negative_relative,
            failures=failures,
        )
        if require_hard_pass and recomputed_negative.get("passed") is not True:
            failures.append(
                _failure("raw_probe_evidence_failed", path=negative_relative)
            )

    ngs_relative = "raw/ngs-probe.json"
    ngs_record = _read_evidence_json(out_dir, ngs_relative, failures)
    _validate_run_binding(ngs_record, expected_binding, ngs_relative, failures)
    ngs_endpoint = f"{EXPECTED_WEB_ORIGIN}/api/public-search/ngs/text"
    expected_ngs_request = {
        "url": ngs_endpoint,
        "method": "POST",
        "body": {"query": "paintings", "topK": 30, "minScore": 0},
    }
    if ngs_record.get("request") != expected_ngs_request:
        failures.append(_failure("ngs_probe_request_drift"))
    ngs_response = _validate_stored_response(
        ngs_record.get("response"),
        expected_url=ngs_endpoint,
        path=ngs_relative,
        failures=failures,
    )
    recomputed_ngs = evaluate_ngs_probe(ngs_response)
    _evaluation_drift(
        ngs_record.get("evaluation"),
        recomputed_ngs,
        path=ngs_relative,
        failures=failures,
    )
    if require_hard_pass and recomputed_ngs.get("passed") is not True:
        failures.append(_failure("raw_probe_evidence_failed", path=ngs_relative))
    for relative in sorted(required_paths & actual_paths):
        path = out_dir / relative
        if path.is_symlink() or path.stat().st_size == 0:
            failures.append(
                _failure("evidence_artifact_invalid", path=relative)
            )
        if relative.endswith(".json") and relative not in {
            "summary.json",
            "identity.json",
            "case-inventory.json",
            "manual-relevance.json",
            "playwright-handoff.json",
            "playwright/playwright-report.json",
        }:
            _read_evidence_json(out_dir, relative, failures)

    if manifest is not None:
        manifest_expectations = {
            "schemaVersion": "nga-staging-evidence-manifest-v2",
            "runId": run_id,
            "phase": phase,
            "snapshot": snapshot,
            "evaluatorGitSha": evaluator_git_sha,
            "deploymentIdentityHash": deployment_hash,
            "playwrightBindingSha256": handoff_hash,
            "artistDataEvidenceSha256": (
                artist_data_evidence.get("evidenceSha256")
                if artist_data_evidence is not None
                else None
            ),
        }
        for field, expected in manifest_expectations.items():
            if manifest.get(field) != expected:
                failures.append(
                    _failure(
                        "evidence_manifest_binding_mismatch",
                        field=field,
                        expected=expected,
                        actual=manifest.get(field),
                    )
                )
        artifacts_value = manifest.get("artifacts")
        artifacts = artifacts_value if isinstance(artifacts_value, Mapping) else {}
        if set(artifacts) != actual_paths:
            failures.append(_failure("evidence_manifest_incomplete"))
        for relative in sorted(actual_paths & set(artifacts)):
            record_value = artifacts.get(relative)
            record = record_value if isinstance(record_value, Mapping) else {}
            path = out_dir / relative
            expected_record = {
                "group": (
                    "playwright" if relative.startswith("playwright/") else "python"
                ),
                "sha256": sha256_bytes(path.read_bytes()),
                "byteLength": path.stat().st_size,
            }
            if record != expected_record:
                failures.append(
                    _failure("evidence_manifest_hash_mismatch", path=relative)
                )
        groups_value = manifest.get("groups")
        groups = groups_value if isinstance(groups_value, Mapping) else {}
        for group in ("python", "playwright"):
            paths = sorted(
                path
                for path in actual_paths
                if (path.startswith("playwright/")) == (group == "playwright")
            )
            if groups.get(group) != {"count": len(paths), "paths": paths}:
                failures.append(
                    _failure("evidence_manifest_group_mismatch", group=group)
                )

    return _result(
        failures,
        phase=phase,
        snapshot=snapshot,
        runId=run_id,
        evaluatorGitSha=evaluator_git_sha,
        deploymentIdentityHash=deployment_hash,
        playwrightBindingSha256=handoff_hash,
        requiredPaths=sorted(required_paths),
        actualPaths=sorted(actual_paths),
        summary=summary,
        identity=identity,
        caseInventory=case_inventory,
        manualRelevance=summary_manual,
        artistDataEvidence=artist_data_evidence,
        identityReleaseDecision=identity_decision,
    )


def rehash_evidence(out_dir: Path) -> dict[str, Any]:
    """Validate and hash one complete same-run Python + Playwright bundle."""
    evaluation = evaluate_evidence_bundle(out_dir)
    if not evaluation["passed"]:
        codes = ", ".join(evaluation["failureCodes"])
        raise GateStopped(f"evidence bundle is incomplete or mixed: {codes}")

    artifacts: dict[str, Any] = {}
    grouped_paths: dict[str, list[str]] = {"python": [], "playwright": []}
    for relative in evaluation["actualPaths"]:
        path = out_dir / relative
        group = "playwright" if relative.startswith("playwright/") else "python"
        grouped_paths[group].append(relative)
        artifacts[relative] = {
            "group": group,
            "sha256": sha256_bytes(path.read_bytes()),
            "byteLength": path.stat().st_size,
        }
    groups = {
        name: {"count": len(paths), "paths": paths}
        for name, paths in grouped_paths.items()
    }
    manifest = {
        "schemaVersion": "nga-staging-evidence-manifest-v2",
        "runId": evaluation["runId"],
        "phase": evaluation["phase"],
        "snapshot": evaluation["snapshot"],
        "evaluatorGitSha": evaluation["evaluatorGitSha"],
        "deploymentIdentityHash": evaluation["deploymentIdentityHash"],
        "playwrightBindingSha256": evaluation["playwrightBindingSha256"],
        "artistDataEvidenceSha256": (
            evaluation["artistDataEvidence"].get("evidenceSha256")
            if isinstance(evaluation.get("artistDataEvidence"), Mapping)
            else None
        ),
        "groups": groups,
        "artifacts": artifacts,
    }
    _write_json(out_dir / "artifact-manifest.json", manifest)
    return manifest


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


def evaluate_live_contract_binding(
    live_versions: Sequence[str], deployed_contract_version: str
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    if not live_versions:
        failures.append(_failure("live_contract_unobserved"))
    elif len(live_versions) != 1:
        failures.append(
            _failure("live_contract_ambiguous", actual=list(live_versions))
        )
    elif live_versions[0] != deployed_contract_version:
        failures.append(
            _failure(
                "live_contract_mismatch",
                expected=deployed_contract_version,
                actual=live_versions[0],
            )
        )
    return _result(
        failures,
        deployedContractVersion=deployed_contract_version,
        liveContractVersions=list(live_versions),
    )


def _web_contract_from_response(response: Mapping[str, Any]) -> dict[str, Any]:
    body = response.get("body") or b""
    return {
        "requestUrl": response.get("requestUrl"),
        "finalUrl": response.get("finalUrl"),
        "status": response.get("status"),
        "contractVersions": extract_web_contract_versions(response),
        "bodySha256": sha256_bytes(body),
        "bodyLength": len(body),
    }


def _observe_web_contract(transport: Any, web_base_url: str) -> dict[str, Any]:
    response = transport.request("GET", f"{web_base_url}/nga/search")
    return _web_contract_from_response(response)


def evaluate_identity_evidence(
    documents: Mapping[str, Mapping[str, Any]],
    *,
    expected_binding: Mapping[str, Any],
    deployed_contract_version: str,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    document_contracts = {
        "deploymentIdentity": (
            "nga-deployment-input-evidence-v1",
            {"schemaVersion", *expected_binding, "content"},
        ),
        "localVersions": (
            "nga-local-version-evidence-v1",
            {"schemaVersion", *expected_binding, "sources"},
        ),
        "requestPolicy": (
            "nga-request-policy-evidence-v1",
            {
                "schemaVersion",
                *expected_binding,
                "publicSearchRequestsPerMinute",
            },
        ),
        "health": (
            "nga-health-evidence-v1",
            {"schemaVersion", *expected_binding, "request", "response"},
        ),
        "webContract": (
            "nga-web-contract-evidence-v1",
            {"schemaVersion", *expected_binding, "request", "response"},
        ),
    }
    for name in IDENTITY_EVIDENCE_PATHS:
        document_value = documents.get(name)
        document = document_value if isinstance(document_value, Mapping) else {}
        _validate_run_binding(
            document,
            expected_binding,
            IDENTITY_EVIDENCE_PATHS[name],
            failures,
        )
        expected_schema, expected_fields = document_contracts[name]
        if (
            document.get("schemaVersion") != expected_schema
            or set(document) != expected_fields
        ):
            failures.append(
                _failure("identity_evidence_document_invalid", document=name)
            )

    local_document = documents.get("localVersions") or {}
    try:
        local_versions = parse_captured_local_versions(
            local_document.get("sources")
        )
    except ValueError:
        local_versions = {}
        failures.append(_failure("identity_local_versions_invalid"))
    if local_versions != EXPECTED_VERSIONS:
        failures.append(
            _failure(
                "identity_local_versions_mismatch",
                expected=EXPECTED_VERSIONS,
                actual=local_versions,
            )
        )

    request_document = documents.get("requestPolicy") or {}
    request_rate = request_document.get("publicSearchRequestsPerMinute")
    if type(request_rate) is not int or not 1 <= request_rate <= 9:
        failures.append(
            _failure("identity_request_rate_invalid", actual=request_rate)
        )

    health_url = f"{EXPECTED_API_ORIGIN}/health"
    health_document = documents.get("health") or {}
    health_request = health_document.get("request")
    if health_request != {"method": "GET", "url": health_url}:
        failures.append(_failure("identity_health_request_invalid"))
    try:
        health_response = parse_identity_response(
            health_document.get("response"), expected_url=health_url
        )
        health_evaluation = evaluate_staging_health_response(
            health_response, EXPECTED_API_ORIGIN
        )
        health = health_evaluation["observation"]
        if not health_evaluation["passed"]:
            failures.extend(health_evaluation["failures"])
    except ValueError:
        health = {}
        failures.append(_failure("identity_health_artifact_invalid"))

    web_url = f"{EXPECTED_WEB_ORIGIN}/nga/search"
    web_document = documents.get("webContract") or {}
    web_request = web_document.get("request")
    if web_request != {"method": "GET", "url": web_url}:
        failures.append(_failure("identity_web_request_invalid"))
    try:
        web_response = parse_identity_response(
            web_document.get("response"), expected_url=web_url
        )
        web_contract = _web_contract_from_response(web_response)
    except ValueError:
        web_contract = {}
        failures.append(_failure("identity_web_artifact_invalid"))
    if web_contract.get("status") != 200:
        failures.append(
            _failure(
                "identity_web_observation_failed",
                status=web_contract.get("status"),
            )
        )
    live_contract_binding = evaluate_live_contract_binding(
        web_contract.get("contractVersions")
        if isinstance(web_contract.get("contractVersions"), list)
        else [],
        deployed_contract_version,
    )
    if live_contract_binding["passed"] is not True:
        failures.extend(live_contract_binding["failures"])

    decision = {
        "localVersions": local_versions,
        "publicSearchRequestsPerMinute": request_rate,
        "health": health,
        "webContract": web_contract,
        "liveContractBinding": live_contract_binding,
        "gatePassed": not failures,
    }
    return _result(failures, decision=decision)


@dataclasses.dataclass(frozen=True)
class RunConfig:
    phase: str
    snapshot: str
    api_base_url: str
    web_base_url: str
    out_dir: Path
    deployment_identity: Path
    fail_on_gates: bool
    repo_root: Path
    relevance_labels: Path | None = None
    pilot_inspection: Path | None = None
    previous_request_handoff: Path | None = None
    requests_per_minute: int = 8


def run_gate(config: RunConfig, transport: Any | None = None) -> dict[str, Any]:
    # No files or clients are created until both user-provided origins pass
    # exact equality. The fresh directory reservation prevents cross-run reuse.
    validate_staging_origins(config.api_base_url, config.web_base_url)
    run_id = start_evidence_run(config.out_dir)
    candidate_sha = _git_sha(config.repo_root)
    deployment_identity_bytes = config.deployment_identity.read_bytes()
    deployment_identity = load_deployment_identity(config.deployment_identity)
    deployment_binding = evaluate_deployment_binding(
        deployment_identity,
        snapshot=config.snapshot,
        evaluator_git_sha=candidate_sha,
    )
    if not deployment_binding["passed"]:
        raise GateStopped("deployment identity does not bind the requested snapshot")
    binding = run_binding(
        run_id=run_id,
        snapshot=config.snapshot,
        evaluator_git_sha=candidate_sha,
        deployment_identity_hash=deployment_binding["deploymentIdentityHash"],
    )
    inventory = load_case_inventory(
        config.repo_root / "eval/nga-staging-cases.yaml",
        config.repo_root / "eval/nga-constraint-queries.yaml",
    )
    selected = select_cases(inventory, config.phase)
    request_labels = expected_public_request_labels(selected, config.phase)
    previous_request_cooldown: dict[str, Any] | None = None
    if config.snapshot == "candidate" and config.fail_on_gates:
        if config.previous_request_handoff is None:
            raise GateStopped(
                "official candidate requires a discovery request cooldown handoff"
            )
        previous_evaluation = validate_request_cooldown_file(
            config.previous_request_handoff,
            current_binding=binding,
            phase=config.phase,
            expected_labels=request_labels,
        )
        if previous_evaluation.get("passed") is not True:
            raise GateStopped(
                "discovery request cooldown handoff is missing, stale, or incomplete"
            )
        previous_request_cooldown = {
            **binding,
            "schemaVersion": "nga-previous-request-cooldown-evidence-v1",
            "phase": config.phase,
            "handoffContent": previous_evaluation["handoffContent"],
            "requestTimingContent": previous_evaluation["requestTimingContent"],
        }
    artist_data_evidence: dict[str, Any] | None = None
    if config.snapshot == "candidate":
        artist_root = _find_artist_evidence_root(config.out_dir)
        binding_value = deployment_identity.get("artistDataBinding")
        artist_binding = (
            binding_value if isinstance(binding_value, Mapping) else {}
        )
        artist_evaluation = (
            evaluate_artist_data_evidence(
                artist_root, artist_binding, phase=config.phase
            )
            if artist_root is not None
            else _result([_failure("artist_evidence_root_invalid")])
        )
        if artist_evaluation.get("passed") is not True:
            raise GateStopped("artist data evidence does not bind the candidate")
        artist_data_evidence = _artist_evidence_record(artist_evaluation)
    pilot_inspection: dict[str, Any] | None = None
    if config.phase == "full" and config.snapshot == "candidate":
        if config.pilot_inspection is None:
            raise GateStopped("full candidate requires a reviewed pilot inspection")
        pilot_inspection = evaluate_pilot_inspection(
            config.pilot_inspection,
            deployment_identity=deployment_identity,
            evaluator_git_sha=candidate_sha,
        )
        if not pilot_inspection["passed"]:
            raise GateStopped("pilot inspection does not authorize the full candidate")
    network = transport or UrllibTransport()
    pacer = RequestPacer(config.requests_per_minute)
    health_response = network.request("GET", f"{config.api_base_url}/health")
    health_evaluation = evaluate_staging_health_response(
        health_response, config.api_base_url
    )
    if not health_evaluation["passed"]:
        raise GateStopped(
            "API health did not prove status=healthy and environment=staging"
        )
    health = health_evaluation["observation"]

    local_version_sources = capture_local_version_sources(config.repo_root)
    local_versions = parse_captured_local_versions(local_version_sources)
    web_response = network.request("GET", f"{config.web_base_url}/nga/search")
    web_contract = _web_contract_from_response(web_response)
    deployed_versions = deployment_binding["deployedVersions"]
    live_contract_binding = evaluate_live_contract_binding(
        web_contract["contractVersions"], str(deployed_versions["contract"])
    )

    started_at = utc_now()
    identity_documents = {
        "deploymentIdentity": {
            **binding,
            "schemaVersion": "nga-deployment-input-evidence-v1",
            "content": capture_bound_json_bytes(deployment_identity_bytes),
        },
        "localVersions": {
            **binding,
            "schemaVersion": "nga-local-version-evidence-v1",
            "sources": local_version_sources,
        },
        "requestPolicy": {
            **binding,
            "schemaVersion": "nga-request-policy-evidence-v1",
            "publicSearchRequestsPerMinute": config.requests_per_minute,
        },
        "health": {
            **binding,
            "schemaVersion": "nga-health-evidence-v1",
            "request": {
                "method": "GET",
                "url": f"{config.api_base_url}/health",
            },
            "response": serialize_identity_response(health_response),
        },
        "webContract": {
            **binding,
            "schemaVersion": "nga-web-contract-evidence-v1",
            "request": {
                "method": "GET",
                "url": f"{config.web_base_url}/nga/search",
            },
            "response": serialize_identity_response(web_response),
        },
    }
    identity_evaluation = evaluate_identity_evidence(
        identity_documents,
        expected_binding=binding,
        deployed_contract_version=str(deployed_versions["contract"]),
    )
    if config.snapshot == "candidate" and not identity_evaluation["passed"]:
        raise GateStopped("raw identity evidence does not bind the candidate")
    identity_release_decision = identity_evaluation["decision"]
    for name, document in identity_documents.items():
        _write_json(config.out_dir / IDENTITY_EVIDENCE_PATHS[name], document)
    if previous_request_cooldown is not None:
        _write_json(
            config.out_dir / "raw/previous-request-cooldown.json",
            previous_request_cooldown,
        )
    identity = {
        **binding,
        "generatedAt": started_at,
        "phase": config.phase,
        "apiBaseUrl": config.api_base_url,
        "webBaseUrl": config.web_base_url,
        "localVersions": local_versions,
        "deploymentIdentity": deployment_identity,
        "deploymentBinding": deployment_binding,
        "artistDataEvidence": artist_data_evidence,
        "pilotInspection": pilot_inspection,
        "previousRequestCooldown": previous_request_cooldown,
        "liveContractBinding": live_contract_binding,
        "publicSearchRequestsPerMinute": config.requests_per_minute,
        "health": health,
        "webContract": web_contract,
        "identityReleaseDecision": identity_release_decision,
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
        pacer.wait(f"text:{case['id']}")
        response = _post_json(network, text_endpoint, request_body)
        evaluated = evaluate_text_case(case, response, deployed_versions)
        record = {
            **binding,
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
    pacer.wait("cache:first")
    cache_first = _post_json(network, text_endpoint, _text_request_body(cache_case))
    # Cache hits still consume an anonymous public-search request and must share
    # the exact same process limiter and raw timing ledger as cold misses.
    pacer.wait("cache:repeat")
    cache_repeat = _post_json(network, text_endpoint, _text_request_body(cache_case))
    pacer.wait("cache:changed")
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
        **binding,
        "query": cache_case["query"],
        "firstRequest": _text_request_body(cache_case),
        "repeatRequest": _text_request_body(cache_case),
        "changedRequest": _text_request_body(changed_cache_case),
        "firstIdentity": canonical_text_identity(cache_case),
        "changedIdentity": canonical_text_identity(changed_cache_case),
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
        pacer.wait(f"image:{case['id']}")
        response = _post_image(
            network,
            image_endpoint,
            files=[("image", case["filename"], fixture["mimeType"], image_bytes)],
            constraints=case.get("constraints"),
        )
        evaluated = evaluate_image_case(case, response)
        record = {
            **binding,
            "case": case,
            "request": {
                "url": image_endpoint,
                "method": "POST",
                "filename": case["filename"],
                "mimeType": fixture["mimeType"],
                "byteLength": len(image_bytes),
                "sha256": sha256_bytes(image_bytes),
                "constraints": normalize_constraints(case.get("constraints")),
                "topK": 30,
                "minScore": 0,
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
    pacer.wait("image:repeat")
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
    identity_inputs = {
        "stable_first": stable_first,
        "stable_repeat": stable_repeat,
        "same_name_first": stable_first,
        "same_name_changed": canonical_image_identity(
            changed_bytes,
            first_image_case["filename"],
            first_image_case.get("constraints"),
            30,
            0,
        ),
        "constraint_first": stable_first,
        "constraint_changed": canonical_image_identity(
            first_bytes,
            first_image_case["filename"],
            changed_constraints,
            30,
            0,
        ),
    }
    image_probe_record = {
        **binding,
        "request": {
            "url": image_endpoint,
            "method": "POST",
            "filename": first_image_case["filename"],
            "mimeType": first_fixture["mimeType"],
            "byteLength": len(first_bytes),
            "sha256": sha256_bytes(first_bytes),
            "constraints": normalize_constraints(first_image_case.get("constraints")),
            "topK": 30,
            "minScore": 0,
            "identity": stable_first,
        },
        "identityInputs": identity_inputs,
        "sameNameChangedSha256": sha256_bytes(changed_bytes),
        "changedConstraints": changed_constraints,
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
            pacer.wait(f"image-negative:{name}")
            negative_responses[name] = _post_image(
                network, image_endpoint, files=files
            )
        negative_evaluation = evaluate_negative_image_probes(negative_responses)
        negative_record = {
            **binding,
            "responses": {
                name: _safe_response(response)
                for name, response in negative_responses.items()
            },
            "evaluation": negative_evaluation,
        }
        _write_json(config.out_dir / "raw/image-negative-probes.json", negative_record)

    pacer.wait("ngs:text")
    ngs_response = _post_json(
        network,
        f"{config.web_base_url}/api/public-search/ngs/text",
        {"query": "paintings", "topK": 30, "minScore": 0},
    )
    ngs_probe = evaluate_ngs_probe(ngs_response)
    _write_json(
        config.out_dir / "raw/ngs-probe.json",
        {
            **binding,
            "request": {
                "url": f"{config.web_base_url}/api/public-search/ngs/text",
                "method": "POST",
                "body": {"query": "paintings", "topK": 30, "minScore": 0},
            },
            "response": _safe_response(ngs_response),
            "evaluation": ngs_probe,
        },
    )
    request_timing = {
        **binding,
        "schemaVersion": "nga-request-timing-evidence-v1",
        "configuredRequestsPerMinute": config.requests_per_minute,
        "requests": pacer.evidence,
        "lastPublicRequestAt": (
            pacer.evidence[-1]["startedAt"] if pacer.evidence else None
        ),
    }
    request_timing_evaluation = evaluate_request_timing_evidence(
        request_timing,
        expected_binding=binding,
        expected_labels=request_labels,
    )
    if request_timing_evaluation.get("passed") is not True:
        raise GateStopped("raw request timing exceeded the anonymous rolling budget")
    request_timing_path = config.out_dir / "raw/request-timing.json"
    _write_json(request_timing_path, request_timing)
    request_cooldown_handoff = build_request_cooldown_handoff(
        binding=binding,
        phase=config.phase,
        request_timing_sha256=sha256_bytes(request_timing_path.read_bytes()),
        last_public_request_at=str(request_timing["lastPublicRequestAt"]),
    )
    _write_json(
        config.out_dir / "request-cooldown-handoff.json",
        request_cooldown_handoff,
    )
    identity["requestTiming"] = request_timing_evaluation
    identity["requestCooldownHandoff"] = request_cooldown_handoff
    _write_json(config.out_dir / "identity.json", identity)
    if config.relevance_labels is not None:
        labels_document = load_json_object(config.relevance_labels, "relevance labels")
        retained_labels = retain_relevance_labels(
            binding=binding,
            templates=manual_templates,
            labels_document=labels_document,
        )
        _write_json(config.out_dir / "relevance-labels.json", retained_labels)
        manual_relevance = summarize_manual_relevance(
            manual_templates, labels_document
        )
    else:
        manual_relevance = {
            "status": "manual_review_required" if manual_templates else "not_applicable",
            "caseCount": len(manual_templates),
            "metrics": None,
        }
    manual_relevance_gate = evaluate_manual_relevance_completion(
        manual_relevance, config.snapshot
    )
    _write_json(
        config.out_dir / "manual-relevance.json",
        {
            **binding,
            "summary": manual_relevance,
            "evaluation": manual_relevance_gate,
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
    all_failures.extend(
        {"scope": "manual-relevance", **failure}
        for failure in manual_relevance_gate["failures"]
    )
    if web_contract["status"] != 200:
        all_failures.append(
            {"scope": "web", "code": "nga_search_page_failed", "status": web_contract["status"]}
        )
    all_failures.extend(
        {"scope": "web-contract", **failure}
        for failure in live_contract_binding["failures"]
    )

    playwright_handoff = build_playwright_handoff(
        run_id=run_id,
        phase=config.phase,
        snapshot=config.snapshot,
        evaluator_git_sha=candidate_sha,
        deployment_identity_hash=deployment_binding["deploymentIdentityHash"],
    )
    _write_json(config.out_dir / "playwright-handoff.json", playwright_handoff)

    summary = {
        **binding,
        "generatedAt": utc_now(),
        "startedAt": started_at,
        "phase": config.phase,
        "publicSearchRequestsPerMinute": config.requests_per_minute,
        "hosts": {
            "api": config.api_base_url,
            "web": config.web_base_url,
        },
        "versions": {
            "localEvaluator": local_versions,
            "deployed": deployed_versions,
            "deploymentBinding": deployment_binding,
            "liveContractBinding": live_contract_binding,
        },
        "identityReleaseDecision": identity_release_decision,
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
        "manualRelevance": manual_relevance,
        "pilotInspection": pilot_inspection,
        "previousRequestCooldown": previous_request_cooldown,
        "playwrightHandoff": playwright_handoff,
        "requestTiming": request_timing_evaluation,
        "requestCooldownHandoff": request_cooldown_handoff,
        "gatePassed": not all_failures,
        "failureCount": len(all_failures),
        "gateFailures": all_failures,
        "limitations": [
            "Relation relevance requires independent 0-3 human labels; similarity is never used as truth, and grade 1 remains weak rather than strong relevance.",
            "NGS non-upstream contact is inferred from the public proxy's scope-forbidden response and is also checked in the browser gate.",
            "The artist-data gate binds the full Task 2 manifest, mapping, preserved image-vector values, and unchanged production identity; it does not authorize or perform the backfill.",
            "Local evaluator versions and deployed API/web identity are reported separately; candidate evaluation requires Task 7 to supply exact deployment IDs, version IDs, and Git SHAs.",
            "Semantic text-plus-image fusion is intentionally out of scope.",
        ],
    }
    _write_json(config.out_dir / "summary.json", summary)
    markdown = [
        f"# NGA staging gate — {config.snapshot} {config.phase}",
        "",
        f"- Generated: {summary['generatedAt']}",
        f"- Evaluator Git SHA: `{candidate_sha}`",
        f"- Deployed API Git SHA: `{deployment_identity['api']['gitSha']}`",
        f"- Deployed web Git SHA: `{deployment_identity['web']['gitSha']}`",
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
    parser.add_argument("--deployment-identity", type=Path, required=True)
    parser.add_argument("--relevance-labels", type=Path)
    parser.add_argument("--pilot-inspection", type=Path)
    parser.add_argument(
        "--previous-request-handoff",
        type=Path,
        help="Discovery request cooldown handoff required by official candidate runs.",
    )
    parser.add_argument("--fail-on-gates", action="store_true")
    parser.add_argument(
        "--public-search-requests-per-minute",
        type=int,
        default=8,
        help="Anonymous request pace (1-9); default leaves headroom below the API limit.",
    )
    return parser


def build_rehash_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rehash a completed NGA Python + Playwright evidence directory."
    )
    parser.add_argument("--out-dir", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(argv) if argv is not None else sys.argv[1:]
    if arguments[:1] == ["rehash"]:
        args = build_rehash_parser().parse_args(arguments[1:])
        try:
            manifest = rehash_evidence(args.out_dir.resolve())
        except (GateStopped, ValueError) as error:
            print(f"NGA staging evidence rehash stopped: {error}", file=sys.stderr)
            return 2
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return 0
    args = build_parser().parse_args(arguments)
    repo_root = Path(__file__).resolve().parents[1]
    try:
        summary = run_gate(
            RunConfig(
                phase=args.phase,
                snapshot=args.snapshot,
                api_base_url=args.api_base_url,
                web_base_url=args.web_base_url,
                out_dir=args.out_dir.resolve(),
                deployment_identity=args.deployment_identity.resolve(),
                fail_on_gates=args.fail_on_gates,
                repo_root=repo_root,
                relevance_labels=(
                    args.relevance_labels.resolve() if args.relevance_labels else None
                ),
                pilot_inspection=(
                    args.pilot_inspection.resolve() if args.pilot_inspection else None
                ),
                previous_request_handoff=(
                    args.previous_request_handoff.resolve()
                    if args.previous_request_handoff
                    else None
                ),
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
