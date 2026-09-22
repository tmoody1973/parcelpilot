"""ParcelPilot Python worker: PDF parsing, tables, OCR fallback, embeddings (later issues)."""

from __future__ import annotations

from functools import cache

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="parcelpilot-worker-py")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---- /rerank: a local cross-encoder for the MOO-832 bake-off -------------------------------------------------------
# bge-reranker-v2-m3 (Apache-2.0) lives in the `eval` dependency group, not the production image. Without it the
# endpoint answers 503, so the service still starts and the harness reports the option as unavailable.
RERANK_MODEL = "BAAI/bge-reranker-v2-m3"


class RerankRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    documents: list[str] = Field(min_length=1, max_length=100)


@cache
def _cross_encoder():  # loaded once per process, on first use
    from sentence_transformers import CrossEncoder

    return CrossEncoder(RERANK_MODEL, max_length=512)


@app.post("/rerank")
def rerank(req: RerankRequest) -> dict[str, object]:
    try:
        model = _cross_encoder()
    except ImportError as e:
        raise HTTPException(status_code=503, detail="local reranker not installed: uv sync --group eval") from e
    scores = model.predict([(req.query, d) for d in req.documents])
    return {"model": RERANK_MODEL, "scores": [float(s) for s in scores]}
