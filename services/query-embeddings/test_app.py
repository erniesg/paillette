import os
import unittest
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

import app as service


class QueryEmbeddingServiceTest(unittest.TestCase):
    def setUp(self):
        self.token = mock.patch.dict(os.environ, {"EMBEDDING_QUERY_TOKEN": "test-token"})
        self.token.start()
        self.client = TestClient(service.app)

    def tearDown(self):
        self.token.stop()

    def test_requires_bearer_token(self):
        response = self.client.post(
            "/v1/embeddings",
            json={"model": "jina-clip-v2", "input": ["blue bottle"]},
        )
        self.assertEqual(response.status_code, 401)

    def test_returns_normalized_openai_style_embeddings(self):
        with mock.patch.object(
            service.registry,
            "encode",
            return_value=np.tile(np.asarray([[3.0, 4.0] + [0.0] * 1022]), (2, 1)),
        ):
            response = self.client.post(
                "/v1/embeddings",
                headers={"Authorization": "Bearer test-token"},
                json={
                    "model": "jina-clip-v2",
                    "input": ["blue bottle", {"text": "red bowl"}],
                    "task": "retrieval.query",
                    "dimensions": 1024,
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["data"]), 2)
        self.assertAlmostEqual(payload["data"][0]["embedding"][0], 0.6)
        self.assertAlmostEqual(payload["data"][0]["embedding"][1], 0.8)

    def test_rejects_unsupported_dimensions_before_loading_model(self):
        with mock.patch.object(service.registry, "encode") as encode:
            response = self.client.post(
                "/v1/embeddings",
                headers={"Authorization": "Bearer test-token"},
                json={
                    "model": "jina-clip-v2",
                    "input": ["blue bottle"],
                    "dimensions": 512,
                },
            )
        self.assertEqual(response.status_code, 400)
        encode.assert_not_called()

    def test_text_input_validation(self):
        with self.assertRaisesRegex(ValueError, "non-empty text"):
            service.text_inputs([{"text": ""}])


if __name__ == "__main__":
    unittest.main()
