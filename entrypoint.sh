#!/bin/bash
set -e

mkdir -p /app/data

# Copy static seed/reference files from the image into the volume if missing.
# The volume mount at /app/data shadows the image's copy, so we stash seeds
# in /app/seeds at build time and bootstrap them here on every start.
for f in /app/seeds/*; do
  [ -f "$f" ] || continue
  fname=$(basename "$f")
  [ -f "/app/data/$fname" ] || cp "$f" "/app/data/$fname"
done

exec /app/.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
