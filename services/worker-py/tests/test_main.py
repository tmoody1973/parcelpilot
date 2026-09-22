"""worker-py API (MOO-832): /rerank answers 503 when the local reranker is not installed, and never crashes."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import main


def test_health():
    assert TestClient(main.app).get("/health").json() == {"status": "ok"}


def test_rerank_is_503_without_the_eval_install(monkeypatch):
    def missing():
        raise ImportError("sentence_transformers")

    monkeypatch.setattr(main, "_cross_encoder", missing)
    r = TestClient(main.app).post("/rerank", json={"query": "height", "documents": ["a"]})
    assert r.status_code == 503 and "eval" in r.json()["detail"]


def test_rerank_scores_every_document_in_order(monkeypatch):
    class Fake:
        def predict(self, pairs):
            return [float(len(d)) for _, d in pairs]

    monkeypatch.setattr(main, "_cross_encoder", lambda: Fake())
    r = TestClient(main.app).post("/rerank", json={"query": "q", "documents": ["aa", "a", "aaa"]})
    assert r.json()["scores"] == [2.0, 1.0, 3.0]


def test_rerank_validates_input():
    assert TestClient(main.app).post("/rerank", json={"query": "", "documents": []}).status_code == 422
