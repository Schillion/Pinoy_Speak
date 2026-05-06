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

# Stash static seed/reference files in /app/seeds so they survive the
# volume mount that shadows /app/data at runtime.  The entrypoint copies
# any missing seeds to the volume on every start.
RUN mkdir -p /app/seeds && \
    find /app/data -maxdepth 1 -type f \( -name "*.json" -o -name "*.txt" \) \
         -exec cp {} /app/seeds/ \;

# Ensure runtime data directory exists (Fly volume mounts here)
RUN mkdir -p /app/data

# Make entrypoint executable
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

CMD ["/app/entrypoint.sh"]
