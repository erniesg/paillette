from __future__ import annotations

import importlib.util
import json
import math
import sys
import tempfile
import unittest
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

    def test_missing_or_ambiguous_live_contract_cannot_fall_back_to_local(self):
        local_versions = {
            "parser": "nga-v5",
            "plan": "nga-plan-v1",
            "contract": "27",
            "apiResultCache": "v6",
        }
        missing = self.call(
            "resolve_observed_versions", local_versions, []
        )
        ambiguous = self.call(
            "resolve_observed_versions", local_versions, ["26", "27"]
        )
        self.assertEqual(missing["contract"], "unobserved")
        self.assertEqual(ambiguous["contract"], "ambiguous:26,27")


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

    def test_malformed_source_url_is_a_violation_not_an_evaluator_crash(self):
        row = passing_row()
        row["metadata"] = {
            **row["metadata"],
            "sourceUrl": "https://nga.gov:not-a-port/object",
        }
        violations = self.call("inspect_row", row, {})
        self.assertIn("source", [item["constraint"] for item in violations])

    def test_parser_plan_and_contract_version_mismatch_fails(self):
        response = passing_response()
        response["json"]["data"]["interpretation"]["parserVersion"] = "nga-v4"
        result = self.call(
            "evaluate_text_case",
            {"id": "version", "expected": {"constraints": {}}},
            response,
            observed_versions={
                "plan": "nga-plan-v0",
                "contract": "26",
                "apiResultCache": "v5",
            },
        )
        self.assertTrue(
            {
                "parser_version_mismatch",
                "plan_version_mismatch",
                "contract_version_mismatch",
                "cache_version_mismatch",
            }.issubset(result["failureCodes"])
        )


class ScopeAndCacheTests(GateTestCase):
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
        probes = {
            "invalid_mime": {"status": 400},
            "zero_byte": {"status": 400},
            "multiple_files": {"status": 400},
            "oversize": {"status": 413},
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


if __name__ == "__main__":
    unittest.main()
