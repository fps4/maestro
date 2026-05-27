# maestro orchestrator — the workspace read API (S1, read-only — ADR-0018).
# Python + the stdlib HTTP server (no web framework). Build context = repo ROOT:
#   docker build -f infra/docker/orchestrator.Dockerfile .
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    MAESTRO_DB=/data/maestro.db

# Install just the engine package + its deps (anthropic, PyYAML). The read API uses no web framework.
COPY pyproject.toml ./
COPY model ./model
COPY orchestrator ./orchestrator
COPY adapters ./adapters
RUN pip install --no-cache-dir . && mkdir -p /data

# The private register (config/products.yaml, ADR-0010) is mounted at runtime, never baked in.
# GITHUB_TOKEN (for authenticated content reads) is passed via env at runtime.
EXPOSE 8800
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 \
    CMD python -c "import socket,sys; s=socket.socket(); s.settimeout(2); \
sys.exit(0 if s.connect_ex(('127.0.0.1',8800))==0 else 1)"

CMD ["maestro", "serve", "--host", "0.0.0.0", "--port", "8800"]
