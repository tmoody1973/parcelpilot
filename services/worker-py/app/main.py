"""ParcelPilot Python worker: PDF parsing, tables, OCR fallback, embeddings (later issues)."""

from fastapi import FastAPI

app = FastAPI(title="parcelpilot-worker-py")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
