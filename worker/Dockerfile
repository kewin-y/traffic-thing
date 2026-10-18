# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.13.0 AS uv

FROM python:3.12-slim-bookworm AS base

# Runtime dependencies of the native SUMO wheels; no display server is needed.
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        libatomic1 \
        libexpat1 \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libstdc++6 \
        libx11-6 \
        libxext6 \
        libxrender1 \
        zlib1g \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

FROM base AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project --python /usr/local/bin/python3.12
COPY src/ ./src/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable --python /usr/local/bin/python3.12

FROM build AS test
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --group import --no-editable --python /usr/local/bin/python3.12
ENV PATH="/app/.venv/bin:$PATH"

FROM build AS importer
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --group import --no-editable --python /usr/local/bin/python3.12
ENV PATH="/app/.venv/bin:$PATH"

FROM base AS runtime
RUN groupadd --gid 10001 worker \
    && useradd --uid 10001 --gid 10001 --create-home worker \
    && mkdir -p /data/networks \
    && mkdir -p /data/runs \
    && chown 10001:10001 /data/runs \
    && mkdir -p /data/timelines \
    && chmod 755 /data /data/networks \
    && chown 10001:10001 /data/timelines \
    && chmod 755 /data/timelines
COPY --from=build /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH" \
    NETWORK_ROOT=/data/networks \
    TIMELINE_ROOT=/data/timelines \
    SIMULATION_TIMEOUT_SECONDS=120 \
    MAX_CONCURRENT_SIMULATIONS=1
USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/health', timeout=3).close()"]

CMD ["sh", "-c", "exec uvicorn traffic_worker.api:app --host 0.0.0.0 --port \"${PORT:-8000}\""]
