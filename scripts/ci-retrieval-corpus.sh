#!/usr/bin/env bash
# Builds the subchapter 6 corpus from the committed PDF fixture and scores retrieval against it (MOO-831).
# Used by the CI job `retrieval-eval`; runnable locally against a scratch database. Needs Postgres + MinIO (compose),
# node/pnpm and uv. Env: DATABASE_URL (owner), DATABASE_SERVICE_URL, S3_ENDPOINT.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/zoning-code-pdfs
cp -n services/worker-py/tests/fixtures/CH295-sub6.pdf data/zoning-code-pdfs/CH295-sub6.pdf || true
pnpm db:migrate
pnpm rules:seed                 # registers and activates the cited documents (sub6; sub5 has no PDF in CI and is skipped below)
pnpm ingest:pages               # pages + images from the fixture
pnpm ingest:structure           # sections and chunks
pnpm ingest:tables              # table families and row chunks
# The use table spans five pages, so its merge needs a reviewer. Locally it was approved in the queue (MOO-819 live
# proof); CI mirrors that one decision so the use rows are served. Nothing else is approved here.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qc "update source_tables set merge_review_status = 'approved' where family_key = 'tbl_295_603_1' and merge_review_status = 'unreviewed'"
pnpm corpus:activate
pnpm retrieval:eval --provider local-hash --gate --corpus "CI: CH295-sub6.pdf fixture, local-hash embeddings" --out "${RETRIEVAL_REPORT:-/tmp/retrieval-ci.md}"
