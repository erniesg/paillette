from __future__ import annotations

import hmac
import os
import threading
from base64 import b64decode
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Any, Literal

import numpy as np
import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from PIL import Image
from pydantic import BaseModel, Field
from transformers import AutoModel


MODEL_CONFIG = {
    "jina-clip-v2": {
        "repository": "jinaai/jina-clip-v2",
        "revision": "e10d47f5691d0454a0fb5d13f46f2199b74cb436",
        "kind": "clip",
    },
    "jina-embeddings-v5-text-small": {
        "repository": "jinaai/jina-embeddings-v5-text-small",
        "revision": "dd76d535f5447ca3897a9c893fb1e612ead98192",
        "kind": "text-v5",
    },
}


class EmbeddingRequest(BaseModel):
    model: str
    input: list[str | dict[str, str]]
    task: str = "retrieval.query"
    dimensions: int = 1024
    normalized: bool = True
    embedding_type: Literal["float"] = "float"
    truncate: bool = True


class EmbeddingRegistry:
    def __init__(self) -> None:
        self.models: dict[str, Any] = {}
        self.locks = {name: threading.Lock() for name in MODEL_CONFIG}

    def _load(self, model_name: str):
        config = MODEL_CONFIG[model_name]
        model = AutoModel.from_pretrained(
            config["repository"],
            revision=config["revision"],
            trust_remote_code=True,
            dtype=torch.float32,
        )
        return model.to("cpu").eval()

    def get(self, model_name: str):
        if model_name not in MODEL_CONFIG:
            raise ValueError(f"unsupported model: {model_name}")
        if model_name not in self.models:
            with self.locks[model_name]:
                if model_name not in self.models:
                    self.models[model_name] = self._load(model_name)
        return self.models[model_name]

    def encode(
        self, model_name: str, inputs: list[str | dict[str, str]], task: str
    ) -> np.ndarray:
        model = self.get(model_name)
        config = MODEL_CONFIG[model_name]
        with self.locks[model_name], torch.inference_mode():
            if config["kind"] == "clip":
                if all(isinstance(value, str) or "text" in value for value in inputs):
                    values = model.encode_text(text_inputs(inputs))
                elif all(isinstance(value, dict) and "image" in value for value in inputs):
                    images = [
                        Image.open(BytesIO(b64decode(value["image"]))).convert("RGB")
                        for value in inputs
                        if isinstance(value, dict)
                    ]
                    values = model.encode_image(images)
                else:
                    raise ValueError("mixed text and image batches are not supported")
            else:
                texts = text_inputs(inputs)
                prompt_name = "document" if task == "retrieval.passage" else "query"
                values = model.encode(
                    texts=texts,
                    task="retrieval",
                    prompt_name=prompt_name,
                )
        if hasattr(values, "detach"):
            values = values.detach().cpu().numpy()
        return np.asarray(values, dtype=np.float32)

    def loaded(self) -> list[str]:
        return sorted(self.models)


def text_inputs(values: list[str | dict[str, str]]) -> list[str]:
    texts = []
    for value in values:
        text = value if isinstance(value, str) else value.get("text")
        if not text or not str(text).strip():
            raise ValueError("only non-empty text inputs are supported")
        texts.append(str(text))
    return texts


def normalize_rows(values: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    return values / np.maximum(norms, 1e-8)


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("EMBEDDING_QUERY_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="embedding token is not configured")
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="invalid bearer token")


registry = EmbeddingRegistry()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    preload = [
        value.strip()
        for value in os.environ.get("PRELOAD_MODELS", "").split(",")
        if value.strip()
    ]
    for model_name in preload:
        registry.get(model_name)
    yield


app = FastAPI(
    title="Paillette Query Embeddings",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "loadedModels": registry.loaded()}


@app.post("/v1/embeddings", dependencies=[Depends(require_token)])
def embeddings(request: EmbeddingRequest) -> dict[str, Any]:
    if request.dimensions != 1024:
        raise HTTPException(status_code=400, detail="only 1024 dimensions are supported")
    try:
        values = registry.encode(request.model, request.input, request.task)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if values.shape != (len(request.input), 1024):
        raise HTTPException(status_code=500, detail=f"unexpected shape {values.shape}")
    if request.normalized:
        values = normalize_rows(values)
    return {
        "object": "list",
        "model": request.model,
        "data": [
            {"object": "embedding", "index": index, "embedding": row.tolist()}
            for index, row in enumerate(values)
        ],
        "usage": {"total_tokens": 0, "prompt_tokens": 0},
    }
