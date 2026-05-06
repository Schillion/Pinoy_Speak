# ── Stage 1: Install dependencies ──
FROM python:3.12.9-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN python -m venv .venv
COPY requirements.txt ./
RUN .venv/bin/pip install --no-cache-dir -r requirements.txt && \
    .venv/bin/python -m spacy download en_core_web_sm && \
    .venv/bin/python -c "import urllib.request, zipfile; urllib.request.urlretrieve('https://huggingface.co/ljvmiranda921/tl_calamancy_md/resolve/main/tl_calamancy_md-any-py3-none-any.whl', 'model.whl'); zipfile.ZipFile('model.whl', 'r').extractall('.venv/lib/python3.12/site-packages/');"

# ── Stage 2: Runtime ──
FROM python:3.12.9-slim

WORKDIR /app

# Copy the virtual environment from the builder
COPY --from=builder /app/.venv .venv/

# Copy application code only (data lives on the persistent volume)
COPY . .

# Bundle the ML model files into a separate path so the Fly.io volume
# mount at /app/data does NOT shadow them.  The entrypoint copies any
# missing files from the bundle → volume on first boot.
RUN if [ -d /app/data ]; then \
      mkdir -p /app/model_bundle && \
      cp -n /app/data/social_model.model* /app/model_bundle/ 2>/dev/null || true && \
      cp -n /app/data/corpus.db           /app/model_bundle/ 2>/dev/null || true && \
      cp -n /app/data/discovered_slang.json /app/model_bundle/ 2>/dev/null || true; \
    fi

# Ensure runtime data directory exists (Fly volume mounts here)
RUN mkdir -p /app/data

# Make entrypoint executable
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

CMD ["/app/entrypoint.sh"]
