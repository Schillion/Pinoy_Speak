#!/bin/bash
# Bootstrap the persistent volume on first launch.
# The Docker image ships model files under /app/model_bundle so they survive
# the volume mount shadowing /app/data.  On every start we copy any missing
# files (corpus, FastText model + numpy shards) from the bundle to the volume
# without overwriting files that a later training run has updated.

set -e

BUNDLE=/app/model_bundle
DATA=/app/data

mkdir -p "$DATA"

if [ -d "$BUNDLE" ]; then
  echo "[entrypoint] Checking volume bootstrap from $BUNDLE …"
  for f in "$BUNDLE"/*; do
    fname=$(basename "$f")
    if [ ! -f "$DATA/$fname" ]; then
      echo "[entrypoint]   copying $fname to volume …"
      cp "$f" "$DATA/$fname"
    else
      echo "[entrypoint]   $fname already in volume — skipping."
    fi
  done
  echo "[entrypoint] Volume bootstrap complete."
fi

exec /app/.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
