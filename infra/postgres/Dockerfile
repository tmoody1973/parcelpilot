# PostgreSQL 16 + PostGIS 3.4 (from the official postgis image) + pgvector from the PGDG apt repo.
# No stock image ships both, so this is the one custom image in the local stack.
FROM postgis/postgis:16-3.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-pgvector \
 && rm -rf /var/lib/apt/lists/*
COPY initdb/ /docker-entrypoint-initdb.d/
