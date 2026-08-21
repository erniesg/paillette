from __future__ import annotations

import importlib.util
import http.server
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
import threading
import unittest
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
        "parserVersion": "nga-v5",
        "originalQuery": "painting showing a sculpture",
        "semanticQuery": "depicting sculpture",
        "constraints": constraints,
        "corrections": [],
        "unresolved": [],
    }
    if relation is not None:
        interpretation["relation"] = relation
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
    return {
        "schemaVersion": "nga-deployment-identity-v1",
        "snapshot": snapshot,
        "capturedAt": "2026-08-22T00:00:00Z",
        "api": {
            "origin": "https://paillette-api-stg.berlayar.ai",
            "deploymentId": "api-deployment",
            "versionId": "api-version",
            "gitSha": git_sha,
            "apiVersion": "v1",
            "parserVersion": "nga-v5" if snapshot == "candidate" else "nga-v4",
            "planVersion": "nga-plan-v1" if snapshot == "candidate" else "unversioned",
            "resultCacheVersion": "v6" if snapshot == "candidate" else "v5",
        },
        "web": {
            "origin": "https://paillette-stg.berlayar.ai",
            "deploymentId": "web-deployment",
            "versionId": "web-version",
            "gitSha": git_sha,
            "contractVersion": "27" if snapshot == "candidate" else "26",
        },
    }


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
    "07-ngs-locked.png",
]


def make_complete_evidence_bundle(
    gate,
    root: Path,
    *,
    phase="pilot",
    snapshot="candidate",
    evaluator_sha="a" * 40,
    deployment_hash="d" * 64,
):
    inventory = gate.load_case_inventory(
        ROOT / "eval" / "nga-staging-cases.yaml",
        ROOT / "eval" / "nga-constraint-queries.yaml",
    )
    selected = gate.select_cases(inventory, phase)
    text_ids = [case["id"] for case in selected["text"]]
    image_ids = [case["id"] for case in selected["image"]]
    manual_by_case = {
        case_id: {"precisionAt5": 0.8, "mrr": 1.0, "ndcgAt10": 0.9}
        for case_id in PILOT_RELATION_IDS
    }
    manual = {
        "status": "graded",
        "caseCount": len(PILOT_RELATION_IDS),
        "gradedAt": "2026-08-22T00:00:00Z",
        "reviewer": "release-reviewer",
        "labelsSha256": "e" * 64,
        "metrics": {
            "byCase": manual_by_case,
            "macro": {"precisionAt5": 0.8, "mrr": 1.0, "ndcgAt10": 0.9},
        },
    }
    identity = {
        "generatedAt": "2026-08-22T00:00:00Z",
        "evaluatorGitSha": evaluator_sha,
        "phase": phase,
        "snapshot": snapshot,
        "deploymentBinding": {
            "passed": True,
            "deploymentIdentityHash": deployment_hash,
        },
    }
    summary = {
        "generatedAt": "2026-08-22T00:01:00Z",
        "evaluatorGitSha": evaluator_sha,
        "deploymentIdentityHash": deployment_hash,
        "snapshot": snapshot,
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
        "schemaVersion": "nga-playwright-handoff-v1",
        "phase": phase,
        "snapshot": snapshot,
        "evaluatorGitSha": evaluator_sha,
        "deploymentIdentityHash": deployment_hash,
        "pythonCompletedAt": completed.isoformat().replace("+00:00", "Z"),
        "playwrightNotBefore": (completed + timedelta(seconds=60))
        .isoformat()
        .replace("+00:00", "Z"),
        "cooldownSeconds": 60,
        "browserPublicSearchRequestBudget": 6,
        "expectedTestCount": 7,
    }
    summary["playwrightHandoff"] = handoff
    root.mkdir(parents=True, exist_ok=True)
    documents = {
        "identity.json": identity,
        "summary.json": summary,
        "case-inventory.json": case_inventory,
        "fixtures-manifest.json": {"fixtures": []},
        "manual-relevance.json": {"summary": manual, "cases": []},
        "playwright-handoff.json": handoff,
        "raw/cache-probe.json": {"evaluation": {"passed": True}},
        "raw/image-identity-probe.json": {
            "identityEvaluation": {"passed": True},
            "repeat": {"evaluation": {"passed": True}},
        },
        "raw/ngs-probe.json": {"evaluation": {"passed": True}},
    }
    if phase == "full":
        documents["raw/image-negative-probes.json"] = {
            "evaluation": {"passed": True}
        }
    for case_id in text_ids:
        documents[f"raw/text/{case_id.replace(':', '_')}.json"] = {
            "case": {"id": case_id},
            "evaluation": {"passed": True},
        }
    for case_id in image_ids:
        documents[f"raw/image/{case_id}.json"] = {
            "case": {"id": case_id},
            "evaluation": {"passed": True},
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
    report = {
        "config": {
            "metadata": {
                "ngaStagingRun": handoff,
                "bindingSha256": hashlib.sha256(handoff_bytes).hexdigest(),
            }
        },
        "stats": {
            "expected": 7,
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
    for screenshot in PLAYWRIGHT_SCREENSHOTS:
        (playwright / screenshot).write_bytes(b"png evidence")
    for index in range(7):
        trace_dir = artifacts / f"test-{index}"
        trace_dir.mkdir()
        (trace_dir / "trace.zip").write_bytes(b"trace evidence")
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
                        b'<link href="/search-spotlights/nga/v27-'
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

    def test_live_contract_version_is_read_from_the_preload_link_header(self):
        versions = self.call(
            "extract_web_contract_versions",
            {
                "headers": {
                    "link": '</search-spotlights/nga/v27-'
                    + ('a' * 64)
                    + '.json>; rel=preload; as=fetch'
                },
                "body": b"<html></html>",
            },
        )
        self.assertEqual(versions, ["27"])

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
        mismatch = self.call("evaluate_live_contract_binding", ["26"], "27")
        missing = self.call("evaluate_live_contract_binding", [], "27")
        ambiguous = self.call(
            "evaluate_live_contract_binding", ["26", "27"], "27"
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
                "parser": "nga-v5",
                "plan": "nga-plan-v1",
                "contract": "27",
                "apiResultCache": "v6",
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
    def test_local_version_observation_reads_the_deployed_contract_literals(self):
        self.assertEqual(
            self.call("observe_local_versions", ROOT),
            {
                "parser": "nga-v5",
                "plan": "nga-plan-v1",
                "contract": "27",
                "apiResultCache": "v6",
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
                "nga-v5",
            )
            if not result["passed"]:
                failures[case["legacyId"]] = result["failures"]
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
                    "parserVersion": "nga-v5",
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
                    "nga-v5",
                )
                self.assertIn(
                    "relation_direction_mismatch", result["failureCodes"]
                )

            with self.subTest(case=case["id"], mutation="unresolved"):
                interpretation = {
                    "parserVersion": "nga-v5",
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
                    "nga-v5",
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
            {"unsupported-relation-near", "unsupported-relation-compound"},
        )
        for case in [*legacy_unresolved, *unresolved_cases]:
            result = self.call(
                "evaluate_declared_interpretation",
                case,
                {
                    "parserVersion": "nga-v5",
                    "semanticQuery": case["query"],
                    "constraints": {},
                    "unresolved": [],
                },
                "nga-v5",
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

    def test_artist_case_records_official_ids_but_does_not_invent_ingested_ids(self):
        inventory = json.loads(
            (ROOT / "eval" / "nga-staging-cases.yaml").read_text(encoding="utf-8")
        )
        artist_case = next(
            case for case in inventory["imageCases"] if case["id"] == "image-artist"
        )
        self.assertEqual(artist_case["constraints"]["artistIds"], ["1364"])
        self.assertEqual(artist_case["minimumResults"], 1)
        self.assertEqual(
            artist_case["capabilityFailure"],
            "artist_constraint_capability_unproven",
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
        self.assertTrue(
            all(
                fixture["officialPrimaryArtist"]["ingestedPrimaryArtistId"]
                is None
                for fixture in fixtures
            )
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
            {"status": "graded", "caseCount": 1},
            "candidate",
        )
        self.assertIn("manual_relevance_incomplete", candidate["failureCodes"])
        self.assertEqual(baseline["failureCodes"], [])
        self.assertEqual(graded["failureCodes"], [])

    def test_full_candidate_pilot_inspection_binds_reviewed_pilot_evidence(self):
        deployment_hash = "d" * 64
        evaluator_sha = "a" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / "pilot"
            make_complete_evidence_bundle(
                self.gate,
                evidence,
                evaluator_sha=evaluator_sha,
                deployment_hash=deployment_hash,
            )
            summary_path = evidence / "summary.json"
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
        deployment_hash = "d" * 64
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
                    deployment_hash=deployment_hash,
                )
                summary_path = evidence / "summary.json"
                inventory_path = evidence / "case-inventory.json"
                manifest_path = evidence / "artifact-manifest.json"
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
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

            playwright = root / "playwright"
            later_trace = (
                playwright / "playwright-artifacts" / "test-0" / "trace.zip"
            )
            later_trace.write_bytes(b"later changed trace")
            second = self.call("rehash_evidence", root)
            self.assertEqual(
                second["artifacts"][
                    "playwright/playwright-artifacts/test-0/trace.zip"
                ]["sha256"],
                hashlib.sha256(b"later changed trace").hexdigest(),
            )
            manifest = json.loads(
                (root / "artifact-manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(second, manifest)

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
                deployment_identity_hash="d" * 64,
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
            raw["evaluation"] = {
                "passed": False,
                "failures": [{"code": "relation_direction_mismatch"}],
            }
            raw_path.write_text(json.dumps(raw) + "\n", encoding="utf-8")
            summary_path = root / "summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["text"]["passed"] = 3
            summary["gatePassed"] = False
            summary["failureCount"] = 1
            summary["gateFailures"] = [
                {"scope": "text", "code": "relation_direction_mismatch"}
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
            phase="pilot",
            snapshot="candidate",
            evaluator_git_sha="a" * 40,
            deployment_identity_hash="d" * 64,
            completed_at=completed,
        )
        self.assertEqual(handoff["cooldownSeconds"], 60)
        self.assertEqual(handoff["browserPublicSearchRequestBudget"], 6)
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
                "phase": "pilot",
                "snapshot": "candidate",
                "evaluatorGitSha": "a" * 40,
                "deploymentIdentityHash": "d" * 64,
                "pythonCompletedAt": now.isoformat().replace("+00:00", "Z"),
                "playwrightNotBefore": (now + timedelta(minutes=10))
                .isoformat()
                .replace("+00:00", "Z"),
                "cooldownSeconds": 60,
                "browserPublicSearchRequestBudget": 6,
                "expectedTestCount": 7,
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
        self.assertIn("LIVE_PUBLIC_SEARCH_REQUEST_BUDGET = 6", source)
        self.assertIn("livePublicSearchRequestCount", source)
        self.assertIn("screenshot: 'off'", config)
        self.assertNotIn("screenshot: 'on'", config)


if __name__ == "__main__":
    unittest.main()
