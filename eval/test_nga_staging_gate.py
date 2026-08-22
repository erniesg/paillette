from __future__ import annotations

import importlib.util
import http.server
import hashlib
import io
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
GATE_PATH = ROOT / "eval" / "nga_staging_gate.py"


def load_gate():
    if not GATE_PATH.exists():
        raise AssertionError(f"missing evaluator: {GATE_PATH}")
    spec = importlib.util.spec_from_file_location("nga_staging_gate", GATE_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load evaluator")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def passing_row(**overrides):
    row = {
        "id": "open-access-art:nga:32679",
        "orgId": "open-access-art",
        "galleryId": "open-access-art",
        "title": "Allegory of Painting",
        "artist": "François Boucher",
        "year": 1765,
        "similarity": 0.91,
        "source": {"provider": "nga"},
        "metadata": {
            "provider": "nga",
            "dateText": "1765",
            "yearStart": 1765,
            "yearEnd": 1765,
            "visualClassification": "Painting",
            "mediumFamily": "oil",
            "medium": "oil on canvas",
            "primaryArtistId": "nga:artist:boucher",
            "sourceUrl":
                "https://www.nga.gov/collection/art-object-page.32679.html",
        },
    }
    row.update(overrides)
    return row


def passing_response(row=None, *, relation=None, constraints=None):
    if row is None:
        row = passing_row()
    if constraints is None:
        constraints = {}
    interpretation = {
        "parserVersion": "nga-v7",
        "originalQuery": "painting showing a sculpture",
        "semanticQuery": "depicting sculpture",
        "constraints": constraints,
        "corrections": [],
        "unresolved": [],
    }
    if relation is not None:
        interpretation["relation"] = relation
        interpretation["relationEvidence"] = {
            "policy": (
                "catalogue_derivation"
                if relation.get("kind") == "derived_from"
                else "visible_subject"
            ),
            "status": "verified",
        }
        metadata = dict(row.get("metadata") or {})
        metadata["relationEvidence"] = {
            "verified": True,
            "source": "institution_metadata",
        }
        row = {**row, "metadata": metadata}
    return {
        "status": 200,
        "headers": {
            "cache-control": "public, max-age=0, s-maxage=86400",
            "etag": 'W/"public-search-test"',
            "x-paillette-search-cache": "MISS",
        },
        "json": {
            "success": True,
            "data": {
                "results": [row],
                "count": 1,
                "queryTime": 1,
                "interpretation": interpretation,
            },
            "meta": {
                "search": {"cacheable": True, "degradedChannels": []}
            },
        },
    }


def deployment_identity(snapshot="candidate", git_sha="a" * 40):
    identity = {
        "schemaVersion": "nga-deployment-identity-v1",
        "snapshot": snapshot,
        "capturedAt": "2026-08-22T00:00:00Z",
        "api": {
            "origin": "https://paillette-api-stg.berlayar.ai",
            "deploymentId": "api-deployment",
            "versionId": "api-version",
            "gitSha": git_sha,
            "apiVersion": "v1",
            "parserVersion": "nga-v7" if snapshot == "candidate" else "nga-v4",
            "planVersion": "nga-plan-v2" if snapshot == "candidate" else "unversioned",
            "resultCacheVersion": "v8" if snapshot == "candidate" else "v5",
        },
        "web": {
            "origin": "https://paillette-stg.berlayar.ai",
            "deploymentId": "web-deployment",
            "versionId": "web-version",
            "gitSha": git_sha,
            "contractVersion": "29" if snapshot == "candidate" else "26",
        },
    }
    if snapshot == "candidate":
        identity["artistDataBinding"] = {
            "schemaVersion": "nga-artist-data-binding-v1",
            "backfillManifestSha256": "1" * 64,
            "mapping": {"count": 63253, "sha256": "2" * 64},
            "vectorValues": {
                "count": 63253,
                "hashesSha256": "3" * 64,
                "originalSha256": "4" * 64,
                "enrichedSha256": "4" * 64,
                "preserved": True,
            },
            "productionIdentity": {
                "beforeSha256": "5" * 64,
                "afterSha256": "5" * 64,
            },
        }
    return identity


def parse_with_exact_local_v5(cases):
    script = """
import { readFileSync } from 'node:fs';
import { parseNgaSearchIntent } from './apps/api/src/utils/nga-search-intent.ts';
const cases = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(cases.map((item) => ({
  id: item.id,
  interpretation: parseNgaSearchIntent(item.query, item.request?.constraints),
}))));
"""
    completed = subprocess.run(
        [
            "node",
            "node_modules/.pnpm/tsx@4.23.1/node_modules/tsx/dist/cli.mjs",
            "-e",
            script,
        ],
        cwd=ROOT,
        input=json.dumps(cases),
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


PILOT_TEXT_IDS = [
    "relation-active-depicts",
    "relation-passive-depicts",
    "classification-list",
    "combined-oil-ships-date",
]
PILOT_IMAGE_IDS = ["image-pilot-painting-date"]
PILOT_RELATION_IDS = [
    "relation-active-depicts",
    "relation-passive-depicts",
]
PLAYWRIGHT_SCREENSHOTS = [
    "01-image-pre-upload.png",
    "02-text-owned-image-editor.png",
    "03-image-owner-local-palette.png",
    "04-live-same-name.png",
    "05-controlled-replacement-ownership.png",
    "06-invalid-upload-preserves-results.png",
    "08-direct-artist-attribution.png",
    "09-derived-verified-empty.png",
    "07-ngs-locked.png",
]
PLAYWRIGHT_TITLES = [
    "pre-upload Image is compact, accessible, truthful, and passive",
    "Text remains the truthful result owner while Image is only being edited",
    "constrained Image becomes owner and Palette order stays local",
    "separate live same-filename image requests execute distinctly",
    "controlled out-of-order image responses keep replacement result ownership",
    "invalid uploads preserve prior results and expose an alert",
    "direct artist attribution returns the pinned primary-artist fixture",
    "derived relation empty state reports unverified catalogue evidence",
    "NGS stays visibly locked and sends no public-search request",
]
PLAYWRIGHT_IDS = [
    "d1c3b58c6b8000469ec5-199dd5869c1d0ade8048",
    "d1c3b58c6b8000469ec5-49ba2302c2b118fbe2f3",
    "d1c3b58c6b8000469ec5-4350d3d8f1f78314881d",
    "d1c3b58c6b8000469ec5-5aeb23a432ab4df1c50c",
    "d1c3b58c6b8000469ec5-1788ccaa5c6cbf7ba7ef",
    "d1c3b58c6b8000469ec5-b87deb1a9d50a0245a51",
    "d1c3b58c6b8000469ec5-0f940651da0b878f8942",
    "d1c3b58c6b8000469ec5-9d59bbae641205ec3b17",
    "d1c3b58c6b8000469ec5-00841a90e29eb411d3b7",
]
PLAYWRIGHT_ARTIFACT_DIRECTORIES = [
    "nga-staging-gate-anonymous-9984a-ssible-truthful-and-passive-nga-staging-chrome",
    "nga-staging-gate-anonymous-356fc--Image-is-only-being-edited-nga-staging-chrome",
    "nga-staging-gate-anonymous-5db73-d-Palette-order-stays-local-nga-staging-chrome",
    "nga-staging-gate-anonymous-60fa1-requests-execute-distinctly-nga-staging-chrome",
    "nga-staging-gate-anonymous-9934e-eplacement-result-ownership-nga-staging-chrome",
    "nga-staging-gate-anonymous-f48c0-results-and-expose-an-alert-nga-staging-chrome",
    "nga-staging-gate-anonymous-9855a-nned-primary-artist-fixture-nga-staging-chrome",
    "nga-staging-gate-anonymous-6806a-verified-catalogue-evidence-nga-staging-chrome",
    "nga-staging-gate-anonymous-9b265-ds-no-public-search-request-nga-staging-chrome",
]
PLAYWRIGHT_PROJECT = "nga-staging-chrome"


def evidence_response(payload, url, *, status=200, headers=None):
    body = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return {
        "requestUrl": url,
        "finalUrl": url,
        "status": status,
        "elapsedMs": 1,
        "headers": headers or {},
        "json": payload,
        "jsonByteLength": len(body),
        "jsonSha256": hashlib.sha256(body).hexdigest(),
        "bodyLength": len(body),
        "bodySha256": hashlib.sha256(body).hexdigest(),
    }


def refresh_response_digest(response):
    body = json.dumps(
        response["json"],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    response["bodyLength"] = len(body)
    response["bodySha256"] = hashlib.sha256(body).hexdigest()
    response["jsonByteLength"] = len(body)
    response["jsonSha256"] = hashlib.sha256(body).hexdigest()


def json_mutate(path, mutation):
    document = json.loads(path.read_text(encoding="utf-8"))
    mutation(document)
    path.write_text(json.dumps(document) + "\n", encoding="utf-8")


def evidence_row(case, *, artwork_id="open-access-art:nga:32679"):
    constraints = case.get("expected", {}).get(
        "constraints", case.get("constraints", {})
    )
    row = passing_row(id=artwork_id)
    metadata = dict(row["metadata"])
    date_range = constraints.get("dateRange")
    if date_range:
        year = date_range["startYear"]
        row["year"] = year
        metadata.update(dateText=str(year), yearStart=year, yearEnd=year)
    classifications = constraints.get("classifications")
    if classifications:
        metadata["visualClassification"] = classifications[0]
    media = constraints.get("mediumFamilies")
    if media:
        metadata.update(mediumFamily=media[0], medium=media[0])
    artist_ids = constraints.get("artistIds")
    if artist_ids:
        metadata["primaryArtistId"] = artist_ids[0]
    expected = case.get("expected", {})
    relation = expected.get("relation")
    if relation:
        metadata["relationEvidence"] = {
            "verified": True,
            "source": "institution_metadata",
        }
    if expected.get("attribution"):
        attribution = expected["attribution"]
        relationship = attribution["relationship"]
        role = {
            "direct": "artist",
            "after": "after",
            "attributed_to": "attributed to",
            "workshop_of": "workshop of",
            "studio_of": "studio of",
            "circle_of": "circle of",
            "school_of": "school of",
            "follower_of": "follower of",
        }[relationship]
        constituent_id = "1364" if relationship == "direct" else "9999"
        if relationship == "direct":
            metadata["primaryArtistId"] = constituent_id
        metadata["ngaArtists"] = {
            "relationships": [
                {
                    "constituentId": constituent_id,
                    "displayOrder": 1,
                    "roleType": "artist",
                    "role": role,
                    "prefix": None,
                    "suffix": None,
                    "preferredDisplayName": attribution["targetText"],
                    "forwardDisplayName": attribution["targetText"],
                    "alternativeNames": [],
                }
            ]
        }
        metadata["relationEvidence"] = {
            "verified": True,
            "source": "catalogue_artist",
        }
    row["metadata"] = metadata
    return row


def text_evidence_response(case, parser_version, url):
    expected = case.get("expected", {})
    constraints = expected.get("constraints", {})
    rows = (
        []
        if case.get("expectedZeroResults") is True
        or case.get("expectedVerifiedEmpty") is True
        else [evidence_row(case)]
    )
    interpretation = {
        "parserVersion": parser_version,
        "originalQuery": case["query"],
        "semanticQuery": expected.get("semanticQuery", case["query"]),
        "constraints": constraints,
        "corrections": [],
        "unresolved": (
            [case["query"]] if expected.get("unresolved") is True else []
        ),
    }
    if "relation" in expected:
        interpretation["relation"] = expected["relation"]
        relation = expected["relation"]
        if relation:
            interpretation["relationEvidence"] = {
                "policy": (
                    "catalogue_derivation"
                    if relation["kind"] == "derived_from"
                    else "visible_subject"
                ),
                "status": "verified" if rows else "unverified",
            }
    if "attribution" in expected:
        interpretation["attribution"] = expected["attribution"]
    payload = {
        "success": True,
        "data": {
            "results": rows,
            "count": len(rows),
            "queryTime": 1,
            "interpretation": interpretation,
        },
        "meta": {"search": {"cacheable": True, "degradedChannels": []}},
    }
    return evidence_response(
        payload,
        url,
        headers={
            "cache-control": "public, max-age=0, s-maxage=86400",
            "etag": f'W/"{case["id"]}"',
            "x-paillette-search-cache": "MISS",
        },
    )


def png_evidence(width=640, height=480):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    scanlines = b"".join(
        b"\x00"
        + bytes(
            component
            for x in range(width)
            for component in ((x + y) % 256, (x * 3 + y) % 256, (x + y * 5) % 256)
        )
        for y in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines, 6))
        + chunk(b"IEND", b"")
    )


def trace_evidence(index):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "test.trace",
            json.dumps(
                {
                    "version": 8,
                    "type": "context-options",
                    "origin": "testRunner",
                    "browserName": "chromium",
                    "platform": "darwin",
                    "sdkLanguage": "javascript",
                    "testIndex": index,
                }
            )
            + "\n",
        )
    return output.getvalue()


def playwright_artifact_dir(root: Path, index: int) -> Path:
    return (
        root
        / "playwright"
        / "playwright-artifacts"
        / PLAYWRIGHT_ARTIFACT_DIRECTORIES[index]
    )


def playwright_screenshot_path(root: Path, index: int) -> Path:
    paths = list((playwright_artifact_dir(root, index) / "attachments").glob("*.png"))
    if len(paths) != 1:
        raise AssertionError(f"expected one screenshot for Playwright test {index}")
    return paths[0]


def make_complete_evidence_bundle(
    gate,
    root: Path,
    *,
    phase="pilot",
    snapshot="candidate",
    evaluator_sha="a" * 40,
    run_id="0123456789abcdef0123456789abcdef",
):
    inventory = gate.load_case_inventory(
        ROOT / "eval" / "nga-staging-cases.yaml",
        ROOT / "eval" / "nga-constraint-queries.yaml",
    )
    selected = gate.select_cases(inventory, phase)
    text_ids = [case["id"] for case in selected["text"]]
    image_ids = [case["id"] for case in selected["image"]]
    manual_case_ids = [
        case["id"] for case in selected["text"] if case.get("manualGradeTop")
    ]
    deployed_identity = deployment_identity(snapshot, evaluator_sha)
    deployment_hash = gate.sha256_json(deployed_identity)
    deployment_binding = gate.evaluate_deployment_binding(
        deployed_identity,
        snapshot=snapshot,
        evaluator_git_sha=evaluator_sha,
    )
    parser_version = deployment_binding["deployedVersions"]["parser"]
    binding = {
        "runId": run_id,
        "snapshot": snapshot,
        "evaluatorGitSha": evaluator_sha,
        "deploymentIdentityHash": deployment_hash,
    }
    manual_templates = [
        {
            "caseId": case_id,
            "status": "manual_review_required",
            "instructions": (
                "Assign each relevance field an integer 0-3; do not infer it from "
                "similarity. Grades 2-3 are strong; grade 1 is weak and cannot "
                "satisfy the strong-result gate."
            ),
            "results": [
                {
                    "rank": 1,
                    "id": "open-access-art:nga:32679",
                    "title": "Allegory of Painting",
                    "artist": "François Boucher",
                    "relevance": None,
                }
            ],
        }
        for case_id in manual_case_ids
    ]
    labels = {
        "schemaVersion": "nga-relevance-labels-v1",
        "gradedAt": "2026-08-22T00:00:00Z",
        "reviewer": "release-reviewer",
        "cases": [
            {
                "caseId": case_id,
                "results": [
                    {"id": "open-access-art:nga:32679", "relevance": 3}
                ],
            }
            for case_id in manual_case_ids
        ],
    }
    manual = gate.summarize_manual_relevance(manual_templates, labels)
    identity = {
        **binding,
        "generatedAt": "2026-08-22T00:00:00Z",
        "phase": phase,
        "deploymentIdentity": deployed_identity,
        "deploymentBinding": deployment_binding,
    }
    summary = {
        **binding,
        "generatedAt": "2026-08-22T00:01:00Z",
        "phase": phase,
        "caseCounts": selected["counts"],
        "text": {"selected": len(text_ids), "passed": len(text_ids)},
        "image": {"selected": len(image_ids), "passed": len(image_ids)},
        "manualRelevance": manual,
        "gatePassed": True,
        "failureCount": 0,
        "gateFailures": [],
    }
    case_inventory = {
        "counts": selected["counts"],
        "textCaseIds": text_ids,
        "imageCaseIds": image_ids,
    }
    completed = datetime(2026, 8, 22, tzinfo=timezone.utc)
    handoff = {
        **binding,
        "schemaVersion": "nga-playwright-handoff-v1",
        "phase": phase,
        "pythonCompletedAt": completed.isoformat().replace("+00:00", "Z"),
        "playwrightNotBefore": (completed + timedelta(seconds=60))
        .isoformat()
        .replace("+00:00", "Z"),
        "cooldownSeconds": 60,
        "browserPublicSearchRequestBudget": 8,
        "expectedTestCount": 9,
    }
    summary["playwrightHandoff"] = handoff
    root.mkdir(parents=True, exist_ok=True)
    documents = {
        "identity.json": identity,
        "summary.json": summary,
        "case-inventory.json": case_inventory,
        "fixtures-manifest.json": {"fixtures": []},
        "manual-relevance.json": {
            **binding,
            "summary": manual,
            "evaluation": gate.evaluate_manual_relevance_completion(
                manual, snapshot
            ),
            "cases": manual_templates,
        },
        "relevance-labels.json": gate.retain_relevance_labels(
            binding=binding,
            templates=manual_templates,
            labels_document=labels,
        ),
        "playwright-handoff.json": handoff,
    }

    text_endpoint = "https://paillette-stg.berlayar.ai/api/public-search/nga/text"
    for case in selected["text"]:
        response = text_evidence_response(case, parser_version, text_endpoint)
        documents[f"raw/text/{case['id'].replace(':', '_')}.json"] = {
            **binding,
            "case": case,
            "request": {
                "url": text_endpoint,
                "method": "POST",
                "body": gate._text_request_body(case),
                "identity": gate.canonical_text_identity(case),
            },
            "response": response,
            "evaluation": gate.evaluate_text_case(
                case, response, deployment_binding["deployedVersions"]
            ),
        }

    cache_case = {
        "id": "cache-probe",
        "query": "validation 0123456789ab oil paintings after 1700 before 1800",
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
    first_cache = text_evidence_response(cache_case, parser_version, text_endpoint)
    repeat_cache = json.loads(json.dumps(first_cache))
    repeat_cache["headers"]["x-paillette-search-cache"] = "HIT"
    changed_cache = text_evidence_response(
        changed_cache_case, parser_version, text_endpoint
    )
    first_identity = gate.canonical_text_identity(cache_case)
    changed_identity = gate.canonical_text_identity(changed_cache_case)
    documents["raw/cache-probe.json"] = {
        **binding,
        "query": cache_case["query"],
        "firstRequest": gate._text_request_body(cache_case),
        "repeatRequest": gate._text_request_body(cache_case),
        "changedRequest": gate._text_request_body(changed_cache_case),
        "firstIdentity": first_identity,
        "changedIdentity": changed_identity,
        "first": first_cache,
        "repeat": repeat_cache,
        "changed": changed_cache,
        "evaluation": gate.evaluate_text_cache_probe(
            first_cache,
            repeat_cache,
            changed_cache,
            first_identity=first_identity,
            changed_identity=changed_identity,
            snapshot=snapshot,
        ),
    }

    fixture_document = json.loads(
        (ROOT / "eval/nga-image-fixtures.json").read_text(encoding="utf-8")
    )
    fixtures = {
        fixture["artworkId"]: fixture for fixture in fixture_document["fixtures"]
    }
    documents["fixtures-manifest.json"] = {
        "fixtures": [
            fixtures[fixture_id]
            for fixture_id in sorted(
                {case["fixtureId"] for case in selected["image"]}
            )
        ],
        "note": "Full image bytes were verified in memory and were not written to evidence.",
    }
    image_endpoint = "https://paillette-stg.berlayar.ai/api/public-search/nga/image"
    first_image_response = None
    first_image_request = None
    first_image_case = selected["image"][0]
    for case in selected["image"]:
        fixture = fixtures[case["fixtureId"]]
        target_policy = (case.get("targetExpectation") or {}).get("policy")
        artwork_id = (
            "open-access-art:nga:eligible-neighbor"
            if target_policy == "excluded"
            else fixture["artworkId"]
        )
        row = evidence_row(case, artwork_id=artwork_id)
        response = evidence_response(
            {"success": True, "data": {"results": [row], "count": 1, "queryTime": 1}},
            image_endpoint,
            headers={"cache-control": "no-store"},
        )
        identity_value = gate.sha256_json(
            {
                "version": "public-image-search-v1",
                "contractVersion": gate.EXPECTED_VERSIONS["contract"],
                "mode": "image",
                "orgId": "nga",
                "imageDigest": fixture["sha256"],
                "constraints": gate.normalize_constraints(case.get("constraints")) or None,
                "topK": 30,
                "minScore": 0.0,
            }
        )
        request = {
            "url": image_endpoint,
            "method": "POST",
            "filename": case["filename"],
            "mimeType": fixture["mimeType"],
            "byteLength": fixture["byteLength"],
            "sha256": fixture["sha256"],
            "constraints": gate.normalize_constraints(case.get("constraints")),
            "topK": 30,
            "minScore": 0,
            "identity": identity_value,
        }
        documents[f"raw/image/{case['id']}.json"] = {
            **binding,
            "case": case,
            "request": request,
            "response": response,
            "evaluation": gate.evaluate_image_case(case, response),
        }
        if case is first_image_case:
            first_image_response = response
            first_image_request = request

    changed_image_sha = "f" * 64
    changed_constraints = {"classifications": ["Drawing"]}
    identity_inputs = {
        "stable_first": first_image_request["identity"],
        "stable_repeat": first_image_request["identity"],
        "same_name_first": first_image_request["identity"],
        "same_name_changed": gate.canonical_image_identity_from_digest(
            changed_image_sha, first_image_case.get("constraints"), 30, 0
        ),
        "constraint_first": first_image_request["identity"],
        "constraint_changed": gate.canonical_image_identity_from_digest(
            first_image_request["sha256"], changed_constraints, 30, 0
        ),
    }
    repeat_evaluation = gate.evaluate_image_response(
        first_image_response, first_image_case.get("constraints")
    )
    documents["raw/image-identity-probe.json"] = {
        **binding,
        "request": first_image_request,
        "identityInputs": identity_inputs,
        "sameNameChangedSha256": changed_image_sha,
        "changedConstraints": changed_constraints,
        "stableIdentity": first_image_request["identity"],
        "repeat": {
            "response": first_image_response,
            "evaluation": repeat_evaluation,
        },
        "identityEvaluation": gate.evaluate_image_identity_probe(
            **identity_inputs
        ),
    }

    invalid_messages = {
        "invalid_mime": "Image must be a JPEG, PNG, or WebP file.",
        "zero_byte": "Image must not be empty.",
        "multiple_files": "Exactly one image file is required.",
        "oversize": "Image must be 10 MB or smaller.",
    }
    if phase == "full":
        negative_responses = {
            name: evidence_response(
                {
                    "success": False,
                    "error": {"code": "INVALID_INPUT", "message": message},
                },
                image_endpoint,
                status=400,
                headers={"cache-control": "no-store"},
            )
            for name, message in invalid_messages.items()
        }
        documents["raw/image-negative-probes.json"] = {
            **binding,
            "responses": negative_responses,
            "evaluation": gate.evaluate_negative_image_probes(negative_responses),
        }

    ngs_url = "https://paillette-stg.berlayar.ai/api/public-search/ngs/text"
    ngs_response = evidence_response(
        {
            "success": False,
            "error": {"code": "PUBLIC_SEARCH_SCOPE_FORBIDDEN", "message": "locked"},
        },
        ngs_url,
        status=403,
        headers={"cache-control": "no-store"},
    )
    documents["raw/ngs-probe.json"] = {
        **binding,
        "request": {
            "url": ngs_url,
            "method": "POST",
            "body": {"query": "paintings", "topK": 30, "minScore": 0},
        },
        "response": ngs_response,
        "evaluation": gate.evaluate_ngs_probe(ngs_response),
    }
    for relative, document in documents.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document) + "\n", encoding="utf-8")
    (root / "summary.md").write_text("# complete evidence\n", encoding="utf-8")

    playwright = root / "playwright"
    artifacts = playwright / "playwright-artifacts"
    artifacts.mkdir(parents=True)
    handoff_bytes = (root / "playwright-handoff.json").read_bytes()
    result_attachments = []
    for index, screenshot_name in enumerate(PLAYWRIGHT_SCREENSHOTS):
        artifact_dir = playwright_artifact_dir(root, index)
        artifact_dir.mkdir()
        attachment_dir = artifact_dir / "attachments"
        attachment_dir.mkdir()
        screenshot_path = (
            attachment_dir
            / f"{screenshot_name.replace('.', '-')}-{index:040x}.png"
        )
        trace_path = artifact_dir / "trace.zip"
        screenshot_path.write_bytes(png_evidence())
        trace_path.write_bytes(trace_evidence(index))
        result_attachments.append(
            [
                {
                    "name": screenshot_name,
                    "contentType": "image/png",
                    "path": str(screenshot_path.resolve()),
                },
                {
                    "name": "trace",
                    "contentType": "application/zip",
                    "path": str(trace_path.resolve()),
                },
            ]
        )
    report = {
        "config": {
            "metadata": {
                "ngaStagingRun": handoff,
                "bindingSha256": hashlib.sha256(handoff_bytes).hexdigest(),
            },
            "projects": [{"name": PLAYWRIGHT_PROJECT}],
        },
        "suites": [
            {
                "title": "nga-staging-gate.spec.ts",
                "file": "nga-staging-gate.spec.ts",
                "specs": [
                    {
                        "id": PLAYWRIGHT_IDS[index],
                        "title": title,
                        "ok": True,
                        "tests": [
                            {
                                "expectedStatus": "passed",
                                "status": "expected",
                                "projectName": PLAYWRIGHT_PROJECT,
                                "results": [
                                    {
                                        "workerIndex": 0,
                                        "parallelIndex": 0,
                                        "status": "passed",
                                        "duration": 100,
                                        "errors": [],
                                        "stdout": [],
                                        "stderr": [],
                                        "retry": 0,
                                        "startTime": "2026-08-22T00:02:00.000Z",
                                        "annotations": [],
                                        "attachments": result_attachments[index],
                                    }
                                ],
                            }
                        ],
                    }
                    for index, title in enumerate(PLAYWRIGHT_TITLES)
                ],
            }
        ],
        "stats": {
            "expected": 9,
            "skipped": 0,
            "unexpected": 0,
            "flaky": 0,
        },
    }
    (playwright / "playwright-report.json").write_text(
        json.dumps(report) + "\n", encoding="utf-8"
    )
    (artifacts / ".last-run.json").write_text(
        json.dumps({"status": "passed", "failedTests": []}) + "\n",
        encoding="utf-8",
    )
    return gate.rehash_evidence(root)


class GateTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.gate = load_gate()
            cls.load_error = None
        except AssertionError as error:
            cls.gate = None
            cls.load_error = str(error)

    def setUp(self):
        if self.gate is None:
            self.fail(self.load_error or "evaluator failed to load")

    def call(self, name, *args, **kwargs):
        self.assertTrue(hasattr(self.gate, name), f"missing {name}")
        return getattr(self.gate, name)(*args, **kwargs)


class HostAndEnvironmentTests(GateTestCase):
    def test_run_start_rejects_preexisting_output_and_generates_random_nonce(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = self.call("start_evidence_run", root / "first")
            second = self.call("start_evidence_run", root / "second")
            self.assertRegex(first, r"^[a-f0-9]{32}$")
            self.assertRegex(second, r"^[a-f0-9]{32}$")
            self.assertNotEqual(first, second)

            with self.assertRaises(self.gate.GateStopped):
                self.call("start_evidence_run", root / "first")

            existing = root / "existing"
            existing.mkdir()

            class Transport:
                def request(self, *_args, **_kwargs):
                    raise AssertionError("network must not be reached")

            identity_path = root / "deployment.json"
            identity_path.write_text(
                json.dumps(
                    deployment_identity(
                        snapshot="baseline", git_sha="b" * 40
                    )
                ),
                encoding="utf-8",
            )
            with self.assertRaises(self.gate.GateStopped):
                self.gate.run_gate(
                    self.gate.RunConfig(
                        phase="pilot",
                        snapshot="baseline",
                        api_base_url="https://paillette-api-stg.berlayar.ai",
                        web_base_url="https://paillette-stg.berlayar.ai",
                        out_dir=existing,
                        deployment_identity=identity_path,
                        fail_on_gates=False,
                        repo_root=ROOT,
                    ),
                    Transport(),
                )

    def test_only_exact_staging_origins_are_accepted(self):
        self.call(
            "validate_staging_origins",
            "https://paillette-api-stg.berlayar.ai",
            "https://paillette-stg.berlayar.ai",
        )

    def test_deceptive_or_non_origin_urls_fail_before_transport_is_created(self):
        invalid = [
            "http://paillette-api-stg.berlayar.ai",
            "https://paillette-api-stg.berlayar.ai.evil.test",
            "https://evil.test/paillette-api-stg.berlayar.ai",
            "https://user@paillette-api-stg.berlayar.ai",
            "https://paillette-api-stg.berlayar.ai:443",
            "https://paillette-api-stg.berlayar.ai/",
            "https://paillette-api-stg.berlayar.ai?x=1",
            "https://paillette-api-stg.berlayar.ai#x",
        ]
        for api_url in invalid:
            with self.subTest(api_url=api_url):
                with self.assertRaises(ValueError):
                    self.call(
                        "validate_staging_origins",
                        api_url,
                        "https://paillette-stg.berlayar.ai",
                    )

    def test_wrong_health_environment_stops_before_search(self):
        class Transport:
            def __init__(self):
                self.calls = []

            def request(self, method, url, **_kwargs):
                self.calls.append((method, url))
                return {
                    "status": 200,
                    "headers": {"content-type": "application/json"},
                    "json": {
                        "status": "healthy",
                        "environment": "production",
                    },
                }

        transport = Transport()
        with self.assertRaises(self.gate.GateStopped):
            self.call(
                "verify_staging_health",
                transport,
                "https://paillette-api-stg.berlayar.ai",
            )
        self.assertEqual(
            transport.calls,
            [("GET", "https://paillette-api-stg.berlayar.ai/health")],
        )

    def test_health_and_web_evidence_record_exact_final_endpoints(self):
        class Transport:
            def request(self, _method, url, **_kwargs):
                if url.endswith("/health"):
                    payload = {"status": "healthy", "environment": "staging"}
                    body = json.dumps(payload).encode()
                else:
                    payload = None
                    body = (
                        b'<link href="/search-spotlights/nga/v28-'
                        + (b"a" * 64)
                        + b'.json">'
                    )
                return {
                    "requestUrl": url,
                    "finalUrl": url,
                    "status": 200,
                    "headers": {},
                    "json": payload,
                    "body": body,
                    "elapsedMs": 1,
                }

        transport = Transport()
        health = self.call(
            "verify_staging_health",
            transport,
            "https://paillette-api-stg.berlayar.ai",
        )
        web = self.call(
            "_observe_web_contract",
            transport,
            "https://paillette-stg.berlayar.ai",
        )
        self.assertEqual(
            health["requestUrl"],
            "https://paillette-api-stg.berlayar.ai/health",
        )
        self.assertEqual(health["finalUrl"], health["requestUrl"])
        self.assertEqual(
            web["requestUrl"], "https://paillette-stg.berlayar.ai/nga/search"
        )
        self.assertEqual(web["finalUrl"], web["requestUrl"])

    def test_transport_blocks_same_and_cross_origin_redirects(self):
        target_hits = []

        class TargetHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                target_hits.append(self.path)
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"followed")

            def log_message(self, *_args):
                pass

        target = http.server.ThreadingHTTPServer(("127.0.0.1", 0), TargetHandler)
        target_thread = threading.Thread(target=target.serve_forever, daemon=True)
        target_thread.start()

        class RedirectHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                if self.path == "/same":
                    self.send_header("Location", "/same-target")
                else:
                    self.send_header(
                        "Location",
                        f"http://127.0.0.1:{target.server_port}/cross-target",
                    )
                self.end_headers()

            def log_message(self, *_args):
                pass

        redirect = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), RedirectHandler
        )
        redirect_thread = threading.Thread(
            target=redirect.serve_forever, daemon=True
        )
        redirect_thread.start()
        try:
            transport = self.gate.UrllibTransport()
            for path in ("same", "cross"):
                with self.subTest(path=path), self.assertRaises(
                    self.gate.GateStopped
                ):
                    transport.request(
                        "GET", f"http://127.0.0.1:{redirect.server_port}/{path}"
                    )
            self.assertEqual(target_hits, [])
        finally:
            redirect.shutdown()
            target.shutdown()
            redirect.server_close()
            target.server_close()

    def test_transport_identifies_live_evaluator_and_preserves_request_headers(self):
        observed = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                observed.update(
                    {key.lower(): value for key, value in self.headers.items()}
                )
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')

            def log_message(self, *_args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            response = self.gate.UrllibTransport().request(
                "GET",
                f"http://127.0.0.1:{server.server_port}/health",
                headers={"X-Evaluation-Run": "bound"},
            )
        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual(response["status"], 200)
        self.assertEqual(
            observed.get("user-agent"), "Paillette-NGA-Staging-Gate/1.0"
        )
        self.assertIn("application/json", observed.get("accept", ""))
        self.assertEqual(observed.get("x-evaluation-run"), "bound")

    def test_live_contract_version_is_read_from_the_preload_link_header(self):
        versions = self.call(
            "extract_web_contract_versions",
            {
                "headers": {
                    "link": '</search-spotlights/nga/v28-'
                    + ('a' * 64)
                    + '.json>; rel=preload; as=fetch'
                },
                "body": b"<html></html>",
            },
        )
        self.assertEqual(versions, ["28"])

    def test_candidate_requires_exact_task7_deployment_binding(self):
        evaluator_sha = "a" * 40
        exact = self.call(
            "evaluate_deployment_binding",
            deployment_identity(git_sha=evaluator_sha),
            snapshot="candidate",
            evaluator_git_sha=evaluator_sha,
        )
        self.assertEqual(exact["failureCodes"], [])

        wrong_sha = deployment_identity(git_sha="b" * 40)
        mismatch = self.call(
            "evaluate_deployment_binding",
            wrong_sha,
            snapshot="candidate",
            evaluator_git_sha=evaluator_sha,
        )
        self.assertIn("deployment_git_sha_mismatch", mismatch["failureCodes"])

        incomplete = deployment_identity(git_sha=evaluator_sha)
        incomplete["api"].pop("versionId")
        missing = self.call(
            "evaluate_deployment_binding",
            incomplete,
            snapshot="candidate",
            evaluator_git_sha=evaluator_sha,
        )
        self.assertIn("deployment_identity_incomplete", missing["failureCodes"])

    def test_baseline_identity_is_attributed_without_candidate_version_claims(self):
        baseline = deployment_identity(snapshot="baseline", git_sha="b" * 40)
        result = self.call(
            "evaluate_deployment_binding",
            baseline,
            snapshot="baseline",
            evaluator_git_sha="a" * 40,
        )
        self.assertEqual(result["failureCodes"], [])
        self.assertEqual(result["deployedVersions"]["parser"], "nga-v4")
        self.assertEqual(result["deployedVersions"]["apiResultCache"], "v5")

    def test_live_web_contract_must_match_task7_deployment_identity(self):
        exact = self.call("evaluate_live_contract_binding", ["26"], "26")
        mismatch = self.call("evaluate_live_contract_binding", ["26"], "28")
        missing = self.call("evaluate_live_contract_binding", [], "28")
        ambiguous = self.call(
            "evaluate_live_contract_binding", ["26", "28"], "28"
        )
        self.assertEqual(exact["failureCodes"], [])
        self.assertIn("live_contract_mismatch", mismatch["failureCodes"])
        self.assertIn("live_contract_unobserved", missing["failureCodes"])
        self.assertIn("live_contract_ambiguous", ambiguous["failureCodes"])

    def test_cli_requires_task7_deployment_identity_file(self):
        arguments = [
            "--phase",
            "pilot",
            "--snapshot",
            "candidate",
            "--api-base-url",
            "https://paillette-api-stg.berlayar.ai",
            "--web-base-url",
            "https://paillette-stg.berlayar.ai",
            "--out-dir",
            "/tmp/nga-gate-evidence",
        ]
        with self.assertRaises(SystemExit):
            self.gate.build_parser().parse_args(arguments)
        parsed = self.gate.build_parser().parse_args(
            [*arguments, "--deployment-identity", "/tmp/deployment.json"]
        )
        self.assertEqual(parsed.deployment_identity, Path("/tmp/deployment.json"))

    def test_candidate_binding_failure_stops_before_network(self):
        class Transport:
            def __init__(self):
                self.calls = []

            def request(self, *_args, **_kwargs):
                self.calls.append((_args, _kwargs))
                raise AssertionError("network must not be reached")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identity_path = root / "deployment.json"
            identity_path.write_text(
                json.dumps(deployment_identity(git_sha="b" * 40)),
                encoding="utf-8",
            )
            transport = Transport()
            with self.assertRaises(self.gate.GateStopped):
                self.gate.run_gate(
                    self.gate.RunConfig(
                        phase="pilot",
                        snapshot="candidate",
                        api_base_url="https://paillette-api-stg.berlayar.ai",
                        web_base_url="https://paillette-stg.berlayar.ai",
                        out_dir=root / "evidence",
                        deployment_identity=identity_path,
                        fail_on_gates=True,
                        repo_root=ROOT,
                    ),
                    transport,
                )
            self.assertEqual(transport.calls, [])

    def test_full_candidate_requires_reviewed_pilot_before_network(self):
        class Transport:
            def __init__(self):
                self.calls = []

            def request(self, *_args, **_kwargs):
                self.calls.append((_args, _kwargs))
                raise AssertionError("network must not be reached")

        evaluator_sha = self.gate._git_sha(ROOT)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            identity_path = root / "deployment.json"
            identity_path.write_text(
                json.dumps(deployment_identity(git_sha=evaluator_sha)),
                encoding="utf-8",
            )
            transport = Transport()
            with self.assertRaises(self.gate.GateStopped):
                self.gate.run_gate(
                    self.gate.RunConfig(
                        phase="full",
                        snapshot="candidate",
                        api_base_url="https://paillette-api-stg.berlayar.ai",
                        web_base_url="https://paillette-stg.berlayar.ai",
                        out_dir=root / "evidence",
                        deployment_identity=identity_path,
                        relevance_labels=None,
                        pilot_inspection=None,
                        fail_on_gates=True,
                        repo_root=ROOT,
                    ),
                    transport,
                )
            self.assertEqual(transport.calls, [])


class InterpretationAndConstraintTests(GateTestCase):
    def test_relation_direction_mismatch_is_a_gate_failure(self):
        expected_relation = {
            "kind": "depicts",
            "workClassification": "Painting",
            "subjectClassification": "Sculpture",
        }
        response = passing_response(
            relation={
                "kind": "depicts",
                "workClassification": "Sculpture",
                "subjectClassification": "Painting",
            },
            constraints={"classifications": ["Painting"]},
        )
        result = self.call(
            "evaluate_text_case",
            {
                "id": "relation-direction",
                "expected": {
                    "constraints": {"classifications": ["Painting"]},
                    "relation": expected_relation,
                },
            },
            response,
        )
        self.assertIn("relation_direction_mismatch", result["failureCodes"])

    def test_each_hard_constraint_violation_is_identified_from_metadata(self):
        constraints = {
            "dateRange": {"startYear": 1700, "endYear": 1799},
            "classifications": ["Painting"],
            "mediumFamilies": ["oil"],
            "artistIds": ["nga:artist:boucher"],
        }
        mutations = {
            "displayed_date": {"dateText": "c. 1805"},
            "classification": {"visualClassification": "Sculpture"},
            "medium": {"mediumFamily": "bronze", "medium": "bronze"},
            "artist": {"primaryArtistId": "nga:artist:other"},
        }
        for expected_code, metadata_update in mutations.items():
            with self.subTest(expected_code=expected_code):
                row = passing_row()
                row["metadata"] = {**row["metadata"], **metadata_update}
                violations = self.call("inspect_row", row, constraints)
                self.assertIn(
                    expected_code,
                    [violation["constraint"] for violation in violations],
                )

    def test_missing_metadata_cannot_prove_a_hard_constraint(self):
        row = passing_row()
        row["metadata"] = {
            **row["metadata"],
            "dateText": None,
            "yearStart": 1750,
            "yearEnd": 1750,
        }
        violations = self.call(
            "inspect_row",
            row,
            {"dateRange": {"startYear": 1700, "endYear": 1799}},
        )
        self.assertIn("displayed_date", [item["constraint"] for item in violations])

    def test_wrong_org_provider_and_source_are_independent_failures(self):
        mutations = {
            "organization": {"orgId": "another-collection"},
            "provider": {"source": {"provider": "met"}},
            "source": {
                "metadata": {
                    **passing_row()["metadata"],
                    "sourceUrl": "https://evil.test/object/32679",
                }
            },
        }
        for expected_code, update in mutations.items():
            with self.subTest(expected_code=expected_code):
                violations = self.call("inspect_row", passing_row(**update), {})
                self.assertIn(
                    expected_code,
                    [violation["constraint"] for violation in violations],
                )

    def test_logical_id_cannot_replace_missing_physical_org_proof(self):
        row = passing_row()
        row.pop("orgId")
        row.pop("galleryId")
        violations = self.call("inspect_row", row, {})
        self.assertIn("organization", [item["constraint"] for item in violations])

    def test_malformed_source_url_is_a_violation_not_an_evaluator_crash(self):
        row = passing_row()
        row["metadata"] = {
            **row["metadata"],
            "sourceUrl": "https://nga.gov:not-a-port/object",
        }
        violations = self.call("inspect_row", row, {})
        self.assertIn("source", [item["constraint"] for item in violations])

    def test_parser_version_must_match_deployed_identity(self):
        response = passing_response()
        response["json"]["data"]["interpretation"]["parserVersion"] = "nga-v4"
        result = self.call(
            "evaluate_text_case",
            {"id": "version", "expected": {"constraints": {}}},
            response,
            observed_versions={
                "parser": "nga-v6",
                "plan": "nga-plan-v1",
                "contract": "28",
                "apiResultCache": "v7",
            },
        )
        self.assertEqual(
            result["failureCodes"].count("parser_version_mismatch"), 1
        )

    def test_baseline_parser_is_checked_against_deployed_not_local_version(self):
        response = passing_response()
        response["json"]["data"]["interpretation"]["parserVersion"] = "nga-v4"
        result = self.call(
            "evaluate_text_case",
            {"id": "baseline", "expected": {"constraints": {}}},
            response,
            observed_versions={
                "parser": "nga-v4",
                "plan": "unversioned",
                "contract": "26",
                "apiResultCache": "v5",
            },
        )
        self.assertNotIn("parser_version_mismatch", result["failureCodes"])


class ScopeAndCacheTests(GateTestCase):
    def test_text_case_can_require_nonempty_results(self):
        response = passing_response()
        response["json"]["data"]["results"] = []
        response["json"]["data"]["count"] = 0
        result = self.call(
            "evaluate_text_case",
            {
                "id": "expected-nonempty",
                "expected": {"constraints": {}},
                "minimumResults": 1,
            },
            response,
        )
        self.assertIn("minimum_results_not_met", result["failureCodes"])

    def test_minimum_results_declaration_fails_closed_for_text_and_image(self):
        text_response = passing_response()
        image_response = passing_response()
        image_response["headers"]["cache-control"] = "no-store"

        for invalid in ("1", 0, -1, True, 1.5):
            with self.subTest(invalid=invalid):
                text = self.call(
                    "evaluate_text_case",
                    {
                        "id": "invalid-text-minimum",
                        "expected": {"constraints": {}},
                        "minimumResults": invalid,
                    },
                    text_response,
                )
                image = self.call(
                    "evaluate_image_case",
                    {
                        "id": "invalid-image-minimum",
                        "minimumResults": invalid,
                    },
                    image_response,
                )

                self.assertIn("invalid_minimum_results", text["failureCodes"])
                self.assertIn("invalid_minimum_results", image["failureCodes"])

    def test_text_success_requires_strict_shapes_and_cache_evidence(self):
        mutations = {
            "missing data": lambda response: response["json"].pop("data"),
            "results not a list": lambda response: response["json"]["data"].__setitem__(
                "results", {}
            ),
            "count mismatch": lambda response: response["json"]["data"].__setitem__(
                "count", 99
            ),
            "missing meta search": lambda response: response["json"].pop("meta"),
            "cacheable not explicitly true": lambda response: response["json"][
                "meta"
            ]["search"].pop("cacheable"),
            "degraded channels missing": lambda response: response["json"]["meta"][
                "search"
            ].pop("degradedChannels"),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                response = passing_response()
                mutate(response)
                result = self.call(
                    "evaluate_text_case",
                    {"id": "strict", "expected": {"constraints": {}}},
                    response,
                )
                self.assertIn("invalid_text_success_schema", result["failureCodes"])

        for header in ("cache-control", "etag", "x-paillette-search-cache"):
            with self.subTest(header=header):
                response = passing_response()
                response["headers"].pop(header)
                result = self.call(
                    "evaluate_text_case",
                    {"id": "headers", "expected": {"constraints": {}}},
                    response,
                )
                self.assertIn("missing_text_cache_header", result["failureCodes"])

    def test_public_search_pacer_leaves_headroom_below_the_cold_miss_limit(self):
        now = [0.0]
        sleeps = []

        def sleep(seconds):
            sleeps.append(seconds)
            now[0] += seconds

        pacer = self.gate.RequestPacer(
            requests_per_minute=2,
            clock=lambda: now[0],
            sleep=sleep,
        )
        pacer.wait()
        pacer.wait()
        pacer.wait()
        self.assertEqual(sleeps, [60.0])

        self.gate.RequestPacer(requests_per_minute=9)
        with self.assertRaisesRegex(ValueError, "between 1 and 9"):
            self.gate.RequestPacer(requests_per_minute=10)

    def test_ngs_success_is_exposure_and_403_is_denied(self):
        exposed = self.call(
            "evaluate_ngs_probe",
            {"status": 200, "headers": {}, "json": {"success": True}},
        )
        denied = self.call(
            "evaluate_ngs_probe",
            {
                "status": 403,
                "headers": {},
                "json": {
                    "success": False,
                    "error": {"code": "PUBLIC_SEARCH_SCOPE_FORBIDDEN"},
                },
            },
        )
        self.assertIn("ngs_public_search_exposed", exposed["failureCodes"])
        self.assertEqual(denied["failureCodes"], [])

    def test_changed_constraints_cannot_share_cache_identity_or_payload(self):
        first = passing_response()
        first["headers"]["x-paillette-search-cache"] = "MISS"
        repeat = json.loads(json.dumps(first))
        repeat["headers"]["x-paillette-search-cache"] = "HIT"
        changed = json.loads(json.dumps(first))
        result = self.call(
            "evaluate_text_cache_probe",
            first,
            repeat,
            changed,
            first_identity="same",
            changed_identity="same",
            snapshot="candidate",
        )
        self.assertIn("changed_constraint_cache_collision", result["failureCodes"])

    def test_cache_probe_rejects_non_successful_nga_responses(self):
        first = passing_response()
        first["headers"]["x-paillette-search-cache"] = "MISS"
        repeat = json.loads(json.dumps(first))
        repeat["headers"]["x-paillette-search-cache"] = "HIT"
        changed = json.loads(json.dumps(first))
        changed["status"] = 500
        changed["json"] = {"success": False}
        result = self.call(
            "evaluate_text_cache_probe",
            first,
            repeat,
            changed,
            first_identity="first",
            changed_identity="changed",
            snapshot="candidate",
        )
        self.assertIn("cache_probe_request_failed", result["failureCodes"])

    def test_cache_probe_requires_strict_success_schema_and_cache_headers(self):
        mutations = {
            "missing results": lambda response: response["json"]["data"].pop(
                "results"
            ),
            "count mismatch": lambda response: response["json"]["data"].__setitem__(
                "count", 9
            ),
            "missing meta search": lambda response: response["json"].pop("meta"),
            "degraded missing": lambda response: response["json"]["meta"][
                "search"
            ].pop("degradedChannels"),
            "cache control missing": lambda response: response["headers"].pop(
                "cache-control"
            ),
            "etag missing": lambda response: response["headers"].pop("etag"),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                first = passing_response()
                first["headers"]["x-paillette-search-cache"] = "MISS"
                repeat = json.loads(json.dumps(first))
                repeat["headers"]["x-paillette-search-cache"] = "HIT"
                changed = json.loads(json.dumps(first))
                mutate(changed)
                result = self.call(
                    "evaluate_text_cache_probe",
                    first,
                    repeat,
                    changed,
                    first_identity="first",
                    changed_identity="changed",
                    snapshot="candidate",
                )
                self.assertTrue(
                    {
                        "invalid_text_success_schema",
                        "missing_text_cache_header",
                    }
                    & set(result["failureCodes"]),
                    result,
                )

    def test_degraded_cacheable_response_fails_even_when_http_succeeds(self):
        response = passing_response()
        response["json"]["meta"]["search"] = {
            "cacheable": False,
            "degradedChannels": ["caption_embedding"],
        }
        result = self.call(
            "evaluate_text_case",
            {"id": "degraded", "expected": {"constraints": {}}},
            response,
        )
        self.assertIn("degraded_cacheable_text", result["failureCodes"])


class ImageProbeTests(GateTestCase):
    def test_required_image_target_must_be_within_declared_rank(self):
        case = {
            "id": "image-self-compatible",
            "fixtureId": "open-access-art:nga:target",
            "targetExpectation": {"policy": "required", "maxRank": 2},
        }
        first = passing_row()
        first["id"] = "open-access-art:nga:neighbor"
        target = passing_row()
        target["id"] = "open-access-art:nga:target"
        response = passing_response(row=first)
        response["headers"]["cache-control"] = "no-store"
        response["json"]["data"]["results"] = [first, target]
        response["json"]["data"]["count"] = 2

        self.assertEqual(
            self.call("evaluate_image_case", case, response)["failureCodes"], []
        )

        case["targetExpectation"]["maxRank"] = 1
        self.assertIn(
            "required_image_target_rank_not_met",
            self.call("evaluate_image_case", case, response)["failureCodes"],
        )

        response["json"]["data"]["results"] = [first]
        response["json"]["data"]["count"] = 1
        self.assertIn(
            "required_image_target_missing",
            self.call("evaluate_image_case", case, response)["failureCodes"],
        )

    def test_excluded_image_target_must_not_bypass_hard_constraints(self):
        case = {
            "id": "image-incompatible-neighbors",
            "fixtureId": "open-access-art:nga:target",
            "targetExpectation": {"policy": "excluded"},
        }
        target = passing_row()
        target["id"] = "open-access-art:nga:target"
        response = passing_response(row=target)
        response["headers"]["cache-control"] = "no-store"

        self.assertIn(
            "excluded_image_target_returned",
            self.call("evaluate_image_case", case, response)["failureCodes"],
        )

        neighbor = passing_row()
        neighbor["id"] = "open-access-art:nga:neighbor"
        response["json"]["data"]["results"] = [neighbor]
        self.assertEqual(
            self.call("evaluate_image_case", case, response)["failureCodes"], []
        )

    def test_artist_capability_requires_a_positive_matching_row(self):
        case = {
            "id": "image-artist-capability",
            "constraints": {"artistIds": ["1364"]},
            "minimumResults": 1,
            "capabilityFailure": "artist_constraint_capability_unproven",
        }
        empty = passing_response(row=passing_row())
        empty["headers"]["cache-control"] = "no-store"
        empty["json"]["data"]["results"] = []
        empty["json"]["data"]["count"] = 0
        empty_result = self.call("evaluate_image_case", case, empty)
        self.assertIn(
            "artist_constraint_capability_unproven", empty_result["failureCodes"]
        )

        matching_row = passing_row()
        matching_row["metadata"] = {
            **matching_row["metadata"],
            "primaryArtistId": "1364",
        }
        positive = passing_response(row=matching_row)
        positive["headers"]["cache-control"] = "no-store"
        positive_result = self.call("evaluate_image_case", case, positive)
        self.assertEqual(positive_result["failureCodes"], [])

    def test_image_success_requires_data_results_count_and_mapping_rows(self):
        mutations = {
            "missing data": lambda response: response["json"].pop("data"),
            "results not a list": lambda response: response["json"]["data"].__setitem__(
                "results", {}
            ),
            "count mismatch": lambda response: response["json"]["data"].__setitem__(
                "count", 2
            ),
            "row not a mapping": lambda response: response["json"]["data"].__setitem__(
                "results", ["not-a-row"]
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                response = passing_response()
                response["headers"]["cache-control"] = "no-store"
                mutate(response)
                result = self.call("evaluate_image_response", response, {})
                self.assertIn("invalid_image_success_schema", result["failureCodes"])

    def test_image_response_requires_no_store(self):
        response = passing_response()
        response["headers"]["cache-control"] = "public, max-age=60"
        result = self.call("evaluate_image_response", response, {})
        self.assertIn("image_response_cacheable", result["failureCodes"])

    def test_image_identity_uses_bytes_not_filename_and_is_stable(self):
        first = self.call(
            "canonical_image_identity",
            b"first bytes",
            "same.jpg",
            {"classifications": ["Painting"]},
            30,
            0.2,
        )
        renamed = self.call(
            "canonical_image_identity",
            b"first bytes",
            "renamed.jpg",
            {"classifications": ["Painting"]},
            30,
            0.2,
        )
        changed = self.call(
            "canonical_image_identity",
            b"different bytes",
            "same.jpg",
            {"classifications": ["Painting"]},
            30,
            0.2,
        )
        self.assertEqual(first, renamed)
        self.assertNotEqual(first, changed)

    def test_image_probe_detects_same_name_collision_and_stable_byte_drift(self):
        result = self.call(
            "evaluate_image_identity_probe",
            stable_first="one",
            stable_repeat="two",
            same_name_first="collision",
            same_name_changed="collision",
            constraint_first="a",
            constraint_changed="a",
        )
        self.assertEqual(
            set(result["failureCodes"]),
            {
                "stable_image_identity_drift",
                "same_filename_different_bytes_collision",
                "image_constraint_identity_collision",
            },
        )

    def test_negative_image_matrix_rejects_every_invalid_upload(self):
        def rejected(message, status=400):
            return {
                "status": status,
                "headers": {"cache-control": "no-store"},
                "json": {
                    "success": False,
                    "error": {"code": "INVALID_INPUT", "message": message},
                },
            }

        probes = {
            "invalid_mime": rejected("Image must be a JPEG, PNG, or WebP file."),
            "zero_byte": rejected("Image must not be empty."),
            "multiple_files": rejected("Exactly one image file is required."),
            "oversize": rejected("Image must be 10 MB or smaller.", 413),
        }
        self.assertEqual(
            self.call("evaluate_negative_image_probes", probes)["failureCodes"],
            [],
        )
        probes["zero_byte"] = {"status": 200}
        self.assertIn(
            "invalid_image_accepted:zero_byte",
            self.call("evaluate_negative_image_probes", probes)["failureCodes"],
        )

    def test_proxy_oversize_400_requires_safe_invalid_input_body(self):
        def rejected(message):
            return {
                "status": 400,
                "headers": {"cache-control": "no-store"},
                "json": {
                    "success": False,
                    "error": {
                        "code": "INVALID_INPUT",
                        "message": message,
                    },
                },
            }

        valid = {
            "invalid_mime": rejected("Image must be a JPEG, PNG, or WebP file."),
            "zero_byte": rejected("Image must not be empty."),
            "multiple_files": rejected("Exactly one image file is required."),
            "oversize": rejected("Image must be 10 MB or smaller."),
        }
        self.assertEqual(
            self.call("evaluate_negative_image_probes", valid)["failureCodes"],
            [],
        )
        valid["oversize"]["json"] = {"success": False, "error": {}}
        self.assertIn(
            "invalid_image_error_contract:oversize",
            self.call("evaluate_negative_image_probes", valid)["failureCodes"],
        )


class InventoryAndRelevanceTests(GateTestCase):
    def test_weak_only_labels_fail_strong_relevance(self):
        metrics = self.call(
            "compute_relevance_metrics", [1, 1, 1, 1, 1], strong_threshold=2
        )
        self.assertEqual(metrics["strongPrecisionAt5"], 0.0)
        self.assertFalse(
            self.call(
                "evaluate_strong_relevance",
                metrics,
                minimum_strong_results=1,
            )["passed"]
        )

    def test_derived_verified_empty_requires_unverified_catalogue_evidence(self):
        relation = {
            "kind": "derived_from",
            "workClassification": "Drawing",
            "sourceClassification": "Photograph",
        }
        case = {
            "id": "derived-verified-empty",
            "expected": {
                "constraints": {"classifications": ["Drawing"]},
                "relation": relation,
            },
            "expectedVerifiedEmpty": True,
        }
        response = passing_response(
            row=passing_row(),
            relation=relation,
            constraints={"classifications": ["Drawing"]},
        )
        response["json"]["data"]["results"] = []
        response["json"]["data"]["count"] = 0
        response["json"]["data"]["interpretation"]["parserVersion"] = "nga-v7"
        response["json"]["data"]["interpretation"]["relationEvidence"] = {
            "policy": "catalogue_derivation",
            "status": "unverified",
        }
        observed = {
            "parser": "nga-v7",
            "plan": "nga-plan-v2",
            "contract": "29",
            "apiResultCache": "v8",
        }

        self.assertEqual(
            self.call("evaluate_text_case", case, response, observed)["failureCodes"],
            [],
        )

        response["json"]["data"]["results"] = [
            passing_row(
                metadata={
                    **passing_row()["metadata"],
                    "visualClassification": "Drawing",
                }
            )
        ]
        response["json"]["data"]["count"] = 1
        unsupported = self.call("evaluate_text_case", case, response, observed)
        self.assertIn("unsupported_derived_relation_row", unsupported["failureCodes"])

        response["json"]["data"]["results"] = []
        response["json"]["data"]["count"] = 0
        response["json"]["data"]["interpretation"]["relationEvidence"][
            "status"
        ] = "verified"
        wrong_status = self.call("evaluate_text_case", case, response, observed)
        self.assertIn(
            "derived_verified_empty_evidence_mismatch",
            wrong_status["failureCodes"],
        )

    def test_relation_rows_require_verified_row_evidence(self):
        relation = {
            "kind": "depicts",
            "workClassification": "Painting",
            "subjectClassification": "Sculpture",
        }
        case = {
            "id": "visible-relation-evidence",
            "expected": {
                "constraints": {"classifications": ["Painting"]},
                "relation": relation,
            },
        }
        row = passing_row()
        response = passing_response(
            row=row,
            relation=relation,
            constraints={"classifications": ["Painting"]},
        )
        response["json"]["data"]["interpretation"]["parserVersion"] = "nga-v7"
        response["json"]["data"]["interpretation"]["relationEvidence"] = {
            "policy": "visible_subject",
            "status": "verified",
        }
        response["json"]["data"]["results"][0]["metadata"].pop(
            "relationEvidence"
        )
        result = self.call(
            "evaluate_text_case",
            case,
            response,
            {"parser": "nga-v7"},
        )
        self.assertIn("unverified_relation_row", result["failureCodes"])

        row["metadata"] = {
            **row["metadata"],
            "relationEvidence": {
                "verified": True,
                "source": "institution_metadata",
            },
        }
        response["json"]["data"]["results"] = [row]
        verified = self.call(
            "evaluate_text_case",
            case,
            response,
            {"parser": "nga-v7"},
        )
        self.assertNotIn("unverified_relation_row", verified["failureCodes"])

    def test_attribution_rows_require_exact_catalogue_relationship(self):
        attribution = {"relationship": "direct", "targetText": "Lavinia Fontana"}
        case = {
            "id": "artist-direct-proof",
            "expected": {"constraints": {}, "attribution": attribution},
        }
        row = passing_row()
        row["metadata"] = {
            **row["metadata"],
            "primaryArtistId": "1364",
            "relationEvidence": {"verified": True, "source": "catalogue_artist"},
        }
        response = passing_response(row=row)
        response["json"]["data"]["interpretation"]["attribution"] = attribution
        missing = self.call("evaluate_text_case", case, response, {"parser": "nga-v7"})
        self.assertIn("attribution_hard_filter_violation", missing["failureCodes"])

        response["json"]["data"]["results"][0]["metadata"]["ngaArtists"] = {
            "relationships": [
                {
                    "constituentId": "1364",
                    "displayOrder": 1,
                    "roleType": "artist",
                    "role": "painter",
                    "prefix": None,
                    "suffix": None,
                    "preferredDisplayName": "Lavinia Fontana",
                    "forwardDisplayName": "Lavinia Fontana",
                    "alternativeNames": [],
                }
            ]
        }
        exact = self.call("evaluate_text_case", case, response, {"parser": "nga-v7"})
        self.assertNotIn("attribution_hard_filter_violation", exact["failureCodes"])

    def test_artist_fixture_contract_requires_primary_id_and_top_three(self):
        inventory = json.loads(
            (ROOT / "eval" / "nga-staging-cases.yaml").read_text(encoding="utf-8")
        )
        case = next(
            item for item in inventory["imageCases"] if item["id"] == "image-artist"
        )
        rows = []
        for index in range(4):
            row = passing_row(id=f"open-access-art:nga:neighbor-{index}")
            row["metadata"] = {**row["metadata"], "primaryArtistId": "1364"}
            rows.append(row)
        rows[3]["id"] = "open-access-art:nga:131994"
        response = passing_response(row=rows[0])
        response["headers"]["cache-control"] = "no-store"
        response["json"]["data"]["results"] = rows
        response["json"]["data"]["count"] = len(rows)

        result = self.call("evaluate_image_case", case, response)
        self.assertIn("required_image_target_rank_not_met", result["failureCodes"])

    def test_wrong_artist_id_excludes_fixture_and_all_rows_keep_primary_id(self):
        inventory = json.loads(
            (ROOT / "eval" / "nga-staging-cases.yaml").read_text(encoding="utf-8")
        )
        case = next(
            item
            for item in inventory["imageCases"]
            if item["id"] == "image-artist-wrong-primary"
        )
        fixture = passing_row(id="open-access-art:nga:131994")
        fixture["metadata"] = {
            **fixture["metadata"],
            "primaryArtistId": "1364",
        }
        response = passing_response(row=fixture)
        response["headers"]["cache-control"] = "no-store"
        leaked = self.call("evaluate_image_case", case, response)
        self.assertIn("excluded_image_target_returned", leaked["failureCodes"])
        self.assertIn("hard_constraint_violation", leaked["failureCodes"])

        matching = passing_row(id="open-access-art:nga:1974-work")
        matching["metadata"] = {
            **matching["metadata"],
            "primaryArtistId": "1974",
        }
        response["json"]["data"]["results"] = [matching]
        response["json"]["data"]["count"] = 1
        clean = self.call("evaluate_image_case", case, response)
        self.assertEqual(clean["failureCodes"], [])

    def test_candidate_identity_requires_artist_backfill_binding(self):
        evaluator_sha = "a" * 40
        identity = deployment_identity(git_sha=evaluator_sha)
        identity["api"].update(
            parserVersion="nga-v7",
            planVersion="nga-plan-v2",
            resultCacheVersion="v8",
        )
        identity["web"]["contractVersion"] = "29"
        identity.pop("artistDataBinding")

        result = self.call(
            "evaluate_deployment_binding",
            identity,
            snapshot="candidate",
            evaluator_git_sha=evaluator_sha,
        )
        self.assertIn("artist_data_identity_incomplete", result["failureCodes"])

    def test_artist_data_identity_binds_counts_hashes_vectors_and_production(self):
        evaluator_sha = "a" * 40
        exact = deployment_identity(git_sha=evaluator_sha)
        self.assertEqual(
            self.call(
                "evaluate_deployment_binding",
                exact,
                snapshot="candidate",
                evaluator_git_sha=evaluator_sha,
            )["failureCodes"],
            [],
        )

        mutations = {
            "mapping count": lambda value: value["mapping"].__setitem__(
                "count", 63252
            ),
            "mapping hash": lambda value: value["mapping"].__setitem__(
                "sha256", "bad"
            ),
            "vector hashes": lambda value: value["vectorValues"].__setitem__(
                "hashesSha256", "bad"
            ),
            "vector values changed": lambda value: value["vectorValues"].update(
                enrichedSha256="6" * 64, preserved=False
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                changed = json.loads(json.dumps(exact))
                mutate(changed["artistDataBinding"])
                result = self.call(
                    "evaluate_deployment_binding",
                    changed,
                    snapshot="candidate",
                    evaluator_git_sha=evaluator_sha,
                )
                self.assertIn("artist_data_identity_invalid", result["failureCodes"])

        production_changed = json.loads(json.dumps(exact))
        production_changed["artistDataBinding"]["productionIdentity"][
            "afterSha256"
        ] = "6" * 64
        result = self.call(
            "evaluate_deployment_binding",
            production_changed,
            snapshot="candidate",
            evaluator_git_sha=evaluator_sha,
        )
        self.assertIn("production_artist_data_identity_changed", result["failureCodes"])

    def test_new_case_inventory_covers_every_attribution_role_and_control(self):
        document = json.loads(
            (ROOT / "eval" / "nga-staging-cases.yaml").read_text(encoding="utf-8")
        )
        self.assertEqual(
            document["expectedVersions"],
            {
                "parser": "nga-v7",
                "plan": "nga-plan-v2",
                "contract": "29",
                "apiResultCache": "v8",
            },
        )
        attribution_roles = {
            case.get("expected", {}).get("attribution", {}).get("relationship")
            for case in document["textCases"]
            if case.get("expected", {}).get("attribution")
        }
        self.assertEqual(
            attribution_roles,
            {
                "direct",
                "after",
                "attributed_to",
                "workshop_of",
                "studio_of",
                "circle_of",
                "school_of",
                "follower_of",
            },
        )
        categories = {case["category"] for case in document["textCases"]}
        self.assertTrue(
            {
                "artist-multiword",
                "artist-case-punctuation-dash",
                "artist-combined-constraints",
                "artist-ambiguity-control",
                "visible-relation-weak-tail",
                "derived-verified-empty",
            }.issubset(categories)
        )

    def test_local_version_observation_reads_the_deployed_contract_literals(self):
        self.assertEqual(
            self.call("observe_local_versions", ROOT),
            {
                "parser": "nga-v7",
                "plan": "nga-plan-v2",
                "contract": "29",
                "apiResultCache": "v8",
            },
        )

    def test_legacy_parser_keeps_all_92_cases(self):
        cases = self.call(
            "parse_legacy_cases", ROOT / "eval" / "nga-constraint-queries.yaml"
        )
        self.assertEqual(len(cases), 92)
        self.assertEqual(len({case["id"] for case in cases}), 92)

    def test_legacy_ambiguous_cases_require_safe_empty_constraints_not_unresolved(self):
        cases = self.call(
            "parse_legacy_cases", ROOT / "eval" / "nga-constraint-queries.yaml"
        )
        ambiguous = {
            case["legacyId"]: case["expected"]
            for case in cases
            if case["legacyId"]
            in {"ambiguous-02", "ambiguous-03", "live-regression-04"}
        }
        self.assertEqual(
            set(ambiguous),
            {"ambiguous-02", "ambiguous-03", "live-regression-04"},
        )
        for expected in ambiguous.values():
            self.assertEqual(expected["constraints"], {})
            self.assertNotIn("unresolved", expected)

    def test_all_92_legacy_declared_expectations_match_exact_local_v5(self):
        cases = self.call(
            "parse_legacy_cases", ROOT / "eval" / "nga-constraint-queries.yaml"
        )
        parsed = parse_with_exact_local_v5(cases)
        self.assertEqual(len(parsed), 92)
        failures = {}
        for case, record in zip(cases, parsed, strict=True):
            self.assertEqual(record["id"], case["id"])
            result = self.call(
                "evaluate_declared_interpretation",
                case,
                record["interpretation"],
                "nga-v7",
            )
            if not result["passed"]:
                failures[case["legacyId"]] = result["failures"]
        self.assertEqual(failures, {})

    def test_all_new_declared_expectations_match_exact_local_v7(self):
        cases = json.loads(
            (ROOT / "eval" / "nga-staging-cases.yaml").read_text(encoding="utf-8")
        )["textCases"]
        parsed = parse_with_exact_local_v5(cases)
        failures = {}
        for case, record in zip(cases, parsed, strict=True):
            result = self.call(
                "evaluate_declared_interpretation",
                case,
                record["interpretation"],
                "nga-v7",
            )
            if not result["passed"]:
                failures[case["id"]] = result["failures"]
        self.assertEqual(failures, {})

    def test_unexpected_relation_and_unresolved_fail_clean_legacy_and_new_cases(self):
        legacy_cases = self.call(
            "parse_legacy_cases", ROOT / "eval" / "nga-constraint-queries.yaml"
        )
        legacy_clean = next(
            case for case in legacy_cases if case["legacyId"] == "subject-01"
        )
        inventory = self.call(
            "load_case_inventory",
            ROOT / "eval" / "nga-staging-cases.yaml",
            ROOT / "eval" / "nga-constraint-queries.yaml",
        )
        new_clean = next(
            case
            for case in inventory["textCases"]
            if case["id"] == "academic-user-phrasing"
        )
        explicit_null = next(
            case
            for case in inventory["textCases"]
            if case["id"] == "classification-list"
        )
        unexpected_relation = {
            "kind": "depicts",
            "workClassification": "Painting",
            "subjectClassification": "Sculpture",
        }
        for case in (legacy_clean, new_clean, explicit_null):
            with self.subTest(case=case["id"], mutation="relation"):
                interpretation = {
                    "parserVersion": "nga-v6",
                    "semanticQuery": case.get("expected", {}).get(
                        "semanticQuery", ""
                    ),
                    "constraints": case["expected"]["constraints"],
                    "relation": unexpected_relation,
                    "unresolved": [],
                }
                result = self.call(
                    "evaluate_declared_interpretation",
                    case,
                    interpretation,
                    "nga-v6",
                )
                self.assertIn(
                    "relation_direction_mismatch", result["failureCodes"]
                )

            with self.subTest(case=case["id"], mutation="unresolved"):
                interpretation = {
                    "parserVersion": "nga-v6",
                    "semanticQuery": case.get("expected", {}).get(
                        "semanticQuery", ""
                    ),
                    "constraints": case["expected"]["constraints"],
                    "unresolved": ["invented ambiguity"],
                }
                result = self.call(
                    "evaluate_declared_interpretation",
                    case,
                    interpretation,
                    "nga-v6",
                )
                self.assertIn("unexpected_unresolved", result["failureCodes"])

    def test_explicit_unresolved_cases_still_require_nonempty_unresolved(self):
        legacy_cases = self.call(
            "parse_legacy_cases", ROOT / "eval" / "nga-constraint-queries.yaml"
        )
        legacy_unresolved = [
            case
            for case in legacy_cases
            if case["expected"].get("unresolved") is True
        ]
        self.assertEqual(
            {case["legacyId"] for case in legacy_unresolved}, {"ambiguity-06"}
        )
        inventory = self.call(
            "load_case_inventory",
            ROOT / "eval" / "nga-staging-cases.yaml",
            ROOT / "eval" / "nga-constraint-queries.yaml",
        )
        unresolved_cases = [
            case
            for case in inventory["textCases"]
            if case["expected"].get("unresolved") is True
        ]
        self.assertEqual(
            {case["id"] for case in unresolved_cases},
            {
                "unsupported-relation-near",
                "unsupported-relation-compound",
                "negated-relation-active",
                "negated-relation-without",
                "negated-relation-passive-no",
                "negated-relation-modified-derived",
                "negated-relation-passive-modifier",
                "negated-work-classification",
                "negated-relation-target-no",
            },
        )
        for case in [*legacy_unresolved, *unresolved_cases]:
            result = self.call(
                "evaluate_declared_interpretation",
                case,
                {
                    "parserVersion": "nga-v6",
                    "semanticQuery": case["query"],
                    "constraints": {},
                    "unresolved": [],
                },
                "nga-v6",
            )
            self.assertIn("unresolved_ambiguity_missing", result["failureCodes"])

    def test_case_inventory_has_exact_pilot_and_full_coverage(self):
        inventory = self.call(
            "load_case_inventory",
            ROOT / "eval" / "nga-staging-cases.yaml",
            ROOT / "eval" / "nga-constraint-queries.yaml",
        )
        pilot = self.call("select_cases", inventory, "pilot")
        full = self.call("select_cases", inventory, "full")
        self.assertEqual([case["query"] for case in pilot["text"]], [
            "painting showing a sculpture",
            "sculpture depicted in a painting",
            "paintings and sculptures",
            "oil paintings of ships before 1800",
        ])
        self.assertEqual(len(pilot["text"]) + len(pilot["image"]), 5)
        self.assertEqual(full["counts"]["legacy"], 92)
        self.assertGreaterEqual(full["counts"]["newText"], 24)

    def test_artist_case_and_fixtures_bind_applied_primary_ids(self):
        inventory = json.loads(
            (ROOT / "eval" / "nga-staging-cases.yaml").read_text(encoding="utf-8")
        )
        artist_case = next(
            case for case in inventory["imageCases"] if case["id"] == "image-artist"
        )
        self.assertEqual(artist_case["constraints"]["artistIds"], ["1364"])
        self.assertEqual(artist_case["minimumResults"], 1)
        self.assertEqual(
            artist_case["targetExpectation"],
            {"policy": "required", "maxRank": 3},
        )
        self.assertNotIn("expectedZeroResults", artist_case)

        fixtures = json.loads(
            (ROOT / "eval" / "nga-image-fixtures.json").read_text(encoding="utf-8")
        )["fixtures"]
        expected_ids = {
            "open-access-art:nga:11236": "1974",
            "open-access-art:nga:131994": "1364",
            "open-access-art:nga:110821": "23812",
        }
        self.assertEqual(
            {
                fixture["artworkId"]: fixture["officialPrimaryArtist"][
                    "constituentId"
                ]
                for fixture in fixtures
            },
            expected_ids,
        )
        self.assertEqual(
            {
                fixture["officialPrimaryArtist"]["sourceCommit"]
                for fixture in fixtures
            },
            {"79d114c2186ca38af27a9478717f1e509d799495"},
        )
        self.assertEqual(
            {
                fixture["artworkId"]: fixture["officialPrimaryArtist"][
                    "ingestedPrimaryArtistId"
                ]
                for fixture in fixtures
            },
            expected_ids,
        )

    def test_manual_relevance_metrics_use_human_labels(self):
        metrics = self.call("score_manual_relevance", [3, 0, 2, 1, 0, 3])
        self.assertAlmostEqual(metrics["precisionAt5"], 3 / 5)
        self.assertEqual(metrics["mrr"], 1.0)
        ideal = [3, 3, 2, 1, 0, 0]
        dcg = sum((2**grade - 1) / math.log2(index + 2) for index, grade in enumerate([3, 0, 2, 1, 0, 3]))
        idcg = sum((2**grade - 1) / math.log2(index + 2) for index, grade in enumerate(ideal))
        self.assertAlmostEqual(metrics["ndcgAt10"], dcg / idcg)

    def test_manual_relevance_refuses_similarity_as_labels(self):
        with self.assertRaises(ValueError):
            self.call(
                "score_manual_relevance",
                [{"similarity": 0.99}, {"similarity": 0.8}],
            )

    def test_manual_template_contains_only_unlabelled_rows(self):
        template = self.call(
            "make_manual_grading_template",
            "relation-active",
            [passing_row(), passing_row(id="open-access-art:nga:2")],
        )
        self.assertEqual(template["status"], "manual_review_required")
        self.assertEqual(template["results"][0]["relevance"], None)
        self.assertNotIn("similarity", template["results"][0])

    def test_relevance_label_file_produces_reproducible_summary_metrics(self):
        templates = [
            self.call(
                "make_manual_grading_template",
                "relation-active",
                [passing_row(), passing_row(id="open-access-art:nga:2")],
            )
        ]
        labels = {
            "schemaVersion": "nga-relevance-labels-v1",
            "gradedAt": "2026-08-22T00:00:00Z",
            "reviewer": "release-reviewer",
            "cases": [
                {
                    "caseId": "relation-active",
                    "results": [
                        {"id": "open-access-art:nga:32679", "relevance": 3},
                        {"id": "open-access-art:nga:2", "relevance": 0},
                    ],
                }
            ],
        }
        summary = self.call("summarize_manual_relevance", templates, labels)
        self.assertEqual(summary["status"], "graded")
        self.assertEqual(summary["metrics"]["macro"]["precisionAt5"], 0.2)
        self.assertEqual(summary["metrics"]["macro"]["mrr"], 1.0)
        self.assertIn("labelsSha256", summary)

        labels["cases"][0]["results"][0]["id"] = "wrong-row"
        with self.assertRaises(ValueError):
            self.call("summarize_manual_relevance", templates, labels)

    def test_relevance_labels_cannot_claim_graded_when_no_cases_need_review(self):
        labels = {
            "schemaVersion": "nga-relevance-labels-v1",
            "gradedAt": "2026-08-22T00:00:00Z",
            "reviewer": "release-reviewer",
            "cases": [],
        }
        with self.assertRaisesRegex(ValueError, "no grading templates"):
            self.call("summarize_manual_relevance", [], labels)

    def test_candidate_gate_cannot_pass_with_pending_manual_relevance(self):
        pending = {"status": "manual_review_required", "caseCount": 1}
        candidate = self.call(
            "evaluate_manual_relevance_completion", pending, "candidate"
        )
        baseline = self.call(
            "evaluate_manual_relevance_completion", pending, "baseline"
        )
        graded = self.call(
            "evaluate_manual_relevance_completion",
            {
                "status": "graded",
                "caseCount": 1,
                "metrics": {
                    "byCase": {
                        "relation": {
                            "precisionAt5": 0.4,
                            "strongPrecisionAt5": 0.2,
                            "strongResultsAt5": 1,
                            "strongResultCount": 1,
                            "strongMrr": 1.0,
                            "mrr": 1.0,
                            "ndcgAt10": 0.9,
                        }
                    }
                },
            },
            "candidate",
        )
        weak = self.call(
            "evaluate_manual_relevance_completion",
            {
                "status": "graded",
                "caseCount": 1,
                "metrics": {
                    "byCase": {
                        "relation": {
                            "precisionAt5": 0.0,
                            "mrr": 0.0,
                            "ndcgAt10": 0.0,
                        }
                    }
                },
            },
            "candidate",
        )
        self.assertIn("manual_relevance_incomplete", candidate["failureCodes"])
        self.assertEqual(baseline["failureCodes"], [])
        self.assertEqual(graded["failureCodes"], [])
        self.assertIn(
            "manual_relevance_threshold_not_met", weak["failureCodes"]
        )

    def test_full_candidate_pilot_inspection_binds_reviewed_pilot_evidence(self):
        evaluator_sha = "a" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / "pilot"
            make_complete_evidence_bundle(
                self.gate,
                evidence,
                evaluator_sha=evaluator_sha,
            )
            summary_document = json.loads(
                (evidence / "summary.json").read_text(encoding="utf-8")
            )
            deployment_hash = summary_document["deploymentIdentityHash"]
            summary_path = evidence / "summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            manifest_path = evidence / "artifact-manifest.json"
            summary_bytes = summary_path.read_bytes()
            manifest_bytes = manifest_path.read_bytes()
            inspection = {
                "schemaVersion": "nga-pilot-inspection-v1",
                "decision": "proceed",
                "reviewedAt": "2026-08-22T00:00:00Z",
                "reviewer": "release-reviewer",
                "pilotSummaryPath": "pilot/summary.json",
                "pilotSummarySha256": hashlib.sha256(summary_bytes).hexdigest(),
                "pilotArtifactManifestPath": "pilot/artifact-manifest.json",
                "pilotArtifactManifestSha256": hashlib.sha256(
                    manifest_bytes
                ).hexdigest(),
            }
            inspection_path = root / "inspection.json"
            inspection_path.write_text(json.dumps(inspection), encoding="utf-8")
            result = self.call(
                "evaluate_pilot_inspection",
                inspection_path,
                deployment_identity_hash=deployment_hash,
                evaluator_git_sha=evaluator_sha,
            )
            self.assertEqual(result["failureCodes"], [])
            self.assertEqual(
                result["pilotArtifactManifestSha256"],
                inspection["pilotArtifactManifestSha256"],
            )

            inspection["decision"] = "hold"
            inspection_path.write_text(json.dumps(inspection), encoding="utf-8")
            blocked = self.call(
                "evaluate_pilot_inspection",
                inspection_path,
                deployment_identity_hash=deployment_hash,
                evaluator_git_sha=evaluator_sha,
            )
            self.assertIn("pilot_inspection_not_approved", blocked["failureCodes"])

    def test_pilot_inspection_rejects_synthetic_or_semantically_incomplete_evidence(self):
        deployment_hash = "d" * 64
        evaluator_sha = "a" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            summary = {
                "phase": "pilot",
                "snapshot": "candidate",
                "gatePassed": True,
                "evaluatorGitSha": evaluator_sha,
                "deploymentIdentityHash": deployment_hash,
                "manualRelevance": {"status": "graded"},
            }
            summary_path = root / "summary.json"
            summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
            inspection = {
                "schemaVersion": "nga-pilot-inspection-v1",
                "decision": "proceed",
                "reviewedAt": "2026-08-22T00:00:00Z",
                "reviewer": "release-reviewer",
                "pilotSummaryPath": "summary.json",
                "pilotSummarySha256": hashlib.sha256(
                    summary_path.read_bytes()
                ).hexdigest(),
            }
            inspection_path = root / "inspection.json"
            inspection_path.write_text(json.dumps(inspection), encoding="utf-8")
            result = self.call(
                "evaluate_pilot_inspection",
                inspection_path,
                deployment_identity_hash=deployment_hash,
                evaluator_git_sha=evaluator_sha,
            )
            self.assertIn("pilot_artifact_manifest_missing", result["failureCodes"])

    def test_pilot_inspection_rejects_self_consistent_wrong_cases_and_metrics(self):
        evaluator_sha = "a" * 40
        mutations = {
            "wrong case ids": lambda summary, inventory: inventory.__setitem__(
                "textCaseIds", ["wrong", *PILOT_TEXT_IDS[1:]]
            ),
            "wrong hard pass count": lambda summary, _inventory: summary[
                "text"
            ].__setitem__("passed", 3),
            "missing relevance metrics": lambda summary, _inventory: summary[
                "manualRelevance"
            ].__setitem__("metrics", None),
            "wrong relation ids": lambda summary, _inventory: summary[
                "manualRelevance"
            ]["metrics"].__setitem__(
                "byCase", {"wrong": {"precisionAt5": 1, "mrr": 1, "ndcgAt10": 1}}
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                evidence = root / "pilot"
                make_complete_evidence_bundle(
                    self.gate,
                    evidence,
                    evaluator_sha=evaluator_sha,
                )
                summary_path = evidence / "summary.json"
                inventory_path = evidence / "case-inventory.json"
                manifest_path = evidence / "artifact-manifest.json"
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
                deployment_hash = summary["deploymentIdentityHash"]
                inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
                mutate(summary, inventory)
                summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
                inventory_path.write_text(
                    json.dumps(inventory) + "\n", encoding="utf-8"
                )
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                for relative in ("summary.json", "case-inventory.json"):
                    path = evidence / relative
                    manifest["artifacts"][relative].update(
                        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                        byteLength=path.stat().st_size,
                    )
                manifest_path.write_text(
                    json.dumps(manifest) + "\n", encoding="utf-8"
                )
                inspection = {
                    "schemaVersion": "nga-pilot-inspection-v1",
                    "decision": "proceed",
                    "reviewedAt": "2026-08-22T00:00:00Z",
                    "reviewer": "release-reviewer",
                    "pilotSummaryPath": "pilot/summary.json",
                    "pilotSummarySha256": hashlib.sha256(
                        summary_path.read_bytes()
                    ).hexdigest(),
                    "pilotArtifactManifestPath": "pilot/artifact-manifest.json",
                    "pilotArtifactManifestSha256": hashlib.sha256(
                        manifest_path.read_bytes()
                    ).hexdigest(),
                }
                inspection_path = root / "inspection.json"
                inspection_path.write_text(
                    json.dumps(inspection), encoding="utf-8"
                )
                result = self.call(
                    "evaluate_pilot_inspection",
                    inspection_path,
                    deployment_identity_hash=deployment_hash,
                    evaluator_git_sha=evaluator_sha,
                )
                self.assertFalse(result["passed"], result)

    def test_rehash_manifest_includes_python_and_later_playwright_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = make_complete_evidence_bundle(self.gate, root)
            self.assertEqual(
                set(first["groups"]), {"python", "playwright"}
            )
            self.assertIn("summary.json", first["artifacts"])
            self.assertIn(
                "playwright/playwright-report.json", first["artifacts"]
            )
            self.assertIn(
                "playwright/playwright-artifacts/.last-run.json",
                first["artifacts"],
            )
            self.assertEqual(first["phase"], "pilot")
            self.assertEqual(first["snapshot"], "candidate")
            self.assertEqual(first["evaluatorGitSha"], "a" * 40)
            self.assertEqual(
                first["runId"], "0123456789abcdef0123456789abcdef"
            )

            later_trace = playwright_artifact_dir(root, 0) / "trace.zip"
            changed_trace = trace_evidence(99)
            later_trace.write_bytes(changed_trace)
            second = self.call("rehash_evidence", root)
            later_trace_relative = later_trace.relative_to(root).as_posix()
            self.assertEqual(
                second["artifacts"][later_trace_relative]["sha256"],
                hashlib.sha256(changed_trace).hexdigest(),
            )
            manifest = json.loads(
                (root / "artifact-manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(second, manifest)

    def test_rehash_manifest_retains_same_run_canonical_relevance_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = make_complete_evidence_bundle(self.gate, root)
            relative = "relevance-labels.json"
            self.assertIn(relative, manifest["artifacts"])
            retained = json.loads((root / relative).read_text(encoding="utf-8"))
            summary = json.loads((root / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(retained["schemaVersion"], "nga-retained-relevance-labels-v1")
            self.assertEqual(retained["runId"], summary["runId"])
            self.assertEqual(retained["snapshot"], summary["snapshot"])
            self.assertEqual(
                self.call("sha256_json", retained["labels"]),
                summary["manualRelevance"]["labelsSha256"],
            )

    def test_rehash_requires_retained_labels_and_recomputes_hash_and_metrics(self):
        mutations = {
            "synthetic labels hash": lambda summary: summary["manualRelevance"].__setitem__(
                "labelsSha256", "f" * 64
            ),
            "synthetic metrics": lambda summary: summary["manualRelevance"].__setitem__(
                "metrics",
                {
                    "byCase": {
                        case_id: {
                            "precisionAt5": 1.0,
                            "mrr": 1.0,
                            "ndcgAt10": 1.0,
                        }
                        for case_id in PILOT_RELATION_IDS
                    },
                    "macro": {
                        "precisionAt5": 1.0,
                        "mrr": 1.0,
                        "ndcgAt10": 1.0,
                    },
                },
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                make_complete_evidence_bundle(self.gate, root)
                summary_path = root / "summary.json"
                manual_path = root / "manual-relevance.json"
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
                manual = json.loads(manual_path.read_text(encoding="utf-8"))
                mutate(summary)
                manual["summary"] = summary["manualRelevance"]
                manual["evaluation"] = self.call(
                    "evaluate_manual_relevance_completion",
                    manual["summary"],
                    summary["snapshot"],
                )
                summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
                manual_path.write_text(json.dumps(manual) + "\n", encoding="utf-8")
                with self.assertRaises(self.gate.GateStopped):
                    self.call("rehash_evidence", root)

    def test_pilot_authorization_recomputes_labels_instead_of_trusting_summary(self):
        evaluator_sha = "a" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / "pilot"
            make_complete_evidence_bundle(
                self.gate, evidence, evaluator_sha=evaluator_sha
            )
            for relative in ("summary.json", "manual-relevance.json"):
                json_mutate(
                    evidence / relative,
                    lambda document: (
                        document["manualRelevance"]
                        if relative == "summary.json"
                        else document["summary"]
                    ).__setitem__("labelsSha256", "f" * 64),
                )
            json_mutate(
                evidence / "manual-relevance.json",
                lambda document: document.__setitem__(
                    "evaluation",
                    self.call(
                        "evaluate_manual_relevance_completion",
                        document["summary"],
                        "candidate",
                    ),
                ),
            )
            manifest_path = evidence / "artifact-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for relative in ("summary.json", "manual-relevance.json"):
                path = evidence / relative
                manifest["artifacts"][relative].update(
                    sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    byteLength=path.stat().st_size,
                )
            manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
            summary_path = evidence / "summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            inspection = {
                "schemaVersion": "nga-pilot-inspection-v1",
                "decision": "proceed",
                "reviewedAt": "2026-08-22T00:00:00Z",
                "reviewer": "release-reviewer",
                "pilotSummaryPath": "pilot/summary.json",
                "pilotSummarySha256": hashlib.sha256(
                    summary_path.read_bytes()
                ).hexdigest(),
                "pilotArtifactManifestPath": "pilot/artifact-manifest.json",
                "pilotArtifactManifestSha256": hashlib.sha256(
                    manifest_path.read_bytes()
                ).hexdigest(),
            }
            inspection_path = root / "inspection.json"
            inspection_path.write_text(json.dumps(inspection), encoding="utf-8")
            result = self.call(
                "evaluate_pilot_inspection",
                inspection_path,
                deployment_identity_hash=summary["deploymentIdentityHash"],
                evaluator_git_sha=evaluator_sha,
            )
            self.assertFalse(result["passed"], result)

    def test_rehash_rejects_foreign_run_records_and_forged_deployment_binding(self):
        mutations = {
            "foreign raw run": lambda root: json_mutate(
                root / "raw/text/relation-active-depicts.json",
                lambda record: record.__setitem__("runId", "f" * 32),
            ),
            "forged deployment verdict": lambda root: json_mutate(
                root / "identity.json",
                lambda record: record["deploymentIdentity"]["api"].__setitem__(
                    "deploymentId", "copied-foreign-deployment"
                ),
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                make_complete_evidence_bundle(self.gate, root)
                mutate(root)
                with self.assertRaises(self.gate.GateStopped):
                    self.call("rehash_evidence", root)

    def test_rehash_binds_every_required_record_to_one_run_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_complete_evidence_bundle(self.gate, root, phase="full")
            paths = [
                "identity.json",
                "summary.json",
                "manual-relevance.json",
                "playwright-handoff.json",
                "raw/text/relation-active-depicts.json",
                "raw/image/image-pilot-painting-date.json",
                "raw/cache-probe.json",
                "raw/image-identity-probe.json",
                "raw/image-negative-probes.json",
                "raw/ngs-probe.json",
            ]
            for relative in paths:
                with self.subTest(path=relative):
                    path = root / relative
                    original = path.read_bytes()
                    json_mutate(
                        path,
                        lambda record: record.__setitem__("runId", "f" * 32),
                    )
                    with self.assertRaises(self.gate.GateStopped):
                        self.call("rehash_evidence", root)
                    path.write_bytes(original)

            report_path = root / "playwright/playwright-report.json"
            original_report = report_path.read_bytes()
            json_mutate(
                report_path,
                lambda report: report["config"]["metadata"]["ngaStagingRun"].__setitem__(
                    "runId", "f" * 32
                ),
            )
            with self.assertRaises(self.gate.GateStopped):
                self.call("rehash_evidence", root)
            report_path.write_bytes(original_report)

    def test_rehash_recomputes_requests_responses_and_stored_evaluations(self):
        def wrong_request(root):
            json_mutate(
                root / "raw/text/relation-active-depicts.json",
                lambda record: record["request"]["body"].__setitem__(
                    "query", "copied foreign query"
                ),
            )

        def forged_text_result(root):
            def mutate(record):
                record["response"]["json"]["data"]["results"][0]["metadata"].pop(
                    "sourceUrl"
                )
                refresh_response_digest(record["response"])

            json_mutate(root / "raw/text/relation-active-depicts.json", mutate)

        def forged_cache_result(root):
            def mutate(record):
                record["changed"] = record["first"]

            json_mutate(root / "raw/cache-probe.json", mutate)

        for label, mutate in {
            "wrong committed request": wrong_request,
            "forged passing text evaluation": forged_text_result,
            "forged passing cache evaluation": forged_cache_result,
        }.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                make_complete_evidence_bundle(self.gate, root)
                mutate(root)
                with self.assertRaises(self.gate.GateStopped):
                    self.call("rehash_evidence", root)

    def test_rehash_requires_artist_and_verified_empty_browser_evidence(self):
        required_titles = {
            "direct artist attribution returns the pinned primary-artist fixture",
            "derived relation empty state reports unverified catalogue evidence",
        }
        self.assertTrue(required_titles.issubset(set(PLAYWRIGHT_TITLES)))
        for title in sorted(required_titles):
            with self.subTest(title=title), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                make_complete_evidence_bundle(self.gate, root)
                report_path = root / "playwright/playwright-report.json"
                report = json.loads(report_path.read_text(encoding="utf-8"))
                report["suites"][0]["specs"] = [
                    spec
                    for spec in report["suites"][0]["specs"]
                    if spec["title"] != title
                ]
                report["stats"]["expected"] -= 1
                report_path.write_text(json.dumps(report) + "\n", encoding="utf-8")
                with self.assertRaises(self.gate.GateStopped):
                    self.call("rehash_evidence", root)

    def test_rehash_requires_exact_passing_browser_specs_and_real_artifacts(self):
        def wrong_title(root):
            json_mutate(
                root / "playwright/playwright-report.json",
                lambda report: report["suites"][0]["specs"][0].__setitem__(
                    "title", "foreign test"
                ),
            )

        def failed_status(root):
            json_mutate(
                root / "playwright/playwright-report.json",
                lambda report: report["suites"][0]["specs"][0]["tests"][0][
                    "results"
                ][0].__setitem__("status", "failed"),
            )

        def wrong_project(root):
            json_mutate(
                root / "playwright/playwright-report.json",
                lambda report: report["suites"][0]["specs"][0]["tests"][0].__setitem__(
                    "projectName", "chromium"
                ),
            )

        def fake_png(root):
            playwright_screenshot_path(root, 0).write_bytes(b"not a png")

        def fake_zip(root):
            (playwright_artifact_dir(root, 0) / "trace.zip").write_bytes(
                b"PK\x03\x04not-readable"
            )

        for label, mutate in {
            "wrong title": wrong_title,
            "failed result": failed_status,
            "wrong project": wrong_project,
            "fake png": fake_png,
            "fake trace": fake_zip,
        }.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                make_complete_evidence_bundle(self.gate, root)
                mutate(root)
                with self.assertRaises(self.gate.GateStopped):
                    self.call("rehash_evidence", root)

    def test_rehash_binds_each_browser_result_to_its_exact_attachments(self):
        mutations = {
            "swapped attachment pair": lambda report: (
                report["suites"][0]["specs"][0]["tests"][0]["results"][0].__setitem__(
                    "attachments",
                    report["suites"][0]["specs"][1]["tests"][0]["results"][0]["attachments"],
                ),
                report["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"][0].__setitem__(
                    "name", PLAYWRIGHT_SCREENSHOTS[0]
                ),
            ),
            "swapped screenshot": lambda report: report["suites"][0]["specs"][0][
                "tests"
            ][0]["results"][0]["attachments"][0].__setitem__(
                "path", report["suites"][0]["specs"][1]["tests"][0]["results"][0]["attachments"][0]["path"]
            ),
            "duplicate screenshot": lambda report: report["suites"][0]["specs"][1][
                "tests"
            ][0]["results"][0]["attachments"][0].__setitem__(
                "path", report["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"][0]["path"]
            ),
            "missing screenshot": lambda report: report["suites"][0]["specs"][0][
                "tests"
            ][0]["results"][0].__setitem__("attachments", report["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"][1:]),
            "extra attachment": lambda report: report["suites"][0]["specs"][0][
                "tests"
            ][0]["results"][0]["attachments"].append(
                {
                    "name": "extra",
                    "contentType": "text/plain",
                    "path": report["suites"][0]["specs"][0]["tests"][0]["results"][0]["attachments"][0]["path"],
                }
            ),
            "wrong screenshot content type": lambda report: report["suites"][0]["specs"][0][
                "tests"
            ][0]["results"][0]["attachments"][0].__setitem__(
                "contentType", "application/octet-stream"
            ),
            "foreign screenshot": lambda report: report["suites"][0]["specs"][0][
                "tests"
            ][0]["results"][0]["attachments"][0].__setitem__(
                "path", "/tmp/foreign.png"
            ),
            "foreign test id": lambda report: report["suites"][0]["specs"][0].__setitem__(
                "id", "foreign-id"
            ),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                make_complete_evidence_bundle(self.gate, root)
                json_mutate(root / "playwright/playwright-report.json", mutate)
                with self.assertRaises(self.gate.GateStopped):
                    self.call("rehash_evidence", root)

    def test_rehash_rejects_readable_non_playwright_trace_zip(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_complete_evidence_bundle(self.gate, root)
            arbitrary = io.BytesIO()
            with zipfile.ZipFile(arbitrary, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("arbitrary.json", '{"not":"a playwright trace"}')
            (playwright_artifact_dir(root, 0) / "trace.zip").write_bytes(arbitrary.getvalue())
            with self.assertRaises(self.gate.GateStopped):
                self.call("rehash_evidence", root)

    def test_pilot_inspection_rejects_self_consistent_failed_raw_case(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / "pilot"
            make_complete_evidence_bundle(self.gate, evidence)
            raw_relative = "raw/text/relation-active-depicts.json"
            raw_path = evidence / raw_relative
            raw = json.loads(raw_path.read_text(encoding="utf-8"))
            raw["evaluation"] = {
                "passed": False,
                "failures": [{"code": "hard_constraint_violation"}],
            }
            raw_path.write_text(json.dumps(raw) + "\n", encoding="utf-8")
            manifest_path = evidence / "artifact-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["artifacts"][raw_relative].update(
                sha256=hashlib.sha256(raw_path.read_bytes()).hexdigest(),
                byteLength=raw_path.stat().st_size,
            )
            manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
            summary_path = evidence / "summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            inspection = {
                "schemaVersion": "nga-pilot-inspection-v1",
                "decision": "proceed",
                "reviewedAt": "2026-08-22T00:00:00Z",
                "reviewer": "release-reviewer",
                "pilotSummaryPath": "pilot/summary.json",
                "pilotSummarySha256": hashlib.sha256(
                    summary_path.read_bytes()
                ).hexdigest(),
                "pilotArtifactManifestPath": "pilot/artifact-manifest.json",
                "pilotArtifactManifestSha256": hashlib.sha256(
                    manifest_path.read_bytes()
                ).hexdigest(),
            }
            inspection_path = root / "inspection.json"
            inspection_path.write_text(json.dumps(inspection), encoding="utf-8")
            result = self.call(
                "evaluate_pilot_inspection",
                inspection_path,
                deployment_identity_hash=summary["deploymentIdentityHash"],
                evaluator_git_sha="a" * 40,
            )
            self.assertFalse(result["passed"], result)

    def test_rehash_fails_closed_for_absent_empty_incomplete_or_mixed_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            absent = root / "absent"
            with self.assertRaises(self.gate.GateStopped):
                self.call("rehash_evidence", absent)
            self.assertFalse(absent.exists())

            empty = root / "empty"
            empty.mkdir()
            with self.assertRaises(self.gate.GateStopped):
                self.call("rehash_evidence", empty)
            self.assertFalse((empty / "artifact-manifest.json").exists())

            incomplete = root / "incomplete"
            incomplete.mkdir()
            (incomplete / "summary.json").write_text("{}\n", encoding="utf-8")
            with self.assertRaises(self.gate.GateStopped):
                self.call("rehash_evidence", incomplete)

            mixed = root / "mixed"
            make_complete_evidence_bundle(self.gate, mixed)
            report_path = mixed / "playwright/playwright-report.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["config"]["metadata"]["ngaStagingRun"]["snapshot"] = "baseline"
            report_path.write_text(json.dumps(report) + "\n", encoding="utf-8")
            with self.assertRaises(self.gate.GateStopped):
                self.call("rehash_evidence", mixed)

    def test_rehash_full_requires_full_only_negative_probe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_complete_evidence_bundle(self.gate, root, phase="full")
            (root / "raw/image-negative-probes.json").unlink()
            with self.assertRaises(self.gate.GateStopped):
                self.call("rehash_evidence", root)

    def test_rehash_baseline_can_capture_complete_failing_gate_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            make_complete_evidence_bundle(
                self.gate, root, snapshot="baseline"
            )
            raw_path = root / "raw/text/relation-active-depicts.json"
            raw = json.loads(raw_path.read_text(encoding="utf-8"))
            raw["response"]["json"]["data"]["results"][0]["metadata"].pop(
                "sourceUrl"
            )
            refresh_response_digest(raw["response"])
            raw["evaluation"] = self.call(
                "evaluate_text_case",
                raw["case"],
                raw["response"],
                {"parser": "nga-v4"},
            )
            raw_path.write_text(json.dumps(raw) + "\n", encoding="utf-8")
            summary_path = root / "summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["text"]["passed"] = 3
            summary["gatePassed"] = False
            summary["failureCount"] = 1
            summary["gateFailures"] = [
                {"scope": "text", "code": "hard_constraint_violation"}
            ]
            summary_path.write_text(json.dumps(summary) + "\n", encoding="utf-8")
            manifest = self.call("rehash_evidence", root)
            self.assertEqual(manifest["snapshot"], "baseline")

    def test_rehash_cli_returns_nonzero_without_complete_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            self.assertEqual(
                self.gate.main(["rehash", "--out-dir", str(missing)]), 2
            )

    def test_playwright_handoff_enforces_shared_sixty_second_cooldown(self):
        completed = datetime(2026, 8, 22, tzinfo=timezone.utc)
        handoff = self.call(
            "build_playwright_handoff",
            run_id="0123456789abcdef0123456789abcdef",
            phase="pilot",
            snapshot="candidate",
            evaluator_git_sha="a" * 40,
            deployment_identity_hash="d" * 64,
            completed_at=completed,
        )
        self.assertEqual(handoff["cooldownSeconds"], 60)
        self.assertEqual(
            handoff["runId"], "0123456789abcdef0123456789abcdef"
        )
        self.assertEqual(handoff["browserPublicSearchRequestBudget"], 8)
        self.assertEqual(handoff["expectedTestCount"], 9)
        completed_at = datetime.fromisoformat(
            handoff["pythonCompletedAt"].replace("Z", "+00:00")
        )
        not_before = datetime.fromisoformat(
            handoff["playwrightNotBefore"].replace("Z", "+00:00")
        )
        self.assertGreaterEqual((not_before - completed_at).total_seconds(), 60)

    def test_playwright_config_rejects_future_handoff_even_during_discovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            now = datetime.now(timezone.utc)
            handoff = {
                "schemaVersion": "nga-playwright-handoff-v1",
                "runId": "0123456789abcdef0123456789abcdef",
                "phase": "pilot",
                "snapshot": "candidate",
                "evaluatorGitSha": "a" * 40,
                "deploymentIdentityHash": "d" * 64,
                "pythonCompletedAt": now.isoformat().replace("+00:00", "Z"),
                "playwrightNotBefore": (now + timedelta(minutes=10))
                .isoformat()
                .replace("+00:00", "Z"),
                "cooldownSeconds": 60,
                "browserPublicSearchRequestBudget": 8,
                "expectedTestCount": 9,
            }
            binding = root / "playwright-handoff.json"
            binding.write_text(json.dumps(handoff) + "\n", encoding="utf-8")
            environment = {
                **os.environ,
                "NGA_STAGING_EVIDENCE_DIR": str(root / "playwright"),
                "NGA_STAGING_RUN_BINDING": str(binding),
            }
            command = [
                "pnpm",
                "--filter",
                "@paillette/web",
                "exec",
                "playwright",
                "test",
                "--config",
                "playwright.staging.config.ts",
                "--list",
            ]
            blocked = subprocess.run(
                command,
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(blocked.returncode, 0)
            self.assertIn("cooldown", f"{blocked.stdout}\n{blocked.stderr}".lower())

            handoff["pythonCompletedAt"] = (now - timedelta(minutes=2))
            handoff["playwrightNotBefore"] = (now - timedelta(minutes=1))
            handoff = {
                key: (
                    value.isoformat().replace("+00:00", "Z")
                    if isinstance(value, datetime)
                    else value
                )
                for key, value in handoff.items()
            }
            binding.write_text(json.dumps(handoff) + "\n", encoding="utf-8")
            allowed = subprocess.run(
                command,
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(allowed.returncode, 0, allowed.stderr)

    def test_browser_gate_has_deterministic_out_of_order_result_ownership(self):
        source = (ROOT / "apps/web/e2e/nga-staging-gate.spec.ts").read_text(
            encoding="utf-8"
        )
        config = (ROOT / "apps/web/playwright.staging.config.ts").read_text(
            encoding="utf-8"
        )
        self.assertIn("controlled out-of-order image responses", source)
        self.assertIn("page.route(", source)
        self.assertIn("replacement result title", source)
        self.assertIn("candidate result title", source)
        self.assertIn("separate live same-filename image requests", source)
        self.assertIn("NGA_STAGING_LIVE_REQUEST_BUDGET", source)
        self.assertIn(
            "expect(summary.live).toBe(LIVE_PUBLIC_SEARCH_REQUEST_BUDGET)",
            source,
        )
        self.assertIn(
            "direct artist attribution returns the pinned primary-artist fixture",
            source,
        )
        self.assertIn(
            "derived relation empty state reports unverified catalogue evidence",
            source,
        )
        self.assertIn("screenshot: 'off'", config)
        self.assertNotIn("screenshot: 'on'", config)


if __name__ == "__main__":
    unittest.main()
