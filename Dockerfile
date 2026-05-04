# ── Stage 1: Install dependencies ──
FROM python:3.12.9-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN python -m venv .venv
COPY requirements.txt ./
RUN .venv/bin/pip install --no-cache-dir -r requirements.txt && \
    .venv/bin/python -m spacy download en_core_web_sm && \
    .venv/bin/pip install --no-cache-dir https://huggingface.co/ljvmiranda921/tl_calamancy_md/resolve/main/tl_calamancy_md-0.1.0-py3-none-any.whl

# ── Stage 2: Runtime ──
FROM python:3.12.9-slim

WORKDIR /app

# Copy the virtual environment from the builder
COPY --from=builder /app/.venv .venv/

# Copy application code only (data lives on the persistent volume)
COPY . .

# Ensure data directory exists (Fly volume mounts here)
RUN mkdir -p /app/data

EXPOSE 8000

CMD ["/app/.venv/bin/uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
