#!/bin/bash
set -e

mkdir -p /app/data

exec /app/.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
